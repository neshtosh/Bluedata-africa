import type { OpenApiDocument } from './build-openapi.js';

type Schema = {
  type?: string | string[];
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
};
type Operation = {
  parameters?: { name: string; in: string; required?: boolean }[];
  requestBody?: { content?: Record<string, { schema?: Schema }> };
  responses?: Record<string, { content?: Record<string, { schema?: Schema }> }>;
};

/**
 * Changes that can break an existing client. Deliberately conservative and simple: it catches
 * the common mistakes (removing things clients use, demanding things they don't send), not
 * every theoretical incompatibility. Additive changes are never reported.
 */
export function detectBreakingChanges(previous: OpenApiDocument, next: OpenApiDocument): string[] {
  const problems: string[] = [];
  for (const [path, operations] of Object.entries(previous.paths)) {
    for (const [method, before] of Object.entries(operations) as [string, Operation][]) {
      const label = `${method.toUpperCase()} ${path}`;
      const after = next.paths[path]?.[method] as Operation | undefined;
      if (!after) {
        problems.push(`${label}: operation removed`);
        continue;
      }

      const statusBefore = successStatus(before);
      const statusAfter = successStatus(after);
      if (statusBefore !== statusAfter) {
        problems.push(`${label}: success status changed ${statusBefore} → ${statusAfter}`);
      }

      const requiredBefore = new Set(requiredParameters(before));
      for (const parameter of requiredParameters(after)) {
        if (!requiredBefore.has(parameter))
          problems.push(`${label}: new required parameter ${parameter}`);
      }

      compareRequest(bodySchema(before), bodySchema(after), `${label} request`, problems);
      compareResponse(
        responseSchema(before, statusBefore),
        responseSchema(after, statusAfter),
        `${label} response`,
        problems,
      );
    }
  }
  return problems;
}

/** Requests break when the server starts demanding something old clients don't send. */
function compareRequest(
  before: Schema | undefined,
  after: Schema | undefined,
  at: string,
  problems: string[],
) {
  if (!after) return;
  if (!before) {
    problems.push(`${at}: body is now required`);
    return;
  }
  if (typeChanged(before, after)) problems.push(`${at}: type changed`);
  const requiredBefore = new Set(before.required ?? []);
  for (const field of after.required ?? []) {
    if (!requiredBefore.has(field)) problems.push(`${at}: new required field ${field}`);
  }
  for (const [field, schema] of Object.entries(after.properties ?? {})) {
    const old = before.properties?.[field];
    if (old) compareRequest(old, schema, `${at}.${field}`, problems);
  }
  if (before.items && after.items) compareRequest(before.items, after.items, `${at}[]`, problems);
}

/** Responses break when the server stops sending something old clients rely on. */
function compareResponse(
  before: Schema | undefined,
  after: Schema | undefined,
  at: string,
  problems: string[],
) {
  if (!before) return;
  if (!after) {
    problems.push(`${at}: body removed`);
    return;
  }
  if (typeChanged(before, after)) problems.push(`${at}: type changed`);
  const requiredAfter = new Set(after.required ?? []);
  for (const [field, schema] of Object.entries(before.properties ?? {})) {
    const replacement = after.properties?.[field];
    if (!replacement) {
      problems.push(`${at}: field ${field} removed`);
      continue;
    }
    if ((before.required ?? []).includes(field) && !requiredAfter.has(field)) {
      problems.push(`${at}: field ${field} is no longer always present`);
    }
    compareResponse(schema, replacement, `${at}.${field}`, problems);
  }
  if (before.items && after.items) compareResponse(before.items, after.items, `${at}[]`, problems);
}

function typeChanged(before: Schema, after: Schema): boolean {
  return JSON.stringify(before.type ?? null) !== JSON.stringify(after.type ?? null);
}

function successStatus(operation: Operation): string | undefined {
  return Object.keys(operation.responses ?? {}).find((code) => code.startsWith('2'));
}

function requiredParameters(operation: Operation): string[] {
  return (operation.parameters ?? []).filter((p) => p.required).map((p) => `${p.in}:${p.name}`);
}

function bodySchema(operation: Operation): Schema | undefined {
  return operation.requestBody?.content?.['application/json']?.schema;
}

function responseSchema(operation: Operation, status: string | undefined): Schema | undefined {
  return status ? operation.responses?.[status]?.content?.['application/json']?.schema : undefined;
}
