import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { servedPath } from './endpoint.js';
import { listEndpoints } from './endpoints.js';

const all = listEndpoints();

describe('endpoint registry', () => {
  it('has no duplicate method + path', () => {
    const keys = all.map(({ endpoint }) => `${endpoint.method} ${servedPath(endpoint)}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('declares a params schema exactly matching the :parameters in each path', () => {
    for (const { id, endpoint } of all) {
      const inPath = [...endpoint.path.matchAll(/:([A-Za-z]+)/g)].map((m) => m[1]).sort();
      const declared =
        endpoint.params instanceof z.ZodObject ? Object.keys(endpoint.params.shape).sort() : [];
      expect(declared, id).toEqual(inPath);
    }
  });

  it('pairs 204 with no response body, and other statuses with a response schema', () => {
    for (const { id, endpoint } of all) {
      expect(endpoint.response === undefined, id).toBe(endpoint.status === 204);
    }
  });

  it('requires idempotency keys only on signed-in POSTs, where it is the default', () => {
    for (const { id, endpoint } of all) {
      if (endpoint.idempotencyKey === 'required') {
        expect(endpoint.method, id).toBe('POST');
        expect(endpoint.auth, id).toBe('session');
      }
    }
    // Documented exception: logout is naturally idempotent.
    const signedInPostsWithoutKey = all
      .filter(
        ({ endpoint: e }) =>
          e.method === 'POST' && e.auth === 'session' && e.idempotencyKey === 'none',
      )
      .map(({ id }) => id);
    expect(signedInPostsWithoutKey).toEqual(['auth.logout']);
  });
});
