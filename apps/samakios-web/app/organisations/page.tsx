'use client';

import { Button } from '@blue/ui';
import { OrganisationsHome, SessionGate, useI18n, useSignOut } from '@blue/web-shell';
import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
import { Brand, PRODUCT, rememberOrganisation } from '../brand';

export default function OrganisationsPage() {
  const router = useRouter();
  const { t } = useI18n();
  const toSignIn = useCallback(() => router.replace('/sign-in'), [router]);
  const signOut = useSignOut(toSignIn);

  return (
    <SessionGate onSignedOut={toSignIn}>
      {(me) => (
        <div className="min-h-dvh">
          <header className="flex h-16 items-center justify-between bg-accent px-4 lg:px-8">
            <Brand />
            <Button variant="inverse" size="sm" onClick={() => void signOut()}>
              {t('switcher.signOut')}
            </Button>
          </header>
          <main className="px-4 py-8 lg:px-8">
            <OrganisationsHome
              me={me}
              product={PRODUCT}
              onOpen={(id) => {
                rememberOrganisation(id);
                router.push(`/o/${id}`);
              }}
            />
          </main>
        </div>
      )}
    </SessionGate>
  );
}
