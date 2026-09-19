"use client"

import { useState } from "react"
import { Plus, Minus } from "lucide-react"
import { sound } from "./SoundEngine"

interface FaqItem {
    question: string
    answer: string
    category: "basics" | "oracle" | "rewards"
}

const FAQS: FaqItem[] = [
    {
        question: "What is a duel?",
        category: "basics",
        answer:
            "Two already-trading tokens go head to head for 5, 10, 15 or 20 minutes. Both players lock an equal stablecoin stake on their side. When the clock runs out, the token with the higher validated market-cap gain wins.",
    },
    {
        question: "What does buy-only mean?",
        category: "basics",
        answer:
            "The duel scores net market-cap growth, so the only way to win is to push your side up. Dumping the other token doesn't help you: the oracle needs a price to hold for 30 seconds before it counts at all.",
    },
    {
        question: "How do you stop flash-loan wicks?",
        category: "oracle",
        answer:
            "Four checks, in order: a liquidity-weighted median across every verified pool, a depth gate that rejects thin-book spikes, a 60-second time-weighted average, and a 30-second hold requirement on any new peak. A one-block spike never reaches settlement.",
    },
    {
        question: "Where is my stake while the duel runs?",
        category: "oracle",
        answer:
            "In an escrow contract deployed for that single match. There is no team wallet in the path and no admin withdrawal function. The contract can only pay the verified winner or refund you in full.",
    },
    {
        question: "What if nobody joins my duel?",
        category: "basics",
        answer:
            "You have a 60-minute window to find an opponent. Cancel any time before someone joins for a full refund. If the window closes empty, anyone can trigger the expiry call and your stake comes back whole.",
    },
    {
        question: "How do points and tiers work?",
        category: "rewards",
        answer:
            "Every settled duel awards points, win or lose. Your first settlement mints a soulbound ERC-721 to your wallet. Lifetime points move you from Bronze through Silver, Gold and Diamond, which raises your vault cap and shortens vesting.",
    },
    {
        question: "How is the pot split?",
        category: "rewards",
        answer:
            "The winner takes 80% of the pot, which is 1.6× their stake. The other 20% funds the oracle, liquidity programs and the rewards pool. Losers forfeit the stake and keep the points.",
    },
]

const FILTERS = [
    { id: "all", label: "All" },
    { id: "basics", label: "Basics" },
    { id: "oracle", label: "Oracle & escrow" },
    { id: "rewards", label: "Rewards" },
] as const

export function FaqSection() {
    const [openKey, setOpenKey] = useState<string | null>(FAQS[0].question)
    const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all")

    const visible = filter === "all" ? FAQS : FAQS.filter((f) => f.category === filter)

    return (
        <div>
            <div className="inline-flex flex-wrap gap-px bg-[var(--line)]">
                {FILTERS.map((f) => (
                    <button
                        key={f.id}
                        onClick={() => {
                            sound.playBlip(500)
                            setFilter(f.id)
                        }}
                        aria-pressed={filter === f.id}
                        className={`utd-body px-4 py-2 text-[12px] transition-colors ${
                            filter === f.id
                                ? "bg-[var(--acid)] text-[var(--acid-ink)]"
                                : "bg-[var(--s1)] text-[var(--dim)] hover:bg-[var(--s2)] hover:text-[var(--txt)]"
                        }`}
                    >
                        {f.label}
                    </button>
                ))}
            </div>

            {/* Keyed on the question, not the filtered index: with a filter applied
                the old index key opened whichever row happened to sit at that
                position in the filtered list. */}
            <div className="mt-6 divide-y divide-[var(--line)] border-y border-[var(--line)]">
                {visible.map((faq) => {
                    const isOpen = openKey === faq.question
                    return (
                        <div key={faq.question}>
                            <button
                                type="button"
                                aria-expanded={isOpen}
                                onClick={() => {
                                    sound.playBlip(620)
                                    setOpenKey(isOpen ? null : faq.question)
                                }}
                                className="group flex w-full items-center justify-between gap-6 py-5 text-left"
                            >
                                <span
                                    className={`utd-body text-[15px] transition-colors ${
                                        isOpen ? "text-white" : "text-[var(--txt)] group-hover:text-white"
                                    }`}
                                >
                                    {faq.question}
                                </span>
                                <span className="flex-none text-[var(--faint)] transition-colors group-hover:text-[var(--acid)]">
                                    {isOpen ? <Minus className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                                </span>
                            </button>

                            {isOpen && (
                                <p className="utd-body max-w-2xl pb-6 text-[14px] text-[var(--dim)]">
                                    {faq.answer}
                                </p>
                            )}
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
