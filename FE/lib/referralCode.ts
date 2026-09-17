import { randomBytes } from 'node:crypto';
import WhitelistEntry from './models/WhitelistEntry';

// No 0/O/1/I -- avoids visual ambiguity when someone reads a code aloud or retypes it by hand.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LENGTH = 7;

function randomCode(): string {
    const bytes = randomBytes(LENGTH);
    let out = '';
    for (let i = 0; i < LENGTH; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
    return out;
}

/** A unique referral code for a newly wallet-verified entry, retrying on the (very rare) collision. */
export async function generateReferralCode(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
        const code = randomCode();
        const exists = await WhitelistEntry.exists({ referralCode: code });
        if (!exists) return code;
    }
    throw new Error('Could not generate a unique referral code after 5 attempts');
}
