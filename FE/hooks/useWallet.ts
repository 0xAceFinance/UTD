'use client'

import { useAccount } from 'wagmi'

/**
 * Thin wrapper around wagmi's account state -- the same source
 * Header.tsx's wallet button reads from. `ready` mirrors wagmi's initial
 * auto-reconnect check (restoring a previously connected wallet on page
 * load) so callers can tell "still figuring out connection state" apart
 * from "definitely not connected."
 */
export function useWallet() {
    const { address, status } = useAccount()
    return {
        ready: status !== 'connecting' && status !== 'reconnecting',
        connected: status === 'connected',
        address,
    }
}
