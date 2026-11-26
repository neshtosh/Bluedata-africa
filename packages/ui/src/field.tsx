import {
  cloneElement,
  forwardRef,
  isValidElement,
  useId,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { cn } from './cn.js';

const control =
  'block w-full rounded-lg bg-mist-0 px-3 text-sm text-mist-900 ring-1 ring-inset ring-mist-200 ' +
  'placeholder:text-mist-400 hover:ring-mist-300 focus:outline-none focus:ring-2 focus:ring-accent-ring ' +
  'aria-[invalid=true]:ring-danger-600 disabled:bg-mist-50 disabled:text-mist-400';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(control, 'h-10', className)} {...props} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <select ref={ref} className={cn(control, 'h-10 pr-8', className)} {...props}>
        {children}
      </select>
    );
  },
);

export interface FieldProps {
  label: ReactNode;
  /** Shown below the control when there is no error. */
  hint?: ReactNode;
  error?: ReactNode;
  /** The control (Input, Select…). Receives id, aria-invalid and aria-describedby. */
  children: ReactElement<Record<string, unknown>>;
  /** `inline` puts the label beside the control, for compact filter bars. */
  layout?: 'stacked' | 'inline';
  className?: string;
}

/** Label + control + hint/error, wired for screen readers. */
export function Field({ label, hint, error, children, layout = 'stacked', className }: FieldProps) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  const control = isValidElement(children)
    ? cloneElement(children, {
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy,
      })
    : children;
  const message = error ? (
    <p id={`${id}-error`} className="text-[13px] text-danger-700" role="alert">
      {error}
    </p>
  ) : hint ? (
    <p id={`${id}-hint`} className="text-[13px] text-mist-500">
      {hint}
    </p>
  ) : null;
  if (layout === 'inline') {
    return (
      <div className={cn('flex flex-col gap-1', className)}>
        <div className="flex items-center gap-3">
          <label
            htmlFor={id}
            className="w-16 shrink-0 whitespace-nowrap text-[13px] font-semibold text-mist-800 sm:w-auto"
          >
            {label}
          </label>
          <div className="min-w-0 flex-1">{control}</div>
        </div>
        {message}
      </div>
    );
  }
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-[13px] font-medium text-mist-800">
        {label}
      </label>
      {control}
      {message}
    </div>
  );
}
