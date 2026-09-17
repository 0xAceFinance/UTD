import { Schema, Document, model, models } from 'mongoose';

/**
 * Real health history for @mcapduel/risk's circuit breaker (Section 05,
 * "oracle/indexer downtime"): one row per POST /api/scan attempt (see
 * lib/duelTokenScan.ts), recording whether the real DexScreener-backed scan
 * succeeded. app/api/duels/route.ts checks the recent history against
 * shouldPauseNewLobbies() before allowing a new lobby to be created --
 * matches already LIVE are never affected, only new ones are gated.
 */
export interface IOracleHealthSample extends Document {
    timestampSec: number;
    succeeded: boolean;
    detail?: string;
}

const OracleHealthSampleSchema = new Schema<IOracleHealthSample>({
    timestampSec: { type: Number, required: true, index: true },
    succeeded: { type: Boolean, required: true },
    detail: { type: String },
});

export default models.OracleHealthSample || model<IOracleHealthSample>('OracleHealthSample', OracleHealthSampleSchema);
