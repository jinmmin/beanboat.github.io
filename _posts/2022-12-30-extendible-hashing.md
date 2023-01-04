---
layout: post
title:  "Hash Schemes"
date:   2022-12-30
tags: ["computer_science", "data_structure"]
---

Hash table is a common data structure that uses a [hash function](https://en.wikipedia.org/wiki/Hash_function) to compute an index into an array of buckets, from which the desired the value can be found[^1]. When designing a hash table, below decisions need to be considered:
* **Hash Function**: used to map a large key space into a smaller domain. Trade-offs need to be made between the compute speed and the collision rate. For example, cryptographic hash functions have very low collision rate but is usually slow.
* **Hashing Scheme**: used to handle key collisions after hashing. Common approaches include having a large hash table, or dynamically shuffling the keys.

This post goes through some common hashing schemes, and uses Extendible Hashing as an example for more detailed explanation and implementation.

### Linear Probe Hashing
[Linear Probing](https://en.wikipedia.org/wiki/Linear_probing) is one form of [open addressing](https://en.wikipedia.org/wiki/Open_addressing). It resolves collisions by linearly searching for the next free slot in the table. Linear probing is to unevenly distributed hash values, so a high-quality hash function such as [MurmurHash](https://en.wikipedia.org/wiki/MurmurHash) is necessary to achieve good performance.

### Robin Hood Hashing
Robin Hood Hashing is a variant of linear probe hashing. When new keys are inserted, old keys may be shifted if the new key is farther away from its optimal position than the old key, so as to keep all keys reasonably close to the slot they originally hash to.

### Cuckoo Hashing
[Cuckoo Hashing](https://en.wikipedia.org/wiki/Cuckoo_hashing) handles collisions by pushing existing keys to another location in the table, resembling the way a cuckoo chick pushes other eggs out of the nest. Cuckoo hashing is commonly implemented using two hash functions and two arrays.

#### Insert
A new element is always inserted in the first table. If a collision occurs, the existing key is moved to the second table. If that causes another collision, the second existing key is moved to the first table. This continues until all collisions are handled. The performance degrades with the increasing load factor.
<iframe src="https://docs.google.com/presentation/d/e/2PACX-1vSPlW7_hIwrTd2dw9mDLtjWfZI_-SD9JTeAr-GyiaqGmw3G10mC3jXIDxyaSDuBcqQIe8unOH_mOwQm/embed?start=true&loop=true&delayms=1000" frameborder="0" width="600" height="366" allowfullscreen="true" mozallowfullscreen="true" webkitallowfullscreen="true"></iframe>

#### Lookup
If a key exists, it will be stored in either the first array or the second one. So with at most two lookups, we can figure out if the key exists or not.

### Chained Hashing
Chained Hashing maintains a linked list of buckets for each slot in the hash table, and puts all elements with the same hash key into the same bucket. To determine whether a key exists, it retrieves the bucket and do a linear scan.

### Extendible Hashing
[Extendible Hashing](https://en.wikipedia.org/wiki/Extendible_hashing) is a variant of chained hashing. Instead of letting the linked list grow infinitely, it splits the buckets.

Frequently used terms in Extendible Hashing:
* **Directory**: used to store the addresses of buckets in pointers. The hash function returns the directory id that points to the bucket for the hash key. The number of directories increases always by doubling.
* **Bucket**: used to store actual data. More than one pointers in the directory may point to one bucket. Buckets have a predefined capacity, and when the number of elements in a bucket exceeds the capacity, the bucket overflows and will need a split.
* **Global Depth**: associated with directories. Denotes the number of bits to use in the hash function result for categorizing the bucket. It is more efficient to use the [LSB](https://en.wikipedia.org/wiki/Bit_numbering#Bit_significance_and_indexing) when expanding the table, as the entire directory can be copied as one block. `Number of Directories = 2^Global Depth`. Global Depth increments when the number of directory expands.
* **Local Depth**:  associated with buckets. Used to decide the action to be performed in case of bucket overflow. Local depth increments when bucket splits. Local Depth is always less than or equal to the Global Depth.

#### Insert
Below are steps to insert elements
1. Convert the key to binary format using an appropriate hash function.
2. Identify the directory. The directory id is the GlobalDepth number of [LSB](https://en.wikipedia.org/wiki/Bit_numbering#Bit_significance_and_indexing)s in the binary number. E.g. the binary obtained is `11001` and the GlobalDepth is 3, the directory id is 3 LSBs of 11001 viz. 001.
3. Insert and check overflow. If bucket overflows,
   1. Local Depth < Global Depth: split the bucket, increment the local depth by 1, assign the pointer to the new bucket, redistribute the elements in the existing bucket.
   2. Local Depth == Global Depth: expand the directory first, and do the bucket split.

Below example shows the insert process.
<iframe src="https://docs.google.com/presentation/d/e/2PACX-1vRm51fSgFRiYLW-fefSPXLFuUGDQnt8i0hXltPHdWJUhX__IPR1V6JEjcmRNg3kmTb4Rp011Om0SRk7/embed?start=true&loop=true&delayms=1000" frameborder="0" width="600" height="366" allowfullscreen="true" mozallowfullscreen="true" webkitallowfullscreen="true"></iframe>

### Linear Hashing
[Linear hashing](https://en.wikipedia.org/wiki/Linear_hashing) keeps a pointer to track the next bucket to split, and uses multiple hashes to find the right bucket for a given key. When a bucket overflows, the bucket is split into the pointer location. Different overflow criterions can be used, e.g. load factor.

## References
[^1]: https://en.wikipedia.org/wiki/Hash_table

