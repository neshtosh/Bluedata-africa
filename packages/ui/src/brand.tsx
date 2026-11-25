import { cn } from './cn.js';

/** Abstract wave mark: three stacked swells, drawn in the current product accent. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn('size-6', className)} aria-hidden fill="none">
      <rect width="24" height="24" rx="6" fill="var(--accent)" />
      <path
        d="M5 9.5c2.3-1.6 4.7-1.6 7 0s4.7 1.6 7 0"
        stroke="white"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M5 13.5c2.3-1.6 4.7-1.6 7 0s4.7 1.6 7 0"
        stroke="white"
        strokeOpacity=".75"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M5 17.5c2.3-1.6 4.7-1.6 7 0s4.7 1.6 7 0"
        stroke="white"
        strokeOpacity=".45"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Product wordmark. `on="dark"` for the navy sidebar, `on="light"` for sign-in pages. */
export function ProductWordmark({
  name,
  subtitle,
  on = 'dark',
}: {
  name: string;
  subtitle?: string;
  on?: 'dark' | 'light';
}) {
  return (
    <div className="flex items-center gap-2.5">
      <BrandMark />
      <div className="leading-tight">
        <p
          className={cn(
            'text-[14px] font-semibold tracking-[-0.01em]',
            on === 'dark' ? 'text-white' : 'text-navy-900',
          )}
        >
          {name}
        </p>
        {subtitle ? (
          <p className={cn('text-[11px]', on === 'dark' ? 'text-mist-400' : 'text-mist-500')}>
            {subtitle}
          </p>
        ) : null}
      </div>
    </div>
  );
}
