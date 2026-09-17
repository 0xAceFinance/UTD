import { Types } from 'mongoose';
import { priceSample, liquidityWeightedMedianPrice } from '@mcapduel/engine';
import { submitJoin, confirmLive, expire } from '@mcapduel/matchmaking';
import { isAllowedJurisdiction } from '@mcapduel/risk';
import { connectToDatabase } from '@/lib/mongoose';
import Duel from '@/lib/models/Duel';
import WalletSighting from '@/lib/models/WalletSighting';
import { getLivePoolSamples } from '@/lib/dexScreenerSource';
import { verifyDuelJoined } from '@/lib/chainVerify';
import { toLobbySnapshot, applyLobby } from '@/lib/lobbyAdapter';
import { getClientIp, getClientCountry } from '@/lib/requestSignals';
import { BLOCKED_COUNTRY_CODES } from '@/lib/riskConfig';
import { success, failure } from '@/utils/response';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        if (!Types.ObjectId.isValid(id)) return failure('invalid duel id', 400);

        const { opponentWallet, txHash } = await req.json();
        if (!opponentWallet) return failure('opponentWallet is required', 400);

        await connectToDatabase();
        const duel = await Duel.findById(id);
        if (!duel) return failure('duel not found', 404);

        // Geofence (@mcapduel/risk, Section 08) -- see app/api/duels/route.ts
        // for the same check on the creator side.
        const country = getClientCountry(req);
        if (country && !isAllowedJurisdiction(country, BLOCKED_COUNTRY_CODES)) {
            return failure('Duels are not available in your region.', 403);
        }

        const nowSec = Math.floor(Date.now() / 1000);
        const opponent = opponentWallet.toLowerCase();

        // The wallet already signed and paid gas for the on-chain joinDuel()
        // transaction before calling us -- never trust the client's claim of
        // what it did; decode the real DuelJoined event from the real receipt.
        // (duel.escrowAddress is absent only on legacy duels created before
        // on-chain integration existed.)
        if (duel.escrowAddress) {
            if (!txHash) return failure('txHash is required', 400);
            await verifyDuelJoined(txHash, duel.escrowAddress, opponent);
        }

        // The real @mcapduel/matchmaking state machine, not hand-rolled status
        // checks -- see lib/lobbyAdapter.ts. Self-healing: a lobby found past
        // its open window expires here instead of joining, same as before.
        let lobby;
        try {
            lobby = submitJoin(toLobbySnapshot(duel), opponent, nowSec);
        } catch (err) {
            if (duel.status === 'OPEN' && nowSec > Math.floor(duel.openDeadline.getTime() / 1000)) {
                applyLobby(duel, expire(toLobbySnapshot(duel), nowSec));
                await duel.save();
            }
            return failure((err as Error).message, 409);
        }

        // The on-chain join transaction (verified above) already confirmed --
        // MATCHED collapses straight into LIVE.
        lobby = confirmLive(lobby, nowSec);
        applyLobby(duel, lobby);

        // The clock starts now, not whenever the lobby was created -- re-snapshot
        // each side with a fresh, real multi-pool read so "gain %" is measured
        // from the actual start of the fight, and seed rawSamples/startLiquidityUsd
        // so the oracle pipeline (lib/duelEngine.ts) has a real baseline to
        // validate against from the first tick. Falls back to the creation-time
        // snapshot if a side has no tokenAddress/totalSupply yet (a Duel created
        // before those fields existed) or the live read comes back empty.
        for (const side of [duel.tokenA, duel.tokenB] as const) {
            if (!side.tokenAddress || !side.totalSupply) continue;
            const samples = await getLivePoolSamples(side.tokenAddress).catch(() => []);
            if (samples.length === 0) continue;

            const priced = samples.map(priceSample);
            const liquidityUsd = priced.reduce((sum, p) => sum + p.liquidityUsd, 0);
            const medianPriceUsd = liquidityWeightedMedianPrice(priced);
            const marketCapUsd = medianPriceUsd * side.totalSupply;
            if (marketCapUsd <= 0) continue;

            side.startMarketCapUsd = marketCapUsd;
            side.currentMarketCapUsd = marketCapUsd;
            side.sustainedPeakMarketCapUsd = marketCapUsd;
            side.startLiquidityUsd = liquidityUsd;
            side.rawSamples = samples;
        }

        await duel.save();

        // Real signal for @mcapduel/risk's wallet-clustering check at
        // settlement (lib/duelEngine.ts) -- see lib/models/WalletSighting.ts.
        const ip = getClientIp(req);
        if (ip !== 'unknown') {
            await WalletSighting.create({ wallet: opponent, ip });
        }

        return success(duel);
    } catch (err) {
        return failure((err as Error).message);
    }
}
