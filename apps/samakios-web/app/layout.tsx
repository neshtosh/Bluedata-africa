import '@fontsource-variable/inter';
import './globals.css';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: { default: 'SamakiOS', template: '%s · SamakiOS' },
  description: 'Fisheries business management: supply, trading, inventory, logistics and finance.',
};

export const viewport: Viewport = { themeColor: '#0b1f33', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-product="samakios">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
