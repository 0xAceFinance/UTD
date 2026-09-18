import { encodePacked, keccak256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { CONTRACTS } from '@/config/contracts';

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
    const privateKey = process.env.ORACLE_SIGNER_PRIVATE_KEY;
    if (!privateKey) throw new Error('ORACLE_SIGNER_PRIVATE_KEY is not configured');

    const account = privateKeyToAccount(privateKey as `0x${string}`);
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
    const privateKey = process.env.ORACLE_SIGNER_PRIVATE_KEY;
    if (!privateKey) throw new Error('ORACLE_SIGNER_PRIVATE_KEY is not configured');

    const account = privateKeyToAccount(privateKey as `0x${string}`);
    const message = keccak256(
        encodePacked(['address', 'uint8', 'uint256'], [escrowAddress, VOID_MARKER, BigInt(CONTRACTS.chainId)])
    );
    return account.signMessage({ message: { raw: message } });
}
