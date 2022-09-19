---
layout: post
title:  "Raft Basics"
date:   2022-09-18
tags: ["computer_science", "consensus_algorithm"]
excerpt: Basics of the Raft consensus algorithm.
---
* content
{:toc}

<i>
This post is mostly based on the [Raft lecture](https://www.youtube.com/watch?v=YbZ3zDzDnrw) by John Ousterhout.
</i>

I had a [post]({{site.url}}/2022/08/07/paxos-basics/) about the Paxos consensus algorithm. In this post, I would like to write about the basics of Raft, another widely used consensus algorithm.

Raft has the same use case as Paxos, but it is a much easier to understand algorithm. Actually the paper for Raft is named "In search of an understandable consensus algorithm". Paxos is hard because the author gives only the necessary invariants and engineers have a lot of flexibility to do the implementation. Raft, instead, gives a step-by-step guide for how things should be done. When used as is, Raft is definitely simpler. When the use case is more complex and you need to customize certain behaviors, there is no obvious winner.

# Leader election
There are generally two approaches to consensus, leader-based and leader-less. For leader-based algorithms, at any given time, there is always one server in change, while others accept its decisions; and clients communicate with the leader. For leader-less algorithms, all servers have equal roles, and clients can contact any server.

Large-scale systems that have a single cluster leader typically use a separate replicated state machine to manage leader election and store configuration information that must survive leader crashes.

Raft uses a leader. Leader-based approaches are usually more efficient than leader-less approaches, as there are no conflicts in proposed values. With this, Raft operations can be divided into two categories: normal operations and leader changes.

Servers start up as followers. Followers expect to receive RPCs from leaders or candidates. Leaders must send heartbeats, i.e. empty `AppendEntries` RPCs, to maintain authority. If `electionTimeout` elapses with no RPCs, followers assume leader has crashed and start a new election. The election timeout is typically 100-500ms.

To start a **new election**, follower does the following:
* Increment current term
* Change to candidate state
* Vote for itself
* Send `RequestVote` RPCs to all other servers, retry until either:
  * Receive votes from majority of servers: become leader, Send `AppendEntries` heartbeats to all other servers
  * Receive RPC from valid leader: return to follower state
  * Election timeout elapses, no one wins election: increment term, restart new election with a randomized timeout

Deposed leader may not be dead. For example, it might be temporarily disconnected from network, and after other servers elect a new leader, the old leader reconnects and attempts to commit log entries. Terms are used to detect stale leaders and candidates. Every RPC contains the term of the sender. If sender's term is older, RPC is rejected, and sender reverts to follower and updates its term. If receiver's term is older, it reverts to follower, updates its term, and then processes RPCs normally. Election updates terms of majority of servers, and prevents deposed leaders from committing new log entries.

# Log replication
Log replication is done using the following steps:
* Client sends command to leader
* Leader appends command to its log
* Leader sends `AppendEntries` RPCs to followers
* Once new entry committed (replicated on a majority of the servers):
  * Leader passes command to its state machine, returns result to client
  * Leader notifies followers of committed entries in subsequent `AppendEntries` RPCs
  * Followers pass committed commands to their state machines

For crashed or slow followers, leader retries RPCs until they succeed. Performance-wise, for each command, only one successful RPC to any majority of servers is needed.

It is guaranteed that if log entries on different servers have same index and term, they store the same command, and the logs are identical in all preceding entries. If a given entry is committed, all preceding entries are also committed.

Consistency can be checked during the `AppendEntries` RPC call. Each `AppendEntries` RPC contains the index and term of the last log entry. If a follower does not contain a matching entry, it rejects the request. New leaders must make follower logs consistent with its own by deleting extraneous entries or filling in missing entries. To do so, leader keeps `nextIndex` for each follower, which is the index of next log entry to send to that follower and is initialized to `1 + leader's last index`. When `AppendEntries` consistency check fails, leader decrements `nextIndex` and tries again. When a follower overwrites an inconsistent entry, it deletes all subsequent entries.

# Requirements
Same as Paxos, Raft also has safety and liveness requirements.

**Safety**
* Leaders never overwrite entries in their logs.
* Only entries in the leader's log can be committed.
* Entries must be committed before applying to state machine..

To meet the safety requirements, there are several rules that we should follow.
* **Election rule**. During elections, candidate with logs most likely to contain all committed entries should be chosen.
  * Candidates include the index and term of last log entry in `RequestVote` RPCs
  * Voting server v denies the vote if its log is "more complete": `lastTerm(v) > lastTerm(c) || (lastTerm(v) == lastTerm(c) && lastIndex(v) > lastIndex(c))`
  * Leader will have "most complete" log among electing majority
* **Commitment rules**. For a leader to decide an entry is committed:
  * The entry must be stored on a majority of servers
  * At least one new entry from the leader's term must also be stored on majority of servers

**Liveness**
* Choose election timeouts randomly in [T, 2T]
* One server usually times out and wins election before others wake up
* Raft will be able to elect and maintain a steady leader as long as the system satisfies: `broadcastTime << electionTimeout << MTBF` (`MTBF` is average time between failures for a single server)

# Configuration changes
System configuration refers to the id and address for each server, and  what constitutes a majority. Consensus mechanism must support changes in the configuration to replace failed machines or change degrees of replication.

Raft uses a 2-phase approach to handle configuration change. The intermediate phase uses joint consensus, meaning leader needs the majority of both old and new configurations for elections and commitment. Configuration change is just a log entry, which is applied immediately on receipt (committed or not). The process goes like commit old config, commit old + new, and commit new config. Once joint consensus is committed, we can begin replicating log entry using the new configuration. During the configuration change, any server from either configuration can server as leader. But if the current leader is not in the new config, it must step down once the new config is committed.

# Log compaction / Snapshot
Servers take snapshots independently. The leader occasionally send snapshots to followers that lag behind. Servers take snapshots when the log reaches a fixed size in bytes.

# References
* https://raft.github.io/
* [Raft lecture](https://www.youtube.com/watch?v=YbZ3zDzDnrw)
* Diego Ongaro and John Ousterhout. 2014. In search of an understandable consensus algorithm. In Proceedings of the 2014 USENIX conference on USENIX Annual Technical Conference (USENIX ATC'14). USENIX Association, USA, 305–320.

# Appendix - Raft protocol
## Client protocol
* Send commands to leader
  * If leader unknown, contact any server
  * If the contacted server is not leader, it will redirect to leader
* Leader does not respond until command has been logged, committed, and executed by leader's state machine
* If request times out (e.g., leader crash):
  * Client reissues command to some other server
  * Eventually redirected to new leader
  * Retry request with new leader
* Implementing **exactly-once semantics** as long as client does not crash by embedding a unique id in each command
   * Server includes id in log entry
  * Before accepting command, leader checks its log for entry with that id
  * If id found in log, ignore new command, return response from old command
  * Prevents a command from being executed twice, if leader crashes after executing command, but before responding

## Raft protocol glossary
### Terms
* Time divided into terms: election, normal operation under a single leader
* At most 1 leader per term
* Some terms have no leader (failed election)
* Terms act as a logical clock
* Each server maintains current term value, which increases monotonically
* Key role of terms: identify obsolete information

### Server States
* **Leader**: handles all client interactions, log replication. At most 1 viable leader at a time
  * Initialize `nextIndex` for each follower to `last log index + 1`
  * Send initial empty `AppendEntries` RPCs (heartbeat) to each follower; repeat during idle period to prevent election timeouts
  * Accept commands from clients, append new entries to local log
  * Whenever `last log index` >= `nextIndex` for a follower, send `AppendEntries` RPC with log entries starting at `nextIndex`, update `nextIndex` if successful
  * If `AppendEntries` fails because of log inconsistency, decrement `nextIndex` and retry
  * Mark log entries committed if stored on a majority of severs and at least one entry from current term is stored on a majority of servers
  * Step down if `currentTerm` changes
* **Follower**: completely passive (issues no RPCs, responds to incoming RPCs)
  * Respond to RPCs from candidates and leaders.
  * Convert to candidate if election timeout elapses without either
    * Receiving valid `AppendEntries` RPC from the leader
    * Granting vote to candidate
* **Candidate**: used to elect a new leader
  * Increment `currentTerm`, vote for self
  * Reset election timeout
  * Send `RequestVote` RPCs to all other servers, wait for either:
    * Votes received from majority of servers: become leader
    * `AppendEntries` RPC received from new leader: step down
    * Election timeout elapses without election resolution: increment term, start new election
    * Discover higher term: step down

During normal operation, there is 1 leader and N-1 followers.

### Persistent State
Each server persists the following to stable storage synchronously before responding to RPCs:
* `currentTerm`: latest term server has seen (initialized to 0 on first boot)
* `votedFor`: candidate id that received vote in current term (or null if none)
* `log[]`: log entries

### Log entry
* term: when entry was received by leader
* index: position of entry in the log
* command: command for state machine

## RequestVote RPC
Invoked by candidates to gather votes.
* **Arguments**
  * candidateId: candidate requesting vote
  * term: candidate's term
  * lastLogIndex: index of candidate's last log entry
  * lastLogTerm: term of candidate's last log entry
* **Results**
  * term: currentTerm, for candidate to update itself
  * voteGranted: true means candidate received vote
* **Implementation**
  1. If term > currentTerm, currentTerm = term (step down if leader or candidate)
  2. If term == currentTerm, votedFor is null or candidateId, and candidate's log is at least as complete as local log, grant vote and reset election timeout

## AppendEntries RPC
Invoked by leader to replicate log entries and discover inconsistencies; also used as heartbeat.
* **Arguments**
  * term: leader's term
  * leaderId: so follower can redirect clients
  * prevLogIndex: index of log entry immediately preceding new ones
  * prevLogTerm: term of prevLogIndex entry
  * entries[]: log entries to store (empty for heartbeat)
  * commitIndex: last entry known to be committed
* **Results**
  * term: currentTerm, for leader to update itself
  * success: true if follower contains entry matching prevLogIndex and prevLogTerm
* **Implementation**
  1. Return if term < currentTerm
  2. If term > currentTerm, currentTerm = term
  3. If candidate or leader, step down
  4. Reset election timeout
  5. Return failure if log doesn't contain an entry at prevLogIndex whose term matches prevLogTerm
  6. If existing entries conflict with new entries, delete ell existing entries starting with first conflicting entry
  7. Append any new entries not already in the log
  8. Advance state machine with newly committed entries

## InstallSnapshot RPC
Invoked by leader to send chunks of a snapshot to a follower. Leaders always send chunks in order.
* **Arguments**
  * term:  leader’s term
  * leaderId:  so follower can redirect clients
  * lastIncludedIndex: the snapshot replaces all entries up through and including this index
  * lastIncludedTerm: term of lastIncludedIndex
  * offset: byte offset where chunk is positioned in the snapshot file
  * data[]: raw bytes of the snapshot chunk, starting at offset
  * done: true if this is the last chunk
* **Results**
  * term: currentTerm, for leader to update itself
**Receiver implementation**
  1. Reply immediately if term < currentTerm
  2. Create new snapshot file if first chunk (offset is 0)
  3. Write data into snapshot file at given offset
  4. Reply and wait for more data chunks if done is false
  5. Save snapshot file, discard any existing or partial snapshot with a smaller index
  6. If existing log entry has same index and term as snapshot’s last included entry, retain log entries following it and reply
  7. Discard the entire log
  8. Reset state machine using snapshot contents (and load snapshot’s cluster configuration)
