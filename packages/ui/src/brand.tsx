import { cn } from './cn.js';

/**
 * Abstract wave mark: three stacked swells. On the blue sidebar header it is drawn white-on-white
 * glass (`onAccent`); elsewhere in the product accent.
 */
export function BrandMark({
  className,
  onAccent = false,
}: {
  className?: string;
  onAccent?: boolean;
}) {
  return (
    <svg viewBox="0 0 24 24" className={cn('size-7', className)} aria-hidden fill="none">
      <rect
        width="24"
        height="24"
        rx="7"
        fill={onAccent ? 'white' : 'var(--accent)'}
        fillOpacity={onAccent ? 0.2 : 1}
      />
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

/**
 * Product wordmark. `on="accent"` for the blue sidebar header, `on="dark"` for navy surfaces,
 * `on="light"` for sign-in pages.
 */
export function ProductWordmark({
  name,
  subtitle,
  on = 'accent',
}: {
  name: string;
  subtitle?: string;
  on?: 'accent' | 'dark' | 'light';
}) {
  return (
    <div className="flex items-center gap-2.5">
      <BrandMark onAccent={on === 'accent'} />
      <div className="leading-tight">
        <p
          className={cn(
            'text-[16px] font-bold tracking-[-0.01em]',
            on === 'light' ? 'text-navy-900' : 'text-white',
          )}
        >
          {name}
        </p>
        {subtitle ? (
          <p
            className={cn(
              'text-[11px]',
              on === 'accent' ? 'text-white/75' : on === 'dark' ? 'text-mist-400' : 'text-mist-500',
            )}
          >
            {subtitle}
          </p>
        ) : null}
      </div>
    </div>
  );
}
