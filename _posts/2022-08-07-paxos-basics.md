---
layout: post
title:  "Paxos Basics"
date:   2022-08-07
tags: ["computer_science", "consensus_algorithm"]
---

This post is mostly based on the [Paxos lecture video](https://www.youtube.com/watch?v=JEpsBg0AO6o) by John Ousterhout, and [Paxos Made Moderately Complex](https://paxos.systems).

Paxos is a protocol for state machine replication in an asynchronous environment to reach consensus on single values. The failure model of a replica in an asynchronous environment includes non-[Byzantine](https://en.wikipedia.org/wiki/Byzantine_fault) fail-stop, delayed or lost messages. The goal is to make the state machines reliable by executing the same commands in the order order on all servers, so in the event of failures, the states do not get lost. The challenge comes up when multiple clients issue requests to replicas in parallel. Different replicas may receive requests in different orders and execute the commands in different order, causing their local states to diverge from one another over time.

The problem can be modeled as having a sequence of slots with commands. The commands are stored as log entries and are executed in the state machines in the order of their slot index. Replicas receive requests from clients and assign them to specific slots. In the case of concurrent requests, a consensus protocol is used to choose a single command for the same slot from the different proposals from the replicas. A replica awaits for the decision before actually updating the sequence of commands, executing the next command, and sending back a response to the client.

## Basic Paxos ("single decree")
The basic idea of Basic Paxos is to have one or more servers propose values, and pick one **single value** as **chosen**. The term "consensus problem" typically refers to this single-value formulation.

### Requirements
There are two requirements for Basic Paxos, safety and liveness.
* **Safety**
  * Only a single value may be chosen.
  * A server never learns that a value has been chosen unless it really has been.
* **Liveness** (assuming majority of servers are up and communicating within reasonable timelines)
  * Some proposed value is eventually chosen.
  * If a value is chosen, servers eventually learn about it.

### Components

There are two components that work together to implement the algorithm.
* **Proposers**: handles client requests; and actively proposes values to be chosen.
* **Acceptors**: passively responds to messages from proposers by voting yes or no, which forms the consensus. They want to know which value was chosen so they can pass it to the state machine. They store the chosen value and the state of the decision process.

Optionally, there could be a third component called **listeners**, who would like to know the chosen value. They can be merged to the acceptors.

### Thought process

If we only have one single acceptor, it could crash and lose the chosen value. So it is better to have multiple acceptors and the value will be chosen if it is accepted by majority of acceptors, i.e. using quorum.

If acceptors accept only first value they receive, in the event of simultaneous proposals, no value might be chosen. Think of the case when each acceptor receives a different proposal. Therefore, acceptors must sometimes accept multiple different values.

If acceptors accept every value it receives, multiple values could be chosen, which violates the safety requirement. Therefore, once a value has been chosen, future proposals must propose or choose that same value. Imagine a situation when a proposal is issued but delayed, and a new proposal arrives and is accepted. There must be a way to reject the old first proposal. So we need a way to order the proposals.

### Proposal numbers

The way to order proposals is to assign a unique number to each proposal. Higher numbers take priority over lower numbers. One simple approach is to concatenate two values. The lower bits is the server id, which is unique per server. This makes sure no two server generate the same proposal number. The higher bits is a max round number that is the largest that a server has ever seen. Servers track the round number and increment it to generate a new proposal number. Proposers must persist the max round number on disk, so they do not reuse it in case of crash or restart.
```
Proposal number = |Round Number|Server Id|
```

### Flow

The flow of Basic Paxos looks like below. Acceptors must record minProposal, acceptedProposal, and acceptedValue on stable storage.
* Proposer
  * Choose a new proposal number n
  * Broadcast `Prepare(n)` to a majority (or all) of Acceptors
* Acceptor
  * Receive `Prepare(n)`
  * If n > minProposal then minProposal = n, and accept the value. Otherwise, reject the value.
  * Return(acceptedProposal, acceptedValue)
* Proposer
  * Receive responses from majority
  * If any acceptedValues returned, replace value with acceptedValue for highest acceptedProposal
  * Broadcast `Accept(n, value)` to a majority (or all) Acceptors
* Acceptor
  * Respond to `Accept(n, value)`:
  * If n >= minProposal then:
    * acceptedProposal = minProposal = n
    * acceptedValue = value
  * Return(minProposal)
* Proposer
  * Responses received from majority:
    * Any rejections (result > n) ? goto(1)
    * Otherwise, value is chosen


### Problems of Basic Paxos

There are several problems with Basic Paxos. One is that competing proposers may cause livelock. One solution is to have randomized delay before restarting, which gives other proposers a chance to finish choosing. Multi-Paxos will use leader election instead.

The other one is that only the proposer knows which value has been chosen. If other servers want to know, must execute Paxos with their own proposal.

## Multi-Paxos

Multi-Paxos combines several instances of Basic Paxos to agree on a series of values forming the log. It uses separate Basic Paxos for each slot in the log. To do this, we add `index` argument to `Prepare` and `Accept`. The lifecycle of a request looks like below:
1. Client sends command to server.
2. Server uses Paxos to choose command as value for a slot of the log.
3. Server returns result from state machine to client.
4. Server waits for previous log entries to be applied, then applies new command to state machine.

### Choosing a slot for a given client request

When a request arrives from client, replica first finds the first slot that is not known to be chosen (i.e. decision has not been made for this slot), then it runs Basic paxos to propose client's command for this slot. If a `Prepare` returns acceptedValue, meaning the slot has been chosen for other replicas, it updates the slot with the acceptedValue and start again; Otherwise, the replica chooses the client's command.

Replicas can handle multiple client requests concurrently, by selecting different slots for each. However, when it comes to the state machine, the commands must be passed to the state machine in the order of the slot.

### Performance optimization

Basic Paxos is inefficient because it allows multiple concurrent proposers, and thus conflicts and restarts are likely to happen, which causes higher load, leading to even more conflicts. Also, for each chosen value, 2 round of RPCs (Prepare and Accept) are needed.

#### Pick a leader

To solve the first issue, we can limit only one server as the proposer, which makes the server a **leader**. One simple approach to elect a leader from Lamport is to let the server with the highest id act as the leader. Each server sends a heartbeat message to every other server every T ms. If a server hasn't received heartbeat from server with higher ID in last 2T ms, it acts as leader. A leader accepts requests from client and acts as proposer and acceptor. Other servers reject client requests or redirect them to the leader, and act only as acceptor.

#### Eliminate most Prepare RPCs

Prepare RPCs are needed for Basic Paxos to block old proposals and find out about possibly chosen values. To eliminate the Prepare RPC, we can make the proposal number refer to the entire log, and let acceptors return the highest proposal number that is accepted for the current slot. Acceptors will also return a `noMoreAccepted` bool to indicate if no proposals are accepted for any slot beyond the current one.

If acceptor responds to Prepare with `noMoreAccepted`, the leader skips future Prepares with that acceptor (until Accept rejected). Once the leader receives `noMoreAccepted` from majority of acceptors, no need for Prepare RPCs. With this, most log entries can be chosen in a single round of RPCs.

### Ensuring full disclosure

So far, information is incomplete. Log entries are only replicated to the majority, and only proposer knows when entry is chosen. We want servers to be fully replicated, and be aware of the chosen value so that they can pass it to the state machine. The steps to achieve the goals are:
* Keep retrying Accept RPCs until all acceptors respond (in background). This will fully replicates most entries.
* Mark entries that are known to be chosen with a special value. Each server maintains a `firstUnchosenIndex` index, which is the earliest log entry not marked as chosen.
* Proposer includes its `firstUnchosenIndex` in Accept RPCs. Acceptor marks all entries i chosen if `i < request.firstUnchosenIndex` and `acceptedProposal[i] == request.proposal`. This makes acceptors know about most chosen entries.
* Acceptor returns its `firstUnchosenIndex` in Accept replies. If proposer's firstUnchosenIndex > firstUnchosenIndex from response, then proposer sends `Success` RPC (in background)
* `Success(index, v)` notifies acceptor of chosen entry:
  * acceptedValue[index] = v
  * Mark acceptedProposal[index] as chosen
  * return firstUnchosenIndex
  * Proposer sends additional Success RPCs, if needed

### Client protocol

Clients send commands to the leader. If leader is unknown, they can contact any server, which will redirect the request to the leader. Leader responds only after the command has been chosen and executed by leader's state machine. If the request times out, client retries the request.

If the leader crashes after executing the command but before responding, we must not execute command twice. The solution is to have the client embed a unique id in each command. Servers include the id in the log entry. State machine records most recent command executed for each client. Before executing command, the state machine checks to see if the command has already been executed, if so, it ignores the new command and returns the response from old command.

### Configuration Changes

System configurations such as ids or addresses for each server, what constitutes a majority can change over time, for reasons like replacing a failed machine, or changing in the degree of replication. The safety requirement for configuration change is that during configuration changes, it must not be possible for different majorities to choose different values for the same log entry.

The solution is to have the configuration stored as a log entry, and replicated just like any other log entry. Configuration for choosing entry i is determined by entry i-α, i.e. a configuration change does not take effect until α commands have been executed. During (i-α, i), multiple concurrent commands can be pending. If the change needs to be completed quickly, the client can issue no-op commands.


## Materials

* [Original paper](http://research.microsoft.com/en-us/um/people/lamport/pubs/lamport-paxos.pdf) by Leslie Lamport. Created in the 1980s but not published until 1998 because the reviewers didn't like the Greek parable in the paper and he didn't want to change it.
* [Paxos Made Simple](http://research.microsoft.com/en-us/um/people/lamport/pubs/paxos-simple.pdf) is a second attempt by Leslie Lamport to explain Paxos. It is still not widely understood.
* [Paxos Made Live - An Engineering Perspective](http://www.cs.utexas.edu/users/lorenzo/corsi/cs380d/papers/paper2-1.pdf) by Google engineers sharing their experience implementing Paxos in Chubby.
* [The Paxos lecture video](https://www.youtube.com/watch?v=JEpsBg0AO6o) by John Ousterhout (author of the [log-structured filesystem paper](http://www.stanford.edu/~ouster/cgi-bin/papers/lfs.pdf)) makes it simple.
* [Paxos Made Moderately Complex](https://paxos.systems) is an operational description of Multi-Paxos.

## Other consensus algorithms

* [RAFT](https://ramcloud.stanford.edu/wiki/download/attachments/11370504/raft.pdf) is an attempt at a more understandable consensus algorithm. The [video presentation](https://www.youtube.com/watch?v=YbZ3zDzDnrw), also by John Ousterhout, is great too.
* [Viewstamped Replication](http://pmg.csail.mit.edu/papers/vr-revisited.pdf) by Barbara Liskov is an early algorithm to directly model log replication.
* [Zab](http://www.stanford.edu/class/cs347/reading/zab.pdf) is the algorithm used by Zookeeper.
