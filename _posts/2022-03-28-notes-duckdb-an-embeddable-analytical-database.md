---
layout: post
title:  "[Paper notes] DuckDB: an Embeddable Analytical Database"
date:   2022-03-28
tags: ["computer_science", "paper_notes"]
---

### Introduction

DuckDB is a novel data management system designed to execute analytical SQL queries while embedded in another process.

The main two use case sources are: interactive data analysis and “edge” computing. Both have requirements on portability and resource.

The previous research on **MonetDB** reveals the following requirements:

- High efficiency for OLAP workloads without completely sacrificing OLTP performance.
- Efficient transfer of tables to and from the database.
- Stability.
- Embeddability and portability. No external dependencies. No signal handling calls to `exit()` and modification of singular process state.

### Design and Implementation

DuckDB follow the “textbook” separation of components. It is accessed with a C/C++ API.

### Parser

The SQL parser is derived from Postgres’ SQL parser.

### Logical planner

- binder: resolves all expressions referring to schema objects such as tables or view with their column names and types.
- plan generator: transforms the parse tree into a tree of basic logical query operators.

### Optimizer

- join order optimization using dynamic programming with a greedy fallback for complex join graphs
- flatten of arbitrary subqueries
- rewrite rules, e.g. common subexpression elimination, constant folding

### Physical planner

### Execution engine

Uses a vectorized interpreted execution engine. It is chosen over Just-In-Time compilation (JIT) of SQL queries for portability reasons.

### Concurrency control

Uses HyPer’s serializable variant of MVCC that is tailored specifically for hybrid OLAP/OLTP systems.

### Storage

Uses the read-optimized DataBlocks storage layout. Logical tables are horizontally partitioned into chunks of columns which are compressed into physical blocks. Blocks carry min/max indexes for every column.

### Useful references

- Harald Lang, Tobias Mühlbauer, Florian Funke, Peter A. Boncz, Thomas Neumann, and Alfons Kemper. 2016. Data Blocks: Hybrid OLTP and OLAP on Compressed Storage using both Vectorization and Compilation. In Proceedings of the 2016 International Conference on Management of Data (SIGMOD ‘16). Association for Computing Machinery, New York, NY, USA, 311–326. DOI:https://doi.org/10.1145/2882903.2882925
- Thomas Neumann, Tobias Mühlbauer, and Alfons Kemper. 2015. Fast Serializable Multi-Version Concurrency Control for Main-Memory Database Systems. In Proceedings of the 2015 ACM SIGMOD International Conference on Management of Data (SIGMOD ‘15). Association for Computing Machinery, New York, NY, USA, 677–689. DOI:https://doi.org/10.1145/2723372.2749436
