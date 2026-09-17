"use client"

import { Swords, List, User } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { LogoMark } from "./Logo"

const navItems = [
  { icon: Swords, label: "duels", href: "/" },
  { icon: List, label: "tokens", href: "/tokens" },
  { icon: User, label: "profile", href: "/profile" },
]

export default function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="border-r border-border/50 bg-gradient-to-b from-card/90 to-card/70 backdrop-blur-md supports-[backdrop-filter]:bg-card/50 lg:block lg:w-24">
      <div className="flex h-full flex-col">
        <div className="flex h-16 items-center justify-center border-b border-border/50">
          <Link href="/">
            <LogoMark className="h-7 w-7" />
          </Link>
        </div>
        <nav className="flex-1 space-y-2 p-2 cyber-grid">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group flex flex-col items-center gap-y-1 rounded-lg p-2 text-sm font-medium transition-all duration-200",
                (item.href === "/" ? pathname === "/" || pathname.startsWith("/duels") : pathname.startsWith(item.href))
                  ? "bg-primary/20 text-primary glow-text border border-primary/30"
                  : "hover:bg-primary/20 hover:text-primary hover:scale-105 hover:border hover:border-primary/30",
              )}
            >
              <item.icon className="h-5 w-5" />
              <span className="font-pixel text-[10px] tracking-wide">{item.label}</span>
            </Link>
          ))}
        </nav>
      </div>
    </aside>
  )
}
