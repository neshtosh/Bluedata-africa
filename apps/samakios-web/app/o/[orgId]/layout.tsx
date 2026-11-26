'use client';

import {
  AppShell,
  IconDashboard,
  IconFinance,
  IconInventory,
  IconLogistics,
  IconPartners,
  IconPrices,
  IconProduction,
  IconPurchases,
  IconSales,
  IconSettings,
  NavItem,
  NavSection,
} from '@blue/ui';
import { OrganisationGate, OrgSwitcher, SessionGate, useI18n } from '@blue/web-shell';
import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, type ReactNode } from 'react';
import { Brand, PRODUCT, rememberOrganisation } from '../../brand';
import { OrganisationContext } from './organisation-context';

export default function OrganisationLayout({ children }: { children: ReactNode }) {
  const { orgId } = useParams<{ orgId: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useI18n();
  const toSignIn = useCallback(() => router.replace('/sign-in'), [router]);
  const toOrganisations = useCallback(() => router.replace('/organisations'), [router]);

  useEffect(() => rememberOrganisation(orgId), [orgId]);

  const base = `/o/${orgId}`;
  const soon = t('common.comingSoon');
  const title = pathname.endsWith('/members')
    ? 'Members'
    : pathname.endsWith('/catalogue')
      ? 'Catalogue'
      : pathname.endsWith('/partners')
        ? 'Suppliers & buyers'
        : pathname.endsWith('/supply')
          ? 'Supply'
          : pathname.endsWith('/purchases')
            ? 'Purchases'
            : pathname.endsWith('/inventory')
              ? 'Inventory'
              : 'Dashboard';

  return (
    <SessionGate onSignedOut={toSignIn}>
      {(me) => (
        <OrganisationGate
          me={me}
          organisationId={orgId}
          product={PRODUCT}
          onChooseAnother={toOrganisations}
        >
          {(membership) => (
            <OrganisationContext.Provider value={membership}>
              <AppShell
                brand={<Brand />}
                title={title}
                actions={
                  <OrgSwitcher
                    me={me}
                    currentOrganisationId={orgId}
                    onSelect={(id) => router.push(`/o/${id}`)}
                    onManage={() => router.push('/organisations')}
                    onSignedOut={toSignIn}
                  />
                }
                navigation={
                  <>
                    <NavSection>
                      <NavItem icon={<IconDashboard />} active={pathname === base}>
                        <Link href={base}>Dashboard</Link>
                      </NavItem>
                    </NavSection>
                    {/* Modules arrive in Phase 3 in this order (DEVELOPMENT_ROADMAP.md). */}
                    <NavSection label="Operations">
                      <NavItem icon={<IconInventory />} active={pathname === `${base}/catalogue`}>
                        <Link href={`${base}/catalogue`}>Catalogue</Link>
                      </NavItem>
                      <NavItem icon={<IconPartners />} active={pathname === `${base}/partners`}>
                        <Link href={`${base}/partners`}>Suppliers & buyers</Link>
                      </NavItem>
                      <NavItem icon={<IconProduction />} active={pathname === `${base}/supply`}>
                        <Link href={`${base}/supply`}>Supply</Link>
                      </NavItem>
                      <NavItem icon={<IconPurchases />} active={pathname === `${base}/purchases`}>
                        <Link href={`${base}/purchases`}>Purchases</Link>
                      </NavItem>
                      <NavItem icon={<IconSales />} soon={soon}>
                        <Link href={base}>Sales</Link>
                      </NavItem>
                      <NavItem icon={<IconInventory />} active={pathname === `${base}/inventory`}>
                        <Link href={`${base}/inventory`}>Inventory</Link>
                      </NavItem>
                      <NavItem icon={<IconLogistics />} soon={soon}>
                        <Link href={base}>Deliveries</Link>
                      </NavItem>
                    </NavSection>
                    <NavSection label="Business">
                      <NavItem icon={<IconFinance />} soon={soon}>
                        <Link href={base}>Payments & expenses</Link>
                      </NavItem>
                      <NavItem icon={<IconPrices />} soon={soon}>
                        <Link href={base}>Reports</Link>
                      </NavItem>
                    </NavSection>
                    <NavSection label="Organisation">
                      <NavItem icon={<IconSettings />} active={pathname === `${base}/members`}>
                        <Link href={`${base}/members`}>Members</Link>
                      </NavItem>
                    </NavSection>
                  </>
                }
                sidebarFooter={<span>Preview · only your organisation sees this data</span>}
              >
                {children}
              </AppShell>
            </OrganisationContext.Provider>
          )}
        </OrganisationGate>
      )}
    </SessionGate>
  );
}
