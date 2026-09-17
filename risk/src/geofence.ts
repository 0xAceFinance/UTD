/**
 * Section 08: which jurisdictions to serve is a legal decision, not a
 * technical one — so unlike every other threshold in this codebase, there is
 * deliberately no default blocklist baked in here. The caller must supply
 * the real list once counsel has defined it (see the "Target jurisdictions"
 * open decision in the spec).
 */
export function isAllowedJurisdiction(countryCode: string, blockedCountryCodes: readonly string[]): boolean {
  const blocked = new Set(blockedCountryCodes.map((c) => c.toUpperCase()));
  return !blocked.has(countryCode.toUpperCase());
}
