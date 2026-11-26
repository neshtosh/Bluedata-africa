'use client';

import { endpoints, type Me } from '@blue/contracts';
import {
  IconCheck,
  IconChevronDown,
  IconLogout,
  IconPlus,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
} from '@blue/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useApi } from './api.js';
import { useI18n } from './i18n.js';

/** Top-bar menu: current organisation, switch to another, register one, sign out. */
export function OrgSwitcher({
  me,
  currentOrganisationId,
  onSelect,
  onManage,
  onSignedOut,
}: {
  me: Me;
  currentOrganisationId: string;
  onSelect: (organisationId: string) => void;
  /** Go to the organisations page (invitations, registration). */
  onManage: () => void;
  onSignedOut: () => void;
}) {
  const { t } = useI18n();
  const signOut = useSignOut(onSignedOut);
  const active = me.organisations.filter((o) => o.membershipStatus === 'active');
  const invitations = me.organisations.filter((o) => o.membershipStatus === 'invited').length;
  const current = active.find((o) => o.organisation.id === currentOrganisationId)?.organisation;
  const initials = me.user.displayName
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <Menu>
      <MenuTrigger
        className="flex h-11 max-w-[300px] items-center gap-2.5 rounded-full bg-mist-0 py-1 pl-1 pr-3 text-left shadow-raised hover:bg-mist-25"
        aria-label={t('switcher.label')}
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-[12px] font-semibold text-white">
          {initials}
        </span>
        <span className="hidden min-w-0 flex-col leading-tight sm:flex">
          <span className="truncate text-[13px] font-medium text-mist-900">
            {current ? (current.tradingName ?? current.legalName) : '—'}
          </span>
          <span className="truncate text-[11px] text-mist-500">{me.user.displayName}</span>
        </span>
        <IconChevronDown className="size-4 shrink-0 text-mist-500" />
      </MenuTrigger>
      <MenuContent>
        <MenuLabel>{t('switcher.label')}</MenuLabel>
        {active.map(({ organisation }) => (
          <MenuItem
            key={organisation.id}
            onSelect={() => onSelect(organisation.id)}
            icon={
              organisation.id === currentOrganisationId ? (
                <IconCheck className="size-4 text-accent" />
              ) : null
            }
          >
            <span className="block truncate">
              {organisation.tradingName ?? organisation.legalName}
            </span>
            <span className="block text-[11px] text-mist-500">
              {organisation.countryCode} · {organisation.defaultCurrency}
            </span>
          </MenuItem>
        ))}
        <MenuSeparator />
        {invitations > 0 ? (
          <MenuItem onSelect={onManage}>
            {t('switcher.invitations', { count: invitations })}
          </MenuItem>
        ) : null}
        <MenuItem onSelect={onManage} icon={<IconPlus className="size-4" />}>
          {t('switcher.create')}
        </MenuItem>
        <MenuItem onSelect={() => void signOut()} icon={<IconLogout className="size-4" />}>
          {t('switcher.signOut')}
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

export function useSignOut(onSignedOut: () => void) {
  const api = useApi();
  const queryClient = useQueryClient();
  return async () => {
    try {
      await api.call(endpoints.auth.logout);
    } finally {
      // Drop every cached tenant response so nothing from this session is shown to the next user.
      queryClient.clear();
      onSignedOut();
    }
  };
}
