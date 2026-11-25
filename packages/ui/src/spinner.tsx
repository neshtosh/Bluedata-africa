import { cn } from './cn.js';

export function Spinner({
  size = 'md',
  className,
  label,
}: {
  size?: 'sm' | 'md';
  className?: string;
  label?: string;
}) {
  const dimension = size === 'sm' ? 'size-3.5' : 'size-5';
  return (
    <svg
      className={cn('animate-spin text-accent', dimension, className)}
      viewBox="0 0 24 24"
      fill="none"
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
