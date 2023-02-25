---
layout: post
title: "[Paper notes] Amazon Aurora"
date:   2023-02-12
tags: ["computer_science", "paper_notes"]
---

This post is notes taken from the two Amazon Aurora papers: "Amazon Aurora: Design Considerations for High Throughput Cloud-Native Relational Databases" and "Amazon Aurora: On Avoiding Distributed Consensus for I/Os, Commits, and Membership Changes".

Amazon Aurora is a high-throughput relational database service for OLTP workloads offered as part of AWS. It was built on top of MySQL. It uses a multi-tenant scale-out storage service that abstracts a virtualized segmented redo log and is loosely coupled to a fleet of database instances. The architecture has three advantages over traditional approaches:
* by building storage as an independent fault-tolerant and self-healing service across multiple data-centers, we protect the database from performance variance and transient or permanent failures at either the networking or storage tiers.
* by only writing redo log records to storage, we are able to reduce network IOPS by an order of magnitude.
* by moving some of the most complex and critical functions (backup and redo recovery) from one-time expensive operations in the database engine to continuous asynchronous operations amortized across a large distributed fleet, we get near-instant crash recovery without checkpointing as well as inexpensive backups that do not interfere with foreground processing.

## Durability At Scale
### Replication and Correlated Failures
One approach to tolerate failures in a replicated system is to use a quorum-based voting protocol.  To achieve consistency, the quorums
must obey two rules. First, each read must be aware of the most recent write, formulated as V<sub>r</sub> + V<sub>w</sub> > V. Second, each write must be aware of the most recent write to avoid conflicting writes, formulated as V<sub>w</sub> > V/2.

A common V=3 is inadequate with AWS AZ.  An AZ is a subset of a Region that is connected to other AZs in the region through low latency links but is isolated for most faults, including power, networking, software deployments, flooding, etc. One can simply place each of the three replicas in a different AZ to be tolerant to large-scale events in addition to the smaller individual failures. Aurora chooses a design point of tolerating (a) losing an entire AZ and one additional node (AZ+1) without losing data, and (b) losing an entire AZ without impacting the ability to write
data, by replicating each data item 6 ways across 3 AZs with 2 copies of each item in each AZ. It uses a quorum model with 6 votes (V = 6), a write quorum of 4/6 (V<sub>w</sub> = 4), and a read quorum of 3/6 (V<sub>r</sub> = 3).

### Segmented Storage
To reducing Mean Time to Repair (MTTR), we partition the database volume into small fixed size segments, currently 10GB in size. These are each replicated 6 ways into `Protection Groups (PGs)`. A storage volume is a concatenated set of PGs, physically implemented using a large fleet of storage nodes that are provisioned as virtual hosts with attached SSDs using Amazon Elastic Compute Cloud (EC2). The PGs that constitute a volume
are allocated as the volume grows. We currently support volumes that can grow up to 64 TB on an unreplicated basis. A 10GB segment can be repaired in 10 seconds on a 10Gbps network link.

### Operational Advantages of Resilience
OS and security patching and software upgrades are executed one AZ at a time and no more than one member of a PG is being patched simultaneously.

## Logs
In Aurora, the only writes that cross the network are redo log records. The log applicator is pushed to the storage tier where it can be used to generate database pages in background or on demand. We continually materialize database pages in the background to avoid regenerating them from
scratch on demand every time.

The approach reduces network load despite amplifying writes for replication and provides performance as well as durability. The storage service can scale out I/Os in an embarrassingly parallel fashion without impacting write throughput of the database engine. In this model, the primary only writes log records to the storage service and streams those log records as well as metadata updates to the replica instances. The IO flow batches fully ordered log records based on a common destination (a logical segment, i.e., a PG) and delivers each batch to all 6 replicas where the batch is persisted on disk and the database engine waits for acknowledgements from 4 out of 6 replicas in order to satisfy the write quorum and consider the log records in question durable or hardened. The replicas use the redo log records to apply changes to their buffer caches.

For crash recovery in Aurora,  durable redo record application happens at the storage tier, continuously, asynchronously, and distributed across
the fleet. Any read request for a data page may require some redo records to be applied if the page is not current. As a result, the process of crash recovery is spread across all normal foreground processing. Nothing is required at database startup.
a
### Storage Service
Activities on the storage node:
1. receive log record and add to an in-memory queue
2. persist record on disk and acknowledge
3. organize records and identify gaps in the log since some batches may be lost
4. gossip with peers to fill in gaps
5. coalesce log records into new data pages
6. periodically stage log and new pages to S3
7. periodically garbage collect old versions
8. periodically validate CRC codes on pages

Each of the steps above is asynchronous, and only steps (1) and (2) are in the foreground path potentially impacting latency.

## THE LOG MARCHES FORWARD

### Async processing
### Normal Operation
* **Segment Complete LSN (SCL)**: identifies the greatest LSN below which all log records of the PG have been received. Used by the storage
nodes when they gossip with each other in order to find and exchange log records that they are missing.

### Recovery

