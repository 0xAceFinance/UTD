import { describe, it, expect } from 'vitest';
import { canForceRefund, STALE_REFUND_GRACE_PERIOD_MS } from '@/app/(app)/components/duel/types';

const END = Date.parse('2026-01-01T00:00:00Z');
const endTime = new Date(END).toISOString();
const PAST_GRACE = END + STALE_REFUND_GRACE_PERIOD_MS + 1;

describe('duel page: force-refund button (canForceRefund)', () => {
  it('MONEY SAFETY: never offered on a SETTLING duel, however long past the grace period', () => {
    expect(canForceRefund({ status: 'SETTLING', endTime }, PAST_GRACE)).toBe(false);
    expect(canForceRefund({ status: 'SETTLING', endTime }, END + 30 * STALE_REFUND_GRACE_PERIOD_MS)).toBe(false);
  });

  it('offered on a LIVE or HELD duel once 24h past endTime', () => {
    expect(canForceRefund({ status: 'LIVE', endTime }, PAST_GRACE)).toBe(true);
    expect(canForceRefund({ status: 'HELD', endTime }, PAST_GRACE)).toBe(true);
  });

  it('not offered before the grace period ends', () => {
    expect(canForceRefund({ status: 'LIVE', endTime }, END + STALE_REFUND_GRACE_PERIOD_MS - 1)).toBe(false);
    expect(canForceRefund({ status: 'HELD', endTime }, END + 60_000)).toBe(false);
  });

  it('not offered for terminal or pre-battle statuses', () => {
    for (const status of ['OPEN', 'MATCHED', 'SETTLED', 'EXPIRED', 'CANCELLED'] as const) {
      expect(canForceRefund({ status, endTime }, PAST_GRACE)).toBe(false);
    }
  });

  it('not offered without an endTime', () => {
    expect(canForceRefund({ status: 'LIVE' }, PAST_GRACE)).toBe(false);
  });
});
