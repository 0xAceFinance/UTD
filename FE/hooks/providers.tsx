// providers.tsx
"use client";
import { WagmiProvider } from "wagmi";
import { ConnectKitProvider } from "connectkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { wagmiConfig } from "@/config/wagmiConfig";

const queryClient = new QueryClient();

// ConnectKit's own CSS-variable theme, tuned to the app's black/neon-green
// brand (see app/globals.css's --background/--card/--primary) so the wallet
// connect modal doesn't look like a foreign light-themed popup.
const connectKitTheme: Record<string, string> = {
    "--ck-font-family": "var(--font-geist-sans), system-ui, sans-serif",
    "--ck-border-radius": "0px",
    "--ck-overlay-background": "rgba(5, 6, 5, 0.8)",
    "--ck-body-background": "#0f130f",
    "--ck-body-background-secondary": "#171c17",
    "--ck-body-background-tertiary": "#1f251f",
    "--ck-body-color": "#f5f5f5",
    "--ck-body-color-muted": "#9a9a9a",
    "--ck-body-divider": "#2a302a",
    "--ck-primary-button-background": "#171c17",
    "--ck-primary-button-hover-background": "#1f251f",
    "--ck-focus-color": "#1ae87a",
    "--ck-accent-color": "#1ae87a",
    "--ck-accent-text-color": "#050605",
};

export default function Providers({ children }: { children: React.ReactNode }) {
    return (
        <WagmiProvider config={wagmiConfig}>
            <QueryClientProvider client={queryClient}>
                <ConnectKitProvider theme="midnight" customTheme={connectKitTheme}>
                    {children}
                </ConnectKitProvider>
            </QueryClientProvider>
        </WagmiProvider>
    );
}
