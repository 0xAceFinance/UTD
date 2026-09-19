import { connectToDatabase } from '@/lib/mongoose';
import WhitelistEntry, { type IWhitelistEntry } from '@/lib/models/WhitelistEntry';
import { nextSequence } from '@/lib/models/Counter';
import { getClientIp } from '@/lib/requestSignals';
import { verifyWalletOwnership } from '@/lib/walletVerification';
import { generateReferralCode } from '@/lib/referralCode';
import { isSuspectedSelfReferral } from '@/lib/whitelistSybil';
import { getReferralStats } from '@/lib/referralStats';
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

/** Referral dashboard fields for a response, empty for unverified/email entries (they have no referralCode). */
async function referralPayload(entry: Pick<IWhitelistEntry, 'walletVerified' | 'referralCode'>) {
    if (!entry.walletVerified || !entry.referralCode) return {};
    const stats = await getReferralStats(entry.referralCode);
    return { referralCode: entry.referralCode, ...stats };
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

        const refCode = typeof body?.ref === 'string' ? body.ref.trim().toUpperCase() : undefined;
        const ip = getClientIp(req);

        await connectToDatabase();

        // Repeat submissions are not an error: hand back the pass (and
        // referral dashboard, if any) they already hold so the form shows
        // the same state on every device.
        const existing = await WhitelistEntry.findOne({ identifier: parsed.identifier });
        if (existing) {
            let updated = false;

            // If existing user has no referrer yet, attach referrer if valid and not self
            if (!existing.referredBy && refCode && refCode !== existing.referralCode) {
                const referrer = await WhitelistEntry.findOne({ referralCode: refCode });
                if (referrer && referrer.identifier.toLowerCase() !== existing.identifier.toLowerCase()) {
                    existing.referredBy = referrer.referralCode;
                    existing.referralSybilFlagged = await isSuspectedSelfReferral(referrer.identifier, parsed.identifier, ip);
                    updated = true;
                }
            }

            // If existing entry is unverified, allow verifying now with signature
            if (!existing.walletVerified && parsed.kind === 'wallet') {
                const { signature, nonce } = body ?? {};
                if (typeof signature === 'string' && typeof nonce === 'string') {
                    const verified = await verifyWalletOwnership(parsed.identifier, nonce, signature);
                    if (verified) {
                        existing.walletVerified = true;
                        if (!existing.referralCode) {
                            existing.referralCode = await generateReferralCode();
                        }
                        updated = true;
                    }
                }
            }

            if (updated) {
                await existing.save();
            }

            const claimed = await WhitelistEntry.countDocuments();
            return success({
                passNumber: existing.passNumber,
                claimed,
                total: TOTAL_PASSES,
                alreadyRegistered: true,
                walletVerified: existing.walletVerified,
                ...(await referralPayload(existing)),
            });
        }

        if ((await WhitelistEntry.countDocuments()) >= TOTAL_PASSES) {
            return failure('All day-one passes have been claimed.', 409);
        }

        // Wallets must prove ownership before they're accepted at all --
        // typing an address alone used to be enough, but referral points now
        // ride on this identity, so an unverified claim isn't good enough
        // for even a plain signup anymore. Email keeps working exactly as
        // before: no verification, and (per referralPayload above) no
        // referral code of its own.
        let walletVerified = false;
        if (parsed.kind === 'wallet') {
            const { signature, nonce } = body ?? {};
            if (typeof signature !== 'string' || typeof nonce !== 'string') {
                return failure('Connect and sign with your wallet to join — typing an address alone is no longer accepted.', 400);
            }
            walletVerified = await verifyWalletOwnership(parsed.identifier, nonce, signature);
            if (!walletVerified) {
                return failure('Wallet signature verification failed. Please reconnect and try again.', 401);
            }
        }

        // An unknown/stale ref code is silently ignored -- never block a
        // signup over a bad link. A self/sybil-clustered referral still
        // records `referredBy` (for attribution/audit) but is excluded from
        // the referrer's points by getReferralStats's query.
        let referredBy: string | undefined;
        let referralSybilFlagged = false;
        if (refCode) {
            const referrer = await WhitelistEntry.findOne({ referralCode: refCode });
            if (referrer && referrer.identifier.toLowerCase() !== parsed.identifier.toLowerCase()) {
                referredBy = referrer.referralCode;
                referralSybilFlagged = await isSuspectedSelfReferral(referrer.identifier, parsed.identifier, ip);
            }
        }

        const passNumber = await nextSequence('whitelist');
        const referralCode = walletVerified ? await generateReferralCode() : undefined;

        let createdEntry: IWhitelistEntry;
        try {
            createdEntry = await WhitelistEntry.create({
                ...parsed,
                passNumber,
                ip,
                walletVerified,
                referralCode,
                referredBy,
                referralSybilFlagged,
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
                    walletVerified: winner?.walletVerified ?? false,
                    ...(winner ? await referralPayload(winner) : {}),
                });
            }
            throw err;
        }

        const claimed = await WhitelistEntry.countDocuments();
        return success({
            passNumber,
            claimed,
            total: TOTAL_PASSES,
            alreadyRegistered: false,
            walletVerified,
            ...(await referralPayload(createdEntry)),
        });
    } catch (err) {
        return failure(err);
    }
}
