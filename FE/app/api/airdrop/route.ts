import { connectToDatabase } from '@/lib/mongoose';
import { getAirdropProgress } from '@/lib/airdrop';
import { isValidWalletAddress } from '@/lib/walletVerification';
import { success, failure } from '@/utils/response';

/**
 * Airdrop progress for a wallet (?wallet=0x...). Without a wallet it still
 * returns the full task list, all locked, so the page can render the
 * catalogue for visitors who haven't connected yet.
 */
export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const wallet = searchParams.get('wallet');
        if (wallet && !isValidWalletAddress(wallet)) return failure('Invalid wallet address.', 400);

        await connectToDatabase();
        return success(await getAirdropProgress(wallet));
    } catch (err) {
        return failure((err as Error).message);
    }
}
