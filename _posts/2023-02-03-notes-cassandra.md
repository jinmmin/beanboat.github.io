---
layout: post
title: "[Paper notes] Cassandra - A Decentralized Structured Storage System"
date:   2023-02-03
tags: ["computer_science", "paper_notes"]
---

Cassandra is a distributed storage system that handles high write throughput while not sacrificing read efficiency.

## Data model
A table in Cassandra is a distributed multi dimensional map indexed by a key. The row key in a table is a string with no size
restrictions, although typically 16 to 36 bytes long. Every operation under a single row key is atomic per replica. Columns are grouped together into sets called column families. Cassandra exposes two kinds of columns families, Simple and Super column families. Super column families
can be visualized as a column family within a column family. Applications can specify the sort order of columns within a Super Column or Simple Column family. The system allows columns to be sorted either by time or by name. Any column within a column family is accessed using the convention `column family : column` and any column within a column family that is of type super is accessed using the convention `column family :
super column : column`.

## Partitioning
Cassandra is able to scale incrementally by partitioning across the cluster using consistent hashing. It uses an order preserving hash function to do so. It improves the basic consistent hashing algorithm by moving lightly loaded nodes on the ring to alleviate heavily loaded nodes. The node mapped by the approach is deemed the coordinator for the key.

## Replication
The coordinator node is in charge of the replication of the data items that fall within its range. In addition to locally storing each key within its range, the coordinator replicates these keys at the N-1 nodes in the ring.

Cassandra provides various replication policies:s "Rack Unaware", "Rack Aware" and "Datacenter Aware". If "Rack Unaware" is chosen, the non-coordinator replicas are chosen by picking N-1 successors of the coordinator on the ring. For "Rack Aware" and "Datacenter Aware" strategies, Cassandra elects a leader amongst its nodes using Zookeeper, and get the ranges that each node is responsible for from the leader.

## Membership
Cluster membership in Cassandra is based on Scuttlebutt, a very efficient anti-entropy Gossip based mechanism. Gossip is not only used for membership but also to disseminate other system related control state.

Cassandra uses a modified version of the `Φ Accrual Failure Detector` to detect node failures. Instead of emitting a Boolean value stating a node is up or down, an Accrual Failure Detection emits a value which represents a suspicion level for each of monitored nodes. This value is defined as Φ.

## Bootstrapping
When a node starts for the first time, it chooses a random token for its position in the ring. For fault tolerance, the mapping is persisted to disk locally and also in Zookeeper. The token information is then gossiped around the cluster. This enables any node to route a request
for a key to the correct node in the cluster. In the bootstrap case, when a node needs to join a cluster, it reads its configuration file (or Zookeeper) which contains a list of a few contact points (a.k.a. seeds) within the cluster.

An administrator uses a command line tool or a browser to connect to a Cassandra node and issue a membership change to join or leave the cluster.

## Scaling
When a new node is added and takes over data from another node. The node giving up the data streams the data over to the new node using kernel-
kernel copy techniques.  We are working on improving this by having multiple replicas take part in the bootstrap transfer thereby parallelizing the effort, similar to Bittorrent.

## Local Persistence
Typical write operation involves a write into a commit log for durability and recoverability and an update into an in-memory data structure. The write into the in-memory data structure is performed only after a successful write into the commit log. When the in-memory data structure crosses a certain threshold, calculated based on data size and number of objects, it dumps itself to disk. All writes are sequential to disk and also generate an index for efficient lookup based on row key. These indices are also persisted along with the data file. Over time many such files could exist on disk and a merge process runs in the background to collate the different files into one file.

A typical read operation first queries the in-memory data structure before looking into the files on disk. The files are looked at in the order of newest to oldest. we could be looking up a key in multiple files on disk. Bloom filter is also stored in each data file and also kept in
memory.  In order to prevent scanning of every column on disk we maintain column indices which allow us to jump to the right chunk on disk for column retrieval. As the columns for a given key are being serialized and written out to disk we generate indices at every 256K chunk boundary.

## Implementation details
The system can be configured to perform either synchronous or asynchronous writes.For systems that require high throughput we rely on asynchronous replication. During the synchronous case we wait for a quorum of responses before we return a result to the client.

We use a rolling a commit log where a new commit log is rolled out after an older one exceeds a particular, configurable, size. 128MB works well on production workloads. Once all the data in the in-memory data structure has been successfully persisted to disk then these commit logs are deleted.

We index all data based on primary key. The data file on disk is broken down into a sequence of blocks. Each block contains at most 128 keys and is demarcated by a block index. The block index captures the relative offset of a key within the block and the size of its data. When an in-memory data structure is dumped to disk a block index is generated and their offsets written out to disk as indices. This index is also maintained in memory for fast access. A typical read operation always looks up data first in the in-memory data structure, and then the data files on disk in reverse time order.
