# MCAP DUEL — Engine (Phase 1)

Discovery engine + oracle integrity pipeline. This is the piece the spec says has to
be trustworthy before anything else gets built on top of it — see Sections 01 and 04
of the product blueprint.

## What's real and tested today

- **Hard-gate scanner** (`src/scanner/gates.ts`, `topTen.ts`) — every filter from Section 01
  (market cap, liquidity, volume, unique traders, age, rug-check, LP-lock, holder
  concentration, blocklist), plus the low-supply edge case: safety gates never relax,
  soft eligibility gates do.
- **Oracle pipeline** (`src/oracle/`) — all five mechanisms from Section 04, composed
  in `aggregator.ts`: liquidity-weighted median across pools → liquidity-depth gate →
  60s TWAP → sustained-peak validation → a hash-chained, tamper-evident sample log.
- **Backtest harness** (`src/backtest/`) — three synthetic adversarial scenarios
  (normal rally, self-pump wick, mid-battle liquidity rug) proving the pipeline
  rejects what it's supposed to reject. Run `npm run backtest` for a human-readable
  report, or `npm test` for the assertions.
- **29 passing unit/integration tests** covering every module, `npm test`.

## What's still pending real Robinhood Chain details

This chain is new enough that its RPC endpoint, chain ID, and DEX contracts aren't
public/confirmed yet. Rather than guess at them, the engine is built against a
generic Uniswap-V2-style pool interface and a `DataSource` abstraction
(`src/chain/dataSource.ts`) with two implementations:

- `MockDataSource` (default, `DATA_SOURCE=mock`) — synthetic candidates, used by
  every test and the scan/backtest scripts today.
- `ChainDexReader` (`DATA_SOURCE=chain`) — reads live pool reserves via viem. The
  reserve-reading path (`readPool()`) is fully implemented; `listCandidates()` and
  `samplePools()` throw on purpose — they need a real indexer (volume, tx count,
  holder concentration, LP-lock status, rug-check results) that can't be built
  against a chain with no confirmed public infrastructure yet.

**To go live:** fill in `CHAIN_RPC_URL`, `CHAIN_ID`, and `DEX_FACTORY_ADDRESSES` in
`.env` (copy `.env.example`), set `DATA_SOURCE=chain`, and wire a real indexer
(subgraph or an event-log scanner) into `ChainDexReader`. Everything downstream —
gates, scoring, oracle pipeline — doesn't change; it already only depends on the
`DataSource` interface and `PoolSample` shape.

## Known tuning item

The wick-attack backtest scenario currently validates a peak (~$854K) above the
genuine held level (~$600K) — still nowhere near the wick's implied ~$2M, so the
attack fails, but it's not as tight as it could be. Worth a tuning pass on the TWAP
window / sustained-peak tolerance once real trading-pattern data exists, rather than
hand-tuning against one synthetic scenario.

## Running it

```
npm install
cp .env.example .env
npm test              # 29 tests, all pure logic, no chain access needed
npm run backtest       # human-readable oracle report
npm run scan           # run the Top 10 selection against the mock data source
npm run typecheck
```
