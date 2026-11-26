'use client';

import { SetupFlow } from '@blue/web-shell';
import { useRouter } from 'next/navigation';
import { Brand } from '../brand';

/** Where setup links land (ADR-019): choose a password, then continue into the app. */
export default function SetupPage() {
  const router = useRouter();
  return <SetupFlow brand={<Brand on="light" />} onDone={() => router.replace('/')} />;
}
