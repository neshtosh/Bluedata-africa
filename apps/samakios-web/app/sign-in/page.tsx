'use client';

import { SignInFlow } from '@blue/web-shell';
import { useRouter } from 'next/navigation';
import { Brand } from '../brand';

export default function SignInPage() {
  const router = useRouter();
  return <SignInFlow brand={<Brand on="light" />} onSignedIn={() => router.replace('/')} />;
}
