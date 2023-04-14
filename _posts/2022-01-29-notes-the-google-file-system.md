---
layout: post
title: "[Paper notes] The Google File System"
date:   2022-01-29
tags: ["computer_science", "paper_notes"]
---

## Design considerations
* Component failures are the norm rather than the exception. Therefore, constant monitoring, error detection, fault tolerance, and automatic recovery must be integral to the system.
* Files are huge by traditional standards. Multi-GB files are common.
* Most files are mutated by appending enw data rather than overwriting existing data. Once written, the files are only read, and often only sequentially.

## Interface
Files are organized hierarchically in directories and identified by pathname. Operations supported: create, delete, open, close, read, write, record append (allows multiple clients to append data concurrently), snapshot.

## Architecture
A GFS cluster consists of a single master and multiple chunkservers and is accessed by multiple clients. Files are divided into fixed-size chunks. Each chunk is identified by an immutable and globally unique 64 bit chunk handle assigned by the master at the time of chunk creation. Each chunk is replicated, by default three times.

The master maintains all file system metadata, including namespace, access control information, the mapping from files to chunks, and the current locations of chunks. And it controls system-wide activities such as lease management, garbage collection, and chunk migration between chunkservers. It communicates with each chunkserver periodically in HeartBeat messages to give it instructions and collect state.

Client interacts with the master for metadata operations and with the chunkservers for data-bearing communication.

File data is not cached anywhere.

### Chunk size
Chunk size is chosen to be 64MB. The advantages of a large chunk size are:
* Reduces clients' need to interact with the master because reads and writes on the same chunk require only one initial request to the master for chunk location information.
* Reduces network overhead by having the clients keeping a persistent TCP connection to the chunkserver over an extended period of time.
* Reduces the size of metadata stored on the master.

The disadvantage is potentially hotspotting for a few files. It can be solved by having a higher replication factor for those.

### Metadata
The file and chunk namespaces metadata and the mapping from files to chunks are also kept persistent by logging mutations to an operation log stored on the master's local disk and replicated on remote machines. Client visible changes are made only after flushing the corresponding operation log to disk locally and remotely. The master recovers its file system state by replaying the operation log. To minimize startup time, the log is kept small by checkpointing its state. The checkpoint is in a compact B-tree like form that can be directly mapped into memory and used for namespace lookup.

The chunk locations are not persistent, instead, they are retrieved by the master from each chunkserver at master startup and whenever a chunkserver joins the cluster. The master monitors chunkservers status with regular HeartBeat messages.

Namespace data is compressed using prefix compression and typically requires less than 64bytes per file.

### Consistency model
Namespace locking guarantees atomicity and correctness. The master's operation log defines a global total order of these operations.

A file region is consistent if all clients will always see the same data, regardless of which replicas they read from. a region is defined after a file data mutation if it is consistent and clients will see what the mutation writes in its entirety.

After a sequence of successful mutations, the mutated file region is guaranteed to be defined and contain the data written by the last mutation. This is achieved by:
* applying mutations to a chunk in the same order on all its replicas
* using chunk version numbers to detect any replica that has become stale because it has missed mutations while its chunkserver was down.

Since clients cache chunk locations, they may read from stale replica. But the window is limited by the cache entry's timeout and the next open of the file.

## System interactions
### Leases and mutation order
We use leases to maintain a consistent mutation order across replicas. The master grants a chunk lease to a primary replica, which picks a serial order for all mutations to the chunk. All replicas follow the order when applying mutations. The lease has an initial timeout of 60 seconds, but can be extended infinitely. The master sometimes revokes a lease before it expires, e.g. to disable mutations on a file that is being renamed.

### Data flow
We decouple the data flow from the control flow to use the network efficiently. Data is pushed linearly along a chain of chunkservers in a pipelined fashion. Each machine forwards the data to the closest machine in the network topology that has not received it. Pipelining is helpful because we use a switched network with full-duplex links. Without network congestion, the ideal elapsed time for transferring `B bytes` to `R replicas` is `B/T + RL` where `T` is the network throughput and `L` is the latency to transfer bytes between two machines. T is typically 100Mbps and L is far below 1ms.

### Snapshot
When the master receives a snapshot request, it first revokes any outstanding leases on the chunks in the files it is about to snapshot. The master logs the operation to disk, and applies this log record to its in-memory state by duplicating the metadata for the source file or directory tree. The newly created snapshot files point to the same chunks as the source files. Snapshot uses standard copy-on-write techniques. The first time a client writes to chunk C after the snapshot, the master asks each chunkserver to create a new chunk called C' and copies the data locally.

## Master operation
### Namespace locking
GFS does not have a per-directory data structure that lists all the files in that directory. Nor does it support aliases. GFS logically represents its namespace as a lookup table mapping full pathnames to metadata. Each node in the namespace tree has an associated read-write lock. If an operation involves `/d1/d2/.../dn/leaf`, it will acquire read-locks on the directory names `/d1`, `/d1/d2`, ..., `/d1/d2/.../dn`, and either a read lock or a write lock on the full pathname `/d1/d2/.../dn/leaf`. This locking scheme allows concurrent mutations in te same directory.

### Replica placement
Replicas are placed across machines and racks to maximize data reliability and availability, and maximize network bandwidth utilization.

### Creation, re-replication, rebalancing
When the master creates a new chunk, it chooses a place that:
* has below-average disk space utilization
* has less "recent" creations on each chunkserver as creation is usually immediately followed by heavy writes.
* spreads across racks.

The master re-replicates a chunk as soon as the number of available replicas falls below a user-specified goal.

The master rebalances replicas periodically: it examines the current replica distribution and moves replicas for better disk space and load balancing.

### Garbage collection
After a file is deleted, it is lazily clean up during regular garbage collection at both the file and chunk level. The advantages of using garbage collection over eager deletion are:
*  simple and reliable, as creation failure is often
*  done in batches and the cost is amortized.
*  done only when the master is relatively free.

The disadvantage is that it hinders the user effort to fine tune usage when storage is tight. It's resolved by expediting storage reclamation when a deleted file is explicitly deleted again.

### Stale replica detection
Chunk replicas may become stale if a chunkserver fails and misses mutations to the chunk while it is down. For each chunk, the master maintains a chunk version number to distinguish between up-to-date and stale replicas. Whenever the master grants a new lease on a chunk, it increases the chunk version number and informs the up-to-date replicas. The master and replicas all record the new version number in their persistent state. If the master sees a version number greater than the one in its records, the master assumes that it failed when granting the lease and so takes the higher version to be up-to-date.

## Fault tolerance
### Fast recovery
Both the master and the chunkserver restore their state and start in seconds no matter how they terminated.

### Chunk replication
Each chunk is replicated on multiple chunkservers on different racks.

### Master replication
The master state (operation log and checkpoints) are replicated on multiple machines. A mutation to the state is committed only after its log record has been flushed to disk locally and on all master replicas. When the master machine or disk fails, monitoring infrastructure outside GFS starts a new master process elsewhere with the replicated operation log.

"Shadow" masters provide read-only access to the file system. They enhance read availability for files that are not being mutated actively or applications that do not mind getting slightly stale results.

### Data integrity
Chunkservers use checksumming to detect corruption of stored data. A chunk is broken up into 64KB blocks. Each has a corresponding 32 bit checksum. For reads, the chunkserver verifies the checksum of data blocks that overlap the read range before returning any data to the requesters. For append, the checksum is incrementally updated for the last partial checksum block. For writes overwriting an existing range of the chunk, we must read and verify the first and last blocks of the range being overwritten, then perform the write, and finally compute and  record the new checksums.


