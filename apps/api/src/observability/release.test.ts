import { describe, expect, it } from 'vitest';
import { resolveReleaseId } from './release.js';

describe('resolveReleaseId (ADR-047 K9)', () => {
  it('accepts a pos-release directory name', () => {
    expect(resolveReleaseId('20261124T090741Z-ad644ee')).toBe('20261124T090741Z-ad644ee');
    expect(resolveReleaseId(' 20261124T090741Z-ad644eea7de4941ba1cb971d2f65fc80d0f04c32\n')).toBe(
      '20261124T090741Z-ad644eea7de4941ba1cb971d2f65fc80d0f04c32',
    );
  });

  it('ignores missing, empty or foreign values', () => {
    expect(resolveReleaseId(undefined)).toBeUndefined();
    expect(resolveReleaseId('')).toBeUndefined();
    expect(resolveReleaseId('restoran-pos')).toBeUndefined(); // pre-cutover /opt layout
    expect(resolveReleaseId('20261124T090741Z-AD644EE')).toBeUndefined();
    expect(resolveReleaseId('20261124T090741Z-ad644ee; rm -rf /')).toBeUndefined();
    expect(resolveReleaseId('20261124T090741Z-ad644ee\nforged log line')).toBeUndefined();
  });
});
