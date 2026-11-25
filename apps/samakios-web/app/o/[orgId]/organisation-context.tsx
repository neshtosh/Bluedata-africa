'use client';

import type { Me } from '@blue/contracts';
import { createContext, useContext } from 'react';

export type Membership = Me['organisations'][number];

/** The current organisation membership, resolved once by the /o/[orgId] layout. */
export const OrganisationContext = createContext<Membership | null>(null);

export function useMembership(): Membership {
  const membership = useContext(OrganisationContext);
  if (!membership) throw new Error('useMembership must be used under /o/[orgId]');
  return membership;
}
