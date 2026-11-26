'use client';

import { cloneElement, useState, type ReactElement, type ReactNode } from 'react';
import { cn } from './cn.js';
import { IconChevronDown, IconMenu } from './icons.js';

export interface AppShellProps {
  /** Product wordmark, shown on the blue header of the sidebar. */
  brand: ReactNode;
  /** Sidebar navigation (NavSection / NavItem). */
  navigation: ReactNode;
  /** Bottom of the sidebar, e.g. environment or help link. */
  sidebarFooter?: ReactNode;
  /** Page title shown in the top bar. */
  title?: ReactNode;
  /** Right side of the top bar, e.g. the organisation switcher. */
  actions?: ReactNode;
  children: ReactNode;
}

/**
 * Application frame shared by both products: a dark sidebar floating on the canvas (blue brand
 * header, blue active item), a transparent top bar, and content in white panels.
 * Below the lg breakpoint the sidebar becomes a drawer opened from the top bar.
 */
export function AppShell({
  brand,
  navigation,
  sidebarFooter,
  title,
  actions,
  children,
}: AppShellProps) {
  const [open, setOpen] = useState(false);
  const sidebar = (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl bg-navy-900 text-mist-200 shadow-overlay">
      <div className="flex h-16 shrink-0 items-center bg-accent px-5">{brand}</div>
      <nav
        aria-label="Main"
        className="flex-1 overflow-y-auto px-3 py-4 [scrollbar-color:rgb(255_255_255/0.15)_transparent] [scrollbar-width:thin]"
        onClick={() => setOpen(false)}
      >
        {navigation}
      </nav>
      {sidebarFooter ? (
        <div className="border-t border-white/10 px-5 py-3 text-[12px] text-mist-400">
          {sidebarFooter}
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="min-h-dvh bg-canvas lg:grid lg:grid-cols-[264px_minmax(0,1fr)]">
      <aside className="hidden lg:sticky lg:top-0 lg:block lg:h-dvh lg:py-4 lg:pl-4">
        {sidebar}
      </aside>

      {open ? (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
        >
          <button
            type="button"
            className="absolute inset-0 bg-navy-950/50"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-y-2 left-2 w-[264px]">{sidebar}</div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 bg-canvas/85 px-4 backdrop-blur lg:px-8">
          <button
            type="button"
            className="-ml-1 rounded-lg p-2 text-mist-600 hover:bg-mist-0 lg:hidden"
            aria-label="Open navigation"
            onClick={() => setOpen(true)}
          >
            <IconMenu />
          </button>
          <div className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-[-0.01em] text-mist-900">
            {title}
          </div>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </header>
        <main className="flex-1 px-4 pb-10 pt-2 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

/**
 * A group of sidebar links. With a label it can be collapsed (open by default); groups
 * containing the active page cannot be collapsed so you never lose your place.
 */
export function NavSection({
  label,
  icon,
  children,
}: {
  label?: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  if (!label) {
    return <ul className="mb-3 flex flex-col gap-1">{children}</ul>;
  }
  return (
    <div className="mb-3">
      <button
        type="button"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        className="flex h-9 w-full items-center gap-2.5 rounded-lg px-3 text-[12px] font-semibold uppercase tracking-[0.06em] text-mist-400 hover:text-mist-200"
      >
        {icon ? <span className="shrink-0">{icon}</span> : null}
        <span className="flex-1 text-left">{label}</span>
        <IconChevronDown
          className={cn('size-4 shrink-0 transition-transform', open ? '' : '-rotate-90')}
        />
      </button>
      {open ? (
        <ul className="mt-1 flex flex-col gap-1 rounded-xl bg-white/[0.03] p-1">{children}</ul>
      ) : null}
    </div>
  );
}

/**
 * A sidebar link. Pass the router's link as the child; its text becomes the label:
 * `<NavItem icon={<IconDashboard />} active><Link href="…">Dashboard</Link></NavItem>`.
 * `soon` marks modules that are planned but not built yet: shown, but not a link.
 */
export function NavItem({
  icon,
  active = false,
  soon,
  children,
}: {
  icon?: ReactNode;
  active?: boolean;
  soon?: ReactNode;
  children: ReactElement<{ children?: ReactNode; className?: string }>;
}) {
  const content = (
    <>
      {icon ? (
        <span className={cn('shrink-0', soon ? 'text-mist-600' : active ? '' : 'opacity-75')}>
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate">{children.props.children}</span>
      {soon ? (
        <span className="rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-mist-400">
          {soon}
        </span>
      ) : null}
    </>
  );
  const base =
    'flex h-9 items-center gap-3 rounded-lg px-3 text-[13px] font-medium transition-colors';
  if (soon) {
    return (
      <li>
        <span className={cn(base, 'cursor-default text-mist-500')} aria-disabled="true">
          {content}
        </span>
      </li>
    );
  }
  return (
    <li>
      {cloneElement(
        children,
        {
          className: cn(
            base,
            active
              ? 'bg-accent text-white shadow-accent'
              : 'text-mist-300 hover:bg-white/[0.06] hover:text-white',
          ),
          'aria-current': active ? 'page' : undefined,
        } as Record<string, unknown>,
        content,
      )}
    </li>
  );
}
