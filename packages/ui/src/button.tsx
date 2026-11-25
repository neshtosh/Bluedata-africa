import { Slot } from '@radix-ui/react-slot';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from './cn.js';
import { Spinner } from './spinner.js';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'inverse' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-strong disabled:bg-mist-300',
  secondary:
    'bg-mist-0 text-mist-900 ring-1 ring-inset ring-mist-200 hover:bg-mist-25 hover:ring-mist-300 disabled:text-mist-400',
  ghost: 'text-mist-700 hover:bg-mist-100 hover:text-mist-900 disabled:text-mist-400',
  /** Ghost button for dark (navy) surfaces. */
  inverse: 'text-mist-100 hover:bg-white/10 hover:text-white disabled:text-mist-500',
  danger: 'bg-danger-600 text-white hover:bg-danger-700 disabled:bg-mist-300',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5',
  md: 'h-9 px-3.5 text-sm gap-2',
  lg: 'h-11 px-5 text-[15px] gap-2',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and disables the button while an action runs. */
  loading?: boolean;
  /** Render the child element (e.g. a link) with button styling. */
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    asChild = false,
    className,
    children,
    disabled,
    ...props
  },
  ref,
) {
  const Component = asChild ? Slot : 'button';
  return (
    <Component
      ref={ref}
      className={cn(
        'inline-flex select-none items-center justify-center rounded-md font-medium transition-colors',
        'disabled:cursor-not-allowed',
        variants[variant],
        sizes[size],
        className,
      )}
      disabled={asChild ? undefined : disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {loading ? <Spinner size="sm" className="text-current" /> : null}
          {children}
        </>
      )}
    </Component>
  );
});
