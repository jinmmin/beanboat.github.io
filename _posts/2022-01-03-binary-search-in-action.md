---
layout: post
title:  "Binary Search in Action"
date:   2022-01-03
tags: ["compute_science", "algorithm"]
---

Binary search is a topic that is easy to explain but hard to implement bug-free. Some example of the most common problems are:
* How to initialize the boundary
* When to exit the loop
* How to update the boundary, i.e. where to shrink

### Boundary
The boundary is the range of elements we will be searching from. The initial boundary should include ALL the element.
```
int l = min(search_space), r = max(search_space)
```
For arrays, it looks:
```
int l = 0, r = nums.length - 1;
```
LeetCode 35 "Search Insert Position" asks to find an index to insert into the array. It is possible to insert after the last element of the array. Thus the boundary becomes:
```
int l = 0, r = nums.length;
```

### Calculate mid
```
int mid = l + (r - l) / 2      // left/lower mid
int mid = l + (r - l + 1) / 2  // right/upper mid
int mid = r - (r - l) / 2      // right/upper mid
```

### Templates
#### Template 1
```
l = min(search_space), r = max(search_space)
while l < r:
  mid = l + (r - l) / 2    # left / lower
  if checkOk(mid):
    r = mid                # right moves
  else:
    l = mid + 1
return l
```

#### Template 2
```
l = min(search_space), r = max(search_space)
while l < r:
  mid = l + (r - l + 1) / 2   # right / upper
  if checkOk(mid):
    l = mid                   # left moves up
  else:
    r = mid - 1
return l
```

### Steps
* Initialize the boundary to include all possible elements.
* Decide return value. After exiting the while loop, left is the minimal one satisfying the condition function.
* Design the condition function. This is the most difficult part and needs a lot of practice.
* Check [0, 1] and switch the mid calculation if needed, to avoid infinite loop.

### LeetCode questions to practice
#### Easy
1.  Search Insert Position
2.  Sqrt(x)
3.   First Bad Version

#### Medium
33. Search in Rotated Sorted Array
81. Search in Rotated Sorted Array II
154. Find Minimum in Rotated Sorted Array II
302. Smallest Rectangle Enclosing Black Pixels
875. Koko Eating Bananas
1011. Capacity To Ship Packages Within D Days
1201. Ugly Number III
1283. Find the Smallest Divisor Given a Threshold
1482. Minimum Number of Days to Make m Bouquets

#### Hard
410. Split Array Largest Sum
644. Maximum Average Subarray II
668. Kth Smallest Number in Multiplication Table
719. Find K-th Smallest Pair Distance
774. Minimize Max Distance to Gas Station
786. K-th Smallest Prime Fraction
1095. Find in Mountain Array
1231. Divide Chocolate

### References
* [Binary-Search-101-The-Ultimate-Binary-Search-Handbook](https://medium.com/r/?url=https%3A%2F%2Fleetcode.com%2Fproblems%2Fbinary-search%2Fdiscuss%2F423162%2FBinary-Search-101-The-Ultimate-Binary-Search-Handbook)
* [Python-Powerful-Ultimate-Binary-Search-Template-Solved-many-problems](https://medium.com/r/?url=https%3A%2F%2Fleetcode.com%2Fdiscuss%2Fgeneral-discussion%2F786126%2FPython-Powerful-Ultimate-Binary-Search-Template.-Solved-many-problems)
