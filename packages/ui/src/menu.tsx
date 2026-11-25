import * as Dropdown from '@radix-ui/react-dropdown-menu';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from './cn.js';

/** Accessible dropdown menu (Radix): keyboard navigation, focus management, typeahead. */
export const Menu = Dropdown.Root;
export const MenuTrigger = Dropdown.Trigger;

export function MenuContent({
  className,
  align = 'end',
  ...props
}: ComponentPropsWithoutRef<typeof Dropdown.Content>) {
  return (
    <Dropdown.Portal>
      <Dropdown.Content
        align={align}
        sideOffset={6}
        className={cn(
          'z-50 min-w-[240px] rounded-lg bg-mist-0 p-1 shadow-overlay ring-1 ring-mist-100',
          className,
        )}
        {...props}
      />
    </Dropdown.Portal>
  );
}

export function MenuItem({
  className,
  icon,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof Dropdown.Item> & { icon?: ReactNode }) {
  return (
    <Dropdown.Item
      className={cn(
        'flex cursor-default select-none items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] text-mist-800 outline-none',
        'data-[highlighted]:bg-mist-50 data-[disabled]:text-mist-400',
        className,
      )}
      {...props}
    >
      {icon ? (
        <span className="flex size-5 shrink-0 items-center justify-center text-mist-500">
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1">{children}</span>
    </Dropdown.Item>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <Dropdown.Label className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-mist-500">
      {children}
    </Dropdown.Label>
  );
}

export function MenuSeparator() {
  return <Dropdown.Separator className="my-1 h-px bg-mist-100" />;
}
