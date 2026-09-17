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
}

const WhitelistEntrySchema = new Schema<IWhitelistEntry>({
    identifier: { type: String, required: true, unique: true, lowercase: true, trim: true },
    kind: { type: String, required: true, enum: ['wallet', 'email'] },
    passNumber: { type: Number, required: true, index: true },
    ip: { type: String },
    createdAt: { type: Date, default: Date.now },
});

export default models.WhitelistEntry ||
    model<IWhitelistEntry>('WhitelistEntry', WhitelistEntrySchema);
