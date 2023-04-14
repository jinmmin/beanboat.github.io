---
layout: post
title: "Notes on \"CockroachDB\""
date:   2022-02-11
tags: ["computer_science", "paper_notes"]
---
CockroachDB (CRDB) is a scalable SQL DBMS that supports global OLTP workloads with high availability and strong consistency. It focuses on the below features:
* Fault tolerance and high availability
* Geo-distributed partitioning and replica placement
* High-performance transactions

## System overview
CRDB uses a standard shared-nothing architecture, in which all nodes are used for both data storage and computation. A CRDB cluster consists of an arbitrary number of nodes, which may be colocated in the same datacenter or spread across the globe. Clients can connect to any node in
the cluster.

Within a node, the layered architecture looks like below:
* **SQL**: includes the parser, optimizer, and the SQL execution engine, which convert high-level SQL statements to low-level read and write requests to the underlying key-value (KV) store.
* **Transactional KV**
* **Distribution**: CRDB uses range-partitioning on the keys to divide the data into contiguous ordered chunks of size ~64 MiB, that are stored across the cluster. These chunks are called "Ranges". The distribution layer is responsible for identifying which Ranges should handle which subset of each query, and routes the subsets accordingly.
* **Replication**
* **Storage**: relies on RocksDB

### Fault Tolerance and High Availability
* **Replication using Raft**:
  * Replicas of a Range form a Raft group, where each replica is either a long-lived leader coordinating all writes to the Raft group, or a follower. The unit of replication in CRDB is a command, which represents a sequence of low-level edits to be made to the storage engine. Raft maintains a consistent, ordered log of updates across a Range’s replicas, and each replica individually applies commands to the storage engine as Raft declares them to be committed to the Range’s log.
  * CRDB uses Range-level **leases**, where a single replica in the Raft group (usually the Raft group leader) acts as the leaseholder. It is the only replica allowed to serve authoritative up-to-date reads or propose writes to the Raft group leader. If a replica detects that the leaseholder is not live, it tries to acquire the lease. To ensure that only one replica holds a lease at a time, lease acquisitions piggyback on Raft; replicas attempting to acquire a lease do so by committing a special lease acquisition log entry. To prevent two replicas from acquiring leases overlapping in time, lease acquisition requests include a copy of the lease believed to be valid at the time of request. Ensuring disjoint leases is essential for CRDB’s isolation guarantees.
* **Membership changes and automatic load (re)balancing**
  * For short-term failures, CRDB uses Raft to operate seamlessly as long as a majority of replicas remain available. Raft ensures the election of a new leader for the Raft group if the leader fails so that transactions can continue. Affected replicas can rejoin their group once back online, and peers help them catch up on missed updates by either:
    * sending a snapshot of the full Range data, or
    * sending a set of missing Raft log entries to be applied.
  * For longer-term failures, CRDB automatically creates new replicas of under-replicated Ranges. The node liveness data and cluster metrics
required to make this determination are disseminated across the cluster using a peer-to-peer gossip protocol.
* **Replica placement**:  When creating tables in the database, users can specify placement constraints and preferences as part of the schema of the table. By default, CRDB spreads replicas across failure domains. CRDB also uses various heuristics to balance load and disk utilization.

### Data Placement Policies
CRDB supports the below multi-region patterns:
* Geo-Partitioned Replicas: tables can be partitioned by access location with each partition (set of Ranges) pinned to a specific region.
* Geo-Partitioned Leaseholders: Leaseholders for partitions in a geo-partitioned table can be pinned to the region of access with the remaining replicas pinned to the remaining regions.
* Duplicated Indexes: indexes can be duplicated and the index's leaseholder can be pinned to a specific region.

## Transactions
CRDB uses a variation of multi-version concurrency control (MVCC) to provide serializable isolation. A SQL transaction starts at the gateway node for the SQL connection. Applications typically connect to a geographically close gateway to minimize latency. The coordinator algorithm looks like below:
* **Execution at the transaction coordinator**: the coordinator receives a series of requested KV operations from the SQL layer, which requires that a response to the current operation must be returned before the next operation is issued. To avoid stalling the transaction while operations are being replicated, the coordinator employs two important optimizations: Write Pipelining and Parallel Commits.
  * Write Pipelining: allows returning a result without waiting for the replication of the current operation.
  * Parallel Commits: lets the commit operation and the write pipeline replicate in parallel.

Combined, they allow many multi-statement SQL transactions to complete with the latency of just one round of replication.

### Atomicity Guarantees
An atomic commit for a transaction is achieved by considering all of its writes intent until commit time. Upon encountering an intent, a reader follows the indirection and reads the intent’s transaction record.
* For **committed** transactions, the reader considers the intent as a regular value (and additionally deletes the intent metadata).
* For **aborted** transactions, the intent is ignored (and cleanup is performed to remove it).
* For **pending** transactions, the reader blocks, waiting for it to finalize.

If the coordinator node fails, contending transactions eventually detect that the transaction record has expired, and mark it aborted. If the transaction is in the staging state, the reader attempts to abort the transaction by preventing one of its writes from being replicated.

### Concurrency control
* **Write-read** conflicts:  A read running into an uncommitted intent with a lower timestamp will wait for the earlier transaction to finalize. Waiting is implemented using in-memory queue structures. A read running into an uncommitted intent with a higher timestamp ignores the intent and
does not need to wait.
* **Read-write** conflicts: A write to a key at timestamp t<sub>a</sub> cannot be performed if there’s already been a read on the same key at a higher timestamp t<sub>b</sub> >= t<sub>a</sub>. CRDB forces the writing transaction to advance its commit timestamp past t<sub>b</sub>.
* **Write-write** conflicts: A write running into an uncommitted intent with a lower timestamp will wait for the earlier transaction to finalize (similar to write-read conflicts). If it runs into a committed value at a higher timestamp, it advances its timestamp past it (similar to read-write conflicts). Write-write conflicts may also lead to deadlocks in cases where different transactions have written intents in different orders. CRDB employs a distributed deadlock-detection algorithm to abort one transaction from a cycle of waiters.

### Read Refreshes
To maintain serializability, the read timestamp must be advanced to match the commit timestamp. To determine whether the read timestamp can be advanced, CRDB maintains the set of keys in the transaction’s read set (up to a memory budget). A "read refresh" request validates that the keys have not been updated in a given timestamp interval. This involves re-scanning the read set and checking whether any MVCC values fall in the given interval.

Advancing the transaction’s read timestamp is also required when a scan encounters an uncertain value: a value whose timestamp makes it unclear if it falls in the reader’s past or future.

### Follower Reads
CRDB allows non-leaseholder replicas to serve requests for read-only queries with timestamps sufficiently in the past through a special `AS OF SYSTEM TIME` query modifier. If a follower read at timestamp T is to be served, the leaseholder must no longer be accepting writes for timestamps `T′ ≤ T`, and the follower must have caught up on the prefix of the Raft log affecting the MVCC snapshot at `T`.

To this end, each leaseholder tracks the timestamps of all incoming requests and periodically emits a closed timestamp, the timestamp below which no further writes will be accepted. When a node in the cluster receives a read request at a sufficiently old timestamp (closed timestamps typically trail current time by ~2 seconds), it forwards the request to the closest node with a replica of the data.

## Clock synchronization
### Hybrid-logical clocks
Each node within a CRDB cluster maintains a hybrid-logical clock (HLC), which provides timestamps that are a combination of physical and logical time. Physical time is based on a node’s coarsely-synchronized system clock, and logical time is based on Lamport’s clocks.

HLCs within a CRDB deployment are configured with a maximum allowable offset between their physical time component and that of other HLCs in the cluster. This offset configuration defaults to a conservative value of 500 ms. Hybrid-logical clocks provide a few important properties:
* HLCs provide causality tracking through their logical component upon each inter-node exchange, which is critical for enforcing invariants , such as the lease disjointness.
* HLCs provide strict monotonicity within and across restarts on a single node. Across restarts, this property is enforced by waiting out the maximum clock offset upon process startup before serving any requests. Strictly monotonic timestamp allocation ensures that two causally dependent transactions originating from the same node are given timestamps that reflect their ordering in real time.
* HLCs provide self-stabilization in the presence of isolated transient clock skew fluctuations. Given sufficient intra-cluster
communication, HLCs across nodes tend to converge and stabilize even if their individual physical clocks diverge. This provides no strong guarantees but can mask clock synchronization errors in practice.

### Uncertainty intervals
Under normal conditions, CRDB satisfies single-key linearizability for reads and writes, by tracking an uncertainty interval for each transaction,
within which the causal ordering between two transactions is indeterminate. Upon its creation, a transaction is given a provisional commit timestamp `commit_ts` from the transaction coordinator’s local HLC and an uncertainty interval of `[commit_ts, commit_ts + max_offset]`.

When a transaction encounters a value on a key at a timestamp below its provisional commit timestamp, it trivially observes the value during reads and overwrites the value at a higher timestamp during writes. When a transaction encounters a value on a key at a timestamp above its provisional commit timestamp but within its uncertainty interval, it performs an uncertainty restart, moving its provisional commit timestamp
above the uncertain value but keeping the upper bound of its uncertainty interval fixed.

### Behavior under clock skew
Within a single Range, consistency is maintained through Raft. Raft does not have a clock dependency, so the ordering of changes it constructs for a single Range will remain linearizable regardless of clock skew. Range leases allow reads to be served from a leaseholder without going through Raft. Under sufficient clock skew, it is possible for multiple nodes to think they each hold the lease for a given Range. CRDB employs two safeguards to ensure that clock skew does not affect transaction isolation:
* Range leases contain a start and an end timestamp. The lease disjointness invariant ensures that within a Range, each lease interval is disjoint from every other lease interval.
* Each write to a Range’s Raft log includes the sequence number of the Range lease that it was proposed under. Upon successful replication, the sequence number is checked against the currently active lease. If they do not match, the write is rejected.

To reduce the likelihood of stale reads, nodes periodically measure their clock’s offset from other nodes. If any node exceeds the configured maximum offset by more than 80% compared to a majority of other nodes, it self-terminates.

## SQL
The primary index is keyed on the primary key, and all other columns are stored in the value (primary keys are automatically generated if not explicitly specified by the schema). CRDB also supports hash indexes, which can help avoid hot spots by distributing load across multiple Ranges.

* Transformation rules in CRDB are written in a domain-specific language (DSL) called `Optgen`.
* CRDB’s primary execution engine is based on the `Volcano` iterator model and processes a single row at a time.
* CRDB can execute a subset of SQL queries using a `vectorized` execution engine.
* CRDB performs schema changes using a protocol that allows tables to remain online, and allows different nodes to asynchronously transition to a new table schema at different times.CRDB implements the solution used by F1 by following a protocol that decomposes each schema change into a
sequence of incremental changes. If we enforce the invariant that there are at most two successive versions of a schema used in the cluster at all times, then the database will remain in a consistent state throughout the schema change.
