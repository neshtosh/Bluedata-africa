'use client';

import { endpoints, SYSTEM_ROLES, type Me, type SystemRoleKey } from '@blue/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Select,
  Spinner,
} from '@blue/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { describeError, useApi } from './api.js';
import { useI18n } from './i18n.js';
import { PHONE_COUNTRIES, toE164, type PhoneCountryCode } from './phone.js';

type Membership = Me['organisations'][number];

/**
 * Members of the current organisation, and (for those allowed to) inviting someone by phone.
 * The UI hides what the user may not do; the API enforces it regardless.
 */
export function MembersPanel({ membership }: { membership: Membership }) {
  const api = useApi();
  const { t } = useI18n();
  const organisationId = membership.organisation.id;
  const members = useQuery({
    queryKey: ['orgs', organisationId, 'members'],
    queryFn: () => api.call(endpoints.orgs.listMembers, { params: { orgId: organisationId } }),
  });
  const canInvite = membership.permissions.includes('platform.members.invite');
  const canLink = membership.permissions.includes('platform.members.manage');
  const [link, setLink] = useState<{ name: string; url: string; expiresAt: string } | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);

  async function createLink(userId: string, name: string) {
    setLinkError(null);
    setLink(null);
    try {
      const created = await api.call(endpoints.orgs.createSetupLink, {
        params: { orgId: organisationId, userId },
      });
      setLink({
        name,
        url: `${window.location.origin}${created.path}`,
        expiresAt: created.expiresAt,
      });
    } catch (caught) {
      setLinkError(describeError(caught, t));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader
          title="Members"
          description="People with access to this organisation and their roles."
        />
        {members.isPending ? (
          <div className="flex justify-center py-10">
            <Spinner label={t('common.loading')} />
          </div>
        ) : members.isError ? (
          <CardBody>
            <Alert tone="danger">{describeError(members.error, t)}</Alert>
          </CardBody>
        ) : members.data.length === 0 ? (
          <EmptyState title="No members yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="border-b border-mist-100 text-[12px] uppercase tracking-[0.04em] text-mist-500">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Name</th>
                  <th className="px-5 py-2.5 font-medium">Phone</th>
                  <th className="px-5 py-2.5 font-medium">Roles</th>
                  <th className="px-5 py-2.5 font-medium">Status</th>
                  {canLink ? <th className="px-5 py-2.5" /> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-mist-100">
                {members.data.map((member) => (
                  <tr key={member.membershipId}>
                    <td className="px-5 py-3 font-medium text-mist-900">{member.displayName}</td>
                    <td className="tabular px-5 py-3 text-mist-600">{member.phone ?? '—'}</td>
                    <td className="px-5 py-3">
                      <span className="flex flex-wrap gap-1">
                        {member.roles.map((role) => (
                          <Badge key={role}>
                            {SYSTEM_ROLES[role as SystemRoleKey]?.name ?? role}
                          </Badge>
                        ))}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone={member.status === 'active' ? 'success' : 'warning'}>
                        {member.status}
                      </Badge>
                    </td>
                    {canLink ? (
                      <td className="px-5 py-3 text-right">
                        {member.status === 'invited' ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => void createLink(member.userId, member.displayName)}
                          >
                            Setup link
                          </Button>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {linkError ? (
          <CardBody>
            <Alert tone="danger">{linkError}</Alert>
          </CardBody>
        ) : null}
        {link ? <SetupLinkBox {...link} onClose={() => setLink(null)} /> : null}
      </Card>
      {canInvite ? <InviteForm organisationId={organisationId} /> : null}
    </div>
  );
}

/**
 * A freshly created setup link, to copy or share by hand. It is shown once: closing the box
 * forgets it, and creating another replaces it.
 */
function SetupLinkBox({
  name,
  url,
  expiresAt,
  onClose,
}: {
  name: string;
  url: string;
  expiresAt: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const message = `${name}, use this link to set up your account (it works once): ${url}`;
  return (
    <CardBody className="border-t border-mist-100">
      <div className="rounded-xl bg-accent-soft p-4">
        <p className="text-[13px] font-semibold text-mist-900">Setup link for {name}</p>
        <p className="mt-1 text-[12px] text-mist-600">
          Send it to {name} only. It works once, until {new Date(expiresAt).toLocaleString()}.
          Anyone with the link can set the password, so don&apos;t post it in a group.
        </p>
        <p className="mt-3 break-all rounded-lg bg-mist-0 px-3 py-2 font-mono text-[12px] text-mist-800">
          {url}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() => void navigator.clipboard.writeText(url).then(() => setCopied(true))}
          >
            {copied ? 'Copied' : 'Copy link'}
          </Button>
          <Button variant="secondary" size="sm" asChild>
            <a
              href={`https://wa.me/?text=${encodeURIComponent(message)}`}
              target="_blank"
              rel="noreferrer"
            >
              Share on WhatsApp
            </a>
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </CardBody>
  );
}

function InviteForm({ organisationId }: { organisationId: string }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const [country, setCountry] = useState<PhoneCountryCode>('KE');
  const [typedPhone, setTypedPhone] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<SystemRoleKey>('viewer');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSent(null);
    const phone = toE164(country, typedPhone);
    if (!phone) {
      setError(t('signIn.phoneInvalid'));
      return;
    }
    setBusy(true);
    try {
      await api.call(endpoints.orgs.invite, {
        params: { orgId: organisationId },
        body: { phone, displayName, roleKeys: [role] },
      });
      setSent(
        `${displayName} has been invited. If they don't have an account yet, create a setup link for them in the list above and send it to them.`,
      );
      setTypedPhone('');
      setDisplayName('');
      await queryClient.invalidateQueries({ queryKey: ['orgs', organisationId, 'members'] });
    } catch (caught) {
      setError(describeError(caught, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Invite a member"
        description="Invitations are by mobile number. Roles can be changed later."
      />
      <CardBody>
        <form
          onSubmit={(e) => void submit(e)}
          noValidate
          className="grid gap-4 sm:grid-cols-[128px_1fr_1fr_160px_auto] sm:items-end"
        >
          <Field label={t('signIn.country')}>
            <Select
              value={country}
              onChange={(e) => setCountry(e.target.value as PhoneCountryCode)}
            >
              {PHONE_COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} {c.dial}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('signIn.phone')}>
            <Input
              type="tel"
              inputMode="tel"
              value={typedPhone}
              onChange={(e) => setTypedPhone(e.target.value)}
            />
          </Field>
          <Field label="Name">
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </Field>
          <Field label="Role">
            <Select value={role} onChange={(e) => setRole(e.target.value as SystemRoleKey)}>
              {(Object.keys(SYSTEM_ROLES) as SystemRoleKey[]).map((key) => (
                <option key={key} value={key}>
                  {SYSTEM_ROLES[key].name}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" loading={busy} disabled={!typedPhone || !displayName.trim()}>
            Invite
          </Button>
        </form>
        {error ? (
          <Alert tone="danger" className="mt-4">
            {error}
          </Alert>
        ) : null}
        {sent ? (
          <Alert tone="success" className="mt-4">
            {sent}
          </Alert>
        ) : null}
      </CardBody>
    </Card>
  );
}
