import type { SVGProps } from 'react';

/** 20px stroke icons. Decorative by default; pass aria-label to make one meaningful. */
function Icon({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      {children}
    </svg>
  );
}

type P = SVGProps<SVGSVGElement>;

export const IconDashboard = (p: P) => (
  <Icon {...p}>
    <rect x="3" y="3" width="6" height="8" rx="1" />
    <rect x="11" y="3" width="6" height="5" rx="1" />
    <rect x="3" y="13" width="6" height="4" rx="1" />
    <rect x="11" y="10" width="6" height="7" rx="1" />
  </Icon>
);
export const IconInventory = (p: P) => (
  <Icon {...p}>
    <path d="M3 6.5 10 3l7 3.5v7L10 17l-7-3.5z" />
    <path d="M3 6.5 10 10l7-3.5M10 10v7" />
  </Icon>
);
export const IconPurchases = (p: P) => (
  <Icon {...p}>
    <path d="M10 3v9m0 0-3.5-3.5M10 12l3.5-3.5" />
    <path d="M3.5 13.5v2a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5v-2" />
  </Icon>
);
export const IconSales = (p: P) => (
  <Icon {...p}>
    <path d="M10 12V3m0 0L6.5 6.5M10 3l3.5 3.5" />
    <path d="M3.5 13.5v2a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5v-2" />
  </Icon>
);
export const IconPartners = (p: P) => (
  <Icon {...p}>
    <circle cx="7.5" cy="7" r="2.75" />
    <path d="M2.5 16.5c.6-2.6 2.6-4 5-4s4.4 1.4 5 4" />
    <path d="M13 4.6a2.6 2.6 0 0 1 0 4.8M14.5 12.7c1.5.5 2.6 1.8 3 3.8" />
  </Icon>
);
export const IconLogistics = (p: P) => (
  <Icon {...p}>
    <path d="M2.5 5.5h9v8h-9zM11.5 8.5h3.2l2.8 2.8v2.2h-6" />
    <circle cx="5.5" cy="14.5" r="1.5" />
    <circle cx="14" cy="14.5" r="1.5" />
  </Icon>
);
export const IconFinance = (p: P) => (
  <Icon {...p}>
    <rect x="2.5" y="5" width="15" height="11" rx="1.5" />
    <path d="M2.5 8.5h15M13 12.5h1.5" />
  </Icon>
);
export const IconMap = (p: P) => (
  <Icon {...p}>
    <path d="m2.5 5 5-2 5 2 5-2v12l-5 2-5-2-5 2z" />
    <path d="M7.5 3v12M12.5 5v12" />
  </Icon>
);
export const IconPrices = (p: P) => (
  <Icon {...p}>
    <path d="M3 16.5h14" />
    <path d="m3.5 12.5 4-4 3 2.5 6-6" />
    <path d="M13 5h3.5v3.5" />
  </Icon>
);
export const IconProduction = (p: P) => (
  <Icon {...p}>
    <path d="M10 3 2.5 7 10 11l7.5-4z" />
    <path d="m2.5 10.5 7.5 4 7.5-4M2.5 13.8 10 17.8l7.5-4" />
  </Icon>
);
export const IconSources = (p: P) => (
  <Icon {...p}>
    <ellipse cx="10" cy="5" rx="6" ry="2.25" />
    <path d="M4 5v10c0 1.24 2.7 2.25 6 2.25s6-1 6-2.25V5M4 10c0 1.24 2.7 2.25 6 2.25s6-1 6-2.25" />
  </Icon>
);
export const IconSettings = (p: P) => (
  <Icon {...p}>
    <circle cx="10" cy="10" r="2.5" />
    <path d="M10 2.5v2M10 15.5v2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M2.5 10h2M15.5 10h2M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" />
  </Icon>
);
export const IconMenu = (p: P) => (
  <Icon {...p}>
    <path d="M3 5.5h14M3 10h14M3 14.5h14" />
  </Icon>
);
export const IconChevronDown = (p: P) => (
  <Icon {...p}>
    <path d="m5.5 8 4.5 4.5L14.5 8" />
  </Icon>
);
export const IconCheck = (p: P) => (
  <Icon {...p}>
    <path d="m4.5 10.5 3.5 3.5 7.5-8" />
  </Icon>
);
export const IconPlus = (p: P) => (
  <Icon {...p}>
    <path d="M10 4v12M4 10h12" />
  </Icon>
);
export const IconLogout = (p: P) => (
  <Icon {...p}>
    <path d="M8 3.5H5A1.5 1.5 0 0 0 3.5 5v10A1.5 1.5 0 0 0 5 16.5h3M12.5 13.5 16 10l-3.5-3.5M16 10H8" />
  </Icon>
);
