import { NextRequest } from 'next/server';
import { formatUnits } from 'viem';
import { createLobby } from '@mcapduel/matchmaking';
import { connectToDatabase } from '@/lib/mongoose';
import Duel from '@/lib/models/Duel';
import DuelToken from '@/lib/models/DuelToken';
import WalletSighting from '@/lib/models/WalletSighting';
import { getClientIp } from '@/lib/requestSignals';
import { checkCanCreateLobby } from '@/lib/duelGuards';
import { verifyDuelCreated } from '@/lib/chainVerify';
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

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { creatorWallet, tokenASymbol, tokenBSymbol, txHash } = body;

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

        const [tokenA, tokenB] = await Promise.all([
            DuelToken.findOne({ symbol: tokenASymbol }),
            DuelToken.findOne({ symbol: tokenBSymbol }),
        ]);
        if (!tokenA || !tokenB) {
            return failure('both tokens must be from today\'s Top 10', 400);
        }

        // The wallet already signed and paid gas for this on-chain transaction
        // before calling us -- never trust the client's claim of what it did;
        // decode the real DuelCreated event from the real receipt instead.
        // stakeToken decimals: 18 (MockERC20 on the local Anvil deployment --
        // see Contracts/script/DeployDuel.s.sol). A real stablecoin (e.g. USDC,
        // 6 decimals) needs this adjusted at production deployment time.
        const created = await verifyDuelCreated(txHash, creatorWallet);
        const receiptEvent = created.event;
        const escrowAddress = created.escrowAddress;
        const buyInUsd = Number(formatUnits(receiptEvent.buyIn, 18));
        const creatorSide = receiptEvent.creatorSide as 0 | 1;
        const durationSeconds = Number(receiptEvent.durationSeconds);

        const existing = await Duel.findOne({ escrowAddress });
        if (existing) return success(existing, 201);

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

        // Real signal for @mcapduel/risk's wallet-clustering check at
        // settlement (lib/duelEngine.ts) -- see lib/models/WalletSighting.ts.
        const ip = getClientIp(req);
        if (ip !== 'unknown') {
            await WalletSighting.create({ wallet: creatorWallet.toLowerCase(), ip });
        }

        return success(duel, 201);
    } catch (err) {
        return failure((err as Error).message, 400);
    }
}
