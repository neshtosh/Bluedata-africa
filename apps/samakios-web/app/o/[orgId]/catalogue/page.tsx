'use client';

import { endpoints, type CatalogueItem, type Vocabulary } from '@blue/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Field,
  IconInventory,
  Input,
  Select,
  Spinner,
} from '@blue/ui';
import { describeError, useApi, useI18n } from '@blue/web-shell';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent } from 'react';
import { useMembership } from '../organisation-context';

function useVocabulary() {
  const api = useApi();
  return useQuery({
    queryKey: ['ref', 'vocabulary'],
    queryFn: () => api.call(endpoints.ref.vocabulary),
    staleTime: 10 * 60_000,
  });
}

/** "Silver cyprinid · omena, mukene, dagaa" — the names traders actually use. */
function speciesLabel(species: Vocabulary['species'][number]): string {
  const local = [...new Set(species.names.map((n) => n.name))];
  return local.length ? `${species.commonNameEn} · ${local.join(', ')}` : species.commonNameEn;
}

export default function CataloguePage() {
  const { organisation, permissions } = useMembership();
  const api = useApi();
  const { t } = useI18n();
  const vocabulary = useVocabulary();
  const items = useQuery({
    queryKey: ['orgs', organisation.id, 'catalogue'],
    queryFn: () =>
      api.call(endpoints.catalogue.list, { params: { orgId: organisation.id }, query: {} }),
  });
  const canManage = permissions.includes('samakios.catalogue.manage');

  if (items.isPending || vocabulary.isPending) {
    return (
      <div className="flex justify-center py-16">
        <Spinner label={t('common.loading')} />
      </div>
    );
  }
  if (items.isError || vocabulary.isError) {
    return <Alert tone="danger">{describeError(items.error ?? vocabulary.error, t)}</Alert>;
  }

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-mist-900">Catalogue</h1>
        <p className="mt-1 max-w-2xl text-sm text-mist-500">
          What you buy and sell, and how much your own basins, tins and crates weigh. Every purchase
          and sale is converted to kilograms through these weights.
        </p>
      </div>
      <CatalogueTable items={items.data} vocabulary={vocabulary.data} canManage={canManage} />
      {canManage ? <AddItemForm vocabulary={vocabulary.data} /> : null}
    </div>
  );
}

function CatalogueTable({
  items,
  vocabulary,
  canManage,
}: {
  items: CatalogueItem[];
  vocabulary: Vocabulary;
  canManage: boolean;
}) {
  const { organisation } = useMembership();
  const api = useApi();
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const speciesById = useMemo(
    () => new Map(vocabulary.species.map((s) => [s.id, s])),
    [vocabulary],
  );
  const formName = (code: string) =>
    vocabulary.productForms.find((f) => f.code === code)?.name ?? code;
  const unitName = (code: string) => vocabulary.units.find((u) => u.code === code)?.name ?? code;

  async function archive(item: CatalogueItem) {
    setError(null);
    try {
      await api.call(endpoints.catalogue.update, {
        params: { orgId: organisation.id, itemId: item.id },
        body: { version: item.version, archived: true },
      });
      await queryClient.invalidateQueries({ queryKey: ['orgs', organisation.id, 'catalogue'] });
    } catch (caught) {
      setError(describeError(caught, t));
    }
  }

  return (
    <Card>
      <CardHeader title="Items" description={`${items.length} active`} />
      {error ? (
        <CardBody>
          <Alert tone="danger">{error}</Alert>
        </CardBody>
      ) : null}
      {items.length === 0 ? (
        <EmptyState
          icon={<IconInventory />}
          title="No items yet"
          description="Add the species and forms you trade — for example omena, sun-dried, sold by the basin."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-mist-100 text-[12px] uppercase tracking-[0.04em] text-mist-500">
              <tr>
                <th className="px-5 py-2.5 font-medium">Item</th>
                <th className="px-5 py-2.5 font-medium">Species</th>
                <th className="px-5 py-2.5 font-medium">Form</th>
                <th className="px-5 py-2.5 font-medium">Sold by</th>
                <th className="px-5 py-2.5 font-medium">Your unit weights</th>
                {canManage ? <th className="px-5 py-2.5" /> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-mist-100">
              {items.map((item) => {
                const species = speciesById.get(item.speciesId);
                return (
                  <tr key={item.id}>
                    <td className="px-5 py-3">
                      <p className="font-medium text-mist-900">{item.name}</p>
                      {item.grade || item.sizeClass ? (
                        <p className="mt-0.5 text-[12px] text-mist-500">
                          {[item.grade && `Grade ${item.grade}`, item.sizeClass]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-5 py-3 text-mist-700">
                      {species ? (
                        <>
                          <span>{species.commonNameEn}</span>
                          <span className="block text-[12px] italic text-mist-500">
                            {species.scientificName}
                          </span>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-5 py-3 text-mist-700">{formName(item.productFormCode)}</td>
                    <td className="px-5 py-3">
                      <Badge>{unitName(item.defaultUnitCode)}</Badge>
                    </td>
                    <td className="tabular px-5 py-3 text-mist-700">
                      {item.units.length === 0
                        ? '—'
                        : item.units.map((u) => `1 ${u.unitCode} = ${u.kgPerUnit} kg`).join(' · ')}
                    </td>
                    {canManage ? (
                      <td className="px-5 py-3 text-right">
                        <Button variant="ghost" size="sm" onClick={() => void archive(item)}>
                          Archive
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function AddItemForm({ vocabulary }: { vocabulary: Vocabulary }) {
  const { organisation } = useMembership();
  const api = useApi();
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const weighableUnits = vocabulary.units.filter((u) => u.dimension !== 'mass');

  const [speciesId, setSpeciesId] = useState(vocabulary.species[0]?.id ?? '');
  const [productFormCode, setProductFormCode] = useState('fresh_whole');
  const [grade, setGrade] = useState('');
  const [sizeClass, setSizeClass] = useState('');
  const [defaultUnitCode, setDefaultUnitCode] = useState('kg');
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const defaultUnit = vocabulary.units.find((u) => u.code === defaultUnitCode);
  const defaultNeedsWeight =
    defaultUnit !== undefined &&
    defaultUnit.dimension !== 'mass' &&
    !weights[defaultUnitCode]?.trim();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    const submittedUnits = Object.entries(weights)
      .filter(([, kg]) => kg.trim())
      .map(([unitCode, kgPerUnit]) => ({ unitCode, kgPerUnit: kgPerUnit.trim() }));
    try {
      await api.call(endpoints.catalogue.create, {
        params: { orgId: organisation.id },
        body: {
          speciesId,
          productFormCode,
          ...(grade.trim() ? { grade } : {}),
          ...(sizeClass.trim() ? { sizeClass } : {}),
          defaultUnitCode,
          units: submittedUnits,
        },
      });
      setGrade('');
      setSizeClass('');
      setWeights({});
      await queryClient.invalidateQueries({ queryKey: ['orgs', organisation.id, 'catalogue'] });
    } catch (caught) {
      const issues =
        caught && typeof caught === 'object' && 'issues' in caught && Array.isArray(caught.issues)
          ? (caught.issues as { path: (string | number)[]; message: string }[])
          : null;
      if (issues) {
        // units.<i>.kgPerUnit refers to the i-th *submitted* unit; key errors by unit code.
        setFieldErrors(
          Object.fromEntries(
            issues.map((i) => {
              const unit = i.path[0] === 'units' ? submittedUnits[Number(i.path[1])] : undefined;
              return [unit ? `unit:${unit.unitCode}` : i.path.join('.'), i.message];
            }),
          ),
        );
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
      <CardHeader
        title="Add an item"
        description="One item per species, form, grade and size you trade."
      />
      <CardBody>
        <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Species" className="lg:col-span-2">
              <Select value={speciesId} onChange={(e) => setSpeciesId(e.target.value)}>
                {vocabulary.species.map((s) => (
                  <option key={s.id} value={s.id}>
                    {speciesLabel(s)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Product form">
              <Select value={productFormCode} onChange={(e) => setProductFormCode(e.target.value)}>
                {vocabulary.productForms.map((f) => (
                  <option key={f.code} value={f.code}>
                    {f.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Sold by default in">
              <Select value={defaultUnitCode} onChange={(e) => setDefaultUnitCode(e.target.value)}>
                {vocabulary.units.map((u) => (
                  <option key={u.code} value={u.code}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Grade (optional)" hint="e.g. A, B, export">
              <Input value={grade} onChange={(e) => setGrade(e.target.value)} />
            </Field>
            <Field label="Size class (optional)" hint="e.g. 3–5 kg, small">
              <Input value={sizeClass} onChange={(e) => setSizeClass(e.target.value)} />
            </Field>
          </div>

          <fieldset>
            <legend className="text-[13px] font-medium text-mist-800">Your unit weights</legend>
            <p className="mt-0.5 text-[13px] text-mist-500">
              How many kilograms one of your containers of this item weighs. Leave blank for units
              you don&apos;t use. Kilograms, grams and tonnes are exact and need no weight.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {weighableUnits.map((unit) => (
                <Field
                  key={unit.code}
                  label={`kg per ${unit.name.toLowerCase()}`}
                  error={fieldErrors[`unit:${unit.code}`]}
                >
                  <Input
                    inputMode="decimal"
                    placeholder="—"
                    value={weights[unit.code] ?? ''}
                    onChange={(e) => setWeights((w) => ({ ...w, [unit.code]: e.target.value }))}
                    className="tabular"
                  />
                </Field>
              ))}
            </div>
            {defaultNeedsWeight ? (
              <p className="mt-2 text-[13px] text-warning-700" role="status">
                Enter how many kg a {defaultUnit.name.toLowerCase()} weighs to sell this item by the{' '}
                {defaultUnit.name.toLowerCase()}.
              </p>
            ) : null}
          </fieldset>

          {error ? <Alert tone="danger">{error}</Alert> : null}
          <div>
            <Button type="submit" loading={busy} disabled={!speciesId || defaultNeedsWeight}>
              Add item
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
