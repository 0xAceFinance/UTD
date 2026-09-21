import { NextRequest } from 'next/server';
import { formatUnits } from 'viem';
import { readStakeTokenDecimals } from '@/lib/chainClient';
import { createLobby } from '@mcapduel/matchmaking';
import { connectToDatabase } from '@/lib/mongoose';
import Duel from '@/lib/models/Duel';
import DuelToken from '@/lib/models/DuelToken';
import WalletSighting from '@/lib/models/WalletSighting';
import { getClientIp } from '@/lib/requestSignals';
import { getFundingSource } from '@/lib/fundingSource';
import { checkCanCreateLobby } from '@/lib/duelGuards';
import { verifyDuelCreated } from '@/lib/chainVerify';
import { attributeReferral } from '@/lib/referralAttribution';
import { success, failure } from '@/utils/response';

export async function GET(req: NextRequest) {
    try {
        await connectToDatabase();
        const status = req.nextUrl.searchParams.get('status');
        const wallet = req.nextUrl.searchParams.get('wallet');
        const sort = req.nextUrl.searchParams.get('sort') === 'oldest' ? 1 : -1;

        const query: Record<string, unknown> = {};
        if (status) query.status = status;
        if (wallet) {
            const w = wallet.toLowerCase();
            query.$or = [{ creatorWallet: w }, { opponentWallet: w }];
        }

        const duels = await Duel.find(query).sort({ createdAt: sort }).limit(50);
        return success(duels);
    } catch (err) {
        return failure((err as Error).message);
    }
}

/** Bare-minimum shape check for a client-supplied token snapshot (see below) --
 * not a trust boundary, just enough to stop obviously-malformed data from
 * reaching the database. */
function isValidSnapshot(s: unknown): s is {
    symbol: string;
    name: string;
    tokenAddress: string;
    totalSupply: number;
    marketCapUsd: number;
} {
    if (!s || typeof s !== 'object') return false;
    const t = s as Record<string, unknown>;
    return (
        typeof t.symbol === 'string' &&
        typeof t.name === 'string' &&
        typeof t.tokenAddress === 'string' &&
        typeof t.totalSupply === 'number' &&
        typeof t.marketCapUsd === 'number'
    );
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { creatorWallet, tokenASymbol, tokenBSymbol, tokenASnapshot, tokenBSnapshot, txHash, refCode } = body;

        if (!creatorWallet || !tokenASymbol || !tokenBSymbol || !txHash) {
            return failure('creatorWallet, tokenASymbol, tokenBSymbol, and txHash are all required', 400);
        }
        if (tokenASymbol === tokenBSymbol) {
            return failure('tokens must be different', 400);
        }

        await connectToDatabase();

        // Same guards the frontend already checked before submitting the
        // on-chain transaction (app/api/duels/precheck/route.ts) -- re-run
        // for real here rather than trusting that check still holds.
        const blockedReason = await checkCanCreateLobby(req, creatorWallet);
        if (blockedReason) return failure(blockedReason, 403);

        // The wallet already signed and paid gas for this on-chain transaction
        // before calling us -- never trust the client's claim of what it did;
        // decode the real DuelCreated event from the real receipt instead.
        // tokenASymbol/tokenBSymbol on the event are ground truth: the escrow
        // clone already exists on-chain holding real funds against exactly
        // these strings, regardless of what today's Top 10 list says by now.
        const created = await verifyDuelCreated(txHash, creatorWallet);
        const receiptEvent = created.event;
        const escrowAddress = created.escrowAddress;
        if (receiptEvent.tokenASymbol !== tokenASymbol || receiptEvent.tokenBSymbol !== tokenBSymbol) {
            return failure('Token pair does not match the on-chain transaction.', 400);
        }
        const buyInUsd = Number(formatUnits(receiptEvent.buyIn, await readStakeTokenDecimals()));
        const creatorSide = receiptEvent.creatorSide as 0 | 1;
        const durationSeconds = Number(receiptEvent.durationSeconds);

        const existing = await Duel.findOne({ escrowAddress });
        if (existing) return success(existing, 201);

        // Prefer the live Top 10 doc (freshest price data). Fall back to the
        // snapshot the frontend captured at the moment the user submitted --
        // funds are already locked on-chain by now, so a scan rotating this
        // symbol out of today's Top 10 in between must not block registration
        // (see app/(app)/duels/create/page.tsx for where the snapshot is taken,
        // and lib/duelGuards.ts for the "why" on this whole flow).
        const [liveTokenA, liveTokenB] = await Promise.all([
            DuelToken.findOne({ symbol: tokenASymbol }),
            DuelToken.findOne({ symbol: tokenBSymbol }),
        ]);
        const tokenA = liveTokenA ?? (isValidSnapshot(tokenASnapshot) ? tokenASnapshot : null);
        const tokenB = liveTokenB ?? (isValidSnapshot(tokenBSnapshot) ? tokenBSnapshot : null);
        if (!tokenA || !tokenB) {
            return failure('both tokens must be from today\'s Top 10', 400);
        }

        // Reuses the tested matchmaking state machine purely to validate the
        // duration bounds (already enforced on-chain too) and compute the
        // open-window deadline consistently with everything else in the system.
        const lobby = createLobby({
            id: 'pending',
            creator: creatorWallet,
            tokenASymbol,
            tokenBSymbol,
            creatorSide,
            durationSeconds,
            nowSec: Math.floor(Date.now() / 1000),
        });

        const duel = await Duel.create({
            status: lobby.status,
            creatorWallet,
            creatorSide,
            escrowAddress,
            tokenA: {
                symbol: tokenA.symbol,
                name: tokenA.name,
                tokenAddress: tokenA.tokenAddress,
                totalSupply: tokenA.totalSupply,
                startMarketCapUsd: tokenA.marketCapUsd,
                currentMarketCapUsd: tokenA.marketCapUsd,
                sustainedPeakMarketCapUsd: tokenA.marketCapUsd,
            },
            tokenB: {
                symbol: tokenB.symbol,
                name: tokenB.name,
                tokenAddress: tokenB.tokenAddress,
                totalSupply: tokenB.totalSupply,
                startMarketCapUsd: tokenB.marketCapUsd,
                currentMarketCapUsd: tokenB.marketCapUsd,
                sustainedPeakMarketCapUsd: tokenB.marketCapUsd,
            },
            buyInUsd,
            durationSeconds: lobby.durationSeconds,
            createdAt: new Date(lobby.createdAtSec * 1000),
            openDeadline: new Date(lobby.openDeadlineSec * 1000),
        });

        // Real signals for @mcapduel/risk's wallet-clustering check at
        // settlement (lib/duelEngine.ts) -- see lib/models/WalletSighting.ts.
        const ip = getClientIp(req);
        const fundedBy = await getFundingSource(creatorWallet);
        if (ip !== 'unknown' || fundedBy) {
            await WalletSighting.create({
                wallet: creatorWallet.toLowerCase(),
                ...(ip !== 'unknown' ? { ip } : {}),
                ...(fundedBy ? { fundedBy } : {}),
            });
        }
        await attributeReferral(creatorWallet, refCode);

        return success(duel, 201);
    } catch (err) {
        return failure((err as Error).message, 400);
    }
}
