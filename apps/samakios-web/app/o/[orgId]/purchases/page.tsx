'use client';

import {
  endpoints,
  type CatalogueItem,
  type Purchase,
  type PurchaseStatus,
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
  IconPurchases,
  Input,
  Select,
  Spinner,
} from '@blue/ui';
import { describeError, useApi, useI18n } from '@blue/web-shell';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState, type FormEvent } from 'react';
import {
  fromScaled,
  grouped,
  minorUnits,
  previewLineTotal,
  todayLocal,
} from '../../../lib/numbers';
import { useMembership } from '../organisation-context';

type Tab = PurchaseStatus | 'all';

const STATUS_BADGE: Record<
  PurchaseStatus,
  { tone: 'success' | 'accent' | 'neutral'; label: string }
> = {
  confirmed: { tone: 'success', label: 'Received' },
  draft: { tone: 'accent', label: 'Draft' },
  cancelled: { tone: 'neutral', label: 'Cancelled' },
};

export default function PurchasesPage() {
  // useSearchParams needs a Suspense boundary in the App Router.
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      }
    >
      <Purchases />
    </Suspense>
  );
}

function Purchases() {
  const { organisation, permissions } = useMembership();
  const api = useApi();
  const { t } = useI18n();
  const orgId = organisation.id;
  const canManage = permissions.includes('samakios.purchases.manage');
  const offerId = useSearchParams().get('offer');
  const router = useRouter();
  const pathname = usePathname();

  const [tab, setTab] = useState<Tab>('confirmed');
  const [partnerId, setPartnerId] = useState('');
  const [adding, setAdding] = useState(Boolean(offerId) && canManage);

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
  const offers = useQuery({
    queryKey: ['orgs', orgId, 'supply', { state: 'open' }],
    queryFn: () => api.call(endpoints.supply.list, { params: { orgId }, query: { state: 'open' } }),
    enabled: canManage,
  });
  const list = useQuery({
    queryKey: ['orgs', orgId, 'purchases', { tab, partnerId }],
    queryFn: () =>
      api.call(endpoints.purchases.list, {
        params: { orgId },
        query: { ...(tab === 'all' ? {} : { status: tab }), ...(partnerId ? { partnerId } : {}) },
      }),
    placeholderData: keepPreviousData,
  });

  const queries = [vocabulary, items, suppliers, list];
  if (queries.some((q) => q.isPending) || (canManage && offers.isPending)) {
    return (
      <div className="flex justify-center py-16">
        <Spinner label={t('common.loading')} />
      </div>
    );
  }
  const failed = [...queries, offers].find((q) => q.isError);
  if (failed || !vocabulary.data || !items.data || !suppliers.data || !list.data) {
    return <Alert tone="danger">{describeError(failed?.error, t)}</Alert>;
  }

  const activeSuppliers = suppliers.data.filter((p) => !p.archived);
  const activeItems = items.data.filter((i) => !i.archived);
  const ready = activeSuppliers.length > 0 && activeItems.length > 0;

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-[-0.02em] text-mist-900">Purchases</h1>
        <p className="mt-1 max-w-2xl text-sm text-mist-500">
          What you bought, from whom, and for how much. A spot purchase goes straight into stock as
          a batch; a planned purchase waits as a draft until the fish arrives.
        </p>
      </div>

      {canManage && !ready ? (
        <Alert>
          Before recording purchases, add your items to the{' '}
          <Link className="font-medium underline" href={`/o/${orgId}/catalogue`}>
            catalogue
          </Link>{' '}
          and at least one supplier under{' '}
          <Link className="font-medium underline" href={`/o/${orgId}/partners`}>
            Suppliers & buyers
          </Link>
          .
        </Alert>
      ) : null}

      {adding && ready ? (
        <PurchaseForm
          suppliers={activeSuppliers}
          items={activeItems}
          offers={offers.data ?? []}
          initialOfferId={offerId}
          vocabulary={vocabulary.data}
          currency={organisation.defaultCurrency}
          onDone={(saved) => {
            setAdding(false);
            if (saved) setTab(saved.status);
            // The offer link has done its job; don't reopen the form on reload.
            if (offerId) router.replace(pathname);
          }}
        />
      ) : null}

      <div>
        <FolderTabs
          label="Show"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'confirmed', label: 'Received' },
            { value: 'draft', label: 'Drafts' },
            { value: 'cancelled', label: 'Cancelled' },
            { value: 'all', label: 'All' },
          ]}
        />
        <Card className="rounded-tl-none">
          <CardBody className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-mist-100">
            <Field label="Supplier" layout="inline" className="w-full sm:w-[280px]">
              <Select value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
                <option value="">All suppliers</option>
                {suppliers.data.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            {canManage && ready && !adding ? (
              <Button className="ml-auto" onClick={() => setAdding(true)}>
                <IconPlus className="size-4" />
                Record purchase
              </Button>
            ) : null}
          </CardBody>
          {list.data.length === 0 ? (
            <EmptyState
              icon={<IconPurchases />}
              title={tab === 'draft' ? 'No drafts' : 'No purchases yet'}
              description="Record what you buy at the landing site; it goes straight into stock."
            />
          ) : (
            <PurchasesTable
              purchases={list.data}
              items={items.data}
              suppliers={suppliers.data}
              vocabulary={vocabulary.data}
              canManage={canManage}
            />
          )}
        </Card>
      </div>
    </div>
  );
}

function PurchasesTable({
  purchases,
  items,
  suppliers,
  vocabulary,
  canManage,
}: {
  purchases: Purchase[];
  items: CatalogueItem[];
  suppliers: TradingPartner[];
  vocabulary: Vocabulary;
  canManage: boolean;
}) {
  const { organisation } = useMembership();
  const api = useApi();
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const itemName = (id: string) => items.find((i) => i.id === id)?.name ?? '—';
  const unitName = (code: string) =>
    vocabulary.units.find((u) => u.code === code)?.name.toLowerCase() ?? code;

  async function act(purchase: Purchase, action: 'confirm' | 'cancel') {
    setError(null);
    try {
      await api.call(endpoints.purchases[action], {
        params: { orgId: organisation.id, purchaseId: purchase.id },
        body: { version: purchase.version },
      });
    } catch (caught) {
      setError(describeError(caught, t));
    }
    await Promise.all(
      ['purchases', 'inventory', 'supply'].map((key) =>
        queryClient.invalidateQueries({ queryKey: ['orgs', organisation.id, key] }),
      ),
    );
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
              <th className="px-5 py-2.5 font-medium">Purchase</th>
              <th className="px-5 py-2.5 font-medium">Supplier</th>
              <th className="px-5 py-2.5 font-medium">What</th>
              <th className="px-5 py-2.5 text-right font-medium">Weight</th>
              <th className="px-5 py-2.5 text-right font-medium">Total</th>
              <th className="px-5 py-2.5 font-medium">Status</th>
              {canManage ? <th className="px-5 py-2.5" /> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-mist-100">
            {purchases.map((purchase) => (
              <tr key={purchase.id} className="align-top">
                <td className="whitespace-nowrap px-5 py-3">
                  <p className="font-medium text-mist-900">{purchase.number}</p>
                  <p className="mt-0.5 text-[12px] text-mist-500">{purchase.purchaseDate}</p>
                </td>
                <td className="px-5 py-3 text-mist-700">
                  {suppliers.find((p) => p.id === purchase.partnerId)?.name ?? '—'}
                </td>
                <td className="px-5 py-3 text-mist-700">
                  <ul className="flex flex-col gap-0.5">
                    {purchase.lines.map((line) => (
                      <li key={line.id}>
                        {itemName(line.catalogueItemId)} ·{' '}
                        <span className="tabular">
                          {grouped(line.quantity)} {unitName(line.unitCode)}
                        </span>
                        {line.batch ? (
                          <span className="text-[12px] text-mist-500"> · {line.batch.number}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </td>
                <td className="tabular whitespace-nowrap px-5 py-3 text-right text-mist-700">
                  {grouped(purchase.totalKg)} kg
                </td>
                <td className="tabular whitespace-nowrap px-5 py-3 text-right font-medium text-mist-900">
                  {purchase.currency} {grouped(purchase.total)}
                </td>
                <td className="px-5 py-3">
                  <Badge tone={STATUS_BADGE[purchase.status].tone}>
                    {STATUS_BADGE[purchase.status].label}
                  </Badge>
                </td>
                {canManage ? (
                  <td className="space-x-2 whitespace-nowrap px-5 py-3 text-right">
                    {purchase.status === 'draft' ? (
                      <>
                        <Button size="sm" onClick={() => void act(purchase, 'confirm')}>
                          Receive
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => void act(purchase, 'cancel')}
                        >
                          Cancel
                        </Button>
                      </>
                    ) : null}
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

interface DraftLine {
  key: number;
  catalogueItemId: string;
  quantity: string;
  unitCode: string;
  unitPrice: string;
  supplyRecordId: string;
}

function PurchaseForm({
  suppliers,
  items,
  offers,
  initialOfferId,
  vocabulary,
  currency,
  onDone,
}: {
  suppliers: TradingPartner[];
  items: CatalogueItem[];
  offers: SupplyRecord[];
  initialOfferId: string | null;
  vocabulary: Vocabulary;
  currency: string;
  onDone: (saved: Purchase | null) => void;
}) {
  const { organisation } = useMembership();
  const api = useApi();
  const queryClient = useQueryClient();
  const { t } = useI18n();

  const startOffer = offers.find((o) => o.id === initialOfferId && !o.expired);
  const lineFor = (key: number, item: CatalogueItem | undefined): DraftLine => ({
    key,
    catalogueItemId: item?.id ?? '',
    quantity: '',
    unitCode: item?.defaultUnitCode ?? 'kg',
    unitPrice: '',
    supplyRecordId: '',
  });
  const [partnerId, setPartnerId] = useState(startOffer?.partnerId ?? suppliers[0]?.id ?? '');
  const [purchaseDate, setPurchaseDate] = useState(todayLocal());
  const [receiveNow, setReceiveNow] = useState(true);
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DraftLine[]>(() =>
    startOffer
      ? [
          {
            key: 0,
            catalogueItemId: startOffer.catalogueItemId,
            quantity: startOffer.quantity,
            unitCode: startOffer.unitCode,
            unitPrice: startOffer.askingPrice ?? '',
            supplyRecordId: startOffer.id,
          },
        ]
      : [lineFor(0, items[0])],
  );
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const scale = minorUnits(currency);
  const totals = useMemo(() => {
    let money = 0n;
    for (const line of lines)
      money += previewLineTotal(line.quantity, line.unitPrice, currency) ?? 0n;
    return { money: fromScaled(money, scale) };
  }, [lines, currency, scale]);

  const update = (key: number, patch: Partial<DraftLine>) =>
    setLines((current) => current.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const unitsFor = (itemId: string) => {
    const item = items.find((i) => i.id === itemId);
    return vocabulary.units.filter(
      (u) => u.dimension === 'mass' || item?.units.some((w) => w.unitCode === u.code),
    );
  };
  const offersFor = (itemId: string) =>
    offers.filter((o) => o.partnerId === partnerId && o.catalogueItemId === itemId && !o.expired);
  const unitWord = (code: string) =>
    vocabulary.units.find((u) => u.code === code)?.name.toLowerCase() ?? code;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const saved = await api.call(endpoints.purchases.create, {
        params: { orgId: organisation.id },
        body: {
          partnerId,
          purchaseDate,
          receiveNow,
          ...(notes.trim() ? { notes } : {}),
          lines: lines.map((line) => ({
            catalogueItemId: line.catalogueItemId,
            quantity: line.quantity.trim().replace(/,/g, ''),
            unitCode: line.unitCode,
            unitPrice: line.unitPrice.trim().replace(/,/g, ''),
            ...(line.supplyRecordId ? { supplyRecordId: line.supplyRecordId } : {}),
          })),
        },
      });
      await Promise.all(
        ['purchases', 'inventory', 'supply'].map((key) =>
          queryClient.invalidateQueries({ queryKey: ['orgs', organisation.id, key] }),
        ),
      );
      onDone(saved);
    } catch (caught) {
      const issues =
        caught && typeof caught === 'object' && 'issues' in caught && Array.isArray(caught.issues)
          ? (caught.issues as { path: (string | number)[]; message: string }[])
          : null;
      if (issues) {
        setFieldErrors(Object.fromEntries(issues.map((i) => [i.path.join('.'), i.message])));
      }
      setError(describeError(caught, t));
    } finally {
      setBusy(false);
    }
  }

  const incomplete = lines.some(
    (l) => !l.catalogueItemId || !l.quantity.trim() || !l.unitPrice.trim(),
  );

  return (
    <Card>
      <CardHeader
        title="Record a purchase"
        description="Weights are converted to kilograms with your catalogue weights; totals are exact."
      />
      <CardBody>
        <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Supplier" error={fieldErrors.partnerId}>
              <Select
                value={partnerId}
                onChange={(e) => {
                  setPartnerId(e.target.value);
                  setLines((current) => current.map((l) => ({ ...l, supplyRecordId: '' })));
                }}
              >
                {suppliers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Purchase date" error={fieldErrors.purchaseDate}>
              <Input
                type="date"
                value={purchaseDate}
                onChange={(e) => setPurchaseDate(e.target.value)}
              />
            </Field>
            <Field label="Notes (optional)" className="lg:col-span-2">
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
            </Field>
          </div>

          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 text-[13px] font-semibold text-mist-800">
              What you bought
            </legend>
            {lines.map((line, index) => {
              const path = `lines.${index}`;
              const lineTotal = previewLineTotal(line.quantity, line.unitPrice, currency);
              const lineOffers = offersFor(line.catalogueItemId);
              return (
                <div
                  key={line.key}
                  className="grid gap-3 rounded-xl bg-mist-50 p-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1.2fr_1.6fr_auto] lg:items-end"
                >
                  <Field label="Item" error={fieldErrors[`${path}.catalogueItemId`]}>
                    <Select
                      value={line.catalogueItemId}
                      onChange={(e) => {
                        const item = items.find((i) => i.id === e.target.value);
                        update(line.key, {
                          catalogueItemId: e.target.value,
                          unitCode: item?.defaultUnitCode ?? 'kg',
                          supplyRecordId: '',
                        });
                      }}
                    >
                      {items.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Quantity" error={fieldErrors[`${path}.quantity`]}>
                    <Input
                      inputMode="decimal"
                      value={line.quantity}
                      onChange={(e) => update(line.key, { quantity: e.target.value })}
                      className="tabular"
                    />
                  </Field>
                  <Field label="Unit" error={fieldErrors[`${path}.unitCode`]}>
                    <Select
                      value={line.unitCode}
                      onChange={(e) => update(line.key, { unitCode: e.target.value })}
                    >
                      {unitsFor(line.catalogueItemId).map((u) => (
                        <option key={u.code} value={u.code}>
                          {u.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field
                    label={`Price per ${unitWord(line.unitCode)} (${currency})`}
                    error={fieldErrors[`${path}.unitPrice`]}
                  >
                    <Input
                      inputMode="decimal"
                      value={line.unitPrice}
                      onChange={(e) => update(line.key, { unitPrice: e.target.value })}
                      className="tabular"
                    />
                  </Field>
                  <Field
                    label="From an offer (optional)"
                    error={fieldErrors[`${path}.supplyRecordId`]}
                  >
                    <Select
                      value={line.supplyRecordId}
                      onChange={(e) => {
                        const offer = lineOffers.find((o) => o.id === e.target.value);
                        update(
                          line.key,
                          offer
                            ? {
                                supplyRecordId: offer.id,
                                quantity: line.quantity || offer.quantity,
                                unitCode: offer.unitCode,
                                unitPrice: line.unitPrice || (offer.askingPrice ?? ''),
                              }
                            : { supplyRecordId: '' },
                        );
                      }}
                    >
                      <option value="">{lineOffers.length ? 'None' : 'No open offers'}</option>
                      {lineOffers.map((o) => (
                        <option key={o.id} value={o.id}>
                          {grouped(o.quantity)} {unitWord(o.unitCode)} · from {o.availableFrom}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <div className="flex items-center justify-between gap-3 lg:h-10 lg:justify-end">
                    <span className="tabular text-[13px] font-semibold text-mist-900">
                      {lineTotal === null
                        ? '—'
                        : `${currency} ${grouped(fromScaled(lineTotal, scale))}`}
                    </span>
                    {lines.length > 1 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setLines((current) => current.filter((l) => l.key !== line.key))
                        }
                      >
                        Remove
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
            <div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() =>
                  setLines((current) => [
                    ...current,
                    lineFor(Math.max(...current.map((l) => l.key)) + 1, items[0]),
                  ])
                }
              >
                <IconPlus className="size-4" />
                Add line
              </Button>
            </div>
          </fieldset>

          <label className="flex items-start gap-2.5 text-[13px] text-mist-800">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={receiveNow}
              onChange={(e) => setReceiveNow(e.target.checked)}
            />
            <span>
              <span className="font-medium">Received now</span>
              <span className="block text-mist-500">
                Untick to save a planned purchase as a draft and receive it when the fish arrives.
              </span>
            </span>
          </label>

          {error ? <Alert tone="danger">{error}</Alert> : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" loading={busy} disabled={!partnerId || incomplete}>
              {receiveNow ? 'Record purchase' : 'Save draft'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => onDone(null)}>
              Cancel
            </Button>
            <span className="tabular ml-auto text-[15px] font-bold text-mist-900">
              Total {currency} {grouped(totals.money)}
            </span>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
