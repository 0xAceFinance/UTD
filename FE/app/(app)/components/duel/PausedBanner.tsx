import { AlertTriangle } from "lucide-react"

/** Shown while BattleEscrowFactory is paused: create/join revert on-chain, settlement waits. */
export function PausedBanner() {
    return (
        <div role="status" className="flex items-center gap-2 border border-[var(--hot)] bg-[var(--s1)] p-3 text-[13px] text-[var(--hot)]">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>Duels are temporarily paused. Creating and joining are disabled; funds in existing duels are safe.</span>
        </div>
    )
}
