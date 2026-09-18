import { CHAIN_ID } from "./dexScreenerSource"

/**
 * GMGN token page for a listed token.
 *
 * GMGN happens to use the same chain slug as DexScreener for Robinhood Chain
 * ("robinhood") -- verified against a live token page -- so the scanner's
 * CHAIN_ID is reused rather than hardcoding the chain a second time. If the
 * scanner ever moves to a chain where the two slugs differ, map it here.
 */
export function gmgnTokenUrl(tokenAddress: string): string {
    return `https://gmgn.ai/${CHAIN_ID}/token/${tokenAddress}`
}
