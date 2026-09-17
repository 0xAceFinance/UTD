import { Schema, Document, model, models } from 'mongoose';

/**
 * Pre-launch signups from the landing page form (app/landing/WhitelistTerminal).
 *
 * Nothing here is created by hand on the cluster: the collection appears on the
 * first insert and Mongoose builds the declared indexes on first use, since
 * lib/mongoose.ts leaves `autoIndex` at its default.
 *
 * `identifier` is the normalised (lowercased, trimmed) wallet address or email
 * and carries the unique index, so a repeat submission is an upsert rather than
 * a second row. `passNumber` comes from the atomic counter in ./Counter so two
 * simultaneous signups can never be handed the same number.
 */
export interface IWhitelistEntry extends Document {
    identifier: string;
    kind: 'wallet' | 'email';
    passNumber: number;
    ip?: string;
    createdAt: Date;
    /** True once a signed message has proven ownership of `identifier` (wallet entries only -- see lib/walletVerification.ts). Email entries stay false forever. */
    walletVerified: boolean;
    /** This entry's own shareable code, generated only once walletVerified is true -- unverified/email entries can't refer anyone. */
    referralCode?: string;
    /** The referralCode of whoever referred this entry, if any. Set regardless of this entry's own verification (kept for attribution), but only counts toward the referrer's points once this entry is walletVerified -- see lib/referralStats.ts. */
    referredBy?: string;
    /** True if this referral looked like a self-referral / sybil cluster (@mcapduel/risk's IP-clustering, see lib/whitelistSybil.ts) -- excluded from the referrer's points, but the entry itself still counts as a normal signup. */
    referralSybilFlagged?: boolean;
}

const WhitelistEntrySchema = new Schema<IWhitelistEntry>({
    identifier: { type: String, required: true, unique: true, lowercase: true, trim: true },
    kind: { type: String, required: true, enum: ['wallet', 'email'] },
    passNumber: { type: Number, required: true, index: true },
    ip: { type: String },
    createdAt: { type: Date, default: Date.now },
    walletVerified: { type: Boolean, default: false },
    referralCode: { type: String, unique: true, sparse: true },
    referredBy: { type: String, index: true },
    referralSybilFlagged: { type: Boolean, default: false },
});

export default models.WhitelistEntry ||
    model<IWhitelistEntry>('WhitelistEntry', WhitelistEntrySchema);
