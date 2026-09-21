import WhitelistEntry from '@/lib/models/WhitelistEntry';
import { generateReferralCode } from '@/lib/referralCode';

const REF_CODE_RE = /^[A-Z0-9]{1,30}$/;

/**
 * Records a wallet's referral attribution the first time it's seen doing
 * something real (creating or joining a duel), extending WhitelistEntry --
 * originally a pre-launch-signup-only model -- into the live product's
 * attribution source. Attribution is first-touch and permanent: a wallet
 * that already has a referredBy is never overwritten, even by a different
 * code on a later duel. Never throws or blocks the caller's request --
 * referral attribution is a bookkeeping side effect, not something that
 * should ever stop a duel from being created over a malformed ref code.
 *
 * `refCode` is whatever the client's stored referral code was at the moment
 * of the request (lib/referralClient.ts::getStoredRef(), already uppercased
 * there) -- absent if the wallet never landed on a referral link.
 */
export async function attributeReferral(wallet: string, refCode: string | undefined | null): Promise<void> {
    try {
        const identifier = wallet.toLowerCase();
        const cleanRefCode = typeof refCode === 'string' && REF_CODE_RE.test(refCode) ? refCode : undefined;

        const existing = await WhitelistEntry.findOne({ identifier });
        if (!existing) {
            const referrer = cleanRefCode ? await WhitelistEntry.findOne({ referralCode: cleanRefCode }) : null;
            const referredBy = referrer && referrer.identifier !== identifier ? referrer.referralCode : undefined;

            await WhitelistEntry.create({
                identifier,
                kind: 'wallet',
                passNumber: 0, // not part of the pre-launch pass sequence -- this entry exists purely for referral attribution
                walletVerified: true, // this wallet already signed a real on-chain transaction to get here
                referralCode: await generateReferralCode(),
                referredBy,
            });
            return;
        }

        if (existing.referredBy || !cleanRefCode) return;
        const referrer = await WhitelistEntry.findOne({ referralCode: cleanRefCode });
        if (!referrer || referrer.identifier === identifier) return;

        existing.referredBy = referrer.referralCode;
        if (!existing.referralCode) existing.referralCode = await generateReferralCode();
        await existing.save();
    } catch (err) {
        console.error(`[referralAttribution] failed for ${wallet}: ${(err as Error)?.message ?? err}`);
    }
}
