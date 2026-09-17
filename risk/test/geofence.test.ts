import { describe, it, expect } from "vitest";
import { isAllowedJurisdiction } from "../src/geofence.js";

describe("isAllowedJurisdiction", () => {
  it("allows a country not on the blocked list", () => {
    expect(isAllowedJurisdiction("DE", ["US", "KP"])).toBe(true);
  });

  it("blocks a country on the list", () => {
    expect(isAllowedJurisdiction("KP", ["US", "KP"])).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isAllowedJurisdiction("kp", ["KP"])).toBe(false);
  });

  it("allows everything when the blocklist is empty (nothing pre-decided by this code)", () => {
    expect(isAllowedJurisdiction("US", [])).toBe(true);
  });

  it("normalizes mixed-case country codes against a mixed-case blocklist", () => {
    expect(isAllowedJurisdiction("Us", ["us"])).toBe(false);
    expect(isAllowedJurisdiction("uS", ["Us"])).toBe(false);
    expect(isAllowedJurisdiction("US", ["us"])).toBe(false);
  });

  it("treats an empty-string country code as simply not matching any real entry", () => {
    // Not on a blocklist of real ISO codes, so an empty string is "allowed" --
    // this only makes sense because callers (backend/lib/duelGuards.ts,
    // app/api/duels/[id]/join/route.ts) guard with `if (country && ...)` and
    // never call this with an empty/falsy country in the first place.
    expect(isAllowedJurisdiction("", ["US", "KP"])).toBe(true);
    // An empty string *on* the blocklist still matches an empty-string input.
    expect(isAllowedJurisdiction("", ["", "US"])).toBe(false);
  });

  // Documents current behavior for a missing/undefined country code, which
  // TypeScript's `string` parameter type normally prevents at compile time.
  // Real callers (backend/lib/duelGuards.ts:34,
  // backend/app/api/duels/[id]/join/route.ts:30) only invoke this function
  // behind `if (country && ...)`, specifically because getClientCountry() can
  // return undefined off-Vercel (per README) and they treat "no country
  // signal" as "don't block" rather than relying on this function to cope.
  // If that call-site guard were ever removed, this function does NOT fail
  // safe the way the circuit breaker does with zero data -- it throws.
  it("throws on an undefined country code rather than failing open or closed (relies on callers to guard, unlike the circuit breaker's fail-safe default)", () => {
    expect(() => isAllowedJurisdiction(undefined as unknown as string, ["US"])).toThrow();
  });
});

describe("isAllowedJurisdiction property test (fuzz)", () => {
  function randomCase(code: string): string {
    return code
      .split("")
      .map((ch) => (Math.random() < 0.5 ? ch.toLowerCase() : ch.toUpperCase()))
      .join("");
  }

  it("is invariant to letter-casing of both the input and the blocklist", () => {
    const codes = ["US", "KP", "IR", "CU", "SY", "DE", "FR", "JP"];
    for (let trial = 0; trial < 200; trial++) {
      const blockedCount = Math.floor(Math.random() * codes.length);
      const shuffled = [...codes].sort(() => Math.random() - 0.5);
      const canonicalBlocked = shuffled.slice(0, blockedCount);
      const randomizedBlocked = canonicalBlocked.map(randomCase);

      const target = codes[Math.floor(Math.random() * codes.length)];
      const randomizedTarget = randomCase(target);

      const expected = !canonicalBlocked.includes(target);
      expect(isAllowedJurisdiction(randomizedTarget, randomizedBlocked)).toBe(expected);
    }
  });
});
