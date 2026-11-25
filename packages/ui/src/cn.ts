import { clsx, type ClassValue } from 'clsx';

/** Joins class names. Components avoid conflicting utilities by design, so no merging is needed. */
export function cn(...values: ClassValue[]): string {
  return clsx(values);
}
