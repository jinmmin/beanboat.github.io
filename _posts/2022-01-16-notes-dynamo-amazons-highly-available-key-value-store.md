---
layout: post
title:  "[Paper notes] Dynamo: Amazon’s Highly Available Key-value Store"
date:   2022-01-16
tags: ["computer_science", "paper_notes"]
---
Highly available, scalable, eventually consistent, “always writable”

### **Highlights**

- Tunable consistency via (N, R, W)
- Sloppy quorum
- Data consistency and reconciliation logic is deferred to developers.
- Full membership model where each node is aware of the data hosted by its peers (May not scale as the overhead in maintaining the routing table increases with the system size).

### Requirements

- **Query model**: simple read and write operations to a data item that is uniquely identified by a key. No operations span multiple data items and there is no need for relational schema.
- **ACID** properties: weaker consistency, high availability, no isolation guarantees, permits only single key updates.
- **Efficiency**: configurable consistency to trade off performance, cost efficiency, availability, and durability

### Partitioning

#### Consistent hashing

Dynamo’s partitioning scheme relies on consistent hashing. In consistent hashing, the output range of a hash function is treated as fixed circular space or “ring”. Each node in the system is assigned a random value within this space.

Each data item identified by a key is assigned to a node by hashing the data item’s key to yield its position on the ring, and walking the ring clockwise to find the first node with the position larger than the item’s position. Dynamo uses MD5 hash on the key to generate a 128-bit hash.

The principle advantage of consistent hashing is that departure or arrival of a node only affects its immediate neighbors.

The basic consistent hashing algorithm presents some challenges:

- the random position assignment leads to non-uniform data and load distribution.
- Oblivious to the heterogeneity in the performance of nodes.

To address these issue, Dynamo uses the concept of “**virtual nodes**”, meaning it maps a node to a single point in the circle, each node gets assigned to multiple points in the ring. It brings the following advantages:

- If a node becomes unavailable, the load handled by this node is evenly dispersed across the remaining available nodes.
- When a node becomes available again, or a new node is added to the system, the newly available node accepts a roughly equivalent amount of load from each of the other available nodes.
- The number of virtual nodes that a node is responsible can be decided based on its capacity, accounting for heterogeneity in the physical infrastructure.

#### Ensuring uniform load distribution

**Strategy 1**: T random tokens per node and partition by token value

Each node is assigned T tokens (chosen uniformly at random from the hash space). Because the tokens are chosen randomly, the ranges vary in size. As nodes join and leave the system, the token set changes and consequently the ranges change. The space needed to maintain the membership at each node increases linearly with the number of nodes in the system.

The fundamental issue is that data partitioning and data placement are intertwined. In some cases, it is preferred to add more nodes to the system in order to handle an increase in request load. However, in this scenario, it is not possible to add nodes without affecting data partitioning.

**Strategy 2**: T random tokens per node and equal sized partitions

The hash space is divided into Q equally sized partitions/ranges and each node is assigned T random tokens. Q is usually set such that Q &gt;&gt; N and Q &gt;&gt; S\*T, where S is the number of nodes in the system.

A partition is placed on the first N unique nodes that are encountered while walking the consistent hashing ring clockwise from the end of the partition.

**Strategy 3**: Q/S tokens per node, equal-sized partitions

Each node is assigned Q/S tokens where S is the number of nodes in the system.

When a node leaves the system, its tokens are randomly distributed to the remaining nodes such that these properties are preserved. Similarly, when a node joins the system it “steals” tokens from nodes in the system in a way that preserves these properties.

### Replication

Each data item is replicated at N hosts, where N is configurable. Each key is assigned to a coordinated node using consistent hashing. The coordinator stores each key locally, and replicates these keys at the N-1 clockwise successor nodes in the ring. The list of nodes that is responsible for storing a particular key is called the **preference list**. The list is constructed to skip positions in the ring to contain only distinct physical nodes.

### Data versioning

Dynamo uses **vector clock**, effectively a list of (node, counter) pairs, to capture causality between different versions of the same object. One can determine whether two versions of an object are on parallel branches or have a causal ordering by examining their vector clocks. If the counter on the first object’s clock are less-than-or-equal to all of the nodes in the second clock, the the first is an ancestor of the second and can be forgotten. Otherwise, the two changes are considered to be in conflict and require reconciliation.

```
Sx -> nodes([Sx, 1]) -> ([Sx, 2]) -> ([Sx, 2], [Sy, 1])                        -> ([Sx, 2], [Sz, 1])-> ([Sx, 2], [Sy, 1], [Sz, 1])-> client performs reconciliation, and node Sx coordinates the write-> ([Sx, 3], [Sy, 1], [Sz, 1])
```

Unresolvable versions are presented to a client upon a read for semantic reconciliation.

A possible issue with vector clocks is that the size of vector clocks may grow if many servers coordinate the writes to an object. In practice, this is not likely because the writes are usually handled by one of the top N nodes in the preference list. To prevent this, Dynamo employs the following clock truncation scheme to limit the size of vector clocks: along with each (node, counter) pair, store a timestamp indicating the last time the node updated the data item. When the number of vector clock pairs reaches a threshold, remove the oldest pair from the clock.

### Execution of get() and put() operations

A read operation implements the following state machine (failure handling and retry states are left out for brevity):

- send read requests to the nodes
- wait for minimum number of required responses
- if too few replies were received within a given time bound, fail the request
- otherwise gather all the data versions and determine the ones to be returned
- if versioning is enabled, perform syntactic reconciliation and generate an opaque write context that contains the vector clock that subsumes all the remaining versions.

If stale versions were returned in any of the responses, the coordinator updates those nodes with the latest version. This process is called read repair because it repairs replicas that have missed a recent update at an opportunistic time and relieves the anti-entropy protocol from having to do it.

Having the first node among the top N to coordinate the writes and thereby serializing all writes at a single location is desirable. But this approach has led to uneven load distribution resulting in SLA violations. This is because the request load is not uniformly distributed across objects. To counter this, any of the top N nodes in the preference list is allowed to coordinate the writes. In particular, since each write usually follows a read operation, the coordinator for a write is chosen to be the node that replied fastest to the previous read operation which is stored in the context information of the request. This increases the chances of getting “read-your-writes” consistency.

#### **Routing**

**Server-driven coordination**

Through a generic load balancer that selects a node based on load info
Pro: clients do not have to link any code specific to Dynamo.

**Client-driven coordination**

Use a partition-aware client library.
Pro: achieves lower latency because it skips a potential forwarding step

A client periodically picks a random Dynamo node and downloads its current view of Dynamo membership state. Using this information the client can determine which set of nodes form the preference list for any given key. Read requests can be coordinated at the client node thereby avoiding the extra network hop that is incurred if the request were assigned to a random Dynamo node by the load balancer. Writes will either be forwarded to a node in the key’s preference list or can be coordinated locally if Dynamo is using timestamps based versioning.

Clients poll a random Dynamo node every 10 seconds for membership updates. A pull based approach was chosen over a push based one as the former scales better with large number of clients and requires very little state to be maintained at servers regarding clients. If the client detects its membership table is stale, it will immediately refresh its membership information.

#### Consistency protocol

Dynamo uses a consistency protocol with two key configurable values: R and W, denoting the minimum number of nodes that must participate in a read or write operation.

Upon receiving a put() request for a key, the coordinator generates the vector clock for the new version and writes the new version locally. The coordinator then sends the new version and the new version clock to the N highest-ranked reachable nodes. If at lease W-1 nodes respond, then the write is considered successful.

For a get() request, the coordinator requests all existing versions of data for that key from the N highest-ranked reachable nodes in the preference list, and waits for R responses before returning the result to the client. If the coordinator ends up gathering multiple versions of the data, it returns all the versions it deems to be causally unrelated. The divergent versions are reconciled and written back.

#### Balancing performance and durability

For services requiring higher level of performances, Dynamo provides the ability to trade-off durability guarantees for performance. In the optimization each storage node maintains an object buffer in its main memory. Each write operation is stored in the buffer and gets periodically written to storage by a writer thread. In this scheme, read operations first check if the requested key is present in the buffer. If so, the object is read from the buffer instead of the storage engine.

To reduce the durability risk, the write operation is refined to have the coordinator choose one out of the N replicas to perform a “durable write”. Since the coordinator waits only for W responses, the performance of the write operation is not affected by the performance of the durable write operation performed by a single replica.

### Handling failures

#### Hinted handoff

Dynamo uses **sloppy quorum**, meaning that all read and write operations re performed on the first N healthy nodes from the preference list, which may not always be the first N nodes encountered when walking the consistent hash ring.

The one outside of the N nodes will have a hint in its metadata that suggests which node was intended recipient of the replica. It keeps the hinted replica in a separate local database that is scanned periodically. Upon detecting the intended recipient node has recovered, it delivers the replica to that node. Once the transfer succeeds, it may delete the object from its local store without decreasing the total number of replicas in the system.

#### Replica synchronization

hinted handoff works best if the system membership churn is low and node failures are transient. It does not work if the hinted replica becomes unavailable before they are returned to the original node.

Dynamo uses **Merkle tress** to detect inconsistencies between replicas. A Merkle tree is a hash tree where leaves are hashes of the values of individual keys. Parent nodes are hashes of their respective children. Each branch can be checked independently without requiring nodes to download the entire tree or the entire data set. Merkle trees minimize the amount of data that needs to be transferred for synchronization and reduce the number of disk reads performed during the **anti-entropy** process.

Dynamo uses Merkel trees for anti-entropy as follows: Each node maintains a separate Merkle tree for each key range (the set of keys covered by a virtual node) it hosts. This allows nodes to compare whether the keys within a key range are up-to-date. Two nodes exchange the root of the Merkle tree corresponding to the key ranges that they host in moon. Subsequently, using the tree traversal scheme to determine if they have any differences and perform the appropriate synchronization action. The disadvantage with this scheme is that many key ranges change when a node joins or leaves the system thereby requiring the trees to be recalculated.

#### **Balancing background vs. foreground tasks**

Background tasks, for replica synchronization and data handoff, could trigger the problem of resource contention and affect the performance of the regular put and get operations.To prevent this, the background tasks were integrated with an admission control mechanism. Each of the background tasks uses this controller to reserve runtime slices of the resource (e.g. database), shared across all background tasks. A feedback mechanism based on the monitored performance of the foreground tasks is employed to change the number of slices that are available to the background tasks.
The admission controller constantly monitors the behavior of resource accesses while executing a “foreground” put/get operation. Monitored aspects include latencies for disk operations, failed database accesses due to lock-contention and transaction timeouts, and request queue wait times.

### Membership and failure detection

**Ring membership**

An administrator uses a command line tool or a browser to connect to a Dynamo node and issue a membership change to join a node or remove a node. The node that servers the request writes the membership change and its time of issue to persistent store. A gossip-based protocol propagates membership changes and maintains an eventually consisten view of membership. Each node contacts a peer chosen at random every second and the two nodes efficiently reconcile their persisted membership change histories.

When a node starts for the first time, it chooses its set of tokens (virtual nodes in the consistent hash space) and maps nodes to their respective token sets. The mapping is persisted on disk and initially contains only the local node and token set. The mappings stored at different Dynamo nodes are reconciled during the same communication exchange that reconciles the membership change histories. Therefore, partitioning and placement information also propagates via the gossip-based protocol and each storage node is aware of the token ranges handled by its peers. This allows each node to forward a key’s read/write operations to the right set of nodes directly.

**External discovery**

To prevent logical partitions, some Dynamo nodes play the role of **seeds**. Seeds are nodes that are discovered via an external mechanism and are known to all nodes. Because all nodes eventually reconcile their membership with a seed, logical partitions are highly unlikely.

**Failure detection**

A purely local notion of failure detection is sufficient for avoiding failed attempts at communication: node A may consider node B failed if node B does not respond to node A’s message. Node A then uses alternate nodes to service requests that map to B’s partitions; A periodically retries B to check for the latter’s recovery. In the absence of client requests to drive traffic between two nodes, neither node really needs to know whether the other is reachable and responsive.

### Applications

- Business logic specific reconciliation
- Timestamp based reconciliation: performs simple timestamp based reconciliation logic of “last write wins”.
- High performance read engine: R is set to be 1 and W to be N.