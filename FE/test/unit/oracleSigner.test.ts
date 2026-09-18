import { describe, it, expect } from 'vitest';
import { encodePacked, keccak256, recoverAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { hashMessage } from 'viem';
import { signSettlement, signVoid } from '@/lib/oracleSigner';
import { CONTRACTS } from '@/config/contracts';

const ESCROW_A = '0x1000000000000000000000000000000000000001' as `0x${string}`;
const ESCROW_B = '0x1000000000000000000000000000000000000002' as `0x${string}`;
const VOID_MARKER = 2;

describe('lib/oracleSigner::signSettlement', () => {
  it('produces a signature that recovers to the configured oracle signer address', async () => {
    const signature = await signSettlement(ESCROW_A, 0);
    const expectedSigner = privateKeyToAccount(process.env.ORACLE_SIGNER_PRIVATE_KEY as `0x${string}`).address;

    // Reproduce exactly what BattleEscrow.settle() verifies (see the
    // function's own doc comment): keccak256(abi.encodePacked(duel,
    // winnerSide, chainid)) wrapped in the EIP-191 personal-sign prefix.
    const message = keccak256(encodePacked(['address', 'uint8', 'uint256'], [ESCROW_A, 0, BigInt(CONTRACTS.chainId)]));
    const digest = hashMessage({ raw: message });
    const recovered = await recoverAddress({ hash: digest, signature });

    expect(recovered.toLowerCase()).toBe(expectedSigner.toLowerCase());
  });

  it('produces different signatures for different winnerSide values on the same duel', async () => {
    const sigA = await signSettlement(ESCROW_A, 0);
    const sigB = await signSettlement(ESCROW_A, 1);
    expect(sigA).not.toBe(sigB);
  });

  it('produces different signatures for different escrow addresses with the same winnerSide', async () => {
    const sigA = await signSettlement(ESCROW_A, 0);
    const sigB = await signSettlement(ESCROW_B, 0);
    expect(sigA).not.toBe(sigB);
  });

  it('throws if ORACLE_SIGNER_PRIVATE_KEY is not configured', async () => {
    const original = process.env.ORACLE_SIGNER_PRIVATE_KEY;
    delete process.env.ORACLE_SIGNER_PRIVATE_KEY;
    try {
      await expect(signSettlement(ESCROW_A, 0)).rejects.toThrow(/ORACLE_SIGNER_PRIVATE_KEY/);
    } finally {
      process.env.ORACLE_SIGNER_PRIVATE_KEY = original;
    }
  });
});

describe('lib/oracleSigner::signVoid', () => {
  it('produces a signature that recovers to the configured oracle signer address', async () => {
    const signature = await signVoid(ESCROW_A);
    const expectedSigner = privateKeyToAccount(process.env.ORACLE_SIGNER_PRIVATE_KEY as `0x${string}`).address;

    // Reproduce exactly what BattleEscrow.voidActive() verifies: same shape
    // as settle()'s message, but over VOID_MARKER instead of a real winnerSide.
    const message = keccak256(
      encodePacked(['address', 'uint8', 'uint256'], [ESCROW_A, VOID_MARKER, BigInt(CONTRACTS.chainId)])
    );
    const digest = hashMessage({ raw: message });
    const recovered = await recoverAddress({ hash: digest, signature });

    expect(recovered.toLowerCase()).toBe(expectedSigner.toLowerCase());
  });

  it('produces a different signature than signSettlement for the same escrow -- the two message spaces never collide', async () => {
    const settleSig = await signSettlement(ESCROW_A, 0);
    const voidSig = await signVoid(ESCROW_A);
    expect(settleSig).not.toBe(voidSig);
  });

  it('produces different signatures for different escrow addresses', async () => {
    const sigA = await signVoid(ESCROW_A);
    const sigB = await signVoid(ESCROW_B);
    expect(sigA).not.toBe(sigB);
  });

  it('throws if ORACLE_SIGNER_PRIVATE_KEY is not configured', async () => {
    const original = process.env.ORACLE_SIGNER_PRIVATE_KEY;
    delete process.env.ORACLE_SIGNER_PRIVATE_KEY;
    try {
      await expect(signVoid(ESCROW_A)).rejects.toThrow(/ORACLE_SIGNER_PRIVATE_KEY/);
    } finally {
      process.env.ORACLE_SIGNER_PRIVATE_KEY = original;
    }
  });
});
