import type React from "react"
import "./app.css"
import Header from "./components/Header"
import Sidebar from "./components/Sidebar"
import BottomNav from "./components/BottomNav"

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="utd app-root min-h-screen selection:bg-[var(--acid)]/25">
      <Sidebar />

      <div className="lg:pl-60">
        <Header />
        {/* Bottom padding clears the fixed tab bar (+ home indicator) on phones. */}
        <main className="mx-auto max-w-6xl px-4 pt-5 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:px-6 lg:px-8 lg:pt-8 lg:pb-16">
          {children}
        </main>
      </div>

      <BottomNav />
    </div>
  )
}
