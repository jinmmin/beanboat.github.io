---
layout: post
title:  "Extendible Hashing"
date:   2022-12-30
tags: ["computer_science", "data_structure"]
excerpt: My first experience of modeling
---

## Overview of Hash table
Design Decision #1: Hash Function
→ How to map a large key space into a smaller domain.
→ Trade-off between being fast vs. collision rate.
Design Decision #2: Hashing Scheme
→ How to handle key collisions after hashing.
→ Trade-off between allocating a large hash table vs.
additional instructions to get/put keys.

## Hash functions
For any input key, return an integer
representation of that key.
We do not want to use a cryptographic hash
function for DBMS hash tables (e.g., SHA-2) .
We want something that is fast and has a low
collision rate.

CRC-64 (1975)
→ Used in networking for error detection.
MurmurHash (2008)
→ Designed as a fast, general-purpose hash function.
Google CityHash (2011)
→ Designed to be faster for short keys (<64 bytes).
Facebook XXHash (2012)
→ From the creator of zstd compression.
Google FarmHash (2014)
→ Newer version of CityHash with better collision rates.

benchmarks: https://github.com/rurban/smhasher


## static hashing schemes
### Linear Probe Hashing
Single giant table of slots.
Resolve collisions by linearly searching for the
next free slot in the table.
→ To determine whether an element is present, hash to a
location in the index and scan for it.
→ Must store the key in the index to know when to stop
scanning.
→ Insertions and deletions are generalizations of lookups.

Deletions
Approach #1: Movement
→ Rehash keys until you find
the first empty slot.
→ Nobody actually does this

Approach #2: Tombstone
→ Set a marker to indicate that
the entry in the slot is
logically deleted.
→ You can reuse the slot for
new keys.
→ May need periodic garbage
collection.

Non unique keys
Choice #1: Separate Linked List
→ Store values in separate storage area for
each key.

Choice #2: Redundant Keys
→ Store duplicate keys entries together in
the hash table.
→ This is easier to implement so this is what
most systems do.

### Robin Hood Hashing
Variant of linear probe hashing that steals slots
from "rich" keys and give them to "poor" keys.
→ Each key tracks the number of positions they are from
where its optimal position in the table.
→ On insert, a key takes the slot of another key if the first
key is farther away from its optimal position than the
second key.

### Cuckoo Hashing


## dynamic hashing schemes
The previous hash tables require the DBMS to
know the number of elements it wants to store.
→ Otherwise, it must rebuild the table if it needs to
grow/shrink in size.
Dynamic hash tables resize themselves on demand.
### Chained Hashing
Maintain a linked list of buckets for each slot in
the hash table.
Resolve collisions by placing all elements with the
same hash key into the same bucket.
→ To determine whether an element is present, hash to its
bucket and scan for it.
→ Insertions and deletions are generalizations of lookups.

→ Extendible Hashing
Chained-hashing approach where we split buckets
instead of letting the linked list grow forever.
Multiple slot locations can point to the same
bucket chain.
Reshuffle bucket entries on split and increase the
number of bits to examine.
→ Data movement is localized to just the split chain

→ Linear Hashing


## References
* [CMU 15-445/645 (Fall 2022) Database Systems](https://15445.courses.cs.cmu.edu/fall2022/)

