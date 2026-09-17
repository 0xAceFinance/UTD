import { Schema, Document, model, models } from 'mongoose';

/**
 * A single entry in the daily Top 10 (spec Section 01): a gladiator that
 * cleared every gate and earned a spot in the arena. Populated by
 * lib/duelTokenScan.ts against live Robinhood Chain data (lib/dexScreenerSource.ts),
 * refreshed by POST /api/scan.
 */
export interface IDuelToken extends Document {
    symbol: string;
    name: string;
    rank: number;
    /** Real on-chain address (lib/dexScreenerSource.ts). Used to poll a live
     * market cap once this token is picked into a duel -- see lib/duelEngine.ts. */
    tokenAddress: string;
    /** Derived at scan time (marketCap / priceUsd, see dexScreenerSource.ts::toCandidate).
     * Carried into a Duel at creation so the oracle pipeline can convert a
     * validated price back into a market cap without re-deriving it live. */
    totalSupply: number;
    marketCapUsd: number;
    liquidityUsd: number;
    volume24hUsd: number;
    change24hPct: number;
    updatedAt: Date;
}

const DuelTokenSchema = new Schema<IDuelToken>({
    symbol: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    rank: { type: Number, required: true, index: true },
    tokenAddress: { type: String, required: true },
    totalSupply: { type: Number, required: true },
    marketCapUsd: { type: Number, required: true },
    liquidityUsd: { type: Number, required: true },
    volume24hUsd: { type: Number, required: true },
    change24hPct: { type: Number, required: true },
    updatedAt: { type: Date, default: Date.now },
});

export default models.DuelToken || model<IDuelToken>('DuelToken', DuelTokenSchema);
