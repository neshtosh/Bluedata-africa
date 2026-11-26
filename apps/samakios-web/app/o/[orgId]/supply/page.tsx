'use client';

import {
  endpoints,
  SUPPLY_ORIGINS,
  type CatalogueItem,
  type SupplyOrigin,
  type SupplyRecord,
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
  FolderTabs,
  IconPlus,
  IconProduction,
  Input,
  KpiTile,
  Select,
  Spinner,
} from '@blue/ui';
import { describeError, useApi, useI18n } from '@blue/web-shell';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useMemo, useState, type FormEvent } from 'react';
import { grouped, sumKg, todayLocal } from '../../../lib/numbers';
import { useMembership } from '../organisation-context';

type State = 'open' | 'closed' | 'all';

const ORIGIN_LABELS: Record<SupplyOrigin, string> = { wild: 'Wild-caught', farmed: 'Farmed' };

function statusBadge(record: SupplyRecord) {
  if (record.expired) return <Badge tone="warning">Expired</Badge>;
  switch (record.status) {
    case 'available':
      return <Badge tone="success">Available</Badge>;
    case 'reserved':
      return <Badge tone="accent">Reserved</Badge>;
    case 'purchased':
      return <Badge>Purchased</Badge>;
    case 'withdrawn':
      return <Badge>Withdrawn</Badge>;
  }
}

export default function SupplyPage() {
  const { organisation, permissions } = useMembership();
  const api = useApi();
  const { t } = useI18n();
  const canManage = permissions.includes('samakios.supply.manage');
  const canBuy = permissions.includes('samakios.purchases.manage');
  const orgId = organisation.id;

  const [state, setState] = useState<State>('open');
  const [catalogueItemId, setCatalogueItemId] = useState('');
  const [partnerId, setPartnerId] = useState('');
  const [origin, setOrigin] = useState<SupplyOrigin | ''>('');
  const [adding, setAdding] = useState(false);

  const vocabulary = useQuery({
    queryKey: ['ref', 'vocabulary'],
    queryFn: () => api.call(endpoints.ref.vocabulary),
    staleTime: 10 * 60_000,
  });
  const items = useQuery({
    queryKey: ['orgs', orgId, 'catalogue'],
    queryFn: () => api.call(endpoints.catalogue.list, { params: { orgId }, query: {} }),
  });
  const suppliers = useQuery({
    queryKey: ['orgs', orgId, 'partners', { role: 'supplier', includeArchived: true }],
    queryFn: () =>
      api.call(endpoints.partners.list, {
        params: { orgId },
        query: { role: 'supplier', includeArchived: 'true' },
      }),
  });
  const records = useQuery({
    queryKey: ['orgs', orgId, 'supply', { state, catalogueItemId, partnerId, origin }],
    queryFn: () =>
      api.call(endpoints.supply.list, {
        params: { orgId },
        query: {
          state,
          ...(catalogueItemId ? { catalogueItemId } : {}),
          ...(partnerId ? { partnerId } : {}),
          ...(origin ? { origin } : {}),
        },
      }),
    placeholderData: keepPreviousData,
  });

  const queries = [vocabulary, items, suppliers, records];
  if (queries.some((q) => q.isPending)) {
    return (
      <div className="flex justify-center py-16">
        <Spinner label={t('common.loading')} />
      </div>
    );
  }
  const failed = queries.find((q) => q.isError);
  if (failed || !vocabulary.data || !items.data || !suppliers.data || !records.data) {
    return <Alert tone="danger">{describeError(failed?.error, t)}</Alert>;
  }

  const activeSuppliers = suppliers.data.filter((p) => !p.archived);
  const activeItems = items.data.filter((i) => !i.archived);
  const missing =
    activeItems.length === 0 ? 'catalogue' : activeSuppliers.length === 0 ? 'partners' : null;

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-[-0.02em] text-mist-900">Supply</h1>
        <p className="mt-1 max-w-2xl text-sm text-mist-500">
          Fish your suppliers have now or expect soon, wild-caught or farmed. Reserve an offer while
          you arrange the purchase; withdraw it when it is no longer on offer.
        </p>
      </div>

      {canManage && missing ? (
        <Alert>
          {missing === 'catalogue' ? (
            <>
              Add the items you trade to the{' '}
              <Link className="font-medium underline" href={`/o/${orgId}/catalogue`}>
                catalogue
              </Link>{' '}
              before recording supply.
            </>
          ) : (
            <>
              Add at least one supplier under{' '}
              <Link className="font-medium underline" href={`/o/${orgId}/partners`}>
                Suppliers & buyers
              </Link>{' '}
              before recording supply.
            </>
          )}
        </Alert>
      ) : null}

      {adding ? (
        <SupplyForm
          suppliers={activeSuppliers}
          items={activeItems}
          vocabulary={vocabulary.data}
          currency={organisation.defaultCurrency}
          onDone={() => setAdding(false)}
        />
      ) : null}

      {state === 'open' ? <AvailableNow records={records.data} items={items.data} /> : null}

      <div>
        <FolderTabs
          label="Show"
          value={state}
          onChange={setState}
          options={[
            { value: 'open', label: 'Open' },
            { value: 'closed', label: 'Closed' },
            { value: 'all', label: 'All' },
          ]}
        />
        <Card className="rounded-tl-none">
          <CardBody className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-mist-100">
            <Field label="Item" layout="inline" className="w-full sm:w-[250px]">
              <Select value={catalogueItemId} onChange={(e) => setCatalogueItemId(e.target.value)}>
                <option value="">All items</option>
                {items.data.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Supplier" layout="inline" className="w-full sm:w-[240px]">
              <Select value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
                <option value="">All suppliers</option>
                {suppliers.data.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Origin" layout="inline" className="w-full sm:w-[240px]">
              <Select
                value={origin}
                onChange={(e) => setOrigin(e.target.value as SupplyOrigin | '')}
              >
                <option value="">Wild and farmed</option>
                {SUPPLY_ORIGINS.map((o) => (
                  <option key={o} value={o}>
                    {ORIGIN_LABELS[o]}
                  </option>
                ))}
              </Select>
            </Field>
            {canManage && !adding && !missing ? (
              <Button className="ml-auto" onClick={() => setAdding(true)}>
                <IconPlus className="size-4" />
                Record supply
              </Button>
            ) : null}
          </CardBody>
          {records.data.length === 0 ? (
            <EmptyState
              icon={<IconProduction />}
              title="No supply recorded"
              description="When a fisher, BMU or farm tells you what they have, record it here."
            />
          ) : (
            <SupplyTable
              records={records.data}
              items={items.data}
              suppliers={suppliers.data}
              vocabulary={vocabulary.data}
              canManage={canManage}
              canBuy={canBuy}
            />
          )}
        </Card>
      </div>
    </div>
  );
}

/** Open, unexpired kilograms per item: what can be bought right now. */
function AvailableNow({ records, items }: { records: SupplyRecord[]; items: CatalogueItem[] }) {
  const totals = useMemo(() => {
    const live = records.filter((r) => r.status === 'available' && !r.expired);
    const byItem = new Map<string, string[]>();
    for (const r of live)
      byItem.set(r.catalogueItemId, [...(byItem.get(r.catalogueItemId) ?? []), r.quantityKg]);
    return [...byItem.entries()]
      .map(([itemId, kgs]) => ({
        name: items.find((i) => i.id === itemId)?.name ?? 'Unknown item',
        kg: sumKg(kgs),
        offers: kgs.length,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [records, items]);

  if (totals.length === 0) return null;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {totals.map((total) => (
        <KpiTile
          key={total.name}
          label={total.name}
          value={grouped(total.kg)}
          unit="kg"
          footnote={`Available now · ${total.offers} ${total.offers === 1 ? 'offer' : 'offers'}`}
        />
      ))}
    </div>
  );
}

function SupplyTable({
  records,
  items,
  suppliers,
  vocabulary,
  canManage,
  canBuy,
}: {
  records: SupplyRecord[];
  items: CatalogueItem[];
  suppliers: TradingPartner[];
  vocabulary: Vocabulary;
  canManage: boolean;
  canBuy: boolean;
}) {
  const { organisation } = useMembership();
  const api = useApi();
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const itemName = (id: string) => items.find((i) => i.id === id)?.name ?? '—';
  const supplierName = (id: string) => suppliers.find((p) => p.id === id)?.name ?? '—';
  const unitName = (code: string) =>
    vocabulary.units.find((u) => u.code === code)?.name.toLowerCase() ?? code;

  async function setStatus(record: SupplyRecord, status: 'available' | 'reserved' | 'withdrawn') {
    setError(null);
    try {
      await api.call(endpoints.supply.update, {
        params: { orgId: organisation.id, supplyRecordId: record.id },
        body: { version: record.version, status },
      });
    } catch (caught) {
      setError(describeError(caught, t));
    }
    await queryClient.invalidateQueries({ queryKey: ['orgs', organisation.id, 'supply'] });
  }

  return (
    <>
      {error ? (
        <CardBody>
          <Alert tone="danger">{error}</Alert>
        </CardBody>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[13px]">
          <thead className="border-b border-mist-100 text-[12px] uppercase tracking-[0.04em] text-mist-500">
            <tr>
              <th className="px-5 py-2.5 font-medium">Item</th>
              <th className="px-5 py-2.5 font-medium">Supplier</th>
              <th className="px-5 py-2.5 text-right font-medium">Quantity</th>
              <th className="px-5 py-2.5 text-right font-medium">Asking price</th>
              <th className="px-5 py-2.5 font-medium">When</th>
              <th className="px-5 py-2.5 font-medium">Status</th>
              {canManage || canBuy ? <th className="px-5 py-2.5" /> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-mist-100">
            {records.map((record) => {
              const open = record.status === 'available' || record.status === 'reserved';
              return (
                <tr key={record.id}>
                  <td className="px-5 py-3">
                    <p className="font-medium text-mist-900">{itemName(record.catalogueItemId)}</p>
                    <p className="mt-0.5 text-[12px] text-mist-500">
                      {[ORIGIN_LABELS[record.origin], record.location].filter(Boolean).join(' · ')}
                    </p>
                  </td>
                  <td className="px-5 py-3 text-mist-700">{supplierName(record.partnerId)}</td>
                  <td className="tabular whitespace-nowrap px-5 py-3 text-right">
                    <p className="text-mist-900">
                      {grouped(record.quantity)} {unitName(record.unitCode)}
                    </p>
                    {record.unitCode === 'kg' ? null : (
                      <p className="text-[12px] text-mist-500">{grouped(record.quantityKg)} kg</p>
                    )}
                  </td>
                  <td className="tabular whitespace-nowrap px-5 py-3 text-right text-mist-700">
                    {record.askingPrice === null
                      ? '—'
                      : `${record.currency} ${grouped(record.askingPrice)} / ${unitName(record.unitCode)}`}
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 text-mist-700">
                    {record.availableUntil
                      ? `${record.availableFrom} to ${record.availableUntil}`
                      : `From ${record.availableFrom}`}
                  </td>
                  <td className="px-5 py-3">{statusBadge(record)}</td>
                  {canManage || canBuy ? (
                    <td className="space-x-2 whitespace-nowrap px-5 py-3 text-right">
                      {canManage && record.status === 'available' && !record.expired ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => void setStatus(record, 'reserved')}
                        >
                          Reserve
                        </Button>
                      ) : null}
                      {canManage && record.status === 'reserved' ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => void setStatus(record, 'available')}
                        >
                          Release
                        </Button>
                      ) : null}
                      {open && canBuy && !record.expired ? (
                        <Button size="sm" asChild>
                          <Link href={`/o/${organisation.id}/purchases?offer=${record.id}`}>
                            Buy
                          </Link>
                        </Button>
                      ) : null}
                      {open && canManage ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => void setStatus(record, 'withdrawn')}
                        >
                          Withdraw
                        </Button>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function SupplyForm({
  suppliers,
  items,
  vocabulary,
  currency,
  onDone,
}: {
  suppliers: TradingPartner[];
  items: CatalogueItem[];
  vocabulary: Vocabulary;
  currency: string;
  onDone: () => void;
}) {
  const { organisation } = useMembership();
  const api = useApi();
  const queryClient = useQueryClient();
  const { t } = useI18n();

  const [partnerId, setPartnerId] = useState(suppliers[0]?.id ?? '');
  const [catalogueItemId, setCatalogueItemId] = useState(items[0]?.id ?? '');
  const [quantity, setQuantity] = useState('');
  const [unitCode, setUnitCode] = useState(items[0]?.defaultUnitCode ?? 'kg');
  const [origin, setOrigin] = useState<SupplyOrigin | ''>('');
  const [availableFrom, setAvailableFrom] = useState(todayLocal());
  const [availableUntil, setAvailableUntil] = useState('');
  const [askingPrice, setAskingPrice] = useState('');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const supplier = suppliers.find((p) => p.id === partnerId);
  const item = items.find((i) => i.id === catalogueItemId);
  const supplierOrigin =
    supplier?.productionType === 'wild' || supplier?.productionType === 'farmed'
      ? supplier.productionType
      : null;
  // Units this item can be recorded in: fixed mass units, plus containers with a recorded weight.
  const usableUnits = vocabulary.units.filter(
    (u) => u.dimension === 'mass' || item?.units.some((w) => w.unitCode === u.code),
  );
  const unitWord =
    vocabulary.units.find((u) => u.code === unitCode)?.name.toLowerCase() ?? unitCode;

  function chooseItem(id: string) {
    setCatalogueItemId(id);
    setUnitCode(items.find((i) => i.id === id)?.defaultUnitCode ?? 'kg');
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      await api.call(endpoints.supply.create, {
        params: { orgId: organisation.id },
        body: {
          partnerId,
          catalogueItemId,
          quantity: quantity.trim(),
          unitCode,
          availableFrom,
          ...(origin ? { origin } : {}),
          ...(availableUntil ? { availableUntil } : {}),
          ...(askingPrice.trim() ? { askingPrice: askingPrice.trim().replace(/,/g, '') } : {}),
          ...(location.trim() ? { location } : {}),
          ...(notes.trim() ? { notes } : {}),
        },
      });
      await queryClient.invalidateQueries({ queryKey: ['orgs', organisation.id, 'supply'] });
      onDone();
    } catch (caught) {
      const issues =
        caught && typeof caught === 'object' && 'issues' in caught && Array.isArray(caught.issues)
          ? (caught.issues as { path: (string | number)[]; message: string }[])
          : null;
      if (issues)
        setFieldErrors(Object.fromEntries(issues.map((i) => [i.path.join('.'), i.message])));
      setError(describeError(caught, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Record supply"
        description="What a supplier has or expects to have. Quantities are converted to kilograms with your catalogue weights."
      />
      <CardBody>
        <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Supplier" error={fieldErrors.partnerId}>
              <Select value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
                {suppliers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Item" error={fieldErrors.catalogueItemId}>
              <Select value={catalogueItemId} onChange={(e) => chooseItem(e.target.value)}>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Quantity" error={fieldErrors.quantity}>
              <Input
                inputMode="decimal"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="tabular"
              />
            </Field>
            <Field label="Unit" error={fieldErrors.unitCode}>
              <Select value={unitCode} onChange={(e) => setUnitCode(e.target.value)}>
                {usableUnits.map((u) => (
                  <option key={u.code} value={u.code}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Available from" error={fieldErrors.availableFrom}>
              <Input
                type="date"
                value={availableFrom}
                onChange={(e) => setAvailableFrom(e.target.value)}
              />
            </Field>
            <Field label="Until (optional)" error={fieldErrors.availableUntil}>
              <Input
                type="date"
                value={availableUntil}
                min={availableFrom}
                onChange={(e) => setAvailableUntil(e.target.value)}
              />
            </Field>
            <Field
              label={`Asking price per ${unitWord} (${currency}, optional)`}
              error={fieldErrors.askingPrice}
            >
              <Input
                inputMode="decimal"
                value={askingPrice}
                onChange={(e) => setAskingPrice(e.target.value)}
                className="tabular"
              />
            </Field>
            <Field label="Origin" error={fieldErrors.origin}>
              <Select
                value={origin}
                onChange={(e) => setOrigin(e.target.value as SupplyOrigin | '')}
              >
                <option value="">
                  {supplierOrigin
                    ? `As the supplier (${ORIGIN_LABELS[supplierOrigin].toLowerCase()})`
                    : 'Choose…'}
                </option>
                {SUPPLY_ORIGINS.map((o) => (
                  <option key={o} value={o}>
                    {ORIGIN_LABELS[o]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Location (optional)" className="lg:col-span-2">
              <Input
                value={location}
                placeholder={supplier?.landingSite ?? 'Landing site or farm'}
                onChange={(e) => setLocation(e.target.value)}
                maxLength={160}
              />
            </Field>
            <Field label="Notes (optional)" className="lg:col-span-2">
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
            </Field>
          </div>
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <div className="flex gap-2">
            <Button
              type="submit"
              loading={busy}
              disabled={
                !partnerId || !catalogueItemId || !quantity.trim() || (!origin && !supplierOrigin)
              }
            >
              Record supply
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
