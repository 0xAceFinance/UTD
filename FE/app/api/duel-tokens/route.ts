import { connectToDatabase } from '@/lib/mongoose';
import DuelToken from '@/lib/models/DuelToken';
import { success, failure } from '@/utils/response';

/** Today's Top 10 (spec Section 01). See lib/models/DuelToken.ts for provenance. */
export async function GET() {
    try {
        await connectToDatabase();
        const tokens = await DuelToken.find().sort({ rank: 1 }).limit(10);
        return success(tokens);
    } catch (err) {
        return failure((err as Error).message);
    }
}
