import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { OpenApiDocument } from './build-openapi.js';

/** The committed, reviewed API description (apps/api/openapi.json). */
export const OPENAPI_FILE = fileURLToPath(new URL('../../openapi.json', import.meta.url));

export function serialize(document: OpenApiDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

export function readCommitted(): OpenApiDocument | undefined {
  return existsSync(OPENAPI_FILE)
    ? (JSON.parse(readFileSync(OPENAPI_FILE, 'utf8')) as OpenApiDocument)
    : undefined;
}

export function writeCommitted(document: OpenApiDocument): void {
  writeFileSync(OPENAPI_FILE, serialize(document));
}
