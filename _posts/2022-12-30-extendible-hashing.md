---
layout: post
title:  "Hash Schemes and Extendible Hashing"
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

#### Implementation

An example implementation based on [CMU 15-445/645 Database Systems](https://15445.courses.cs.cmu.edu/fall2022/).

<details><summary>Bucket</summary>
{% highlight cpp %}
template <typename K, typename V>
class Bucket {
 public:
  Bucket(size_t size, int depth = 0) : size_(size), depth_(depth) {}

  auto GetDepth() const -> int { return depth_; }

  void IncrementDepth() { depth_++; }

  auto GetItems() -> std::list<std::pair<K, V>> & { return list_; }

  auto Find(const K &key, V &value) -> bool {
    for (std::pair<K, V> &item : list_) {
      if (item.first == key) {
        value = item.second;
        return true;
      }
    }
    return false;
  }

  auto Remove(const K &key) -> bool {
    auto it = list_.begin();
    while (it != list_.end()) {
      if (it->first == key) {
        *it = list_.back();
        list_.pop_back();
        return true;
      }
      it++;
    }
    return false;
  }

  auto Insert(const K &key, const V &value) -> bool {
    auto it = list_.begin();
    while (it != list_.end()) {
      if (it->first == key) {
        it->second = value;
        return true;
      }
      it++;
    }

    if (list_.size() >= size_) {
      return false;
    }

    list_.emplace_back(key, value);
    return true;
  }

 private:
  size_t size_;
  int depth_;
  std::list<std::pair<K, V>> list_;
};
{% endhighlight %}
</details>

<details><summary>ExtendibleHashTable</summary>
{% highlight cpp %}
template <typename K, typename V>
class ExtendibleHashTable {
 public:
  explicit ExtendibleHashTable(size_t bucket_size)
      : global_depth_(0), bucket_size_(bucket_size), num_buckets_(1) {}

  auto GetGlobalDepth() const -> int { return global_depth_; }

  auto GetLocalDepth(int dir_index) const -> int {
    return dir_[dir_index]->GetDepth();
  }

  auto Find(const K &key, V &value) -> bool {
    size_t index = IndexOf(key);
    if (index >= dir_.size()) {
      return false;
    }
    return dir_[index]->Find(key, value);
  }

  void Insert(const K &key, const V &value) {
    if (GetGlobalDepth() == 0) {
      dir_.emplace_back(std::make_shared<Bucket<K, V>>(bucket_size_, 1));
      dir_.emplace_back(std::make_shared<Bucket<K, V>>(bucket_size_, 1));
      global_depth_++;
    }

    size_t index = IndexOf(key);
    if (dir_[index]->Insert(key, value)) {
      return;
    }

    // Bucket overflows.
    if (GetLocalDepth(index) == GetGlobalDepth()) {
      // Expand the directory by copying the existing directory to the end.
      size_t current_size = dir_.size();
      for (size_t i = 0; i < current_size; ++i) {
        dir_.push_back(dir_[i]);
      }
      global_depth_++;
    }

    dir_[index]->IncrementDepth();

    // Split the bucket
    size_t aindex = (index + (1 << (global_depth_ - 1))) % (1 << global_depth_);
    // Make the other directory point to a new bucket
    dir_[aindex] =
        std::make_shared<Bucket<K, V>>(bucket_size_, dir_[index]->GetDepth());
    bucket_size_++;

    // Redistribute the existing bucket
    auto it = dir_[index]->GetItems().begin();
    while (it != dir_[index]->GetItems().end()) {
      if (IndexOf(it->first) != index) {
        // Move to the new bucket and remove from the existing bucket
        dir_[aindex]->Insert(it->first, it->second);
        if (it == --dir_[index]->GetItems().end()) {
          dir_[index]->GetItems().pop_back();
          break;
        }
        *it = dir_[index]->GetItems().back();
        dir_[index]->GetItems().pop_back();
      } else {
        it++;
      }
    }

    Insert(key, value);
  }

  auto Remove(const K &key) -> bool {
    size_t index = IndexOf(key);
    if (index >= dir_.size()) {
      return false;
    }
    return dir_[index]->Remove(key);
  }

 private:
  auto IndexOf(const K &key) -> size_t {
    int mask = (1 << global_depth_) - 1;
    return std::hash<K>()(key) & mask;
  }

  int global_depth_;    // The global depth of the directory
  size_t bucket_size_;  // The size of a bucket
  int num_buckets_;     // The number of buckets in the hash table
  std::vector<std::shared_ptr<Bucket<K, V>>>
      dir_;  // The directory of the hash table
};
{% endhighlight %}
</details>

<details><summary>Unit test</summary>
{% highlight cpp %}
TEST(ExtendibleHashTableTest, BasicTest) {
  auto table = std::make_unique<ExtendibleHashTable<int, std::string>>(2);

  table->Insert(1, "a");
  table->Insert(2, "b");
  table->Insert(3, "c");
  table->Insert(4, "d");
  table->Insert(5, "e");
  table->Insert(6, "f");
  table->Insert(7, "g");
  table->Insert(8, "h");
  table->Insert(9, "i");
  EXPECT_EQ(2, table->GetLocalDepth(0));
  EXPECT_EQ(3, table->GetLocalDepth(1));
  EXPECT_EQ(2, table->GetLocalDepth(2));
  EXPECT_EQ(2, table->GetLocalDepth(3));

  std::string result;
  table->Find(9, result);
  EXPECT_EQ("i", result);
  table->Find(8, result);
  EXPECT_EQ("h", result);
  table->Find(2, result);
  EXPECT_EQ("b", result);
  EXPECT_FALSE(table->Find(10, result));

  EXPECT_TRUE(table->Remove(8));
  EXPECT_TRUE(table->Remove(4));
  EXPECT_TRUE(table->Remove(1));
  EXPECT_FALSE(table->Remove(20));
}
{% endhighlight %}
</details>




### Linear Hashing
[Linear hashing](https://en.wikipedia.org/wiki/Linear_hashing) keeps a pointer to track the next bucket to split, and uses multiple hashes to find the right bucket for a given key. When a bucket overflows, the bucket is split into the pointer location. Different overflow criterions can be used, e.g. load factor.

## References
[^1]: https://en.wikipedia.org/wiki/Hash_table

