import { connectToDatabase } from '@/lib/mongoose';
import WhitelistEntry from '@/lib/models/WhitelistEntry';
import { nextSequence } from '@/lib/models/Counter';
import { success, failure } from '@/utils/response';

/** Total day-one passes on offer. Drives the "N left" line on the landing page. */
const TOTAL_PASSES = 1000;

const WALLET_RE = /^0x[a-fA-F0-9]{40}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function classify(raw: string): { identifier: string; kind: 'wallet' | 'email' } | null {
    const identifier = raw.trim().toLowerCase();
    if (WALLET_RE.test(identifier)) return { identifier, kind: 'wallet' };
    if (EMAIL_RE.test(identifier)) return { identifier, kind: 'email' };
    return null;
}

/** Real signup count, so the landing page stops inventing one. */
export async function GET() {
    try {
        await connectToDatabase();
        const claimed = await WhitelistEntry.countDocuments();
        return success({ claimed, total: TOTAL_PASSES });
    } catch (err) {
        return failure(err);
    }
}

export async function POST(req: Request) {
    try {
        const body = await req.json().catch(() => null);
        const parsed = classify(String(body?.identifier ?? ''));

        if (!parsed) {
            return failure('Enter a wallet address (0x…) or an email address.', 400);
        }

        await connectToDatabase();

        // Repeat submissions are not an error: hand back the pass they already
        // hold so the form shows the same number on every device.
        const existing = await WhitelistEntry.findOne({ identifier: parsed.identifier });
        if (existing) {
            const claimed = await WhitelistEntry.countDocuments();
            return success({
                passNumber: existing.passNumber,
                claimed,
                total: TOTAL_PASSES,
                alreadyRegistered: true,
            });
        }

        if ((await WhitelistEntry.countDocuments()) >= TOTAL_PASSES) {
            return failure('All day-one passes have been claimed.', 409);
        }

        const passNumber = await nextSequence('whitelist');

        try {
            await WhitelistEntry.create({
                ...parsed,
                passNumber,
                ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
            });
        } catch (err: any) {
            // Lost a race against a simultaneous identical submission; the
            // unique index did its job, so return the winner's pass.
            if (err?.code === 11000) {
                const winner = await WhitelistEntry.findOne({ identifier: parsed.identifier });
                const claimed = await WhitelistEntry.countDocuments();
                return success({
                    passNumber: winner?.passNumber ?? passNumber,
                    claimed,
                    total: TOTAL_PASSES,
                    alreadyRegistered: true,
                });
            }
            throw err;
        }

        const claimed = await WhitelistEntry.countDocuments();
        return success({ passNumber, claimed, total: TOTAL_PASSES, alreadyRegistered: false });
    } catch (err) {
        return failure(err);
    }
}
