# Simulation is built on debug_traceCall dual tracers, not eth_simulateV1 or a local fork

Monad mainnet does not implement `eth_simulateV1` (verified empirically 2026-07-06: `-32601 Method not found`), so the obvious standard for multi-transaction simulation is unavailable. Instead, `simulate` chains transactions manually over `debug_traceCall`: for each unsigned transaction in a Plan, run `callTracer` (`withLog: true`) to get the call tree and event logs, and `prestateTracer` (`diffMode: true`) to get the state diff; merge the diff into an accumulated `stateOverrides` object so the next transaction executes on top of the previous one's effects.

This yields strictly more than `eth_simulateV1` would have: logs (`Transfer`/`Approval` → actual fund flows for the intent-vs-effects check), plus the full call tree (unknown recipients, unexpected fallback calls) for deep risk detection.

## Evidence (Monad mainnet, 2026-07-06)

All four primitives verified live against public endpoints: state overrides are genuinely executed (code override returned the planted constant; per-slot `stateDiff` override honored), `callTracer` returns logs, `prestateTracer` returns pre/post diffs. Endpoint support is uneven: `rpc.monad.xyz`, `rpc4.monad.xyz`, `rpc-mainnet.monadinfra.com`, and `monad-rpc.huginn.tech` pass everything; dRPC free tier, OnFinality public, bloXroute, and even the official `rpc3.monad.xyz` block or limit the `debug` namespace.

## Considered Options

- **`eth_simulateV1`** — not implemented on Monad.
- **Local anvil fork** — works anywhere but adds a foundry binary dependency for every contributor and CI job, and is an order of magnitude slower. Kept as a future second backend.
- **Third-party simulation APIs (Tenderly-style)** — wrong first dependency for open infrastructure (keys, vendor lock-in).
- **`eth_call` + state overrides as the engine** — rejected: returns only the function return value (no logs, no call tree, no diff), so the intent-vs-effects check degrades to "verify only what we thought to measure", and multi-tx chaining requires per-protocol storage-slot arithmetic. Retained only as an auxiliary read/quote primitive.

## Consequences

- The default RPC endpoint is `rpc.monad.xyz` (full support, no key).
- Monad's `debug_traceCall` **enforces sender balance** (discovered 2026-07-07: a 2-MON transfer from an underfunded address is rejected with `insufficient balance`, unlike geth's default). The simulator therefore pre-funds the plan's account via a balance override — matching `eth_simulateV1`'s validation-off semantics. Simulation answers "what would this plan do", not "can the account afford it"; affordability is the wallet's question at signing time.
- `Simulator` is an interface, not a class: roughly half of third-party free tiers block `debug_*`, so an anvil-fork backend must be addable without touching callers. When `debug_traceCall` is unavailable, simulate fails loudly with a list of supported endpoints — it never silently skips.
- All simulation requests set an explicit, modest `gas` value; provider free tiers reject calls that fall back to the node's block-gas-limit default.
- Trace `gasUsed` appears to report the gas limit rather than actual consumption; gas estimates go through `eth_estimateGas` separately.
