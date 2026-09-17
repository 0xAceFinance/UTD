import { connectToDatabase } from '@/lib/mongoose';
import User from '@/lib/models/User';
import { success, failure } from '@/utils/response';


// fethes the user details by connected wallet address use this directly 
export async function GET(req: Request) {
    try {
        await connectToDatabase();

        const { searchParams } = new URL(req.url);
        const walletAddress = searchParams.get('wallet');

        // If wallet param is passed, return specific user by wallet
        if (walletAddress) {
            const user = await User.findOne(
                { 'wallets.address': walletAddress.toLowerCase() },
                { passwordHash: 0 }
            );

            if (!user) return failure('User not found', 404);
            return success(user);
        }

        // Otherwise, return all users
        const users = await User.find({}, { passwordHash: 0 });
        return success(users);
    } catch (err) {
        return failure(err);
    }
}