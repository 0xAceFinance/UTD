import { Schema, Document, model, models } from 'mongoose';

/**
 * One-time nonces for proving wallet ownership before a whitelist entry
 * counts for referral points (see lib/walletVerification.ts). Each nonce is
 * deleted the moment it's checked -- successfully or not -- so a captured
 * signature can never be replayed. The TTL index cleans up anything that
 * was issued but never used (e.g. the user closed the signing prompt).
 */
export interface IWalletNonce extends Document {
    wallet: string;
    nonce: string;
    createdAt: Date;
}

const WalletNonceSchema = new Schema<IWalletNonce>({
    wallet: { type: String, required: true, lowercase: true, index: true },
    nonce: { type: String, required: true },
    createdAt: { type: Date, default: Date.now, expires: 600 }, // 10 minutes
});

export default models.WalletNonce || model<IWalletNonce>('WalletNonce', WalletNonceSchema);
