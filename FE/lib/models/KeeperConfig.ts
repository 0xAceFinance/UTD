import { Schema, model, models } from 'mongoose';

/**
 * A single-row, admin-adjustable setting for the relayer's automatic gas
 * top-up (lib/relayerTopUp.ts): how much stakeToken (USDG) to pull from the
 * platform treasury and swap to ETH each time the relayer runs low. Starts
 * small ($1) and is raised with GET/PATCH /api/admin/keeper-config as the
 * treasury grows -- no redeploy, no restart. topUpsToday/topUpDay enforce
 * KEEPER_TOPUP_MAX_PER_DAY (lib/relayerTopUp.ts) without a separate
 * collection; topUpDay is a UTC "YYYY-MM-DD" string, reset lazily the first
 * time a new day is seen.
 */
export interface IKeeperConfig {
    _id: string;
    topUpUsdg: number;
    topUpDay?: string;
    topUpsToday?: number;
    updatedAt?: Date;
    updatedBy?: string;
}

const KeeperConfigSchema = new Schema<IKeeperConfig>({
    _id: { type: String, required: true },
    topUpUsdg: { type: Number, required: true },
    topUpDay: String,
    topUpsToday: Number,
    updatedAt: Date,
    updatedBy: String,
});

const KeeperConfig = models.KeeperConfig || model<IKeeperConfig>('KeeperConfig', KeeperConfigSchema);
export default KeeperConfig;

/** $1 -- see the sizing discussion in Deployment.md; raise via the admin route as the treasury grows. */
export const DEFAULT_TOP_UP_USDG = 1;

/** Reads the current setting, seeding the default row on first use. Never throws on a race to seed it. */
export async function getKeeperConfig(): Promise<IKeeperConfig> {
    const existing = await KeeperConfig.findById('relayer');
    if (existing) return existing;
    try {
        return await KeeperConfig.create({ _id: 'relayer', topUpUsdg: DEFAULT_TOP_UP_USDG });
    } catch {
        return (await KeeperConfig.findById('relayer')) ?? { _id: 'relayer', topUpUsdg: DEFAULT_TOP_UP_USDG };
    }
}
