/** SQLSTATE and constraint name of a Postgres error, whether or not Drizzle wrapped it. */
export function pgError(error: unknown): { code?: string; constraint?: string } {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth++) {
    if (
      'code' in current &&
      typeof current.code === 'string' &&
      /^[0-9A-Z]{5}$/.test(current.code)
    ) {
      const constraint =
        'constraint' in current && typeof current.constraint === 'string'
          ? current.constraint
          : undefined;
      return { code: current.code, ...(constraint ? { constraint } : {}) };
    }
    current = 'cause' in current ? current.cause : undefined;
  }
  return {};
}

export const UNIQUE_VIOLATION = '23505';
