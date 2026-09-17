import { tierForPoints } from '@mcapduel/points';
import { connectToDatabase } from '@/lib/mongoose';
import CombatRecord from '@/lib/models/CombatRecord';
import Duel from '@/lib/models/Duel';
import { success, failure } from '@/utils/response';

export async function GET(_req: Request, { params }: { params: Promise<{ wallet: string }> }) {
    try {
        const { wallet } = await params;
        await connectToDatabase();

        const record = await CombatRecord.findOne({ wallet: wallet.toLowerCase() });
        const matches = await Duel.find({
            status: 'SETTLED',
            $or: [{ creatorWallet: wallet.toLowerCase() }, { opponentWallet: wallet.toLowerCase() }],
        })
            .sort({ endTime: -1 })
            .limit(20);

        const totalPoints = record?.totalPoints ?? 0;

        return success({
            wallet: wallet.toLowerCase(),
            totalPoints,
            availablePoints: totalPoints - (record?.redeemedPoints ?? 0),
            tier: tierForPoints(totalPoints),
            wins: record?.wins ?? 0,
            losses: record?.losses ?? 0,
            currentStreak: record?.currentStreak ?? 0,
            matches,
        });
    } catch (err) {
        return failure((err as Error).message);
    }
}
