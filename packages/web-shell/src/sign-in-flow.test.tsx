import { ApiClient, ApiError } from '@blue/api-client';
import { endpoints } from '@blue/contracts';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from './api.js';
import { I18nProvider } from './i18n.js';
import { SignInFlow } from './sign-in-flow.js';

const CHALLENGE = '0192f1c0-0000-7000-8000-0000000000aa';

function problem(status: number, code: string, extra: Record<string, unknown> = {}) {
  return new ApiError(status, {
    type: 'urn:x',
    title: code,
    status,
    code,
    instance: '/',
    requestId: 'r',
    ...extra,
  });
}

/** Renders the flow with ApiClient.call replaced by `call`. */
function renderFlow(call: (endpoint: unknown, input: unknown) => Promise<unknown>) {
  const spy = vi.spyOn(ApiClient.prototype, 'call').mockImplementation(call as never);
  const onSignedIn = vi.fn();
  render(
    <ApiProvider baseUrl="http://api.test" clientName="test">
      <I18nProvider>
        <SignInFlow brand={<span>Brand</span>} onSignedIn={onSignedIn} />
      </I18nProvider>
    </ApiProvider>,
  );
  return { spy, onSignedIn, user: userEvent.setup() };
}

afterEach(() => vi.restoreAllMocks());

describe('SignInFlow', () => {
  it('signs in an existing user: number (as typed locally) → code → done', async () => {
    const { spy, onSignedIn, user } = renderFlow(async (endpoint) => {
      if (endpoint === endpoints.auth.requestOtp)
        return { challengeId: CHALLENGE, expiresAt: '2026-11-03T10:00:00.000Z' };
      if (endpoint === endpoints.auth.verifyOtp)
        return { user: { id: 'u', displayName: 'Amina' }, sessionExpiresAt: '' };
      return null; // /me refresh
    });

    await user.type(screen.getByLabelText('Mobile number'), '0712 345 678');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    expect(spy).toHaveBeenCalledWith(endpoints.auth.requestOtp, {
      body: { phone: '+254712345678' },
    });

    expect(await screen.findByText('We sent a 6-digit code to +254712345678.')).toBeTruthy();
    await user.type(screen.getByLabelText('Code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    expect(spy).toHaveBeenCalledWith(endpoints.auth.verifyOtp, {
      body: { challengeId: CHALLENGE, phone: '+254712345678', code: '123456' },
    });
    await vi.waitFor(() => expect(onSignedIn).toHaveBeenCalled());
  });

  it('asks a new user for their name and resubmits the same code (no second SMS)', async () => {
    const verifyBodies: unknown[] = [];
    const { spy, onSignedIn, user } = renderFlow(async (endpoint, input) => {
      if (endpoint === endpoints.auth.requestOtp) return { challengeId: CHALLENGE, expiresAt: '' };
      if (endpoint === endpoints.auth.verifyOtp) {
        const body = (input as { body: { displayName?: string } }).body;
        verifyBodies.push(body);
        if (!body.displayName) throw problem(422, 'DISPLAY_NAME_REQUIRED');
        return { user: { id: 'u', displayName: body.displayName }, sessionExpiresAt: '' };
      }
      return null;
    });

    await user.type(screen.getByLabelText('Mobile number'), '712345678');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    await user.type(await screen.findByLabelText('Code'), '654321');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    await user.type(await screen.findByLabelText('Your name'), 'Otieno Ouma');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    await vi.waitFor(() => expect(onSignedIn).toHaveBeenCalled());
    expect(verifyBodies).toEqual([
      { challengeId: CHALLENGE, phone: '+254712345678', code: '654321' },
      {
        challengeId: CHALLENGE,
        phone: '+254712345678',
        code: '654321',
        displayName: 'Otieno Ouma',
      },
    ]);
    expect(spy.mock.calls.filter(([e]) => e === endpoints.auth.requestOtp)).toHaveLength(1);
  });

  it('explains errors in plain language', async () => {
    const { user } = renderFlow(async (endpoint) => {
      if (endpoint === endpoints.auth.requestOtp)
        throw new ApiError(
          429,
          {
            type: 'x',
            title: 't',
            status: 429,
            code: 'RATE_LIMITED',
            instance: '/',
            requestId: 'r',
          },
          42,
        );
      return null;
    });
    await user.type(screen.getByLabelText('Mobile number'), '0712345678');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Too many attempts. Try again in 42 seconds.',
    );
  });

  it('rejects an invalid number without calling the API', async () => {
    const { spy, user } = renderFlow(async () => null);
    await user.type(screen.getByLabelText('Mobile number'), '12345');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Enter a valid mobile number');
    expect(spy.mock.calls.filter(([e]) => e === endpoints.auth.requestOtp)).toHaveLength(0);
  });
});
