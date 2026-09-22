import { Schema, Document, model, models } from 'mongoose';
import type { LobbyStatus } from '@mcapduel/matchmaking';

const LOBBY_STATUSES: LobbyStatus[] = ['OPEN', 'MATCHED', 'LIVE', 'SETTLING', 'HELD', 'SETTLED', 'EXPIRED', 'CANCELLED'];

/** Mirrors @mcapduel/engine's PoolSample shape -- see lib/dexScreenerSource.ts::getLivePoolSamples. */
export interface StoredPoolSample {
    poolAddress: string;
    tokenAddress: string;
    dexName: string;
    reserveToken: number;
    reserveQuote: number;
    quotePriceUsd: number;
    timestampSec: number;
}

export interface TokenSide {
    symbol: string;
    name: string;
    /** Real on-chain address (lib/dexScreenerSource.ts). Absent on duels created
     * before this field existed -- lib/duelEngine.ts leaves those sides untouched
     * rather than fake-simulating them. */
    tokenAddress?: string;
    /** Derived at scan time, carried through so the oracle pipeline can turn a
     * validated price back into a market cap (engine's marketCapUsd formula). */
    totalSupply?: number;
    /** Real total liquidity across every pool, read fresh the moment the battle
     * starts (join time) -- the baseline the oracle's liquidity gate measures
     * drops against (engine/src/oracle/liquidityGate.ts). */
    startLiquidityUsd?: number;
    /** Every raw multi-pool sample taken since the battle started -- the input
     * to engine's runOraclePipeline. Grows while LIVE; see lib/duelEngine.ts. */
    rawSamples: StoredPoolSample[];
    startMarketCapUsd: number;
    /** Latest liquidity-weighted median read, refreshed by lib/duelEngine.ts on
     * every poll while the duel is LIVE -- for the live animated bar. Not
     * itself oracle-validated; sustainedPeakMarketCapUsd is. */
    currentMarketCapUsd: number;
    /** The oracle-validated peak (engine's runOraclePipeline: liquidity-weighted
     * median -> liquidity-depth gate -> 60s TWAP -> sustained-peak dwell check),
     * re-derived from rawSamples on every poll. Only ever increases. This is
     * what settlement uses to decide the winner. */
    sustainedPeakMarketCapUsd: number;
    /** Hash-chain integrity of rawSamples as of the last poll (engine's SampleLog). */
    oracleVerified?: boolean;
}

/** A payout BattleEscrow couldn't push (e.g. a USDC-blacklisted recipient) and
 * credited to owed[to] instead -- claimable via withdraw(). amount is the raw
 * token amount as a decimal string (it can exceed Number precision). */
export interface DeferredPayout {
    to: string;
    amount: string;
}

export interface IDuel extends Document {
    status: LobbyStatus;
    creatorWallet: string;
    opponentWallet?: string;
    creatorSide: 0 | 1;
    tokenA: TokenSide;
    tokenB: TokenSide;
    buyInUsd: number;
    durationSeconds: number;
    createdAt: Date;
    openDeadline: Date;
    startTime?: Date;
    endTime?: Date;
    winnerSide?: 0 | 1;
    winnerPoints?: number;
    loserPoints?: number;
    /** Set at cancel time (@mcapduel/matchmaking's `cancel` transition) -- the
     * real timestamp history app/api/duels/route.ts checks against the
     * cancellation rate limiter (@mcapduel/matchmaking's `canCreateLobby`). */
    cancelledAt?: Date;
    /** Set when @mcapduel/risk's wallet-clustering check flags creator and
     * opponent as a suspected sybil match at settlement (lib/duelEngine.ts) --
     * the match goes to HELD instead of SETTLED pending human review. Checked
     * BEFORE the oracle ever signs a settlement: once signed, anyone can
     * submit it on-chain permissionlessly, so a flag after signing would be
     * meaningless. */
    flaggedSybil?: boolean;
    /** Real escrow clone address (Contracts/src/duel/BattleEscrow.sol),
     * derived from the real DuelCreated event -- see lib/chainVerify.ts.
     * Absent on duels created before on-chain integration existed. */
    escrowAddress?: string;
    /** Oracle signature over (escrowAddress, winnerSide), produced once
     * (lib/oracleSigner.ts) after the real winner is determined off-chain and
     * the sybil check clears. Status is SETTLING while this is set but no
     * on-chain settle() has been confirmed yet -- see
     * app/api/duels/[id]/confirm-settlement/route.ts. */
    oracleSignature?: string;
    /** PayoutDeferred events from the settle() transaction, if any. */
    deferredPayouts?: DeferredPayout[];
    /** Short lease held by lib/settlementRelayer.ts while it has a settle()
     * transaction in flight, so the cron and a page view can't both pay gas
     * to submit the same settlement. */
    relayLockedUntil?: Date;
    /** Creator's/opponent's referrer wallet and the bps rate signed into the
     * settlement (lib/referralAccount.ts::currentReferrerBps), snapshotted at
     * the same moment oracleSignature is produced -- lib/duelEngine.ts's
     * finalizeSettlement() reuses these exact values (never recomputes) so
     * referral crediting always matches what was actually signed and paid
     * on-chain, even if the referrer's tier moved in between. Absent/0 means
     * no referrer on that side. */
    creatorReferrerWallet?: string;
    creatorReferrerBps?: number;
    opponentReferrerWallet?: string;
    opponentReferrerBps?: number;
    /** Set only if the opponent swapped the creator's proposed opposing token
     * at join time -- the on-chain DuelCreated event (immutable) still shows
     * this original symbol, which will now diverge from the opponent's slot
     * on tokenA/tokenB.symbol. Kept for support/audit, never read by any logic. */
    originalOpponentTokenSymbol?: string;
}

const PoolSampleSchema = new Schema<StoredPoolSample>(
    {
        poolAddress: { type: String, required: true },
        tokenAddress: { type: String, required: true },
        dexName: { type: String, required: true },
        reserveToken: { type: Number, required: true },
        reserveQuote: { type: Number, required: true },
        quotePriceUsd: { type: Number, required: true },
        timestampSec: { type: Number, required: true },
    },
    { _id: false }
);

const TokenSideSchema = new Schema<TokenSide>(
    {
        symbol: { type: String, required: true },
        name: { type: String, required: true },
        tokenAddress: { type: String },
        totalSupply: { type: Number },
        startLiquidityUsd: { type: Number },
        rawSamples: { type: [PoolSampleSchema], default: [] },
        startMarketCapUsd: { type: Number, required: true },
        currentMarketCapUsd: { type: Number, required: true },
        sustainedPeakMarketCapUsd: { type: Number, required: true },
        oracleVerified: { type: Boolean, default: false },
    },
    { _id: false }
);

const DuelSchema = new Schema<IDuel>({
    status: { type: String, enum: LOBBY_STATUSES, default: 'OPEN', index: true },
    creatorWallet: { type: String, required: true, lowercase: true, index: true },
    opponentWallet: { type: String, lowercase: true, index: true },
    creatorSide: { type: Number, enum: [0, 1], required: true },
    tokenA: { type: TokenSideSchema, required: true },
    tokenB: { type: TokenSideSchema, required: true },
    buyInUsd: { type: Number, required: true },
    durationSeconds: { type: Number, required: true },
    createdAt: { type: Date, default: Date.now },
    openDeadline: { type: Date, required: true },
    startTime: Date,
    endTime: Date,
    winnerSide: { type: Number, enum: [0, 1] },
    winnerPoints: Number,
    loserPoints: Number,
    cancelledAt: Date,
    flaggedSybil: { type: Boolean, default: false },
    escrowAddress: { type: String, index: true },
    oracleSignature: String,
    deferredPayouts: {
        type: [new Schema<DeferredPayout>({ to: { type: String, lowercase: true }, amount: String }, { _id: false })],
        default: undefined,
    },
    relayLockedUntil: Date,
    creatorReferrerWallet: { type: String, lowercase: true },
    creatorReferrerBps: Number,
    opponentReferrerWallet: { type: String, lowercase: true },
    opponentReferrerBps: Number,
    originalOpponentTokenSymbol: String,
});

export default models.Duel || model<IDuel>('Duel', DuelSchema);
