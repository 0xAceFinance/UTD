export interface DuelTokenDTO {
    _id: string
    symbol: string
    name: string
    rank: number
    /** On-chain contract address (Robinhood Chain). */
    tokenAddress: string
    marketCapUsd: number
    liquidityUsd: number
    volume24hUsd: number
    change24hPct: number
}

export interface DuelTokenSideDTO {
    symbol: string
    name: string
    /** Absent on legacy duels created before addresses were stored. */
    tokenAddress?: string
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
