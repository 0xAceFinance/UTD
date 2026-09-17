import { Schema, Document, model, models } from 'mongoose';

/**
 * Real signal for @mcapduel/risk's wallet-clustering sybil check (Section 05):
 * every wallet is recorded against the request IP it created or joined a duel
 * from. Two wallets sharing an IP become a `shared_ip` edge in the
 * WalletClusterGraph at settlement time (lib/duelEngine.ts).
 *
 * This is deliberately the only clustering signal wired up. The other two
 * edge types the risk package supports -- `funded_by` (needs on-chain funding-
 * source analysis) and `shared_device` (needs a fingerprinting library) --
 * aren't built; there's no data source for them yet. Shared-IP has real
 * false positives too (NAT, shared wifi, VPNs), which is exactly why a
 * cluster hit routes a match to HELD for human review instead of auto-
 * rejecting it.
 */
export interface IWalletSighting extends Document {
    wallet: string;
    ip: string;
    seenAt: Date;
}

const WalletSightingSchema = new Schema<IWalletSighting>({
    wallet: { type: String, required: true, lowercase: true, index: true },
    ip: { type: String, required: true, index: true },
    seenAt: { type: Date, default: Date.now },
});

export default models.WalletSighting || model<IWalletSighting>('WalletSighting', WalletSightingSchema);
