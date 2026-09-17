import { randomBytes } from 'node:crypto';
import { connectToDatabase } from '@/lib/mongoose';
import WalletNonce from '@/lib/models/WalletNonce';
import { buildVerificationMessage, isValidWalletAddress } from '@/lib/walletVerification';
import { success, failure } from '@/utils/response';

/** Issues a one-time nonce to sign, proving ownership of a wallet before it can refer / be referred for points. */
export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const wallet = (searchParams.get('wallet') ?? '').toLowerCase();
        if (!isValidWalletAddress(wallet)) return failure('A valid wallet address is required.', 400);

        await connectToDatabase();
        const nonce = randomBytes(16).toString('hex');
        await WalletNonce.create({ wallet, nonce });

        return success({ nonce, message: buildVerificationMessage(wallet, nonce) });
    } catch (err) {
        return failure((err as Error).message);
    }
}
