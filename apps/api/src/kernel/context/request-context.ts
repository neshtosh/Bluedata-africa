import type { Id } from '@blue/primitives';
import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request identity and tenant, available anywhere in the call chain without passing it
 * through every function. The store object is created when the request arrives and attached to
 * the Fastify request, so guards (authentication, tenant membership — increment 2.4) can fill
 * in userId/organisationId before the handler runs inside it.
 */
export interface RequestContextStore {
  readonly requestId: string;
  /** Client IP as seen by Fastify (set trustProxy when deployed behind a load balancer). */
  readonly ip: string | null;
  userId: Id | null;
  /** The session that authenticated this request, if any (for logout, password change). */
  sessionId: Id | null;
  organisationId: Id | null;
}

const storage = new AsyncLocalStorage<RequestContextStore>();

export const RequestContext = {
  create(requestId: string, ip: string | null = null): RequestContextStore {
    return { requestId, ip, userId: null, sessionId: null, organisationId: null };
  },

  run<T>(store: RequestContextStore, fn: () => T): T {
    return storage.run(store, fn);
  },

  current(): RequestContextStore | undefined {
    return storage.getStore();
  },

  /** For code that must only ever run inside a request (or a job that sets a context). */
  require(): RequestContextStore {
    const store = storage.getStore();
    if (!store) throw new Error('No request context: called outside a request or job scope');
    return store;
  },
};

declare module 'fastify' {
  interface FastifyRequest {
    blueContext: RequestContextStore;
  }
}
