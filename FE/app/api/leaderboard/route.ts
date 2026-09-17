import { tierForPoints } from '@mcapduel/points';
import { connectToDatabase } from '@/lib/mongoose';
import CombatRecord from '@/lib/models/CombatRecord';
import { success, failure } from '@/utils/response';

export async function GET() {
    try {
        await connectToDatabase();
        const records = await CombatRecord.find().sort({ totalPoints: -1 }).limit(50);
        const ranked = records.map((r, i) => ({
            rank: i + 1,
            wallet: r.wallet,
            totalPoints: r.totalPoints,
            tier: tierForPoints(r.totalPoints),
            wins: r.wins,
            losses: r.losses,
        }));
        return success(ranked);
    } catch (err) {
        return failure((err as Error).message);
    }
}
