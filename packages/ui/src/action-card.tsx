import type { ReactNode } from 'react';
import { cn } from './cn.js';

export type ActionCardTone = 'blue' | 'cyan' | 'green' | 'violet';
export type ActionCardArt = 'stack' | 'layers' | 'petals' | 'waves';

const tones: Record<ActionCardTone, string> = {
  blue: 'from-card-blue-from to-card-blue-to shadow-[0_10px_24px_rgb(52_102_240/0.28)]',
  cyan: 'from-card-cyan-from to-card-cyan-to shadow-[0_10px_24px_rgb(26_159_230/0.28)]',
  green: 'from-card-green-from to-card-green-to shadow-[0_10px_24px_rgb(25_179_127/0.28)]',
  violet: 'from-card-violet-from to-card-violet-to shadow-[0_10px_24px_rgb(93_85_230/0.28)]',
};

/**
 * A gradient card for a main action ("Record supply", "Add partner"): title, one line of help,
 * a white outlined action, and decorative glass artwork on the right.
 */
export function ActionCard({
  title,
  description,
  action,
  tone = 'blue',
  art = 'stack',
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** Usually `<Button variant="onColor" size="sm" asChild><Link …/></Button>`. */
  action?: ReactNode;
  tone?: ActionCardTone;
  art?: ActionCardArt;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'relative flex min-h-[148px] overflow-hidden rounded-2xl bg-gradient-to-br p-5 text-white',
        tones[tone],
        className,
      )}
    >
      <div className="relative z-10 flex max-w-[62%] flex-col">
        <h3 className="text-[19px] font-bold tracking-[-0.01em]">{title}</h3>
        {description ? (
          <p className="mt-1.5 text-[12.5px] leading-5 text-white/85">{description}</p>
        ) : null}
        {action ? <div className="mt-auto pt-4">{action}</div> : null}
      </div>
      <Artwork art={art} />
    </div>
  );
}

/** Original glass-style shapes; decorative only. */
function Artwork({ art }: { art: ActionCardArt }) {
  const common = 'pointer-events-none absolute right-4 top-1/2 size-24 -translate-y-1/2';
  switch (art) {
    case 'stack':
      // Three stacked discs: stock, volumes.
      return (
        <svg viewBox="0 0 96 96" className={common} aria-hidden fill="none">
          {[62, 46, 30].map((y, i) => (
            <g key={y} opacity={0.55 + i * 0.15}>
              <ellipse cx="48" cy={y + 8} rx="30" ry="11" fill="white" fillOpacity=".35" />
              <rect x="18" y={y} width="60" height="8" fill="white" fillOpacity=".35" />
              <ellipse cx="48" cy={y} rx="30" ry="11" fill="white" fillOpacity=".75" />
            </g>
          ))}
        </svg>
      );
    case 'layers':
      // Three floating rhombi: supply arriving in layers.
      return (
        <svg viewBox="0 0 96 96" className={common} aria-hidden fill="none">
          {[64, 48, 32].map((y, i) => (
            <path
              key={y}
              d={`M48 ${y - 16} L80 ${y} L48 ${y + 16} L16 ${y} Z`}
              fill="white"
              fillOpacity={0.35 + i * 0.2}
            />
          ))}
        </svg>
      );
    case 'petals':
      // Four overlapping petals: partners around a centre.
      return (
        <svg viewBox="0 0 96 96" className={common} aria-hidden fill="none">
          {[0, 90, 180, 270].map((angle, i) => (
            <ellipse
              key={angle}
              cx="48"
              cy="30"
              rx="15"
              ry="22"
              transform={`rotate(${angle} 48 48)`}
              fill="white"
              fillOpacity={0.3 + i * 0.12}
            />
          ))}
          <circle cx="48" cy="48" r="9" fill="white" fillOpacity=".9" />
        </svg>
      );
    case 'waves':
      // Three swells, echoing the brand mark.
      return (
        <svg viewBox="0 0 96 96" className={common} aria-hidden fill="none">
          {[34, 50, 66].map((y, i) => (
            <path
              key={y}
              d={`M10 ${y}c9.5-7 19-7 28.5 0s19 7 28.5 0 19-7 19 0`}
              stroke="white"
              strokeOpacity={0.9 - i * 0.22}
              strokeWidth="7"
              strokeLinecap="round"
            />
          ))}
        </svg>
      );
  }
}
