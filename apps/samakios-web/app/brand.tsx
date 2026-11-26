import { ProductWordmark } from '@blue/ui';

export const PRODUCT = 'samakios' as const;

export function Brand({ on = 'accent' }: { on?: 'accent' | 'dark' | 'light' }) {
  return <ProductWordmark name="SamakiOS" subtitle="Fisheries operations" on={on} />;
}

/** Remembers the last organisation opened in this browser (a convenience, not authorisation). */
const LAST_ORG_KEY = 'samakios:last-organisation';

export function rememberOrganisation(id: string) {
  try {
    localStorage.setItem(LAST_ORG_KEY, id);
  } catch {
    // Private mode or blocked storage: nothing to remember.
  }
}

export function lastOrganisation(): string | null {
  try {
    return localStorage.getItem(LAST_ORG_KEY);
  } catch {
    return null;
  }
}
