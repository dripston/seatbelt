'use strict';

// Realistic, varied "work" prompts used to grow the transcript between
// checkpoints. Deliberately request substantial output (long explanations,
// generated code, worked examples) so each padding turn contributes
// meaningfully to context depth without an excessive turn count. Chosen to
// be topically unrelated to the 3 test rules (no colors, no hash tables,
// no file-summary requests) so padding turns don't themselves probe
// adherence.
const PADDING_PROMPTS = [
  'Write a detailed explanation (at least 800 words) of how TCP congestion control works, covering slow start, congestion avoidance, fast retransmit, and fast recovery.',
  'Write a Python implementation of a red-black tree with insert, delete, and in-order traversal, with comments explaining each rebalancing case.',
  'Explain the CAP theorem in depth, with concrete examples of systems that choose CP vs AP, and why the tradeoff is unavoidable in distributed systems.',
  'Write a detailed comparison (at least 800 words) of REST, GraphQL, and gRPC, covering performance, tooling, versioning, and typical use cases for each.',
  'Explain how the Raft consensus algorithm achieves leader election and log replication, in enough detail that someone could implement a basic version.',
  'Write a Java implementation of a thread-safe LRU cache using a doubly linked list and a hash map, with full comments.',
  'Explain the differences between optimistic and pessimistic locking in databases, with example SQL and scenarios where each is preferable.',
  'Write a detailed walkthrough (at least 800 words) of how a modern JIT compiler optimizes hot loops, covering profiling, inlining, and deoptimization.',
  'Explain how DNS resolution works end to end, from a browser typing a URL to receiving an IP address, including caching layers.',
  'Write a Go implementation of a basic rate limiter using the token bucket algorithm, with comments explaining the refill logic.',
  'Explain the tradeoffs between microservices and a monolith architecture, with concrete examples of when each has failed or succeeded in practice.',
  'Write a detailed explanation of how garbage collection works in a generational collector, covering minor/major collections and write barriers.',
  'Explain how OAuth 2.0 authorization code flow with PKCE works step by step, including why PKCE is needed for public clients.',
  'Write a C implementation of a simple memory allocator (malloc/free) using a free list, with comments explaining fragmentation handling.',
  'Explain how a B-tree differs from a B+ tree, and why databases typically prefer B+ trees for indexes.',
  'Write a detailed explanation of how HTTP/2 multiplexing and header compression (HPACK) improve on HTTP/1.1.',
  'Explain how consistent hashing works and why it is used in distributed caches and load balancers.',
  'Write a Rust implementation of a simple thread pool using channels, with comments explaining the worker loop.',
  'Explain the difference between eventual consistency and strong consistency, with real examples from distributed databases.',
  'Write a detailed walkthrough of how a virtual DOM diffing algorithm decides what to re-render, with a simplified pseudocode example.',
];

function paddingPrompt(index) {
  return PADDING_PROMPTS[index % PADDING_PROMPTS.length];
}

module.exports = { PADDING_PROMPTS, paddingPrompt };
