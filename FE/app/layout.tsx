import type React from "react"
import { GeistSans } from "geist/font/sans"
import { Press_Start_2P } from "next/font/google"
import "./globals.css"
import Providers from "@/hooks/providers"
import { Toaster } from "@/components/ui/sonner"

const pressStart2P = Press_Start_2P({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  variable: "--font-press-start-2p",
})

export const metadata = {
  title: {
    default: "UTD | Underground Token Duel",
    template: "%s | UTD",
  },
  description: "Pick a side. Lock a stake. Whoever pumps harder wins the duel.",
  generator: 'v0.dev'
}

/* viewport-fit=cover lets the app's fixed bottom tab bar pad itself for the
   iPhone home indicator via env(safe-area-inset-bottom). */
export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#060907",
}

/**
 * Deliberately bare: the app shell (Sidebar + Header) lives in
 * app/(app)/layout.tsx, not here, so a route outside that group -- the
 * marketing page at app/landing/page.tsx -- doesn't inherit it. Every route
 * still gets fonts, wallet/query providers, and toasts from here.
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${pressStart2P.variable} dark`}>
      <body className="min-h-screen font-mono antialiased bg-[#060806] text-[#e4e4e7]">
        <Providers>{children}</Providers>
        <Toaster position="top-right" richColors closeButton />
      </body>
    </html>
  )
}
