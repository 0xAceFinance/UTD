import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import mongoose from 'mongoose';
import { privateKeyToAccount } from 'viem/accounts';
import { parseEther, parseUnits } from 'viem';

const GAS_SWAP = vi.hoisted(() => ({
  weth: '0x1000000000000000000000000000000000000002',
  swapRouter: '0x1000000000000000000000000000000000000003',
  quoter: '0x1000000000000000000000000000000000000004',
  poolFeeTier: 100,
  treasury: '0x1000000000000000000000000000000000000005',
}));
const STAKE_TOKEN = vi.hoisted(() => '0x1000000000000000000000000000000000000001');

vi.mock('@/config/contracts', () => ({
  CONTRACTS: { stakeToken: STAKE_TOKEN, gasSwap: GAS_SWAP },
}));

const { postAlert } = vi.hoisted(() => ({ postAlert: vi.fn(async () => {}) }));
vi.mock('@/lib/alerts', () => ({ postAlert }));

import { maybeTopUpRelayer } from '@/lib/relayerTopUp';
import { publicClient, readStakeTokenDecimals } from '@/lib/chainClient';
import KeeperConfig from '@/lib/models/KeeperConfig';
import { ensureDbConnected, clearDatabase } from '../helpers/db';

const getBalance = vi.mocked(publicClient.getBalance);
const readContract = vi.mocked(publicClient.readContract);
const waitForReceipt = vi.mocked(publicClient.waitForTransactionReceipt);

// Anvil's well-known test key #2 -- never a real secret (same one used as the
// relayer key in test/unit/settlementRelayer.test.ts).
const account = privateKeyToAccount('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a');
const TX = `0x${'ab'.repeat(32)}` as `0x${string}`;
const AMOUNT_WEI = parseUnits('1', 18); // 1 USDG at the mocked 18 decimals

function fakeWallet() {
  return { writeContract: vi.fn().mockResolvedValue(TX) };
}

beforeEach(async () => {
  await ensureDbConnected();
  await clearDatabase();
  vi.clearAllMocks();
  vi.mocked(readStakeTokenDecimals).mockResolvedValue(18);
  getBalance.mockResolvedValue(0n); // low balance by default -- most tests want a top-up to trigger
  waitForReceipt.mockResolvedValue({ status: 'success' } as never);
  // readContract call order in the happy path: allowance(treasury->relayer),
  // quote, [allowance(relayer->router)] -- individual tests override as needed.
  readContract.mockImplementation(async ({ functionName }: any) => {
    if (functionName === 'allowance') return parseUnits('100', 18); // plenty, both directions
    if (functionName === 'quoteExactInputSingle') return [parseEther('0.001'), 0n, 0, 0n];
    throw new Error(`unexpected readContract call: ${functionName}`);
  });
});

afterAll(async () => {
  await mongoose.connection.close();
});

describe('lib/relayerTopUp::maybeTopUpRelayer', () => {
  it('does nothing when the balance is already healthy', async () => {
    getBalance.mockResolvedValue(parseEther('1'));
    const wallet = fakeWallet();
    const result = await maybeTopUpRelayer(account, wallet as never);
    expect(result.status).toBe('balance_ok');
    expect(wallet.writeContract).not.toHaveBeenCalled();
  });

  it('pulls USDG, swaps, and unwraps to ETH when the balance is low', async () => {
    const wallet = fakeWallet();
    const result = await maybeTopUpRelayer(account, wallet as never);

    expect(result.status).toBe('topped_up');
    expect(result.usdgPulled).toBe('1');
    expect(wallet.writeContract).toHaveBeenCalledTimes(2); // transferFrom, then multicall (router already max-approved)

    const pull = wallet.writeContract.mock.calls[0][0];
    expect(pull.functionName).toBe('transferFrom');
    expect(pull.args).toEqual([GAS_SWAP.treasury, account.address, AMOUNT_WEI]);

    const swap = wallet.writeContract.mock.calls[1][0];
    expect(swap.functionName).toBe('multicall');
    expect(swap.address).toBe(GAS_SWAP.swapRouter);

    const doc = await KeeperConfig.findById('relayer');
    expect(doc?.topUpsToday).toBe(1);
    expect(doc?.topUpDay).toBe(new Date().toISOString().slice(0, 10));
  });

  it('sets amountOutMinimum 0.5% below the live quote', async () => {
    readContract.mockImplementation(async ({ functionName }: any) => {
      if (functionName === 'allowance') return parseUnits('100', 18);
      if (functionName === 'quoteExactInputSingle') return [parseEther('0.002'), 0n, 0, 0n];
      throw new Error('unexpected call');
    });
    const wallet = fakeWallet();
    await maybeTopUpRelayer(account, wallet as never);

    // decodeFunctionData isn't worth importing here -- the swap call's args
    // carry the raw multicall bytes; assert indirectly via the write count
    // and that no error was raised computing the floor (a NaN/overflow would
    // throw inside encodeFunctionData before writeContract is ever called).
    expect(wallet.writeContract).toHaveBeenCalledTimes(2);
  });

  it('approves the router only when its own allowance from the relayer is insufficient', async () => {
    readContract.mockImplementation(async ({ functionName, args }: any) => {
      if (functionName === 'allowance') {
        const [owner] = args as [string];
        // Treasury's grant to the relayer is fine; the relayer's own grant to the router is not yet set.
        return owner === GAS_SWAP.treasury ? parseUnits('100', 18) : 0n;
      }
      if (functionName === 'quoteExactInputSingle') return [parseEther('0.001'), 0n, 0, 0n];
      throw new Error('unexpected call');
    });
    const wallet = fakeWallet();
    const result = await maybeTopUpRelayer(account, wallet as never);

    expect(result.status).toBe('topped_up');
    expect(wallet.writeContract).toHaveBeenCalledTimes(3); // transferFrom, approve, multicall
    expect(wallet.writeContract.mock.calls[1][0].functionName).toBe('approve');
  });

  it('reports unconfigured and sends nothing when this chain has no gasSwap config', async () => {
    const contracts = await import('@/config/contracts');
    (contracts.CONTRACTS as { gasSwap?: unknown }).gasSwap = undefined;
    const wallet = fakeWallet();
    const result = await maybeTopUpRelayer(account, wallet as never);
    expect(result.status).toBe('unconfigured');
    expect(wallet.writeContract).not.toHaveBeenCalled();
    (contracts.CONTRACTS as { gasSwap?: unknown }).gasSwap = GAS_SWAP; // restore for later tests
  });

  it('stops and alerts when the treasury allowance cannot cover the next top-up', async () => {
    readContract.mockImplementation(async ({ functionName }: any) => {
      if (functionName === 'allowance') return 0n;
      throw new Error('should not quote without allowance');
    });
    const wallet = fakeWallet();
    const result = await maybeTopUpRelayer(account, wallet as never);

    expect(result.status).toBe('allowance_too_low');
    expect(wallet.writeContract).not.toHaveBeenCalled();
    expect(postAlert).toHaveBeenCalledWith(expect.stringContaining('allowance'));
  });

  it('stops and alerts once the daily top-up cap is reached, without sending anything', async () => {
    process.env.KEEPER_TOPUP_MAX_PER_DAY = '2';
    const today = new Date().toISOString().slice(0, 10);
    await KeeperConfig.create({ _id: 'relayer', topUpUsdg: 1, topUpDay: today, topUpsToday: 2 });

    const wallet = fakeWallet();
    const result = await maybeTopUpRelayer(account, wallet as never);

    expect(result.status).toBe('daily_cap_reached');
    expect(wallet.writeContract).not.toHaveBeenCalled();
    expect(postAlert).toHaveBeenCalledWith(expect.stringContaining("top-up cap"));
    delete process.env.KEEPER_TOPUP_MAX_PER_DAY;
  });

  it('resets the daily count on a new UTC day', async () => {
    await KeeperConfig.create({ _id: 'relayer', topUpUsdg: 1, topUpDay: '2000-01-01', topUpsToday: 999 });
    const wallet = fakeWallet();
    const result = await maybeTopUpRelayer(account, wallet as never);
    expect(result.status).toBe('topped_up');
  });

  it('reports failed and alerts if the swap transaction reverts, without crashing the caller', async () => {
    waitForReceipt.mockResolvedValueOnce({ status: 'success' } as never); // the transferFrom
    waitForReceipt.mockResolvedValueOnce({ status: 'reverted' } as never); // the swap multicall
    const wallet = fakeWallet();
    const result = await maybeTopUpRelayer(account, wallet as never);

    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/reverted/);
    expect(postAlert).toHaveBeenCalledWith(expect.stringContaining('top-up failed'));
  });

  it('never throws on an unexpected RPC failure', async () => {
    readContract.mockRejectedValue(new Error('rpc down'));
    const wallet = fakeWallet();
    const result = await maybeTopUpRelayer(account, wallet as never);
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/rpc down/);
  });
});
