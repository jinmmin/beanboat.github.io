---
layout: post
title:  "Replication and Consistency"
date:   2022-01-10
tags: ["compute_science", "distributed_systems"]
---

First, learn about CAP theorem. A good read is from [Coda](https://codahale.com/you-cant-sacrifice-partition-tolerance).

### Single-leader
All writes are sent to the leader. Leaders send data changes to all of its followers as part of a ***replication log*** or ***change stream***. Followers take the log and apply the writes in the same order as they were processed on the leader.

Good for read-heavy systems.

> In practice, if you use synchronous replication on a database, it usually means that one of the followers is synchronous, and the others are asynchronous.

Built-in feature in many relational databases, such as PostgreSQL, MySQL; and some non-relational databases, such as MongoDB.

#### Set up new followers
1. Take a consistent snapshot of the leader’s database without taking a lock on the entire database. Most databases have this feature, as it is also required for backups.
2. Copy the snapshot to the new follower node.
3. The follower connects to the leader and requests all the data changes that have happened since the snapshot. This requires that the snapshot is associated with an exact position, e.g. sequence number, in the leader’s replication log.
4. When the follower catches up, it can continue to process data changes from the leader as they happen.

#### Failure handling
##### Follower failure
Find the last transaction that was processed before the fault occurred from its log. Connect to the leader and request changes occurred since the follower was disconnected.

##### Leader failure
Failover can be either manual or automatic. An automatic process usually consists of the following steps:
- Determine that the leader has failed, usually based on **timeout**.
- Choose and promote a new leader. This could be done through an **election** process, which is a **consensus** problem.
- Reconfigure the system to use the new leader. Clients need to send their writes to the new leader, and the other followers need to start consuming data changes from the new leader.

Potential problems for the approach:
- The new leader may not have received all the writes from the old leader before it failed. If the old leader rejoins after a new leader is selected, how to deal with those writes? Discarding may violate certain durability expectations.
- Split brain. If both leaders accept writes, and there is no process for resolving conflicts, the data is likely to be lost or corrupted.
- What is the right timeout before declaring a leader is dead?

#### Implementation of replication logs
##### statement-based replication
- Any statement that calls a nondeterministic function, such as now() or rand(), will generate different values on replicas.
- Statements using auto-incrementing columns or depending on existing data can be limiting when there are concurrent transactions.
- Statements that have side effects, e.g. triggers, stored procedures, UDFs, may result in different side effects on each replica.

##### Write-ahead log (WAL)
The log is an append-only sequence of bytes containing all writes to the database. The main disadvantage is that the log describes the data on a very low level: a WAL contains details of which bytes were changed in which disk blocks. This makes replication closely coupled to the storage engine. If the database changes its storage format it is typically not possible to run different versions of the database software on the leader and the followers.

##### Logical (row-based) log replication
Use different log formats for replication and for the storage engine. This is called change data capture.

##### Trigger-based replication
When a data change occurs, execute a trigger that logs this change into a separate table, from which it can be read by an external process. The external process then applies application logic and replicate the data change to another system.

##### Weak consistencies (stronger than eventual consistency)
- read-after-write consistency / read-your-write consistency
- monotonic reads, meaning that if a user makes several reads in sequence, they will not see time go backward. One solution is to make a user always read from the same replica.
- consistent prefix reads, i.e. no violation of causality.

### Multi-leader
##### Use cases
- multi-datacenter operation. Have a leader in each datacenter.
- clients with offline operation. The local database on a device acts as a leader.
- collaborative editing.

##### Conflict resolution
- Try to avoid conflict
- last write wins (LWW): give each write a unique ID (e.g., a timestamp, a UUID, or a hash of the key and value), pick the write with the highest ID as the winner.
- Writes that originated at a replica with a higher ID always wins.
- Somehow merge the values together, .e.g sort and concatenate.
- Retain the data and write application code to resolve (perhaps by prompting the user)

##### Multi-leader replication topologies
circular (single point failure), star (single point failure), all-to-all (wrong order)

### Leaderless
Used by Dynamo, Cassandra, Riak, Voldemort.

In some leaderless implementations, the client directly sends its writes to several replicas, while in others, a coordinator node does this on behalf of the client.

#### Node repair

##### Anti-entropy repair / Background repair
It is a process of comparing the data of replicas and updating each replica to the newest version. Usually implemented with **Merkle tree**. The leaf node is the hash of a row value. Each parent node higher in the tree is a hash of its respective children. It allows efficient and secure verification of the contents of large data structures. The amount of data needed to be synchronized is proportional to the differences between the two replicas. The steps are:
- Build a Merkle tree for each replica.
- Compare the Merkle trees to discover differences.

##### Hinted handoff / write repair
If the failure detector marks a node as down, missed writes are stored by the coordinator node for a period of time. When gossip discovers a node is back online, the coordinator replays each remaining hint to write the data to the newly-returned node, then deletes the hint file.

##### Read repair
When a read query encounters inconsistent results, it initiates a read repair. Such read repairs run in the foreground and block application operations until the repair process is complete.

#### Quorums for reading and writing
If there are n replicas, every write must be confirmed by w nodes to be considered successful, and we must query at least r nodes for each read. As long as w + r &gt; n, meaning the sets of nodes used by the read and
write operations overlap in at least one node, we expect to get an up-to-date value when reading

A common choice is to make n an odd number (typically 3 or 5) and to set
```
w = r = (n + 1) / 2 (rounded up)
```

Possible scenarios that stale values are returned with this setting:
- If a sloppy quorum is used, the w writes may end up on different nodes than the r reads.
- If a write happens concurrently with a read, the write may be reflected on only some of the replicas. In this case, it’s undetermined whether the read returns the old or the new value.
- For concurrent writes, if last write wins is used, writes can be lost due to clock skew.

Reading your writes, monotonic reads, or consistent prefix reads do not usually happen. But stronger guarantees generally require transactions or consensus.

**sloppy quorum:** In a large cluster with significantly more than n nodes, it’s likely that the client can connect to some database nodes during the network interruption, just not to the nodes that it needs to assemble a quorum for a particular value. In that case, we accept writes anyway, and write them to some nodes that are reachable but aren’t among the n nodes on which the value usually lives. Particularly useful for increasing write availability.

#### Concurrent writes
- Last write wins, i.e.e discarding concurrent writes
- **Version vectors (sometimes called a version clock):** Each replica increments its own version number when processing a write, and also
    keeps track of the version numbers it has seen from each of the other replicas. The collection of version numbers from all the replicas is called a version vector.

#### Failure detection — **Gossip protocol**
- Each node maintains a node membership list, which contains member IDs and heartbeat counters.
- Each node periodically increments its heartbeat counter.
- Each node periodically sends heartbeats to a set of random nodes, which in turn propagate to another set of nodes.
- Once nodes receive heartbeats, the membership list is updated to the latest info.
- If the heartbeat has not increased for more than predefined periods, the member is considered as offline.

### References
* *Kleppmann, M. (2018). *Designing data-intensive applications: The big ideas behind reliable, scalable, and maintainable systems*
