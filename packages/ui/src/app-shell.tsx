'use client';

import { cloneElement, useState, type ReactElement, type ReactNode } from 'react';
import { cn } from './cn.js';
import { IconMenu } from './icons.js';

export interface AppShellProps {
  /** Product wordmark area at the top of the sidebar. */
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
 * Application frame shared by both products: navy sidebar, white top bar, neutral canvas.
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
    <div className="flex h-full flex-col bg-navy-900 text-mist-200">
      <div className="flex h-14 items-center px-4">{brand}</div>
      <nav
        aria-label="Main"
        className="flex-1 overflow-y-auto px-2 py-3"
        onClick={() => setOpen(false)}
      >
        {navigation}
      </nav>
      {sidebarFooter ? (
        <div className="border-t border-white/10 px-4 py-3 text-[12px] text-mist-400">
          {sidebarFooter}
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="hidden lg:sticky lg:top-0 lg:block lg:h-dvh">{sidebar}</aside>

      {open ? (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
        >
          <button
            type="button"
            className="absolute inset-0 bg-navy-950/40"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-[260px] shadow-overlay">{sidebar}</div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-mist-100 bg-mist-0/95 px-4 backdrop-blur lg:px-6">
          <button
            type="button"
            className="-ml-1 rounded-md p-1.5 text-mist-600 hover:bg-mist-100 lg:hidden"
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
        <main className="flex-1 px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

export function NavSection({ label, children }: { label?: ReactNode; children: ReactNode }) {
  return (
    <div className="mb-4">
      {label ? (
        <p className="px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-mist-500">
          {label}
        </p>
      ) : null}
      <ul className="flex flex-col gap-0.5">{children}</ul>
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
        <span className={cn('shrink-0', soon ? 'text-mist-600' : 'opacity-80')}>{icon}</span>
      ) : null}
      <span className="min-w-0 flex-1 truncate">{children.props.children}</span>
      {soon ? (
        <span className="rounded-sm bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-mist-400">
          {soon}
        </span>
      ) : null}
    </>
  );
  const base =
    'flex h-9 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium transition-colors';
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
            active ? 'bg-white/10 text-white' : 'text-mist-300 hover:bg-white/5 hover:text-white',
          ),
          'aria-current': active ? 'page' : undefined,
        } as Record<string, unknown>,
        content,
      )}
    </li>
  );
}
