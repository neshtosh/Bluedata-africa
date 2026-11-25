import { describe, expect, it } from 'vitest';
import type { OpenApiDocument } from './build-openapi.js';
import { detectBreakingChanges } from './breaking-changes.js';

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
});

function doc(operation: Record<string, unknown>): OpenApiDocument {
  return { paths: { '/v1/things': { post: operation } } };
}

function op({
  body,
  response,
  status = '201',
  params = [],
}: {
  body?: unknown;
  response?: unknown;
  status?: string;
  params?: { name: string; in: string; required: boolean }[];
}) {
  return {
    parameters: params,
    ...(body ? { requestBody: { content: { 'application/json': { schema: body } } } } : {}),
    responses: {
      [status]: response ? { content: { 'application/json': { schema: response } } } : {},
    },
  };
}

const base = op({
  body: obj({ name: { type: 'string' }, note: { type: 'string' } }, ['name']),
  response: obj({ id: { type: 'string' }, name: { type: 'string' } }, ['id', 'name']),
});

describe('detectBreakingChanges', () => {
  it('reports nothing for identical or purely additive changes', () => {
    expect(detectBreakingChanges(doc(base), doc(base))).toEqual([]);
    const additive = op({
      body: obj({ name: { type: 'string' }, note: { type: 'string' }, tag: { type: 'string' } }, [
        'name',
      ]),
      response: obj(
        { id: { type: 'string' }, name: { type: 'string' }, extra: { type: 'number' } },
        ['id', 'name'],
      ),
    });
    expect(detectBreakingChanges(doc(base), doc(additive))).toEqual([]);
  });

  it('reports removed operations', () => {
    expect(detectBreakingChanges(doc(base), { paths: {} })).toEqual([
      'POST /v1/things: operation removed',
    ]);
  });

  it('reports newly required request fields and parameters', () => {
    const stricter = op({
      body: obj({ name: { type: 'string' }, note: { type: 'string' } }, ['name', 'note']),
      response: obj({ id: { type: 'string' }, name: { type: 'string' } }, ['id', 'name']),
      params: [{ name: 'X-Tenant', in: 'header', required: true }],
    });
    expect(detectBreakingChanges(doc(base), doc(stricter))).toEqual([
      'POST /v1/things: new required parameter header:X-Tenant',
      'POST /v1/things request: new required field note',
    ]);
  });

  it('reports response fields that are removed or no longer guaranteed', () => {
    const weaker = op({
      body: obj({ name: { type: 'string' }, note: { type: 'string' } }, ['name']),
      response: obj({ id: { type: 'string' } }, []),
    });
    expect(detectBreakingChanges(doc(base), doc(weaker))).toEqual([
      'POST /v1/things response: field id is no longer always present',
      'POST /v1/things response: field name removed',
    ]);
  });

  it('reports a changed success status', () => {
    expect(
      detectBreakingChanges(
        doc(base),
        doc({ ...base, responses: { '200': base.responses['201'] } }),
      ),
    ).toContain('POST /v1/things: success status changed 201 → 200');
  });
});
