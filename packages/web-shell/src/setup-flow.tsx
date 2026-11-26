'use client';

import { endpoints, type SetupLinkDetails } from '@blue/contracts';
import { Alert, Button, Card, Field, Input, Spinner } from '@blue/ui';
import { useEffect, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react';
import { describeError, useApi, useRefreshSession } from './api.js';
import { useI18n } from './i18n.js';

/** The token from the link's #fragment (fragments never reach servers or logs). */
function tokenFromHash(hash: string): string | null {
  const match = /(?:^#|&)token=([A-Za-z0-9_-]+)/.exec(hash);
  return match?.[1] ?? null;
}

const subscribeToHash = (onChange: () => void) => {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
};

/**
 * The page a setup link opens (ADR-019): shows who the account is for, then the person chooses
 * a password (and confirms their name). Completing it signs them in and, for links sent by an
 * organisation, joins that organisation.
 */
export function SetupFlow({ brand, onDone }: { brand: ReactNode; onDone: () => void }) {
  const api = useApi();
  const refreshSession = useRefreshSession();
  const { t } = useI18n();

  // undefined while rendering on the server (no URL fragment there), then the token or null.
  const hash = useSyncExternalStore(
    subscribeToHash,
    () => window.location.hash,
    () => undefined,
  );
  const token = hash === undefined ? undefined : tokenFromHash(hash);
  const [details, setDetails] = useState<SetupLinkDetails | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    api
      .call(endpoints.auth.inspectSetup, { body: { token } })
      .then((result) => {
        setDetails(result);
        setDisplayName(result.displayName);
      })
      .catch((caught: unknown) => setFatal(describeError(caught, t)));
  }, [api, t, token]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    if (password !== confirm) {
      setError(t('setup.mismatch'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.call(endpoints.auth.completeSetup, {
        body: {
          token,
          password,
          ...(displayName.trim() && displayName.trim() !== details?.displayName
            ? { displayName: displayName.trim() }
            : {}),
        },
      });
      // The link is spent; don't leave it in the address bar or history.
      window.history.replaceState(null, '', window.location.pathname);
      await refreshSession();
      onDone();
    } catch (caught) {
      setError(describeError(caught, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-[420px]">
        <div className="mb-6 flex justify-center">{brand}</div>
        <Card className="px-6 py-6">
          <h1 className="text-xl font-semibold tracking-[-0.02em] text-mist-900">
            {t('setup.title')}
          </h1>
          {token === null ? (
            <Alert tone="danger" className="mt-4">
              {t('setup.missing')}
            </Alert>
          ) : fatal ? (
            <Alert tone="danger" className="mt-4">
              {fatal}
            </Alert>
          ) : !details ? (
            <div className="flex justify-center py-8">
              <Spinner label={t('common.loading')} />
            </div>
          ) : (
            <form onSubmit={(e) => void submit(e)} noValidate className="mt-1 flex flex-col gap-4">
              <div className="text-[13px] leading-5 text-mist-500">
                <p>{t('setup.subtitle')}</p>
                <p className="tabular mt-2 font-medium text-mist-800">
                  {t('setup.for', { phone: details.phone })}
                </p>
                {details.organisationName ? (
                  <p className="mt-0.5">{t('setup.joining', { name: details.organisationName })}</p>
                ) : null}
              </div>
              <Field label={t('setup.name')}>
                <Input
                  autoComplete="name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </Field>
              <Field label={t('setup.password')} hint={t('setup.passwordHint')}>
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus
                />
              </Field>
              <Field label={t('setup.confirm')}>
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </Field>
              {error ? <Alert tone="danger">{error}</Alert> : null}
              <Button
                type="submit"
                size="lg"
                loading={busy}
                disabled={password.length < 10 || confirm.length === 0 || !displayName.trim()}
              >
                {t('setup.submit')}
              </Button>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
