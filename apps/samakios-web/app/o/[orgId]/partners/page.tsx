'use client';

import {
  endpoints,
  PARTNER_KINDS,
  PARTNER_ROLES,
  PRODUCTION_TYPES,
  type PartnerKind,
  type PartnerRole,
  type TradingPartner,
  type Vocabulary,
} from '@blue/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Field,
  IconPartners,
  Input,
  Select,
  Spinner,
} from '@blue/ui';
import {
  describeError,
  PHONE_COUNTRIES,
  toE164,
  useApi,
  useI18n,
  type PhoneCountryCode,
} from '@blue/web-shell';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDeferredValue, useMemo, useState, type FormEvent } from 'react';
import { useMembership } from '../organisation-context';

type ProductionType = (typeof PRODUCTION_TYPES)[number];

const KIND_LABELS: Record<PartnerKind, string> = {
  individual: 'Individual',
  business: 'Business',
  cooperative: 'Cooperative',
  bmu: 'Beach Management Unit',
};
const ROLE_LABELS: Record<PartnerRole, string> = {
  supplier: 'Supplier',
  buyer: 'Buyer',
  transporter: 'Transporter',
};
const PRODUCTION_LABELS: Record<ProductionType, string> = {
  wild: 'Wild-caught',
  farmed: 'Farmed',
  both: 'Wild and farmed',
};

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export default function PartnersPage() {
  const { organisation, permissions } = useMembership();
  const api = useApi();
  const { t } = useI18n();
  const canManage = permissions.includes('samakios.partners.manage');

  const [role, setRole] = useState<PartnerRole | ''>('');
  const [speciesId, setSpeciesId] = useState('');
  const [search, setSearch] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [editing, setEditing] = useState<TradingPartner | 'new' | null>(null);
  const q = useDeferredValue(search.trim());

  const vocabulary = useQuery({
    queryKey: ['ref', 'vocabulary'],
    queryFn: () => api.call(endpoints.ref.vocabulary),
    staleTime: 10 * 60_000,
  });
  const partners = useQuery({
    queryKey: ['orgs', organisation.id, 'partners', { role, speciesId, q, includeArchived }],
    queryFn: () =>
      api.call(endpoints.partners.list, {
        params: { orgId: organisation.id },
        query: {
          ...(role ? { role } : {}),
          ...(speciesId ? { speciesId } : {}),
          ...(q ? { q } : {}),
          ...(includeArchived ? { includeArchived: 'true' } : {}),
        },
      }),
    placeholderData: keepPreviousData,
  });

  if (partners.isPending || vocabulary.isPending) {
    return (
      <div className="flex justify-center py-16">
        <Spinner label={t('common.loading')} />
      </div>
    );
  }
  if (partners.isError || vocabulary.isError) {
    return <Alert tone="danger">{describeError(partners.error ?? vocabulary.error, t)}</Alert>;
  }
  const filtered = Boolean(role || speciesId || q || includeArchived);

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.02em] text-mist-900">
            Suppliers & buyers
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-mist-500">
            The people and businesses you buy from, sell to and move fish with. One record per
            partner, even when they are both a supplier and a buyer. Only your organisation sees
            this list.
          </p>
        </div>
        {canManage && editing === null ? (
          <Button onClick={() => setEditing('new')}>Add partner</Button>
        ) : null}
      </div>

      {editing !== null ? (
        <PartnerForm
          key={editing === 'new' ? 'new' : editing.id}
          partner={editing === 'new' ? null : editing}
          vocabulary={vocabulary.data}
          onDone={() => setEditing(null)}
        />
      ) : null}

      <Card>
        <CardHeader
          title="Partners"
          description={`${partners.data.length} ${filtered ? 'matching' : 'active'}`}
        />
        <CardBody>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_auto] lg:items-end">
            <Field label="Search">
              <Input
                type="search"
                placeholder="Name or phone number"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </Field>
            <Field label="Role">
              <Select value={role} onChange={(e) => setRole(e.target.value as PartnerRole | '')}>
                <option value="">All roles</option>
                {PARTNER_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}s
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Species">
              <Select value={speciesId} onChange={(e) => setSpeciesId(e.target.value)}>
                <option value="">Any species</option>
                {vocabulary.data.species.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.commonNameEn}
                  </option>
                ))}
              </Select>
            </Field>
            <label className="flex h-9 items-center gap-2 text-[13px] text-mist-700">
              <input
                type="checkbox"
                checked={includeArchived}
                onChange={(e) => setIncludeArchived(e.target.checked)}
              />
              Show archived
            </label>
          </div>
        </CardBody>
        {partners.data.length === 0 ? (
          <EmptyState
            icon={<IconPartners />}
            title={filtered ? 'No partners match' : 'No partners yet'}
            description={
              filtered
                ? 'Try a different name, role or species.'
                : 'Add the fishers, farmers, BMUs, buyers and transporters you work with.'
            }
          />
        ) : (
          <PartnersTable
            partners={partners.data}
            vocabulary={vocabulary.data}
            canManage={canManage}
            onEdit={setEditing}
          />
        )}
      </Card>
    </div>
  );
}

function PartnersTable({
  partners,
  vocabulary,
  canManage,
  onEdit,
}: {
  partners: TradingPartner[];
  vocabulary: Vocabulary;
  canManage: boolean;
  onEdit: (partner: TradingPartner) => void;
}) {
  const { organisation } = useMembership();
  const api = useApi();
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const speciesName = useMemo(() => {
    const byId = new Map(vocabulary.species.map((s) => [s.id, s.commonNameEn]));
    return (id: string) => byId.get(id) ?? '—';
  }, [vocabulary]);

  async function setArchived(partner: TradingPartner, archived: boolean) {
    setError(null);
    try {
      await api.call(endpoints.partners.update, {
        params: { orgId: organisation.id, partnerId: partner.id },
        body: { version: partner.version, archived },
      });
    } catch (caught) {
      setError(describeError(caught, t));
    }
    await queryClient.invalidateQueries({ queryKey: ['orgs', organisation.id, 'partners'] });
  }

  return (
    <>
      {error ? (
        <CardBody>
          <Alert tone="danger">{error}</Alert>
        </CardBody>
      ) : null}
      <div className="overflow-x-auto border-t border-mist-100">
        <table className="w-full text-left text-[13px]">
          <thead className="border-b border-mist-100 text-[12px] uppercase tracking-[0.04em] text-mist-500">
            <tr>
              <th className="px-5 py-2.5 font-medium">Partner</th>
              <th className="px-5 py-2.5 font-medium">Roles</th>
              <th className="px-5 py-2.5 font-medium">Phone</th>
              <th className="px-5 py-2.5 font-medium">Landing site</th>
              <th className="px-5 py-2.5 font-medium">Species</th>
              {canManage ? <th className="px-5 py-2.5" /> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-mist-100">
            {partners.map((partner) => (
              <tr key={partner.id}>
                <td className="px-5 py-3">
                  <p className="font-medium text-mist-900">
                    {partner.name}
                    {partner.archived ? <Badge className="ml-2">Archived</Badge> : null}
                  </p>
                  <p className="mt-0.5 text-[12px] text-mist-500">
                    {[
                      KIND_LABELS[partner.kind],
                      partner.productionType && PRODUCTION_LABELS[partner.productionType],
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </td>
                <td className="px-5 py-3">
                  <span className="flex flex-wrap gap-1">
                    {partner.roles.map((r) => (
                      <Badge key={r}>{ROLE_LABELS[r]}</Badge>
                    ))}
                  </span>
                </td>
                <td className="tabular whitespace-nowrap px-5 py-3 text-mist-700">
                  {partner.phone ?? '—'}
                </td>
                <td className="px-5 py-3 text-mist-700">{partner.landingSite ?? '—'}</td>
                <td className="px-5 py-3 text-mist-700">
                  {partner.speciesIds.length === 0
                    ? '—'
                    : partner.speciesIds.map(speciesName).join(', ')}
                </td>
                {canManage ? (
                  <td className="whitespace-nowrap px-5 py-3 text-right">
                    {partner.archived ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void setArchived(partner, false)}
                      >
                        Restore
                      </Button>
                    ) : (
                      <>
                        <Button variant="ghost" size="sm" onClick={() => onEdit(partner)}>
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void setArchived(partner, true)}
                        >
                          Archive
                        </Button>
                      </>
                    )}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function PartnerForm({
  partner,
  vocabulary,
  onDone,
}: {
  partner: TradingPartner | null;
  vocabulary: Vocabulary;
  onDone: () => void;
}) {
  const { organisation } = useMembership();
  const api = useApi();
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const dial = PHONE_COUNTRIES.find((c) => c.code === organisation.countryCode);
  const country: PhoneCountryCode = dial?.code ?? 'KE';

  const [kind, setKind] = useState<PartnerKind>(partner?.kind ?? 'individual');
  const [name, setName] = useState(partner?.name ?? '');
  const [phone, setPhone] = useState(partner?.phone ?? '');
  const [roles, setRoles] = useState<PartnerRole[]>(partner?.roles ?? ['supplier']);
  const [productionType, setProductionType] = useState<ProductionType | ''>(
    partner?.productionType ?? '',
  );
  const [landingSite, setLandingSite] = useState(partner?.landingSite ?? '');
  const [notes, setNotes] = useState(partner?.notes ?? '');
  const [speciesIds, setSpeciesIds] = useState<string[]>(partner?.speciesIds ?? []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const phoneE164 = phone.trim() ? toE164(country, phone) : null;
  const phoneInvalid = phone.trim() !== '' && phoneE164 === null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const text = (value: string) => value.trim() || null;
    try {
      if (partner) {
        await api.call(endpoints.partners.update, {
          params: { orgId: organisation.id, partnerId: partner.id },
          body: {
            version: partner.version,
            kind,
            name,
            phone: phoneE164,
            roles,
            productionType: productionType || null,
            landingSite: text(landingSite),
            notes: text(notes),
            speciesIds,
          },
        });
      } else {
        await api.call(endpoints.partners.create, {
          params: { orgId: organisation.id },
          body: {
            kind,
            name,
            roles,
            speciesIds,
            ...(phoneE164 ? { phone: phoneE164 } : {}),
            ...(productionType ? { productionType } : {}),
            ...(landingSite.trim() ? { landingSite } : {}),
            ...(notes.trim() ? { notes } : {}),
          },
        });
      }
      await queryClient.invalidateQueries({ queryKey: ['orgs', organisation.id, 'partners'] });
      onDone();
    } catch (caught) {
      setError(describeError(caught, t));
      // A stale version means someone else changed it: refresh the list behind the form.
      void queryClient.invalidateQueries({ queryKey: ['orgs', organisation.id, 'partners'] });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title={partner ? `Edit ${partner.name}` : 'Add a partner'}
        description="Keep it to what you need to trade: a name, a phone number and what they do."
      />
      <CardBody>
        <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Name" className="lg:col-span-2">
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={160} />
            </Field>
            <Field label="Type">
              <Select value={kind} onChange={(e) => setKind(e.target.value as PartnerKind)}>
                {PARTNER_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABELS[k]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Phone (optional)"
              hint={dial ? `e.g. 0${dial.example}` : undefined}
              error={phoneInvalid ? 'Enter a full phone number' : undefined}
            >
              <Input
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="tabular"
              />
            </Field>
            <Field label="Landing site or location (optional)" className="lg:col-span-2">
              <Input
                value={landingSite}
                onChange={(e) => setLandingSite(e.target.value)}
                maxLength={160}
              />
            </Field>
            <Field label="Fish source (optional)">
              <Select
                value={productionType}
                onChange={(e) => setProductionType(e.target.value as ProductionType | '')}
              >
                <option value="">Not recorded</option>
                {PRODUCTION_TYPES.map((p) => (
                  <option key={p} value={p}>
                    {PRODUCTION_LABELS[p]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Notes (optional)">
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
            </Field>
          </div>

          <fieldset>
            <legend className="text-[13px] font-medium text-mist-800">What they do</legend>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
              {PARTNER_ROLES.map((r) => (
                <label key={r} className="flex items-center gap-2 text-[13px] text-mist-800">
                  <input
                    type="checkbox"
                    checked={roles.includes(r)}
                    onChange={() => setRoles((current) => toggle(current, r))}
                  />
                  {ROLE_LABELS[r]}
                </label>
              ))}
            </div>
            {roles.length === 0 ? (
              <p className="mt-2 text-[13px] text-warning-700" role="status">
                Choose at least one.
              </p>
            ) : null}
          </fieldset>

          <fieldset>
            <legend className="text-[13px] font-medium text-mist-800">
              Species they trade (optional)
            </legend>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
              {vocabulary.species.map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-[13px] text-mist-800">
                  <input
                    type="checkbox"
                    checked={speciesIds.includes(s.id)}
                    onChange={() => setSpeciesIds((current) => toggle(current, s.id))}
                  />
                  {s.commonNameEn}
                </label>
              ))}
            </div>
          </fieldset>

          {error ? <Alert tone="danger">{error}</Alert> : null}
          <div className="flex gap-2">
            <Button
              type="submit"
              loading={busy}
              disabled={!name.trim() || roles.length === 0 || phoneInvalid}
            >
              {partner ? 'Save changes' : 'Add partner'}
            </Button>
            <Button type="button" variant="ghost" onClick={onDone}>
              Cancel
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
