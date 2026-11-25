'use client';

import { ApiProvider, I18nProvider } from '@blue/web-shell';
import type { ReactNode } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ApiProvider baseUrl={API_URL} clientName="bluedata-web">
      <I18nProvider>{children}</I18nProvider>
    </ApiProvider>
  );
}
