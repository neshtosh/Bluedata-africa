'use client';

import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  IconMap,
  IconPrices,
  KpiTile,
  type BadgeTone,
} from '@blue/ui';

/** How BlueData labels every figure (ARCHITECTURE.md §12.1, ADR-012). */
const PROVENANCE: { tone: BadgeTone; label: string; meaning: string }[] = [
  {
    tone: 'official',
    label: 'Official statistic',
    meaning: 'Published by a government or intergovernmental body.',
  },
  {
    tone: 'verified',
    label: 'Verified',
    meaning: 'Checked by a BlueData data steward against its source.',
  },
  {
    tone: 'submitted',
    label: 'User-submitted',
    meaning: 'Reported by a field collector or partner; not yet verified.',
  },
  {
    tone: 'estimate',
    label: 'Estimate',
    meaning: 'Derived from incomplete data; the method is always shown.',
  },
  {
    tone: 'forecast',
    label: 'Forecast',
    meaning: 'Model output with an uncertainty range. Never shown as fact.',
  },
];

/**
 * Intelligence overview. No datasets are loaded in Phase 2, so the page says so plainly:
 * BlueData never shows figures it cannot source.
 */
export default function OverviewPage() {
  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-mist-900">
          Fisheries intelligence
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-mist-500">
          Production, market prices and supply across the Lake Victoria basin and beyond — every
          figure with its source and how much to trust it.
        </p>
      </div>

      <section aria-label="Headline indicators" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile
          label="Nile perch · wholesale"
          value={null}
          unit="KES/kg"
          footnote="No verified price data yet"
        />
        <KpiTile
          label="Tilapia · wholesale"
          value={null}
          unit="KES/kg"
          footnote="No verified price data yet"
        />
        <KpiTile
          label="Landings · this month"
          value={null}
          unit="t"
          footnote="No production data yet"
        />
        <KpiTile label="Markets covered" value={null} footnote="No markets mapped yet" />
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="overflow-hidden">
          <CardHeader title="Map" description="Landing sites, markets, farms and processors." />
          <EmptyState
            className="min-h-[320px] justify-center bg-[radial-gradient(circle_at_30%_40%,var(--color-ocean-50),transparent_60%)]"
            icon={<IconMap />}
            title="No geographic layers loaded"
            description="The map arrives with the geographic registry in Phase 4, starting with Lake Victoria landing sites."
          />
        </Card>
        <Card>
          <CardHeader
            title="How to read BlueData"
            description="Every number carries one of these labels."
          />
          <CardBody className="pt-2">
            <ul className="flex flex-col">
              {PROVENANCE.map((item) => (
                <li
                  key={item.label}
                  className="flex flex-col gap-1 border-b border-mist-100 py-3 last:border-0"
                >
                  <Badge tone={item.tone}>{item.label}</Badge>
                  <p className="text-[12px] leading-5 text-mist-500">{item.meaning}</p>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Price trends"
          description="Wholesale and landing prices by species, market and month."
        />
        <EmptyState
          icon={<IconPrices />}
          title="No price series yet"
          description="Field price collection starts during Phase 3; series appear once observations are verified."
        />
      </Card>
    </div>
  );
}
