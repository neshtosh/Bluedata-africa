'use client';

import { MembersPanel } from '@blue/web-shell';
import { useMembership } from '../organisation-context';

export default function MembersPage() {
  return (
    <div className="mx-auto w-full max-w-[1200px]">
      <MembersPanel membership={useMembership()} />
    </div>
  );
}
