---
layout: post
title:  "Notes on \"Bigtable: A Distributed Storage System for Structured Data\""
date:   2022-01-26
tags: ["computer_science", "paper_notes"]
---

Bigtable is a distributed storage system for managing structured data. Bigtable resembles a database

## Data model
A Bigtable is a sparse, distributed, persistent multi-dimensional sorted map. The map is indexed by a row key, column key, and a timestamp; each value in the map is an uninterpreted array of bytes. E.g.

```
(row:string, column:string, time:int64) → string
```

### Rows
Every read or write of data under a single row key is atomic. Bigtable maintains data in lexicographic order by row key. The row range for a table is dynamically partitioned. Each row range is called a *tablet*, which is the unit of distribution and load balancing. Row keys can be designed to achieve good locality for data accesses.

### Column Families
Column keys are grouped into sets called *column families*s, which form the basic unit of access control. All data stored in a column family is usually of the same type. Data in the same column family are compressed together. The number of distinct column families in a table be small (in the hundreds at most), and families rarely change during operation. A table may have an unbounded number of columns.

A column key name follows the syntax: `family:qualifier`.

### Timestamps
Each cell in a Bigtable can contain multiple versions of the same data; these versions are indexed by timestamp. They can be assigned by Bigtable or client applications.

Two per-column-family settings are supported to garbage-collect cell versions:
- only the last *n* versions of a cell be kept
- only new-enough versions be kept (e.g., only keep values that were written in the last seven days).

## Building Blocks
* **Storage**: Bigtable uses the distributed GFS to store log and data files.
* **Cluster:** A Bigtable cluster typically operates in a shared pool of machines that run a wide variety of other distributed applications, and Bigtable processes often share the same machines with processes from other applications. Bigtable depends on a cluster management system for scheduling jobs, managing resources on shared machines, dealing with machine failures, and monitoring machine status.
* **SSTable:**
  * The Google **SSTable** file format is used internally to store Bigtable data. An SSTable provides a persistent, ordered immutable map from keys to values, where both keys and values are arbitrary byte strings. Each SSTable contains a sequence of blocks (typically each block is 64KB in size, but this is configurable). A block index (stored at the end of the SSTable) is used to locate blocks; the index is loaded into memory when the SSTable is opened.
  * A lookup can be performed with a single disk seek: we first find the appropriate block by performing a binary search in the in-memory index, and then reading the appropriate block from disk. Optionally, an SSTable can be completely mapped into memory, which allows us to perform lookups and scans without touching disk.
* **Chubby:**
  * to ensure that there is at most one active master at any time
  * to store the bootstrap location of Bigtable data
  * to discover tablet servers and finalize tablet server deaths
  * to store Bigtable schema information (the column family information for each table)
  * to store access control lists

## Implementation
The Bigtable implementation has three major components:
- a **client library**: communicate directly with tablet servers for reads and writes
- one **master server**:
    * assign tablets to tablet servers
    * detect the addition and expiration of tablet servers
    * balance tablet-server load
    * garbage collect files in GFS
    * handle schema changes such as table and column family creations
- many **tablet servers**:
    * can be dynamically added or removed
    * manage a set of tablets, typically around 10 to 1000
    * handle read and write requests to the tablets that it has loaded
    * splits tablets that have grown too large

A Bigtable cluster stores a number of tables. Each table consists of a set of tablets, and each tablet contains all data associated with a row range. Initially, each table consists of just one tablet. As a table grows, it is automatically split into multiple tablets, each approximately 100–200 MB in size by default.

### Tablet Location
A B-tree like three-level hierarchical is used to store tablet location information.
* First level: a file stored in Chubby that contains the location of the root tablet.
* Root tablet: contains the location of all tablets in a special METADATA table. It is the first tablet in the METADATA table, but is treated specially — it is never split — to ensure that the tablet location hierarchy has no more than three levels.
* METADATA table: stores the location of a tablet under a row key that is an is an encoding of the tablet’s table identifier and its end row.

The client library caches tablet locations. When there is a miss, the client recursively moves up the tablet location hierarchy. We also stores secondary information in the METADATA table, including a log of all events pertaining to each tablet, for debugging and performance analysis.

### Tablet Assignment
Bigtable uses Chubby to keep track of tablet servers. When a tablet server starts, it creates, and acquires an exclusive lock on, a uniquely-named file in a specific Chubby directory. The master monitors this directory to discover tablet servers. A tablet server stops serving its tablets if it loses its exclusive. A tablet server will attempt to reacquire an exclusive lock on its file as long as the file still exists. If the file no longer exists, then the tablet server will never be able to serve again, so it kills itself. Whenever a tablet
server terminates, it attempts to release its lock so that the master will reassign its tablets more quickly.

To detect when a tablet server is no longer serving its tablets, the master periodically asks each tablet server for the status of its lock. If a tablet server reports that it has lost its lock, or if the master was unable to reach a server during its last several attempts, the master attempts to acquire an exclusive lock on the server’s file. If the master is able to acquire the lock, then Chubby is live and the tablet server is either dead or having trouble reaching Chubby. The master deletes the server file, and move all the tablets into the set of unassigned tablets.

If the master's Chubby session expires, the master kills itself. Master failures do not change the assignment of tablets to tablet servers.

The master executes the following steps at startup
1. Grabs a unique *master* lock in Chubby, which prevents concurrent master instantiations.
2. Scans the servers directory in Chubby to find the live servers.
3. Communicates with every live tablet server to discover what tablets are already assigned to each server.
4. Add the root tablet to the set of unassigned tablets if an assignment for the root tablet was not discovered.
5. Scans the METADATA table to learn the set of tablets.

Tablet splits are initiated by a tablet server. The tablet server commits the split by recording information for the new tablet in the METADATA table. When the split has committed, it notifies the master. In case the split notification is lost, the master detects the new tablet when it asks a tablet server to load the tablet that has now split. The tablet server will notify the master of the split, because the tablet entry it finds in the METADATA table will specify only a portion of the tablet that the master asked it to load.

### Tablet Serving
The persistent state of a tablet is stored in GFS. Updates are committed to a commit log that stores redo records. The recently committed ones are stored in memory in a sorted buffer called a **memtable**; the older updates are stored in a sequence of **SSTables**.

To **recover** a tablet, a tablet server reads its metadata from the METADATA table. This metadata contains the list of SSTables that comprise a tablet and a set of a redo points, which are pointers into any commit logs that may contain data for the tablet. The server reads the indices of the SSTables into memory and reconstructs the memtable by applying all of the updates that have committed since the redo points.

For **write** operations, a valid mutation is written to the commit log. Group commit is used to improve the throughput of lots of small mutations. Then its contents are inserted into the memtable.

**Read** operation is executed on a merged view of the sequence of SSTables and the memtable.

### Compactions
When the memtable size reaches a threshold, the memtable is frozen, a new memtable is created, and the frozen memtable is converted to an SSTable and written to GFS. This **minor compaction** process has two goals: it shrinks the memory usage, and reduces the amount of data that has to be read from the commit log during recovery.

Every minor compaction creates a new SSTable. We bound the number of such files by periodically executing a **merging compaction** (a.k.a **major compaction**) in the background.

Incoming read and write operations can continue while compactions occur.

## Refinements
### Locality groups
Clients can group multiple column families together into a *locality group*. A separate SSTable is generated for each locality group in each tablet. Segregating column families that are not typically accessed together into separate locality groups enables more efficient reads.

some useful tuning parameters can be specified on a per-locality group basis. For example, a locality group can be declared to be in-memory.

### Compression
The user-specified compression format is applied to each SSTable block (whose size is controllable via a locality group specific tuning parameter). Although we lose some space by compressing each block separately, we benefit in that small portions of an SSTable can be read without decompressing the entire file.

### Caching for read performance
Tablet servers use two levels of caching:
- Scan Cache: a higher-level cache that caches the key-value pairs returned by the SSTable interface to the tablet server code.
- Block Cache: a lower-level cache that caches SSTables blocks that were read from GFS.

### Bloom filters
Clients can specify that Bloom filters be created for SSTables in a particular locality group.

### Commit-log implementation
Cons of keeping the commit log for each tablet in a separate log file:
- lots of files would be written to GFS, which could cause a large number of disk seeks to write to the different physical log files.
- Reduces the effectiveness of the group commit optimization, since groups would tend to be smaller.

We append mutations to a single commit log per tablet server, co-mingling mutations for different tablets in the same physical log file. It provides significant performance benefits during normal operations, but complicates recovery. To avoid that, we sort the commit log entries in order of the keys `⟨table, row name, log sequence number⟩`. The read can then be efficient with one disk seek followed by a sequential read. To parallelize the sorting, we partition the log file into 64 MB segments, and sort each segment in parallel on different tablet servers.

### Speeding up tablet recovery
If the master moves a tablet from one tablet server to another, the source tablet server first does a minor compaction on that tablet. This compaction reduces recovery time by reducing the amount of uncompacted state in the tablet server’s commit log. After finishing this com-
paction, the tablet server stops serving the tablet. Before it actually unloads the tablet, the tablet server does another (usually very fast) minor compaction to eliminate any remaining uncompacted state in the tablet server’s log that arrived while the first minor compaction was
being performed. After that the tablet can be loaded on another tablet server without requiring any recovery of log entries.

### Exploiting immutability
To reduce contention during reads of the memtable, we make each memtable row copy-on-write and allow reads and writes to proceed in parallel.

