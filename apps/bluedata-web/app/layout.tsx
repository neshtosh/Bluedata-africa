import '@fontsource-variable/inter';
import './globals.css';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: { default: 'BlueData Africa', template: '%s · BlueData Africa' },
  description:
    'Fisheries intelligence for Africa: production, prices, supply and demand — with sources.',
};

export const viewport: Viewport = { themeColor: '#0b1f33', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-product="bluedata">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
