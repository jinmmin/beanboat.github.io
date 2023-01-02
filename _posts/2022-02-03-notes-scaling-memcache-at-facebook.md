---
layout: post
title:  "[Paper notes] Scaling Memcache at Facebook"
date:   2022-02-03
tags: ["computer_science", "paper_notes"]
---

### Overview

**Requirements**

- Heavy read
- Heterogeneous read sources, such as MySQL databases, HDFS installations, and backend services.

**Query cache as a demand-filled look-aside cache**

- Read: request from memcache first; if not available, query the database or backend service, and populates the cache.
- Write: issue request to the database, and sends a delete request to the cache that invalidates any stale data. Choose delete over update because deletes are idempotent.

**Generic cache:** as a general key-value store, for an intermediate temp storage

**Overall architecture**

![](https://cdn-images-1.medium.com/max/800/1*tnaQYuFpPgDGww9eTb43sg.png)**Overall architecture**### In a Cluster: Latency and Load

#### Reducing latency

**Routing**: Items are distributed across the memcached servers through consistent hashing. Memcache clients maintain a map of all available servers, which is updated through an auxiliary configuration system.

**Parallel requests and batching**: in application code, try to minimize the number of network round trips necessary to respond to page requests, by constructing a directed acyclic graph (DAG) representing the dependencies between data, and web servers use this DAG to maximize the number of items that can be fetched concurrently.

**Client-server communication:**

- When appropriate, embed the complexity of the system into a stateless client rather than in the memcached servers. Client logic is provided as two components: a library that can be embedded into applications or as a standalone proxy named **mcrouter**.
- Use **UDP** for get requests to reduce latency and overhead. The UDP implementation detects packets that are dropped or received out of order (using sequence numbers) and treats them as errors on the client side. Clients treat get errors as cache misses, but skip inserting entries into memcached afterward to avoid putting additional load on a possibly overloaded network or server.
- For reliability, set and delete operations are done over **TCP** through an instance of mcrouter running on the client machine.
- mcrouter coalesce the connections between the client and the memcached servers, which reduces network, CPU and memory resources needed by **high throughput** TCP connections.
- **Incast congestion**: If a client requests a large number of keys, the responses can overwhelm components such as rack and cluster switches if those responses arrive all at once. Clients use a sliding window mechanism to control the number of outstanding requests. Similar to TCP’s congestion control, the size of this sliding window grows slowly upon a successful request and shrinks when a request goes unanswered.

#### Reducing load

**Lease**

A **lease** is a 64-bit token bound to the specific key the client originally requested.

Problem: A **stale set** occurs when a web server sets a value in memcache that does not reflect the latest value that should be cached. This can occur when concurrent updates to memcache get reordered.

Solution: The client provides the lease token when setting the value in the cache. With the lease token, memcached can verify and determine whether the data should be stored and thus arbitrate concurrent writes. Verification can fail if memcached has invalidated the lease token due to receiving a delete request for that item. Similar to load-link/store- conditional operates.

Problem: A **thundering herd** happens when a specific key undergoes heavy read and write activity. As the write activity repeatedly invalidates the recently set values, many reads default to the more costly path.

Solution: Each memcached server regulates the rate at which it returns tokens.

**Stale values**: in some situations, slightly out-of-data is acceptable.

**Memcache Pools**

Partition a cluster’s memcached servers into separate pools. Designate one pool (named wildcard) as the default and provision separate pools for special keys. For example, one pool for frequently accessed keys, and one key for infrequently accessed keys for which cache misses are expensive.

**Replication Within Pools**

Favor replication over further dividing the key space, for keys that are retrieved by large batch.

#### **Handling Failures**

For small outages, use an automated remediation system to recover. At the same time, use a dedicated small set of machines, named **Gutter**, to take over the responsibilities of a few failed servers.

When a memcached client receives no response to its get request, the client assumes the server has failed and issues the request again to a special Gutter pool. Entries in Gutter expire quickly to obviate Gutter invalidations.

The approach of rehashing the key risks cascading failures due to non-uniform key access frequency.

### In a Region: Replication

The web and memcached servers are split into multiple frontend clusters. Along with a storage cluster that contain the databases, they define a **region**.

**Regional invalidations**

We deploy invalidation daemons (named **mcsqueal**) on every database. Each daemon inspects the SQL statements that its database commits, extracts any deletes, and broad- casts these deletes to the memcache deployment in every frontend cluster in that region.

**Regional pools**

**Cold cluster warmup**

- a standalone proxy named **mcrouter**. This proxy presents a memcached server interface and routes the requests/replies to/from other servers.

### **Across Regions: Consistency**

**benefits of deploying to multiple regions**:

- putting web servers closer to end users reduce latency.
- geographic diversity mitigates the effects of events such as natural disasters or massive power failures.
- new locations can provide cheaper power and other economic incentives.

Each region consists of a storage cluster and several frontend clusters. One region holds the master databases and the other regions contain read-only replicas. Relies on MySQL’s replication mechanism to keep replica databases up-to-date with their masters.

**Writes from a master region:** invalidating data via daemons avoids a race condition where an invalidation arrives before the data has been replicated from the master region.

**Writes from a non-master region**: Uses a ***remote marker*** mechanism to minimize the probability of reading stale data. The presence of the marker indicates that data in the local replica database are potentially stale and the query should be redirected to the master region. When a web server updates data that affects a key *k*, that server

- sets a remote marker *rk* in the region
- performs the write to the master embedding *k* and *rk* to be invalidated
- deletes *k* in the local cluster.

On a subsequent request for *k*, a web server check whether *rk* exists, and direct its query to the master or local region depending on the presence of *rk*.

**Operational considerations:** sharing the same channel of communication for the delete stream as the database replication gains network efficiency on lower bandwidth connections.

### **Single Server Improvements**

The all-to-all communication pattern implies that a single server can become a bottleneck for a cluster.

**First major optimizations:**

- allow automatic expansion of the hash table to avoid look-up times drifting to *O*(*n*)
- make the server multi-threaded using a global lock to protect multiple data structures
- giving each thread its own UDP port to reduce contention when sending replies and later spreading interrupt processing overhead

**Adaptive slab allocator to manage memory**

**The Transient Item Cache:**

- for long-lived items, lazily evicts
- for short-lived items, place into a circular buffer of linked lists based on the expiration time of the item. Every second, all of the items in the bucket at the head of the buffer are evicted and the head advances by one.

**Software Upgrades:** modified memcached to store its cached values and main data structures in System V shared memory regions so that the data can remain live across a software upgrade and thereby minimize disruption.