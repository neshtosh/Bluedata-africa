'use client';

import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  IconInventory,
  IconPurchases,
  KpiTile,
} from '@blue/ui';
import { useMembership } from './organisation-context';

const NEXT_STEPS = [
  {
    title: 'Add suppliers and buyers',
    detail: 'Fishermen, cooperatives, BMUs, traders and processors you trade with.',
  },
  {
    title: 'Record your first purchase',
    detail: 'Spot purchases at the landing site, by kg, basin or piece — works offline.',
  },
  {
    title: 'Track stock by batch',
    detail: 'Every purchase creates a batch with its cost, origin and catch date.',
  },
  {
    title: 'Sell and get paid',
    detail: 'Sales from batches, invoices, mobile-money references and balances.',
  },
];

/**
 * Operational overview. SamakiOS modules arrive in Phase 3, so every figure is an explicit
 * "no data yet" — never a placeholder number that could be mistaken for a real one.
 */
export default function DashboardPage() {
  const { organisation, roles } = useMembership();
  const currency = organisation.defaultCurrency;

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[13px] text-mist-500">Welcome to</p>
          <h1 className="text-2xl font-semibold tracking-[-0.02em] text-mist-900">
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

      <section aria-label="Key figures" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile
          label="Stock on hand"
          value={null}
          unit="kg"
          footnote="No inventory recorded yet"
        />
        <KpiTile
          label="Purchases · 7 days"
          value={null}
          unit={currency}
          footnote="No purchases recorded yet"
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
            title="Recent activity"
            description="Purchases, sales, deliveries and stock movements."
          />
          <EmptyState
            icon={<IconPurchases />}
            title="Nothing recorded yet"
            description="Purchases, sales and stock movements will appear here as your team records them."
          />
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
        <CardHeader
          title="Stock by species"
          description="Kilograms on hand by species and product form."
        />
        <EmptyState
          icon={<IconInventory />}
          title="No stock yet"
          description="Stock appears once purchases are received into inventory."
        />
      </Card>
    </div>
  );
}
