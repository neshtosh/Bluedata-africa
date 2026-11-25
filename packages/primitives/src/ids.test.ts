import { describe, expect, it } from 'vitest';
import { isId, newId } from './ids.js';

describe('newId', () => {
  it('produces valid version-7 UUIDs', () => {
    const id = newId();
    expect(isId(id)).toBe(true);
    expect(id[14]).toBe('7');
  });

  it('is time-ordered, so later IDs sort after earlier ones', () => {
    const ids = Array.from({ length: 1000 }, () => newId());
    expect([...ids].sort()).toEqual(ids);
  });
});

describe('isId', () => {
  it('rejects non-UUID values', () => {
    expect(isId('not-a-uuid')).toBe(false);
    expect(isId(42)).toBe(false);
    expect(isId(undefined)).toBe(false);
  });
});
