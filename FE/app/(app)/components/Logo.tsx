import { cn } from "@/lib/utils"

export function LogoMark({ className }: { className?: string }) {
    return <img src="/logo.png" alt="UTD emblem" className={cn("object-contain", className)} />
}

export function Logo({ className, markClassName }: { className?: string; markClassName?: string }) {
    return (
        <div className={className}>
            <LogoMark className={markClassName} />
        </div>
    )
}
