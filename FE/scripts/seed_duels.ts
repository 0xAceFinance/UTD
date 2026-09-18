import { connectToDatabase } from '@/lib/mongoose';
import DuelToken from '@/lib/models/DuelToken';
import Duel from '@/lib/models/Duel';

async function seed() {
    await connectToDatabase();
    const count = await Duel.countDocuments();
    if (count > 0) {
        console.log(`Already have ${count} duels.`);
        process.exit(0);
    }

    const tokens = await DuelToken.find().sort({ rank: 1 }).limit(10);
    if (tokens.length < 4) {
        console.log("Not enough tokens to seed duels.");
        process.exit(1);
    }

    const sampleDuels = [
        {
            status: 'OPEN',
            creatorWallet: '0x1111111111111111111111111111111111111111',
            creatorSide: 0,
            tokenA: {
                symbol: tokens[0].symbol,
                name: tokens[0].name,
                tokenAddress: tokens[0].tokenAddress,
                totalSupply: tokens[0].totalSupply,
                startLiquidityUsd: tokens[0].liquidityUsd,
                rawSamples: [],
                startMarketCapUsd: tokens[0].marketCapUsd,
                currentMarketCapUsd: tokens[0].marketCapUsd,
                sustainedPeakMarketCapUsd: tokens[0].marketCapUsd,
                oracleVerified: true,
            },
            tokenB: {
                symbol: tokens[1].symbol,
                name: tokens[1].name,
                tokenAddress: tokens[1].tokenAddress,
                totalSupply: tokens[1].totalSupply,
                startLiquidityUsd: tokens[1].liquidityUsd,
                rawSamples: [],
                startMarketCapUsd: tokens[1].marketCapUsd,
                currentMarketCapUsd: tokens[1].marketCapUsd,
                sustainedPeakMarketCapUsd: tokens[1].marketCapUsd,
                oracleVerified: true,
            },
            buyInUsd: 100,
            durationSeconds: 1500,
            createdAt: new Date(),
            openDeadline: new Date(Date.now() + 1800 * 1000),
        },
        {
            status: 'OPEN',
            creatorWallet: '0x2222222222222222222222222222222222222222',
            creatorSide: 1,
            tokenA: {
                symbol: tokens[2].symbol,
                name: tokens[2].name,
                tokenAddress: tokens[2].tokenAddress,
                totalSupply: tokens[2].totalSupply,
                startLiquidityUsd: tokens[2].liquidityUsd,
                rawSamples: [],
                startMarketCapUsd: tokens[2].marketCapUsd,
                currentMarketCapUsd: tokens[2].marketCapUsd,
                sustainedPeakMarketCapUsd: tokens[2].marketCapUsd,
                oracleVerified: true,
            },
            tokenB: {
                symbol: tokens[3].symbol,
                name: tokens[3].name,
                tokenAddress: tokens[3].tokenAddress,
                totalSupply: tokens[3].totalSupply,
                startLiquidityUsd: tokens[3].liquidityUsd,
                rawSamples: [],
                startMarketCapUsd: tokens[3].marketCapUsd,
                currentMarketCapUsd: tokens[3].marketCapUsd,
                sustainedPeakMarketCapUsd: tokens[3].marketCapUsd,
                oracleVerified: true,
            },
            buyInUsd: 250,
            durationSeconds: 1800,
            createdAt: new Date(),
            openDeadline: new Date(Date.now() + 2400 * 1000),
        },
        {
            status: 'LIVE',
            creatorWallet: '0x3333333333333333333333333333333333333333',
            opponentWallet: '0x4444444444444444444444444444444444444444',
            creatorSide: 0,
            tokenA: {
                symbol: tokens[4].symbol,
                name: tokens[4].name,
                tokenAddress: tokens[4].tokenAddress,
                totalSupply: tokens[4].totalSupply,
                startLiquidityUsd: tokens[4].liquidityUsd,
                rawSamples: [],
                startMarketCapUsd: tokens[4].marketCapUsd,
                currentMarketCapUsd: tokens[4].marketCapUsd * 1.14,
                sustainedPeakMarketCapUsd: tokens[4].marketCapUsd * 1.14,
                oracleVerified: true,
            },
            tokenB: {
                symbol: tokens[5].symbol,
                name: tokens[5].name,
                tokenAddress: tokens[5].tokenAddress,
                totalSupply: tokens[5].totalSupply,
                startLiquidityUsd: tokens[5].liquidityUsd,
                rawSamples: [],
                startMarketCapUsd: tokens[5].marketCapUsd,
                currentMarketCapUsd: tokens[5].marketCapUsd * 1.05,
                sustainedPeakMarketCapUsd: tokens[5].marketCapUsd * 1.05,
                oracleVerified: true,
            },
            buyInUsd: 50,
            durationSeconds: 1200,
            createdAt: new Date(Date.now() - 300 * 1000),
            openDeadline: new Date(),
            startTime: new Date(Date.now() - 300 * 1000),
            endTime: new Date(Date.now() + 900 * 1000),
        },
        {
            status: 'SETTLED',
            creatorWallet: '0x5555555555555555555555555555555555555555',
            opponentWallet: '0x6666666666666666666666666666666666666666',
            creatorSide: 0,
            winnerSide: 0,
            winnerPoints: 125,
            loserPoints: 25,
            tokenA: {
                symbol: tokens[6].symbol,
                name: tokens[6].name,
                tokenAddress: tokens[6].tokenAddress,
                totalSupply: tokens[6].totalSupply,
                startLiquidityUsd: tokens[6].liquidityUsd,
                rawSamples: [],
                startMarketCapUsd: tokens[6].marketCapUsd,
                currentMarketCapUsd: tokens[6].marketCapUsd * 1.42,
                sustainedPeakMarketCapUsd: tokens[6].marketCapUsd * 1.42,
                oracleVerified: true,
            },
            tokenB: {
                symbol: tokens[7].symbol,
                name: tokens[7].name,
                tokenAddress: tokens[7].tokenAddress,
                totalSupply: tokens[7].totalSupply,
                startLiquidityUsd: tokens[7].liquidityUsd,
                rawSamples: [],
                startMarketCapUsd: tokens[7].marketCapUsd,
                currentMarketCapUsd: tokens[7].marketCapUsd * 1.08,
                sustainedPeakMarketCapUsd: tokens[7].marketCapUsd * 1.08,
                oracleVerified: true,
            },
            buyInUsd: 100,
            durationSeconds: 1500,
            createdAt: new Date(Date.now() - 3600 * 1000),
            openDeadline: new Date(Date.now() - 3000 * 1000),
            startTime: new Date(Date.now() - 3000 * 1000),
            endTime: new Date(Date.now() - 1500 * 1000),
        }
    ];

    await Duel.insertMany(sampleDuels);
    console.log("Seeded 4 sample duels successfully.");
    process.exit(0);
}

seed().catch((err) => {
    console.error(err);
    process.exit(1);
});
