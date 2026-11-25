'use client';

import { ApiError } from '@blue/api-client';
import { endpoints } from '@blue/contracts';
import { Alert, Button, Card, Field, Input, Select } from '@blue/ui';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { describeError, useApi, useRefreshSession } from './api.js';
import { useI18n } from './i18n.js';
import { PHONE_COUNTRIES, toE164, type PhoneCountryCode } from './phone.js';

const RESEND_AFTER_SECONDS = 30;

type Step = 'phone' | 'code' | 'name';

/**
 * Phone-first sign-in (ARCHITECTURE.md §10.2): number → SMS code → (name, first time only).
 * The same code is resubmitted with the name, so new users never wait for a second SMS.
 */
export function SignInFlow({ brand, onSignedIn }: { brand: ReactNode; onSignedIn: () => void }) {
  const api = useApi();
  const refreshSession = useRefreshSession();
  const { t } = useI18n();

  const [step, setStep] = useState<Step>('phone');
  const [country, setCountry] = useState<PhoneCountryCode>('KE');
  const [typedPhone, setTypedPhone] = useState('');
  const [phone, setPhone] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(describeError(caught, t));
    } finally {
      setBusy(false);
    }
  }

  const sendCode = (to: string) =>
    run(async () => {
      const result = await api.call(endpoints.auth.requestOtp, { body: { phone: to } });
      setPhone(to);
      setChallengeId(result.challengeId);
      setCode('');
      setStep('code');
      setResendIn(RESEND_AFTER_SECONDS);
    });

  function submitPhone(event: FormEvent) {
    event.preventDefault();
    const e164 = toE164(country, typedPhone);
    if (!e164) {
      setError(t('signIn.phoneInvalid'));
      return;
    }
    void sendCode(e164);
  }

  function verify(event: FormEvent, withName: boolean) {
    event.preventDefault();
    if (!phone || !challengeId) return;
    void run(async () => {
      try {
        await api.call(endpoints.auth.verifyOtp, {
          body: { challengeId, phone, code, ...(withName ? { displayName } : {}) },
        });
      } catch (caught) {
        if (caught instanceof ApiError && caught.code === 'DISPLAY_NAME_REQUIRED') {
          setStep('name');
          return;
        }
        throw caught;
      }
      await refreshSession();
      onSignedIn();
    });
  }

  const example = PHONE_COUNTRIES.find((c) => c.code === country)?.example ?? '';

  return (
    <div className="flex min-h-dvh items-center justify-center bg-mist-50 px-4 py-10">
      <div className="w-full max-w-[400px]">
        <div className="mb-6 flex justify-center">{brand}</div>
        <Card className="px-6 py-6">
          {step === 'phone' ? (
            <form onSubmit={submitPhone} noValidate className="flex flex-col gap-4">
              <Header title={t('signIn.title')} subtitle={t('signIn.subtitle')} />
              <div className="grid grid-cols-[128px_1fr] gap-2">
                <Field label={t('signIn.country')}>
                  <Select
                    value={country}
                    onChange={(e) => setCountry(e.target.value as PhoneCountryCode)}
                  >
                    {PHONE_COUNTRIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.code} {c.dial}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('signIn.phone')} hint={t('signIn.phoneHint', { example })}>
                  <Input
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel-national"
                    value={typedPhone}
                    onChange={(e) => setTypedPhone(e.target.value)}
                    autoFocus
                  />
                </Field>
              </div>
              {error ? <Alert tone="danger">{error}</Alert> : null}
              <Button type="submit" size="lg" loading={busy}>
                {t('signIn.sendCode')}
              </Button>
            </form>
          ) : step === 'code' ? (
            <form onSubmit={(e) => verify(e, false)} noValidate className="flex flex-col gap-4">
              <Header
                title={t('signIn.codeTitle')}
                subtitle={t('signIn.codeSentTo', { phone: phone ?? '' })}
              />
              <Field label={t('signIn.code')}>
                <Input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  className="tabular text-center text-lg tracking-[0.4em]"
                  autoFocus
                />
              </Field>
              {error ? <Alert tone="danger">{error}</Alert> : null}
              <Button type="submit" size="lg" loading={busy} disabled={code.length !== 6}>
                {t('signIn.verify')}
              </Button>
              <div className="flex flex-col items-center gap-2 text-[13px] sm:flex-row sm:justify-between">
                <button
                  type="button"
                  className="text-mist-600 underline-offset-2 hover:underline"
                  onClick={() => {
                    setStep('phone');
                    setError(null);
                  }}
                >
                  {t('signIn.changeNumber')}
                </button>
                {resendIn > 0 ? (
                  <span className="tabular text-mist-500">
                    {t('signIn.resendIn', { seconds: resendIn })}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="font-medium text-accent-strong underline-offset-2 hover:underline"
                    onClick={() => phone && void sendCode(phone)}
                    disabled={busy}
                  >
                    {t('signIn.resend')}
                  </button>
                )}
              </div>
            </form>
          ) : (
            <form onSubmit={(e) => verify(e, true)} noValidate className="flex flex-col gap-4">
              <Header title={t('signIn.nameTitle')} subtitle={t('signIn.nameSubtitle')} />
              <Field label={t('signIn.displayName')}>
                <Input
                  autoComplete="name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  autoFocus
                />
              </Field>
              {error ? <Alert tone="danger">{error}</Alert> : null}
              <Button
                type="submit"
                size="lg"
                loading={busy}
                disabled={displayName.trim().length === 0}
              >
                {t('signIn.createAccount')}
              </Button>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}

function Header({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h1 className="text-xl font-semibold tracking-[-0.02em] text-mist-900">{title}</h1>
      <p className="mt-1 text-[13px] leading-5 text-mist-500">{subtitle}</p>
    </div>
  );
}
