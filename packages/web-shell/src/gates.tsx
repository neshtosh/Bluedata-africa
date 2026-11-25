'use client';

import type { Me } from '@blue/contracts';
import { Alert, Button, EmptyState, Spinner } from '@blue/ui';
import { useEffect, type ReactNode } from 'react';
import { describeError, useSession } from './api.js';
import { useI18n } from './i18n.js';
import type { ProductCode } from './organisations.js';

const PRODUCT_NAMES: Record<ProductCode, string> = {
  samakios: 'SamakiOS',
  bluedata: 'BlueData Africa',
};

export function FullPageSpinner() {
  const { t } = useI18n();
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <Spinner label={t('common.loading')} />
    </div>
  );
}

/**
 * Renders children only for a signed-in user; otherwise asks the app to redirect (the app owns
 * routing, so this package stays framework-agnostic). The API remains the real gate — this only
 * decides what to show.
 */
export function SessionGate({
  onSignedOut,
  children,
}: {
  onSignedOut: () => void;
  children: (me: Me) => ReactNode;
}) {
  const session = useSession();
  const { t } = useI18n();
  useEffect(() => {
    if (session.status === 'signed-out') onSignedOut();
  }, [session.status, onSignedOut]);

  if (session.status === 'signed-in') return <>{children(session.me)}</>;
  if (session.status === 'error') {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <Alert tone="danger">{describeError(session.error, t)}</Alert>
      </div>
    );
  }
  return <FullPageSpinner />;
}

/**
 * Renders children for an organisation the user actively belongs to and whose subscription
 * includes `product`; otherwise explains why and offers the organisations page.
 */
export function OrganisationGate({
  me,
  organisationId,
  product,
  onChooseAnother,
  children,
}: {
  me: Me;
  organisationId: string;
  product: ProductCode;
  onChooseAnother: () => void;
  children: (membership: Me['organisations'][number]) => ReactNode;
}) {
  const { t } = useI18n();
  const membership = me.organisations.find(
    (o) => o.organisation.id === organisationId && o.membershipStatus === 'active',
  );
  useEffect(() => {
    // Not a member (or not active yet): treat like a missing page and go back to the list.
    if (!membership) onChooseAnother();
  }, [membership, onChooseAnother]);

  if (!membership) return <FullPageSpinner />;
  if (!membership.products.includes(product)) {
    return (
      <EmptyState
        className="min-h-dvh justify-center"
        title={t('orgs.notIncluded', { product: PRODUCT_NAMES[product] })}
        action={
          <Button variant="secondary" onClick={onChooseAnother}>
            {t('orgs.title')}
          </Button>
        }
      />
    );
  }
  return <>{children(membership)}</>;
}
