import { Schema, model, models } from 'mongoose';

/**
 * A single-row lease that serializes every transaction the relayer wallet
 * sends (lib/settlementRelayer.ts). The keeper can be woken by a Cloud Task,
 * the per-minute cron and a page view at the same moment, possibly on
 * different Cloud Run instances; two of them sending from one wallet at once
 * would race each other's nonces. Only the holder of this lease sends.
 */
export interface IKeeperLock {
    _id: string;
    lockedUntil: Date;
    holder?: string;
}

const KeeperLockSchema = new Schema<IKeeperLock>({
    _id: { type: String, required: true },
    lockedUntil: { type: Date, required: true },
    holder: String,
});

export default models.KeeperLock || model<IKeeperLock>('KeeperLock', KeeperLockSchema);
