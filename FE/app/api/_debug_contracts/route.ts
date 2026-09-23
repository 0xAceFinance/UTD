import { CONTRACTS } from '@/config/contracts';

export async function GET() {
    return Response.json({
        CONTRACTS,
        env: {
            NEXT_PUBLIC_CHAIN_ID: process.env.NEXT_PUBLIC_CHAIN_ID,
            NEXT_PUBLIC_RPC_URL: process.env.NEXT_PUBLIC_RPC_URL,
            NEXT_PUBLIC_BATTLE_ESCROW_FACTORY_ADDRESS: process.env.NEXT_PUBLIC_BATTLE_ESCROW_FACTORY_ADDRESS,
        },
    });
}
