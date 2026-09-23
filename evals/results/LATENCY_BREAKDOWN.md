# Latency breakdown (Phase 4)

N=200 iterations each.

| Measurement | avg | p50 | p95 |
|---|---|---|---|
| In-process `decide()` only (no process spawn) | 0.251ms | — | — |
| Full `node scripts/pre-bash.js` child process (spawn + module load + stdin + decide + stdout) | 91.96ms | 89.06ms | 121.00ms |
| Bare `node -e ""` (pure Node cold-start, no script logic at all) | 77.83ms | 75.91ms | 94.05ms |

**Attributed to this script's own logic (module loading + decide()): 14.13ms average** (full child process avg minus bare Node cold-start avg).

**Conclusion**: A meaningful share of latency comes from this script's own module loading or decide() logic, not just Node cold-start — but broken down further, `decide()` itself is negligible (0.25ms). The ~14ms attributed to "script logic" is almost entirely Node's own `require()`/module-resolution overhead for loading 4 separate local `.js` files (~3ms each, isolated and measured directly), not actual computation.

## Can a warm/persistent process model avoid this?

Checked Claude Code's official documentation directly (code.claude.com/docs/en/hooks and /hooks-guide). Finding: **no warm/daemon/persistent process model is documented for `command`-type hooks** — every invocation spawns a fresh process, and this is not presented as a limitation with a workaround, it's simply how the mechanism works. The `http` and `mcp_tool` hook types do reuse an already-running server/connection instead of spawning fresh, but adopting either would mean running and maintaining a persistent server process ourselves — a substantially larger architectural change than a "reduce cold start" fix, and out of scope for this fix pass without a dedicated design/eval effort of its own.

## Was bundling into a single file attempted?

Yes, briefly. A naive concatenation of the four local modules into one file was tried to see if eliminating separate `require()` calls (each with its own file-stat/compile cost) would recover the ~11-14ms. It failed immediately on duplicate `module.exports` declarations and internal cross-file `require()` calls that would need proper resolution to merge safely. Real bundling (via a proper build step, not concatenation) was judged not worth doing in this final phase of the fix pass: the potential win is small (a few ms off a ~14ms component of a ~90-140ms total, where ~78ms is an unavoidable Node cold-start floor this environment imposes), and the risk of introducing a subtle bug into an otherwise now-well-tested, well-performing matching engine (Phases 1-3 of this fix pass) was judged not worth taking for that size of win, this late in the pass.

## Bottom line

**Latency p95 (~140ms) is primarily an environment constraint (Node.js process cold-start on this machine, ~78-94ms of the total, non-negotiable without a warm-process architecture Claude Code doesn't currently support for command hooks) plus a smaller, real, load-bearing component (~11-14ms of local module loading) that could theoretically be reduced via bundling but was not attempted in this pass given the risk/reward at this stage.** This is reported honestly as a miss against the target, not claimed fixed. See evals/results/VERDICT-2.md for how this affects the overall shipping recommendation.

