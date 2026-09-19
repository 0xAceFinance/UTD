import { Schema, Document, model, models } from 'mongoose';

/**
 * A self-reported airdrop task completion (social tasks only -- every other
 * task is derived live from real data in lib/airdrop.ts, so it has nothing
 * to store). One row per wallet per task; the compound unique index makes a
 * double claim a no-op instead of double points.
 */
export interface IAirdropClaim extends Document {
    wallet: string;
    taskId: string;
    claimedAt: Date;
}

const AirdropClaimSchema = new Schema<IAirdropClaim>({
    wallet: { type: String, required: true, lowercase: true, index: true },
    taskId: { type: String, required: true },
    claimedAt: { type: Date, default: Date.now },
});

AirdropClaimSchema.index({ wallet: 1, taskId: 1 }, { unique: true });

export default models.AirdropClaim || model<IAirdropClaim>('AirdropClaim', AirdropClaimSchema);
