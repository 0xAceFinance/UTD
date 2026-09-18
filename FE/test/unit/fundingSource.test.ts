import { describe, it, expect, vi, beforeEach } from 'vitest';

const getBlockNumber = vi.fn();
const getLogs = vi.fn();

// Mocks the RPC transport boundary only (same approach as
// test/unit/chainVerify.test.ts) -- getFundingSource's own logic (bounded
// fromBlock computation, picking the earliest log) stays real.
vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>();
  return {
    ...actual,
    createPublicClient: () => ({ getBlockNumber, getLogs }),
  };
});

const WALLET = '0xWALLETaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

beforeEach(() => {
  getBlockNumber.mockReset();
  getLogs.mockReset();
});

describe('lib/fundingSource::getFundingSource', () => {
  it('returns the sender of the earliest inbound transfer within the lookback window', async () => {
    const earliestFunder = '0xEARLIESTFUNDERaaaaaaaaaaaaaaaaaaaaaaaaa';
    getBlockNumber.mockResolvedValue(1_000_000n);
    getLogs.mockResolvedValue([
      { blockNumber: 999_000n, args: { from: '0xLATERFUNDERaaaaaaaaaaaaaaaaaaaaaaaaaaaa' } },
      { blockNumber: 998_000n, args: { from: earliestFunder } },
    ]);

    const { getFundingSource } = await import('@/lib/fundingSource');
    const result = await getFundingSource(WALLET);

    expect(result).toBe(earliestFunder.toLowerCase());
  });

  it('bounds the search to the configured lookback window from the latest block', async () => {
    getBlockNumber.mockResolvedValue(1_000_000n);
    getLogs.mockResolvedValue([]);

    const { getFundingSource } = await import('@/lib/fundingSource');
    await getFundingSource(WALLET);

    expect(getLogs).toHaveBeenCalledTimes(1);
    const callArgs = getLogs.mock.calls[0][0];
    expect(callArgs.fromBlock).toBe(1_000_000n - 50_000n); // default FUNDING_SOURCE_LOOKBACK_BLOCKS
    expect(callArgs.toBlock).toBe('latest');
    expect(callArgs.args.to.toLowerCase()).toBe(WALLET.toLowerCase());
  });

  it('clamps fromBlock to 0 rather than going negative when the chain is younger than the lookback window', async () => {
    getBlockNumber.mockResolvedValue(100n);
    getLogs.mockResolvedValue([]);

    const { getFundingSource } = await import('@/lib/fundingSource');
    await getFundingSource(WALLET);

    expect(getLogs.mock.calls[0][0].fromBlock).toBe(0n);
  });

  it('returns undefined when no inbound transfer is found', async () => {
    getBlockNumber.mockResolvedValue(1_000_000n);
    getLogs.mockResolvedValue([]);

    const { getFundingSource } = await import('@/lib/fundingSource');
    expect(await getFundingSource(WALLET)).toBeUndefined();
  });

  it('returns undefined (never throws) when the RPC call fails -- best-effort, not required', async () => {
    getBlockNumber.mockRejectedValue(new Error('RPC unreachable'));

    const { getFundingSource } = await import('@/lib/fundingSource');
    await expect(getFundingSource(WALLET)).resolves.toBeUndefined();
  });
});
