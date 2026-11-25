'use client';

import { ApiClient, ApiError } from '@blue/api-client';
import { endpoints, type Me } from '@blue/contracts';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { LOCALES, type MessageKey, type Translate } from './i18n.js';

const ApiContext = createContext<ApiClient | null>(null);

export interface ApiProviderProps {
  /** API origin, e.g. http://localhost:4000 (NEXT_PUBLIC_API_URL). */
  baseUrl: string;
  /** Identifies the app in the CSRF header, e.g. samakios-web. */
  clientName: string;
  children: ReactNode;
}

/** One ApiClient and one QueryClient per browser tab. */
export function ApiProvider({ baseUrl, clientName, children }: ApiProviderProps) {
  const [client] = useState(() => new ApiClient({ baseUrl, clientName }));
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            // Don't retry auth or permission failures; do retry flaky networks a little.
            retry: (count, error) =>
              !(error instanceof ApiError && error.status < 500) && count < 2,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );
  return (
    <ApiContext.Provider value={client}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ApiContext.Provider>
  );
}

export function useApi(): ApiClient {
  const client = useContext(ApiContext);
  if (!client) throw new Error('useApi must be used inside <ApiProvider>');
  return client;
}

export type Session =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'signed-in'; me: Me }
  | { status: 'error'; error: unknown };

export const ME_QUERY_KEY = ['me'] as const;

/** The signed-in user and their organisations, or signed-out. */
export function useSession(): Session {
  const api = useApi();
  const query = useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: async () => {
      try {
        return await api.call(endpoints.me.get);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
  });
  if (query.isPending) return { status: 'loading' };
  if (query.isError) return { status: 'error', error: query.error };
  return query.data ? { status: 'signed-in', me: query.data } : { status: 'signed-out' };
}

/** Re-read /me after anything that changes sessions or memberships. */
export function useRefreshSession() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
}

/** A user-facing message for any error thrown by the API client. */
export function describeError(error: unknown, t: Translate): string {
  if (error instanceof ApiError) {
    const key = `error.${error.code}` as MessageKey;
    if (key in LOCALES.en) return t(key, { seconds: error.retryAfterSeconds ?? 60 });
    return error.problem?.detail ?? t('error.generic');
  }
  if (error instanceof TypeError) return t('error.network'); // fetch network failure
  return t('error.generic');
}
