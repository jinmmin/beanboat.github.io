---
layout: post
title: "[Paper notes] RocksDB: Evolution of Development Priorities in a Key-value Store Serving Large-scale Applications"
date:   2022-02-04
tags: ["computer_science", "paper_notes"]
---
RocksDB is a persistent key-value storage engine created in 2012 by Facebook, based on Google's LevelDB. RocksDB is high customizable, and can be tuned for a wide spectrum of workloads, such as high write throughput, high read throughput, space efficiency, or something in between.

## Architecture and Use of LSM-trees
### Write
Whenever data is written to RocksDB, the written data is added to an in-memory write buffer called MemTable, as well as an on-disk Write Ahead Log (WAL). MemTable is implemented as a `skiplist` to keep the data ordered with `O(log n)` insert and search overheads. The WAL is used for recovery after a failure, but is not mandatory. Once the size of the MemTable reaches a configured size, then:
1. the MemTable and WAL become immutable
2. a new MemTable and WAL are allocated for subsequent writes
3. the contents of the MemTable are flushed to a Sorted String Table (SSTable) data file on disk
4. the flushed MemTable and associated WAL are discarded.
Each SSTable stores data in sorted order, divided into uniformly sized blocks. Once written, each SSTable is immutable. Every SSTable also has an index block with one index entry per SSTable block for binary search.

### Compaction
The LSM-tree has multiple levels. The newest SSTables are created by MemTable flushes, and are placed in Level-0. The other levels are created by a process called compaction. The maximum size of each level is limited by configuration parameters. When level-L’s size target is exceeded, some SSTables in level-L are selected and merged with the overlapping SSTables in level-(L+1) to create a new SSTable in level-(L+1). In doing so, deleted and overwritten data is removed, and the new SSTable is optimized for read performance and space efficiency. Compaction I/O is efficient, as it can be parallelized and only involves bulk reads and writes of entire files. The supported compaction types include:
* Leveled Compaction: The size target of each level is exponentially increasing. Compactions are initiated proactively to ensure the target sizes are not exceeded.
* Tiered Compaction: Multiple SSTables are lazily compacted together, either when the sum of the number of level-0 files and the number of non-zero levels exceeds a configurable threshold or when the ratio between total DB size over the size of the largest level exceeds a threshold. In effect, compactions are delayed until either read performance or space efficiency degenerates, so more data can be compacted altogether.
* FIFO Compaction: simply discards old SSTables once the DB hits a size limit and only performs lightweight compactions. It targets in-memory caching applications.

Being able to configure the type of compaction allows RocksDB to serve a wide range of use cases.  A lazier compaction algorithm improves write amplification and write throughput, but read performance suffers.

### Read
In the read path, a key lookup occurs by first searching all MemTables, followed by searching all Level-0 SSTables, followed by the SSTables in successively older levels whose partition covers the lookup key. Binary search is used in each case. The search continues until the key is found,
or it is determined that the key is not present in the oldest level. Hot SSTable blocks are cached in a memory-based block cache to reduce I/O as well as decompression overheads. Bloom filters are used to eliminate most unnecessary searches within SSTables.

### Column family
Column family allows different independent key spaces to co-exist in one DB. Each KV pair is associated with exactly one column family,Each column family has its own set of MemTables and SSTables, but they share the WAL. Benefits of column families include the following:
* each column family can be configured independently; that is, they each can have different compaction, compression, merge operators, and compaction filters;
* the shared WAL enables atomic writes to different column families
* existing column families can be removed, and new column families can be created, dynamically and efficiently

## Evolution of resource optimization targets
* Write Amplification: applications often pick a compaction method to reduce write amplification when the write rate is high and compact more aggressively when the write rate is low to achieve space efficiency and better read performance.
* Space Amplification: We developed **Dynamic Leveled Compaction**, where the size of each level in the tree is automatically adjusted
based on the size of the oldest (last) level, instead of setting the size of each level statically. Capping the ratio between the sizes of the newer levels and the oldest level tends to limit space overhead.
* CPU Utilization: A common concern is that with SSDs, the bottleneck has shifted from the storage device to the CPU. RocksDB does not share this concern because:
  * only a few applications are limited by the IOPS provided by the SSDs
  * any server with a high-end CPU has more than enough compute power to saturate one high-end SSD

## Lessons on serving large-scale systems
### Resource management
A separate RocksDB instance is used to service each shard, which means that a storage host will have many RocksDB instances running on it. These instances can either all run in one single address space or each in its own address space. Resources that need to be managed include: (1) the memory for write buffer, MemTables, and block cache, (2) compaction I/O bandwidth, (3) compaction threads, (4) total disk usage, and (5) file deletion rate.
Lessons learnt:
* RocksDB allows applications to create one or more resource controllers (implemented as C++ objects passed to different DB objects) for each type of resource mentioned above and also do so on a per instance basis.
* It is important to support prioritization among RocksDB instances to make sure a resource is prioritized for the instances that need it most.
* when running multiple instances in one process: Threads doing similar type of work (e.g., background flushes) should be in a pool that is shared across all similar instances (e.g., shards of a database) on a host.
* Global (per host) resource management is more challenging when the RocksDB instances run in separate processes. Two strategies can be applied:
  * Each instance could be configured to use resources conservatively, as opposed to greedily. The downside of this strategy is that the global resources may not be fully exploited, leading to sub-optimal resource usage.
  * More challenging and yet to work on is for the instances to share resource usage information among themselves and to adapt accordingly in an attempt to optimize resource usage more globally.

### Support for replication and backups
* Replication:
  * Logical copying: all the keys can be read from a source replica and then written to the destination replica.
  * Physical copying: Bootstrapping a new replica can be done by copying SSTables and other files directly.
* Backups: One difference between backups and replication is that applications often need to manage multiple backups. RocksDB provides a backup engine for applications to use if their backup requirements are simple.
* Challenges on Updating Replicas

### WAL Treatment
We introduced differentiated WAL operating modes: (i) synchronous WAL writes, (ii) buffered WAL writes, and (iii) no WAL writes at all.

### Data Format Compatibility
For backwards compatibility, RocksDB must be able to understand all formats previously written to disk, which adds considerable software and maintenance complexities. For forward compatibility, future data formats need to be understood, and we aim to maintain forward compatibility for at least one year.

## Lessons on failure handling
* Data corruption needs to be detected early to minimize the risk of data unavailability or data loss, and in doing so to pinpoint where the error originated. RocksDB achieves early detection by checksumming data at multiple layers and verifying those checksums as the data traverses through the system.
* Integrity protection must cover the entire system to prevent silent hardware data corruptions from being exposed to RocksDB clients or spreading to other replicas.
  * Block integrity: each SSTable block or WAL fragment has a checksum attached to it, generated when the data is created. This checksum is verified every time the block is read, either to serve a request from the application or for compactions, due to its smaller scope.
  * SSTable Integrity:  each SSTable is protected by its own checksum, generated when the table is created. An SSTable’s checksum is recorded in the metadata’s SSTable file entry and is validated with the SSTable file wherever it is transferred.
  * Handoff Integrity: an established technique for detecting write corruptions early is to generate a handoff checksum on the data to be written to the underlying file system and pass it down along with the data, where it is verified by the lower layers. We wish to protect WAL writes using such a write API.
  * End-to-end Integrity: we are currently implementing per-KV checksums to detect corruptions that occur above the file I/O layer. This checksum will be transferred along with the KV pair wherever it is copied.
* Errors need to be treated in a differentiated manner.

## Lessons from configuration management and customizability
### Managing Configurations
Configuring parameters where the parameter options were directly embedded in the code has caused two problems:
* Parameter options were often tied to the data stored on disk, causing potential compatibility issues.
* Configuration options not explicitly specified in the code were automatically set to default values. And applications would sometimes experience unexpected consequences.

RocksDB introduced support for optionally storing an options file along with the database, along with two tools:
* A validation tool that validates whether the options for opening a database was compatible with the target database.
* A migration tool that rewrites a database to be compatible with the desired options.

We have spent considerable effort on improving out-of-box performance and simplifying configurations. The current focus is on providing automatic adaptivity, while continuing to support extensive explicit configuration, which creates significant code maintenance overhead but is worth it.

### The Power of Call-back Functions
**Compaction Filter**. A compaction filter is a call-back function that is called during compaction for each KV-pair being processed. The application can then decide whether to (i) discard (remove) the KV-pair, (ii) modify the value, or (iii) leave the KV-pair as is. It was used to implement time-to-live (TTL), garbage collection as part of a multi-version concurrency control (MVCC) solution, modify data to migrate old data to a new format or to alter data based on time, or simply to collect statistics. Improperly using compaction filters can break some basic data consistency guarantees, and snapshot reads may no longer be repeatable (if the data is modified between reads). Another limitation is that they do not allow multiple KV pairs to be atomically dropped or modified.

**Merge operators** allow applications to update the value of an existing key without first having to read the KV pair and without having to write out the entire KV-pair. When a read operation or a compaction process encounters a merge record and a previous put record, or multiple merge records, RocksDB invokes an application-specified call-back merge operator, which can be used to combine them into a single one, which can be a put record or a merge record. The merge operator is used to implement read-modify-write operations. However,it negatively affects read performance in that the search for a KV pair does not necessarily end when the first entry is found, and in the worst case, the search must traverse all levels or until a Put record is found for the key.

### Optimizing deletions
Deletion is achieved by adding a special marker to the LSM-tree, called a Tombstone. This makes deletes fast, but can make subsequent queries
slower.
* **Range Scans over a Large Range of Tombstones**: Applications often delete a large range of consecutive or nearby keys. RocksDB supports initiating compactions when there are many consecutive tombstones.
* **Reclaiming Disk Space**: Application can specify a time threshold and RocksDB will ensure that any tombstone representing deleted data will reach the oldest level within that threshold. This feature is implemented by having the SSTable maintain (in its metadata) the earliest (i.e., oldest) time an entry in the SSTable was first added to the system, with compactions scheduled accordingly.
* Rate-limited File Deletions

### Managing memory
RocksDB relies on a third-party allocator `jemalloc` to manage memory.
