"use client";

import { Bell, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConnectKitButton } from "connectkit";

function WalletButton() {
  return (
    <ConnectKitButton.Custom>
      {({ isConnected, isConnecting, show, address, ensName }) => (
        <Button onClick={show} disabled={isConnecting} className="gap-2">
          {isConnected && <span className="h-1.5 w-1.5 flex-none rounded-full bg-[hsl(var(--good))]" />}
          {isConnecting
            ? "Connecting…"
            : isConnected
              ? ensName ?? `${address?.slice(0, 4)}…${address?.slice(-2)}`
              : "Connect Wallet"}
        </Button>
      )}
    </ConnectKitButton.Custom>
  );
}

export default function Header() {
  return (
    <header className="border-b border-border/50 bg-card/80 backdrop-blur supports-[backdrop-filter]:bg-card/60 shadow-md z-10">
      <div className="flex h-16 items-center px-6 cyber-gradient">
        <div className="relative flex flex-1 items-center gap-x-4">
          <div className="relative w-full max-w-md">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search the battlefield..."
              className="w-full bg-secondary/50 pl-9 border-primary/20 focus-visible:ring-1 focus-visible:ring-primary"
            />
          </div>
        </div>

        <div className="flex items-center gap-x-4">
          <Button variant="ghost" size="icon" aria-label="Notifications">
            <Bell className="h-5 w-5" />
          </Button>

          <WalletButton />
        </div>
      </div>
    </header>
  );
}
