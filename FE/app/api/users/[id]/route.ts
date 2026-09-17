// app/api/users/[id]/route.ts
import { connectToDatabase } from '@/lib/mongoose';
import User from '@/lib/models/User';
import { success, failure } from '@/utils/response';
import { Types } from 'mongoose';

// get specific user info use tthe data from this route for /profile page by user id no need to use this route for now 

export async function GET(
    req: Request,
    { params }: { params: { id: string } }
) {
    try {
        await connectToDatabase();

        const { id } = params;

        if (!Types.ObjectId.isValid(id)) {
            return failure('Invalid user ID', 400);
        }

        const user = await User.findById(id, {
            passwordHash: 0
        });

        if (!user) {
            return failure('User not found', 404);
        }

        return success(user);
    } catch (err) {
        return failure(err);
    }
}
