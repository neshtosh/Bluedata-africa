import { uuidv7 } from 'uuidv7';

/** Branded UUID string so IDs are not confused with arbitrary strings at compile time. */
export type Id = string & { readonly __brand: 'Id' };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Generates a time-ordered UUIDv7 (ADR-006). Safe to call on clients, including offline
 * devices, because uniqueness does not depend on the database.
 */
export function newId(): Id {
  return uuidv7() as Id;
}

export function isId(value: unknown): value is Id {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}
