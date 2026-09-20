import { BaseError, ContractFunctionRevertedError, InsufficientFundsError, UserRejectedRequestError } from 'viem';
import { InsufficientStakeBalanceError } from './duelContract';

/** Require-string reasons from Contracts/src/duel/BattleEscrowFactory.sol, reworded for players. */
const KNOWN_REVERT_REASONS: Record<string, string> = {
    'bad buyIn': "That stake amount isn't allowed for this duel.",
    'stake token not approved': 'This stake token is no longer supported.',
    'bad side': 'Pick a valid side before continuing.',
    'duration out of range': "That round length isn't allowed.",
    'unknown duel': 'This duel no longer exists.',
    'duel is paused': 'Duels are paused right now. Try again later.',
};

/**
 * Turns whatever a wallet-signed call throws (a user cancelling in
 * MetaMask/Rabby, a gas-estimation-time revert, an RPC hiccup) into one
 * short, player-facing line. Never surfaces viem's full error dump (call
 * args, raw calldata, docs links) -- that's `err.message`; this only ever
 * reads `err.shortMessage` or a short, explicitly-mapped string.
 */
export function getFriendlyErrorMessage(err: unknown, fallback: string): string {
    if (err instanceof InsufficientStakeBalanceError) return err.message;

    if (err instanceof BaseError) {
        if (err.walk((e) => e instanceof UserRejectedRequestError)) {
            return 'You cancelled the transaction in your wallet.';
        }
        if (err.walk((e) => e instanceof InsufficientFundsError)) {
            return "You don't have enough native gas balance to pay this network's transaction fee.";
        }

        const revertError = err.walk((e) => e instanceof ContractFunctionRevertedError) as
            | ContractFunctionRevertedError
            | undefined;
        const reason = revertError?.data?.errorName ?? revertError?.reason;
        if (reason && KNOWN_REVERT_REASONS[reason]) return KNOWN_REVERT_REASONS[reason];
        if (reason) return `Transaction rejected: ${reason}`;

        // shortMessage is viem's one-line summary (e.g. "User rejected the
        // request." or "The contract function ... reverted.") -- unlike
        // `.message`, it never includes call args or raw calldata.
        return err.shortMessage || fallback;
    }

    if (err instanceof Error && err.message && err.message.length < 200) return err.message;

    return fallback;
}
