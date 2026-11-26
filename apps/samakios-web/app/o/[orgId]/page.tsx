'use client';

import {
  ActionCard,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  IconInventory,
  IconPurchases,
  KpiTile,
} from '@blue/ui';
import { endpoints } from '@blue/contracts';
import { useApi } from '@blue/web-shell';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { grouped } from '../../lib/numbers';
import { useMembership } from './organisation-context';

const NEXT_STEPS = [
  {
    title: 'Sell and get paid',
    detail: 'Sales from batches, invoices, mobile-money references and balances.',
  },
  {
    title: 'Payments, advances and expenses',
    detail: 'What you owe suppliers, what buyers owe you, and your margins.',
  },
  {
    title: 'Record purchases offline',
    detail: 'Capture spot purchases at the landing site without a connection.',
  },
];

/**
 * Operational overview. Figures come from the organisation's own records; anything not
 * recorded yet is an explicit "no data yet", never a placeholder number.
 */
export default function DashboardPage() {
  const { organisation, roles, permissions } = useMembership();
  const api = useApi();
  const currency = organisation.defaultCurrency;
  const base = `/o/${organisation.id}`;
  const stock = useQuery({
    queryKey: ['orgs', organisation.id, 'inventory', 'summary'],
    queryFn: () => api.call(endpoints.inventory.summary, { params: { orgId: organisation.id } }),
    enabled: permissions.includes('samakios.inventory.read'),
  });
  const recent = useQuery({
    queryKey: ['orgs', organisation.id, 'purchases', { recent: true }],
    queryFn: () =>
      api.call(endpoints.purchases.list, { params: { orgId: organisation.id }, query: {} }),
    enabled: permissions.includes('samakios.purchases.read'),
  });
  const items = useQuery({
    queryKey: ['orgs', organisation.id, 'catalogue'],
    queryFn: () =>
      api.call(endpoints.catalogue.list, { params: { orgId: organisation.id }, query: {} }),
  });
  const itemName = (id: string) => items.data?.find((i) => i.id === id)?.name ?? '—';
  const hasStock = Boolean(stock.data && stock.data.items.length > 0);
  const week = stock.data?.purchasesLast7Days;

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[13px] text-mist-500">Welcome to</p>
          <h1 className="text-2xl font-bold tracking-[-0.02em] text-mist-900">
            {organisation.tradingName ?? organisation.legalName}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Badge>{organisation.countryCode}</Badge>
          <Badge>{currency}</Badge>
          {roles.map((role) => (
            <Badge key={role} tone="accent">
              {role}
            </Badge>
          ))}
        </div>
      </div>

      <section aria-label="Main actions" className="grid gap-5 md:grid-cols-3">
        <ActionCard
          tone="blue"
          art="waves"
          title="Purchases"
          description="Record what you buy at the landing site; it goes straight into stock."
          action={
            <Button variant="onColor" size="sm" asChild>
              <Link href={`${base}/purchases`}>Record purchase</Link>
            </Button>
          }
        />
        <ActionCard
          tone="cyan"
          art="layers"
          title="Supply"
          description="Fish your suppliers have now or expect soon."
          action={
            <Button variant="onColor" size="sm" asChild>
              <Link href={`${base}/supply`}>See offers</Link>
            </Button>
          }
        />
        <ActionCard
          tone="green"
          art="stack"
          title="Inventory"
          description="Stock on hand by batch, with its origin and cost."
          action={
            <Button variant="onColor" size="sm" asChild>
              <Link href={`${base}/inventory`}>Open</Link>
            </Button>
          }
        />
      </section>

      <section aria-label="Key figures" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile
          label="Stock on hand"
          value={hasStock && stock.data ? grouped(stock.data.onHandKg) : null}
          unit="kg"
          footnote={
            hasStock && stock.data
              ? `Cost ${currency} ${grouped(stock.data.onHandCost)}`
              : 'No stock received yet'
          }
        />
        <KpiTile
          label="Purchases · 7 days"
          value={week && week.count > 0 ? grouped(week.total) : null}
          unit={currency}
          footnote={week && week.count > 0 ? `${week.count} received` : 'No purchases this week'}
        />
        <KpiTile
          label="Sales · 7 days"
          value={null}
          unit={currency}
          footnote="No sales recorded yet"
        />
        <KpiTile label="Owed to you" value={null} unit={currency} footnote="No invoices yet" />
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <CardHeader
            title="Recent purchases"
            description="The latest purchases, received or planned."
            actions={
              <Link
                href={`${base}/purchases`}
                className="text-[13px] font-semibold text-accent hover:underline"
              >
                All purchases
              </Link>
            }
          />
          {recent.data && recent.data.length > 0 ? (
            <ul className="divide-y divide-mist-100">
              {recent.data.slice(0, 5).map((purchase) => (
                <li key={purchase.id} className="flex items-center gap-4 px-6 py-3 text-[13px]">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-mist-900">{purchase.number}</p>
                    <p className="truncate text-[12px] text-mist-500">
                      {purchase.purchaseDate} ·{' '}
                      {purchase.lines.map((l) => itemName(l.catalogueItemId)).join(', ')}
                    </p>
                  </div>
                  <span className="tabular text-mist-700">{grouped(purchase.totalKg)} kg</span>
                  <span className="tabular w-32 text-right font-medium text-mist-900">
                    {purchase.currency} {grouped(purchase.total)}
                  </span>
                  <Badge tone={purchase.status === 'confirmed' ? 'success' : 'neutral'}>
                    {purchase.status === 'confirmed' ? 'Received' : purchase.status}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={<IconPurchases />}
              title="No purchases yet"
              description="Purchases appear here as your team records them."
            />
          )}
        </Card>
        <Card>
          <CardHeader title="Getting started" description="What arrives next in SamakiOS." />
          <CardBody className="pt-2">
            <ol className="flex flex-col">
              {NEXT_STEPS.map((step, index) => (
                <li
                  key={step.title}
                  className="flex gap-3 border-b border-mist-100 py-3 last:border-0"
                >
                  <span className="tabular flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[12px] font-semibold text-accent-strong">
                    {index + 1}
                  </span>
                  <div>
                    <p className="text-[13px] font-medium text-mist-900">{step.title}</p>
                    <p className="mt-0.5 text-[12px] leading-5 text-mist-500">{step.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Stock by item" description="Kilograms on hand by catalogue item." />
        {hasStock && stock.data ? (
          <ul className="divide-y divide-mist-100">
            {stock.data.items.map((item) => (
              <li
                key={item.catalogueItemId}
                className="flex items-center gap-4 px-6 py-3 text-[13px]"
              >
                <span className="min-w-0 flex-1 truncate font-medium text-mist-900">
                  {itemName(item.catalogueItemId)}
                </span>
                <span className="text-[12px] text-mist-500">
                  {item.batches} {item.batches === 1 ? 'batch' : 'batches'}
                </span>
                <span className="tabular w-28 text-right font-semibold text-mist-900">
                  {grouped(item.onHandKg)} kg
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={<IconInventory />}
            title="No stock yet"
            description="Stock appears once purchases are received into inventory."
          />
        )}
      </Card>
    </div>
  );
}
