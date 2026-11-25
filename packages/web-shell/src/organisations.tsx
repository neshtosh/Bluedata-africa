'use client';

import { ApiError } from '@blue/api-client';
import { endpoints, ORGANISATION_TYPES, type Me, type OrganisationTypeCode } from '@blue/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  cn,
  EmptyState,
  Field,
  Input,
  Select,
} from '@blue/ui';
import { useState, type FormEvent } from 'react';
import { describeError, useApi, useRefreshSession } from './api.js';
import { useI18n } from './i18n.js';

export type ProductCode = 'samakios' | 'bluedata';

const PRODUCT_NAMES: Record<ProductCode, string> = {
  samakios: 'SamakiOS',
  bluedata: 'BlueData Africa',
};
const REGISTRATION_COUNTRIES = [
  { code: 'KE', name: 'Kenya' },
  { code: 'UG', name: 'Uganda' },
  { code: 'TZ', name: 'Tanzania' },
] as const;
const MAX_TYPES = 5;

/** Turns "Lake Traders Ltd." into "lake-traders-ltd". */
export function suggestSlug(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * The organisations page shared by both products: pending invitations, the organisations the
 * user belongs to (flagging ones whose subscription lacks this product), and registration.
 */
export function OrganisationsHome({
  me,
  product,
  onOpen,
}: {
  me: Me;
  product: ProductCode;
  onOpen: (organisationId: string) => void;
}) {
  const { t } = useI18n();
  const invitations = me.organisations.filter((o) => o.membershipStatus === 'invited');
  const active = me.organisations.filter((o) => o.membershipStatus === 'active');

  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-mist-900">
          {t('orgs.title')}
        </h1>
        <p className="mt-1 text-sm text-mist-500">{t('orgs.subtitle')}</p>
      </div>

      {invitations.length > 0 ? (
        <Card>
          <CardHeader title={t('orgs.invitations')} />
          <ul className="divide-y divide-mist-100">
            {invitations.map((invitation) => (
              <InvitationRow
                key={invitation.organisation.id}
                organisationId={invitation.organisation.id}
                name={invitation.organisation.tradingName ?? invitation.organisation.legalName}
              />
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <CardHeader title={t('orgs.title')} />
        {active.length === 0 ? (
          <EmptyState title={t('orgs.none')} />
        ) : (
          <ul className="divide-y divide-mist-100">
            {active.map(({ organisation, roles, products }) => {
              const included = products.includes(product);
              return (
                <li key={organisation.id} className="flex items-center gap-4 px-5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-mist-900">
                      {organisation.tradingName ?? organisation.legalName}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-mist-500">
                      <span>{organisation.countryCode}</span>
                      <span aria-hidden>·</span>
                      <span>{organisation.defaultCurrency}</span>
                      {roles.map((role) => (
                        <Badge key={role} tone="neutral">
                          {role}
                        </Badge>
                      ))}
                    </p>
                    {!included ? (
                      <p className="mt-1 text-[12px] text-warning-700">
                        {t('orgs.notIncluded', { product: PRODUCT_NAMES[product] })}
                      </p>
                    ) : null}
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!included}
                    onClick={() => onOpen(organisation.id)}
                  >
                    {t('orgs.open')}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <CreateOrganisationForm onCreated={onOpen} />
    </div>
  );
}

function InvitationRow({ organisationId, name }: { organisationId: string; name: string }) {
  const api = useApi();
  const refreshSession = useRefreshSession();
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      await api.call(endpoints.me.acceptInvitation, { params: { orgId: organisationId } });
      await refreshSession();
    } catch (caught) {
      setError(describeError(caught, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-col gap-2 px-5 py-3.5 sm:flex-row sm:items-center">
      <p className="flex-1 text-sm text-mist-800">{t('orgs.invitedBy', { name })}</p>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Button size="sm" onClick={() => void accept()} loading={busy}>
        {t('orgs.accept')}
      </Button>
    </li>
  );
}

export function CreateOrganisationForm({
  onCreated,
}: {
  onCreated: (organisationId: string) => void;
}) {
  const api = useApi();
  const refreshSession = useRefreshSession();
  const { t } = useI18n();
  const [legalName, setLegalName] = useState('');
  const [tradingName, setTradingName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [countryCode, setCountryCode] = useState<string>('KE');
  const [types, setTypes] = useState<OrganisationTypeCode[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const effectiveSlug = slugEdited ? slug : suggestSlug(legalName);

  function toggleType(code: OrganisationTypeCode) {
    setTypes((current) =>
      current.includes(code)
        ? current.filter((c) => c !== code)
        : current.length < MAX_TYPES
          ? [...current, code]
          : current,
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const organisation = await api.call(endpoints.orgs.register, {
        body: {
          legalName,
          ...(tradingName.trim() ? { tradingName } : {}),
          slug: effectiveSlug,
          countryCode,
          organisationTypes: types,
        },
      });
      await refreshSession();
      onCreated(organisation.id);
    } catch (caught) {
      if (caught instanceof ApiError && caught.problem?.errors) {
        setFieldErrors(
          Object.fromEntries(
            caught.problem.errors.map((e) => [e.path.split('.')[0] ?? '', e.message]),
          ),
        );
      }
      // Client-side contract validation throws a ZodError before any request is sent.
      if (
        caught &&
        typeof caught === 'object' &&
        'issues' in caught &&
        Array.isArray(caught.issues)
      ) {
        const issues = caught.issues as { path: (string | number)[]; message: string }[];
        setFieldErrors(Object.fromEntries(issues.map((i) => [String(i.path[0] ?? ''), i.message])));
        setError(t('error.VALIDATION_FAILED'));
      } else {
        setError(describeError(caught, t));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title={t('orgs.createTitle')} description={t('orgs.createSubtitle')} />
      <CardBody>
        <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-4 sm:grid-cols-2">
          <Field label={t('orgs.legalName')} error={fieldErrors.legalName}>
            <Input
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
              autoComplete="organization"
            />
          </Field>
          <Field label={t('orgs.tradingName')} error={fieldErrors.tradingName}>
            <Input value={tradingName} onChange={(e) => setTradingName(e.target.value)} />
          </Field>
          <Field label={t('orgs.slug')} hint={t('orgs.slugHint')} error={fieldErrors.slug}>
            <Input
              value={effectiveSlug}
              onChange={(e) => {
                setSlugEdited(true);
                setSlug(e.target.value);
              }}
              spellCheck={false}
            />
          </Field>
          <Field label={t('orgs.country')} error={fieldErrors.countryCode}>
            <Select value={countryCode} onChange={(e) => setCountryCode(e.target.value)}>
              {REGISTRATION_COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <fieldset className="sm:col-span-2">
            <legend className="text-[13px] font-medium text-mist-800">{t('orgs.types')}</legend>
            <p className="mt-0.5 text-[13px] text-mist-500">{t('orgs.typesHint')}</p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {ORGANISATION_TYPES.map((type) => {
                const selected = types.includes(type.code);
                return (
                  <button
                    key={type.code}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggleType(type.code)}
                    className={cn(
                      'h-8 rounded-md px-3 text-[13px] font-medium ring-1 ring-inset transition-colors',
                      selected
                        ? 'bg-accent-soft text-accent-strong ring-accent'
                        : 'bg-mist-0 text-mist-700 ring-mist-200 hover:ring-mist-300',
                    )}
                  >
                    {type.name}
                  </button>
                );
              })}
            </div>
            {fieldErrors.organisationTypes ? (
              <p className="mt-1.5 text-[13px] text-danger-700" role="alert">
                {fieldErrors.organisationTypes}
              </p>
            ) : null}
          </fieldset>
          {error ? (
            <Alert tone="danger" className="sm:col-span-2">
              {error}
            </Alert>
          ) : null}
          <div className="sm:col-span-2">
            <Button type="submit" loading={busy} disabled={!legalName.trim() || types.length === 0}>
              {t('orgs.create')}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
