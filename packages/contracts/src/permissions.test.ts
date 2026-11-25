import { describe, expect, it } from 'vitest';
import { PERMISSION_KEYS, SYSTEM_ROLES } from './permissions.js';

describe('permission registry', () => {
  it('uses keys that satisfy the ref.permissions CHECK constraint', () => {
    for (const key of PERMISSION_KEYS) expect(key).toMatch(/^[a-z_]+(\.[a-z_]+)+$/);
  });

  it('gives only the owner the right to change data-sharing consent', () => {
    const holders = Object.entries(SYSTEM_ROLES)
      .filter(([, role]) =>
        (role.permissions as readonly string[]).includes('platform.data_sharing.manage'),
      )
      .map(([key]) => key);
    expect(holders).toEqual(['owner']);
  });

  it('keeps the viewer read-only', () => {
    for (const key of SYSTEM_ROLES.viewer.permissions) expect(key).toMatch(/\.read$/);
  });
});
