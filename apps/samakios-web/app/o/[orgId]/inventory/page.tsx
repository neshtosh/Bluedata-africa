'use client';

import { endpoints } from '@blue/contracts';
import {
  Alert,
  Badge,
  Card,
  CardBody,
  EmptyState,
  Field,
  FolderTabs,
  IconInventory,
  KpiTile,
  Select,
  Spinner,
} from '@blue/ui';
import { describeError, useApi, useI18n } from '@blue/web-shell';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { grouped } from '../../../lib/numbers';
import { useMembership } from '../organisation-context';

type Tab = 'in-stock' | 'all';

export default function InventoryPage() {
  const { organisation, permissions } = useMembership();
  const api = useApi();
  const { t } = useI18n();
  const orgId = organisation.id;
  const [tab, setTab] = useState<Tab>('in-stock');
  const [catalogueItemId, setCatalogueItemId] = useState('');

  const summary = useQuery({
    queryKey: ['orgs', orgId, 'inventory', 'summary'],
    queryFn: () => api.call(endpoints.inventory.summary, { params: { orgId } }),
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
  const batches = useQuery({
    queryKey: ['orgs', orgId, 'inventory', 'batches', { tab, catalogueItemId }],
    queryFn: () =>
      api.call(endpoints.inventory.batches, {
        params: { orgId },
        query: {
          inStock: tab === 'in-stock' ? 'true' : 'false',
          ...(catalogueItemId ? { catalogueItemId } : {}),
        },
      }),
    placeholderData: keepPreviousData,
  });

  const queries = [summary, items, suppliers, batches];
  if (queries.some((q) => q.isPending)) {
    return (
      <div className="flex justify-center py-16">
        <Spinner label={t('common.loading')} />
      </div>
    );
  }
  const failed = queries.find((q) => q.isError);
  if (failed || !summary.data || !items.data || !suppliers.data || !batches.data) {
    return <Alert tone="danger">{describeError(failed?.error, t)}</Alert>;
  }

  const itemName = (id: string) => items.data.find((i) => i.id === id)?.name ?? '—';
  const supplierName = (id: string | null) => suppliers.data.find((p) => p.id === id)?.name ?? '—';
  const empty = summary.data.items.length === 0;
  const currency = summary.data.currency;

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-[-0.02em] text-mist-900">Inventory</h1>
        <p className="mt-1 max-w-2xl text-sm text-mist-500">
          Stock on hand by batch: what came in, from whom, when it was caught or harvested, and what
          it cost. Every change is kept in a ledger that can&apos;t be edited.
        </p>
      </div>

      <section aria-label="Stock figures" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiTile
          label="Stock on hand"
          value={empty ? null : grouped(summary.data.onHandKg)}
          unit="kg"
          footnote={
            empty
              ? 'Nothing in stock'
              : `${summary.data.items.length} ${summary.data.items.length === 1 ? 'item' : 'items'}`
          }
        />
        <KpiTile
          label="Stock at cost"
          value={empty ? null : grouped(summary.data.onHandCost)}
          unit={currency}
          footnote="What you paid for the stock left"
        />
        <KpiTile
          label="Purchases · 7 days"
          value={
            summary.data.purchasesLast7Days.count === 0
              ? null
              : grouped(summary.data.purchasesLast7Days.total)
          }
          unit={currency}
          footnote={`${summary.data.purchasesLast7Days.count} received`}
        />
        <KpiTile
          label="Batches in stock"
          value={empty ? null : String(summary.data.items.reduce((n, i) => n + i.batches, 0))}
          footnote="Each purchase line is a batch"
        />
      </section>

      <div>
        <FolderTabs
          label="Show"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'in-stock', label: 'In stock' },
            { value: 'all', label: 'All batches' },
          ]}
        />
        <Card className="rounded-tl-none">
          <CardBody className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-mist-100">
            <Field label="Item" layout="inline" className="w-full sm:w-[300px]">
              <Select value={catalogueItemId} onChange={(e) => setCatalogueItemId(e.target.value)}>
                <option value="">All items</option>
                {items.data.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </Select>
            </Field>
            {permissions.includes('samakios.purchases.manage') ? (
              <Link
                href={`/o/${orgId}/purchases`}
                className="ml-auto text-[13px] font-semibold text-accent hover:underline"
              >
                Record a purchase to add stock →
              </Link>
            ) : null}
          </CardBody>
          {batches.data.length === 0 ? (
            <EmptyState
              icon={<IconInventory />}
              title="No stock"
              description="Stock appears here when a purchase is received."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead className="border-b border-mist-100 text-[12px] uppercase tracking-[0.04em] text-mist-500">
                  <tr>
                    <th className="px-5 py-2.5 font-medium">Batch</th>
                    <th className="px-5 py-2.5 font-medium">Item</th>
                    <th className="px-5 py-2.5 font-medium">Supplier</th>
                    <th className="px-5 py-2.5 font-medium">Caught / received</th>
                    <th className="px-5 py-2.5 text-right font-medium">On hand</th>
                    <th className="px-5 py-2.5 text-right font-medium">Cost per kg</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-mist-100">
                  {batches.data.map((batch) => (
                    <tr key={batch.id}>
                      <td className="whitespace-nowrap px-5 py-3">
                        <p className="font-medium text-mist-900">{batch.number}</p>
                        <p className="mt-0.5 text-[12px] text-mist-500">
                          {batch.purchase ? batch.purchase.number : 'No purchase'}
                        </p>
                      </td>
                      <td className="px-5 py-3">
                        <p className="text-mist-900">{itemName(batch.catalogueItemId)}</p>
                        <Badge className="mt-1">
                          {batch.origin === 'wild' ? 'Wild-caught' : 'Farmed'}
                        </Badge>
                      </td>
                      <td className="px-5 py-3 text-mist-700">
                        {supplierName(batch.supplierPartnerId)}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-mist-700">
                        <p>{batch.catchOrHarvestDate}</p>
                        <p className="text-[12px] text-mist-500">in {batch.receivedOn}</p>
                      </td>
                      <td className="tabular whitespace-nowrap px-5 py-3 text-right">
                        <p className="font-medium text-mist-900">
                          {grouped(batch.quantityKgOnHand)} kg
                        </p>
                        <p className="text-[12px] text-mist-500">
                          of {grouped(batch.quantityKgReceived)} kg
                        </p>
                      </td>
                      <td className="tabular whitespace-nowrap px-5 py-3 text-right text-mist-700">
                        {batch.currency} {grouped(batch.costPerKg)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
