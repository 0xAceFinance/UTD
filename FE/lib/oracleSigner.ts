import { encodePacked, keccak256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

/**
 * Signs a settlement result exactly the way BattleEscrow.settle() verifies
 * it (Contracts/src/duel/BattleEscrow.sol): keccak256(abi.encodePacked(duel,
 * winnerSide)), then the standard EIP-191 personal-sign prefix -- viem's
 * signMessage with a raw hash applies that prefix automatically, matching
 * Solidity's MessageHashUtils.toEthSignedMessageHash(). Anyone holding this
 * signature can submit settle() permissionlessly; the contract only trusts
 * the signature, never who calls it.
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
    const message = keccak256(encodePacked(['address', 'uint8'], [escrowAddress, winnerSide]));
    return account.signMessage({ message: { raw: message } });
}
