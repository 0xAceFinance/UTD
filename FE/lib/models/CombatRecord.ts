import { Schema, Document, model, models } from 'mongoose';

/**
 * Off-chain mirror of CombatRecordNFT.sol (Contracts/src/rewards/) -- fast
 * reads for the profile screen and leaderboard. This is the system of
 * record for now since no contract is deployed yet; once one is, this
 * becomes a cache kept in sync with on-chain events instead.
 */
export interface ICombatRecord extends Document {
    wallet: string;
    totalPoints: number;
    redeemedPoints: number;
    wins: number;
    losses: number;
    currentStreak: number;
    /** Most recent opponents, oldest first -- feeds the opponent-diversity gate (points package). */
    recentOpponents: string[];
}

const CombatRecordSchema = new Schema<ICombatRecord>({
    wallet: { type: String, required: true, unique: true, lowercase: true, index: true },
    totalPoints: { type: Number, default: 0 },
    redeemedPoints: { type: Number, default: 0 },
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    currentStreak: { type: Number, default: 0 },
    recentOpponents: { type: [String], default: [] },
});

export default models.CombatRecord || model<ICombatRecord>('CombatRecord', CombatRecordSchema);
