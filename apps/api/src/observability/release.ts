/**
 * ADR-047 K9 — release visibility (minimal).
 *
 * `run-api.sh` exports `POS_RELEASE_ID` = the name of the live release directory
 * (`<UTC>-<sha7>`, e.g. `20261124T090741Z-ad644ee`). The API logs it once at
 * startup and tags Sentry events with it. Anything that does not match the
 * release-name shape is ignored (dev, tests, the pre-cutover layout), so a
 * stray value never reaches logs or Sentry. `/api/health` deliberately does
 * NOT expose it (public endpoint; no version fingerprint).
 */

const RELEASE_ID_PATTERN = /^\d{8}T\d{6}Z-[0-9a-f]{7,40}$/;

export function resolveReleaseId(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const value = raw.trim();
  return RELEASE_ID_PATTERN.test(value) ? value : undefined;
}

export function currentReleaseId(): string | undefined {
  return resolveReleaseId(process.env['POS_RELEASE_ID']);
}
