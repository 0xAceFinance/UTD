import type React from "react"
import Header from "./components/Header"
import Sidebar from "./components/Sidebar"

/** The app shell (sidebar + header) for every connected-app route: dashboard, duels, tokens, profile. */
export default function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex flex-col flex-1">
        <Header />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  )
}
