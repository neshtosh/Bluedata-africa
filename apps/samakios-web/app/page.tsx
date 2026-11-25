'use client';

import { FullPageSpinner, useSession } from '@blue/web-shell';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { lastOrganisation, PRODUCT } from './brand';

/** Sends the user where they belong: sign-in, their organisation, or the organisations page. */
export default function Home() {
  const router = useRouter();
  const session = useSession();

  useEffect(() => {
    if (session.status === 'signed-out') {
      router.replace('/sign-in');
    } else if (session.status === 'signed-in') {
      const usable = session.me.organisations.filter(
        (o) => o.membershipStatus === 'active' && o.products.includes(PRODUCT),
      );
      const remembered = lastOrganisation();
      const target = usable.find((o) => o.organisation.id === remembered) ?? usable[0];
      router.replace(target ? `/o/${target.organisation.id}` : '/organisations');
    }
  }, [session, router]);

  return <FullPageSpinner />;
}
