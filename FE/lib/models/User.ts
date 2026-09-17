import { Schema, Document, model, models } from 'mongoose';



export interface IUser extends Document {
    username: string;
    email: string;
    passwordHash: string;
    walletAddress: string;
    chain: string;
    createdAt: Date;
    profilePicture?: string;

    portfolio: {
        totalValue: number;
        lastUpdated: Date;
    };

    stats: {
        tokensOwned: number;
        activeWars: number;
        warsWon: number;
        totalVolume: number;
        totalProfit: number;
    };
}



const UserSchema = new Schema<IUser>({
    username: { type: String, required: true, index: true },
    email: { type: String, required: true, unique: true, index: true },
    passwordHash: { type: String, required: true },

    walletAddress: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        index: true
    },
    chain: { type: String, default: 'ethereum' },

    createdAt: { type: Date, default: Date.now },
    profilePicture: { type: String },

    portfolio: {
        totalValue: { type: Number, default: 0 },
        lastUpdated: { type: Date, default: Date.now }
    },

    stats: {
        tokensOwned: { type: Number, default: 0 },
        activeWars: { type: Number, default: 0 },
        warsWon: { type: Number, default: 0 },
        totalVolume: { type: Number, default: 0 },
        totalProfit: { type: Number, default: 0 }
    }
});

export default models.User || model<IUser>('User', UserSchema);
