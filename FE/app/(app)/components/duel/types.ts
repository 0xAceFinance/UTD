export interface DuelTokenDTO {
    _id: string
    symbol: string
    name: string
    rank: number
    marketCapUsd: number
    liquidityUsd: number
    volume24hUsd: number
    change24hPct: number
}

export interface DuelTokenSideDTO {
    symbol: string
    name: string
    startMarketCapUsd: number
    currentMarketCapUsd: number
    sustainedPeakMarketCapUsd: number
}

export type DuelStatus = 'OPEN' | 'MATCHED' | 'LIVE' | 'SETTLING' | 'HELD' | 'SETTLED' | 'EXPIRED' | 'CANCELLED'

export interface DuelDTO {
    _id: string
    status: DuelStatus
    creatorWallet: string
    opponentWallet?: string
    creatorSide: 0 | 1
    tokenA: DuelTokenSideDTO
    tokenB: DuelTokenSideDTO
    buyInUsd: number
    durationSeconds: number
    createdAt: string
    openDeadline: string
    startTime?: string
    endTime?: string
    winnerSide?: 0 | 1
    winnerPoints?: number
    loserPoints?: number
    flaggedSybil?: boolean
    /** Real escrow clone address (Contracts/src/duel/BattleEscrow.sol). Absent on
     * legacy duels created before on-chain integration existed. */
    escrowAddress?: string
    /** Oracle signature ready for anyone to submit as settle(winnerSide, oracleSignature)
     * on the escrow contract -- present once status is SETTLING. */
    oracleSignature?: string
    /** PayoutDeferred events from the settle() tx: payouts the stake token refused
     * (e.g. a blacklisted address), credited to owed[to] on the escrow instead. */
    deferredPayouts?: { to: string; amount: string }[]
}

/** Mirrors BattleEscrow.STALE_REFUND_GRACE_PERIOD (Contracts/src/duel/BattleEscrow.sol). */
export const STALE_REFUND_GRACE_PERIOD_MS = 24 * 60 * 60 * 1000

/**
 * Whether to offer the last-resort refundStale() button. Only for a duel with
 * no result: LIVE (never signed) or HELD (flag never resolved). Never for
 * SETTLING -- a winner is already signed there, and refundStale() would hand
 * the loser back a stake they lost; the payout button is the only action.
 * The real timing gate is on-chain; this is a UI estimate.
 */
export function canForceRefund(duel: Pick<DuelDTO, 'status' | 'endTime'>, nowMs = Date.now()): boolean {
    if (duel.status !== 'LIVE' && duel.status !== 'HELD') return false
    return !!duel.endTime && nowMs - new Date(duel.endTime).getTime() >= STALE_REFUND_GRACE_PERIOD_MS
}

export function formatUsd(n: number): string {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
    if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
    return `$${n.toFixed(0)}`
}

export function pctReturn(start: number, current: number): number {
    return ((current - start) / start) * 100
}

export function formatRelativeTime(iso: string): string {
    const diffSec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
    if (diffSec < 60) return 'just now'
    const diffMin = Math.floor(diffSec / 60)
    if (diffMin < 60) return `${diffMin}m ago`
    const diffHr = Math.floor(diffMin / 60)
    if (diffHr < 24) return `${diffHr}h ago`
    const diffDay = Math.floor(diffHr / 24)
    return `${diffDay}d ago`
}
