import { encodePacked, keccak256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { CONTRACTS } from '@/config/contracts';
import { readSettlementSigner } from '@/lib/chainClient';

/**
 * Each escrow verifies against the signer it snapshotted at activate()
 * (BattleEscrow.settlementSigner()), not the factory's current oracleSigner.
 * So after a rotation, duels activated before it still need the old key:
 * ORACLE_SIGNER_PRIVATE_KEY_PREVIOUS keeps it available for the ~24h those
 * duels can still be in flight. Picks whichever configured key the escrow
 * actually expects, and throws if neither does -- a signature from the wrong
 * key would just revert on-chain, so it's better never to store one.
 */
async function signerFor(escrowAddress: `0x${string}`) {
    const current = process.env.ORACLE_SIGNER_PRIVATE_KEY;
    if (!current) throw new Error('ORACLE_SIGNER_PRIVATE_KEY is not configured');
    const previous = process.env.ORACLE_SIGNER_PRIVATE_KEY_PREVIOUS;

    const expected = (await readSettlementSigner(escrowAddress)).toLowerCase();
    for (const key of previous ? [current, previous] : [current]) {
        const account = privateKeyToAccount(key as `0x${string}`);
        if (account.address.toLowerCase() === expected) return account;
    }
    throw new Error(
        `no configured oracle key matches escrow ${escrowAddress}'s settlementSigner ${expected} ` +
            '(check ORACLE_SIGNER_PRIVATE_KEY / ORACLE_SIGNER_PRIVATE_KEY_PREVIOUS after a signer rotation)'
    );
}

/**
 * Signs a settlement result exactly the way BattleEscrow.settle() verifies
 * it (Contracts/src/duel/BattleEscrow.sol): keccak256(abi.encodePacked(duel,
 * winnerSide, chainid)), then the standard EIP-191 personal-sign prefix --
 * viem's signMessage with a raw hash applies that prefix automatically,
 * matching Solidity's MessageHashUtils.toEthSignedMessageHash(). Anyone
 * holding this signature can submit settle() permissionlessly; the contract
 * only trusts the signature, never who calls it. chainid is folded in so a
 * signature can never be replayed on a different chain (relevant if this is
 * ever deployed to more than one chain from the same deployer key).
 *
 * ORACLE_SIGNER_PRIVATE_KEY is one of Anvil's well-known local test keys
 * today (see .env.local) -- never a real secret, safe for local dev. Before
 * any public deployment this must become a real, securely-managed key (a
 * KMS-backed signer, not a plain env var), and BattleEscrowFactory's
 * oracleSigner must be set to match it.
 */
export async function signSettlement(escrowAddress: `0x${string}`, winnerSide: 0 | 1): Promise<`0x${string}`> {
    const account = await signerFor(escrowAddress);
    const message = keccak256(
        encodePacked(['address', 'uint8', 'uint256'], [escrowAddress, winnerSide, BigInt(CONTRACTS.chainId)])
    );
    return account.signMessage({ message: { raw: message } });
}

/** BattleEscrow's VOID_MARKER sentinel -- outside settle()'s accepted 0/1
 * range, so a void signature can never be replayed as a settle signature
 * (or vice versa). See Contracts/src/duel/BattleEscrow.sol. */
const VOID_MARKER = 2;

/**
 * Signs a voidActive() refund for a HELD duel exactly the way
 * BattleEscrow.voidActive() verifies it -- same message shape as
 * signSettlement above, but over VOID_MARKER instead of a real winnerSide.
 * Used by the admin resolve route (app/api/admin/duels/[id]/resolve) when a
 * flagged match is decided not to have been legitimate.
 */
export async function signVoid(escrowAddress: `0x${string}`): Promise<`0x${string}`> {
    const account = await signerFor(escrowAddress);
    const message = keccak256(
        encodePacked(['address', 'uint8', 'uint256'], [escrowAddress, VOID_MARKER, BigInt(CONTRACTS.chainId)])
    );
    return account.signMessage({ message: { raw: message } });
}
