import { verifyMessage } from 'viem';
import WalletNonce from './models/WalletNonce';

export const WALLET_RE = /^0x[a-fA-F0-9]{40}$/;

export function isValidWalletAddress(value: string): boolean {
    return WALLET_RE.test(value);
}

/** The exact message a wallet must sign to prove ownership -- must match on both the nonce-issuing and verifying sides. */
export function buildVerificationMessage(wallet: string, nonce: string): string {
    return `Verify wallet ownership for UTD's referral program.\n\nWallet: ${wallet}\nNonce: ${nonce}`;
}

/**
 * Consumes a one-time nonce and checks the signature recovers to `wallet`.
 * The nonce is deleted whether or not the signature checks out, so a replay
 * attempt against the same nonce always fails after the first try -- callers
 * must request a fresh nonce per attempt.
 */
export async function verifyWalletOwnership(wallet: string, nonce: string, signature: string): Promise<boolean> {
    const normalizedWallet = wallet.toLowerCase();
    const doc = await WalletNonce.findOneAndDelete({ wallet: normalizedWallet, nonce });
    if (!doc) return false; // unknown, already-used, or expired nonce

    const message = buildVerificationMessage(normalizedWallet, nonce);
    try {
        return await verifyMessage({ address: wallet as `0x${string}`, message, signature: signature as `0x${string}` });
    } catch {
        return false;
    }
}
