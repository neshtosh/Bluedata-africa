import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn.js';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-2xl bg-mist-0 shadow-raised', className)} {...props} />;
}

export function CardHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-4 border-b border-mist-100 px-6 py-5',
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="text-[16px] font-bold tracking-[-0.01em] text-mist-900">{title}</h2>
        {description ? <p className="mt-0.5 text-[13px] text-mist-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-6 py-5', className)} {...props} />;
}

export type BadgeTone =
  | 'neutral'
  | 'accent'
  | 'success'
  | 'warning'
  | 'danger'
  | 'verified'
  | 'official'
  | 'submitted'
  | 'estimate'
  | 'forecast';

const badgeTones: Record<BadgeTone, string> = {
  neutral: 'bg-mist-100 text-mist-700',
  accent: 'bg-accent-soft text-accent-strong',
  success: 'bg-success-50 text-success-700',
  warning: 'bg-warning-50 text-warning-700',
  danger: 'bg-danger-50 text-danger-700',
  verified: 'bg-mist-0 text-mist-800 ring-1 ring-inset ring-mist-200',
  official: 'bg-mist-0 text-mist-800 ring-1 ring-inset ring-mist-200',
  submitted: 'bg-mist-0 text-mist-800 ring-1 ring-inset ring-mist-200',
  estimate: 'bg-mist-0 text-mist-800 ring-1 ring-inset ring-mist-200',
  forecast: 'bg-mist-0 text-mist-800 ring-1 ring-inset ring-mist-200',
};

const provenanceDot: Partial<Record<BadgeTone, string>> = {
  verified: 'bg-prov-verified',
  official: 'bg-prov-official',
  submitted: 'bg-prov-submitted',
  estimate: 'bg-prov-estimate',
  forecast: 'border border-dashed border-prov-forecast bg-transparent',
};

/** Small status label. Provenance tones carry a coloured marker so they read without colour too. */
export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  const dot = provenanceDot[tone];
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-[12px] font-medium',
        badgeTones[tone],
        className,
      )}
    >
      {dot ? <span aria-hidden className={cn('size-2 rounded-full', dot)} /> : null}
      {children}
    </span>
  );
}

export function Alert({
  tone = 'neutral',
  title,
  children,
  className,
}: {
  tone?: 'neutral' | 'danger' | 'warning' | 'success';
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const tones = {
    neutral: 'bg-accent-soft text-mist-800 ring-accent/20',
    danger: 'bg-danger-50 text-danger-700 ring-danger-600/25',
    warning: 'bg-warning-50 text-warning-700 ring-warning-500/30',
    success: 'bg-success-50 text-success-700 ring-teal-600/25',
  };
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('rounded-xl px-4 py-3 text-[13px] ring-1 ring-inset', tones[tone], className)}
    >
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? <div className={title ? 'mt-0.5' : undefined}>{children}</div> : null}
    </div>
  );
}

/** A metric tile. `value` null renders an explicit "no data" state rather than a fake zero. */
export function KpiTile({
  label,
  value,
  unit,
  footnote,
  className,
}: {
  label: ReactNode;
  value: ReactNode | null;
  unit?: ReactNode;
  footnote?: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn('px-5 py-4', className)}>
      <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-mist-500">{label}</p>
      <p className="tabular mt-2 flex items-baseline gap-1.5">
        {value === null ? (
          <span className="text-2xl font-semibold text-mist-300" aria-label="No data yet">
            —
          </span>
        ) : (
          <span className="text-2xl font-semibold tracking-[-0.02em] text-mist-900">{value}</span>
        )}
        {unit && value !== null ? <span className="text-[13px] text-mist-500">{unit}</span> : null}
      </p>
      {footnote ? <p className="mt-1.5 text-[12px] text-mist-500">{footnote}</p> : null}
    </Card>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-10 text-center', className)}>
      {icon ? (
        <div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
          {icon}
        </div>
      ) : null}
      <p className="text-sm font-semibold text-mist-900">{title}</p>
      {description ? (
        <p className="mt-1 max-w-sm text-[13px] text-mist-500">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
