'use client';

import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from './cn.js';

export interface TabOption<T extends string> {
  value: T;
  label: ReactNode;
}

/**
 * Folder-style tabs that sit on top of a panel: the selected tab is white and joins the panel
 * below (give that Card `rounded-tl-none`), the others are tinted. Arrow keys move between
 * tabs (WAI-ARIA tabs pattern, automatic activation).
 */
export function FolderTabs<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  /** Accessible name of the tab list, e.g. "Show". */
  label: string;
  value: T;
  options: readonly TabOption<T>[];
  onChange: (value: T) => void;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    const option = options[next];
    if (!option) return;
    onChange(option.value);
    refs.current[next]?.focus();
  }

  return (
    <div role="tablist" aria-label={label} className={cn('flex items-end gap-1', className)}>
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(element) => {
              refs.current[index] = element;
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              'rounded-t-xl px-5 text-[13px] font-semibold transition-colors',
              selected
                ? 'h-11 bg-mist-0 text-mist-900'
                : 'h-10 bg-mist-100 text-mist-500 hover:bg-mist-200/70 hover:text-mist-700',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
