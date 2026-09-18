import { Schema, Document, model, models } from 'mongoose';

/**
 * Signals for @mcapduel/risk's wallet-clustering sybil check (Section 05):
 * every wallet is recorded against the request IP it created or joined a duel
 * from, plus (best-effort) the address that first funded it with the stake
 * token (lib/fundingSource.ts). Two wallets sharing either become a
 * `shared_ip`/`funded_by` edge in the WalletClusterGraph at settlement time
 * (lib/duelEngine.ts) -- funded_by catches a pair that shares no network
 * (different IPs/VPNs), which shared-IP alone can't.
 *
 * `shared_device` (needs a fingerprinting library) still isn't built; no
 * data source for it yet. Both wired-up signals have real false positives
 * (NAT/shared wifi/VPN for IP; a shared exchange withdrawal or on-ramp for
 * funding source), which is exactly why a cluster hit routes a match to HELD
 * for human review instead of auto-rejecting it.
 */
export interface IWalletSighting extends Document {
    wallet: string;
    ip?: string;
    fundedBy?: string;
    seenAt: Date;
}

const WalletSightingSchema = new Schema<IWalletSighting>({
    wallet: { type: String, required: true, lowercase: true, index: true },
    ip: { type: String, index: true },
    fundedBy: { type: String, lowercase: true, index: true },
    seenAt: { type: Date, default: Date.now },
});

export default models.WalletSighting || model<IWalletSighting>('WalletSighting', WalletSightingSchema);
