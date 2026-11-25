'use client';

import {
  AppShell,
  IconDashboard,
  IconMap,
  IconPartners,
  IconPrices,
  IconProduction,
  IconSettings,
  IconSources,
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
  const title = pathname.endsWith('/members') ? 'Members' : 'Overview';

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
                        <Link href={base}>Overview</Link>
                      </NavItem>
                    </NavSection>
                    {/* Intelligence modules arrive in Phase 4 (DEVELOPMENT_ROADMAP.md). */}
                    <NavSection label="Intelligence">
                      <NavItem icon={<IconMap />} soon={soon}>
                        <Link href={base}>Map</Link>
                      </NavItem>
                      <NavItem icon={<IconPrices />} soon={soon}>
                        <Link href={base}>Market prices</Link>
                      </NavItem>
                      <NavItem icon={<IconProduction />} soon={soon}>
                        <Link href={base}>Production</Link>
                      </NavItem>
                      <NavItem icon={<IconPartners />} soon={soon}>
                        <Link href={base}>Supply & demand</Link>
                      </NavItem>
                      <NavItem icon={<IconProduction />} soon={soon}>
                        <Link href={base}>Aquaculture</Link>
                      </NavItem>
                    </NavSection>
                    <NavSection label="Data">
                      <NavItem icon={<IconSources />} soon={soon}>
                        <Link href={base}>Sources & licences</Link>
                      </NavItem>
                    </NavSection>
                    <NavSection label="Organisation">
                      <NavItem icon={<IconSettings />} active={pathname === `${base}/members`}>
                        <Link href={`${base}/members`}>Members</Link>
                      </NavItem>
                    </NavSection>
                  </>
                }
                sidebarFooter={<span>Phase 2 preview · no datasets loaded</span>}
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
