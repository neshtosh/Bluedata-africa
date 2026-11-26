import { z } from 'zod';
import { DisplayName, PhoneE164, Uuid } from './common.js';

export const OTP_LENGTH = 6;

/** POST /v1/auth/otp/request — send a one-time code to a phone number. */
export const OtpRequestSchema = z.strictObject({
  phone: PhoneE164,
});
export type OtpRequest = z.infer<typeof OtpRequestSchema>;

export const OtpRequestResponseSchema = z.object({
  challengeId: Uuid,
  expiresAt: z.iso.datetime(),
});
export type OtpRequestResponse = z.infer<typeof OtpRequestResponseSchema>;

/**
 * POST /v1/auth/otp/verify — exchange the code for a session. displayName is used only when the
 * phone number is new (first sign-in creates the account).
 */
export const OtpVerifySchema = z.strictObject({
  challengeId: Uuid,
  // Sent again because challenges store only an HMAC of the destination, never the number.
  phone: PhoneE164,
  code: z
    .string()
    .regex(new RegExp(`^[0-9]{${OTP_LENGTH}}$`), `Enter the ${OTP_LENGTH}-digit code`),
  displayName: DisplayName.optional(),
});
export type OtpVerify = z.infer<typeof OtpVerifySchema>;

/** NIST SP 800-63B: length over composition rules; upper bound stops hashing abuse. */
export const Password = z.string().min(10, 'Use at least 10 characters').max(128);

/** POST /v1/auth/password/login */
export const PasswordLoginSchema = z.strictObject({
  phone: PhoneE164,
  password: z.string().min(1).max(128),
});
export type PasswordLogin = z.infer<typeof PasswordLoginSchema>;

/** PUT /v1/me/password — set or change the password of the signed-in user. */
export const SetPasswordSchema = z.strictObject({
  password: Password,
});
export type SetPassword = z.infer<typeof SetPasswordSchema>;

/** GET /v1/auth/methods — how people can sign in on this deployment. */
export const SignInMethodsSchema = z.object({
  /** One-time codes by SMS. False until an SMS provider is configured (ADR-019). */
  otp: z.boolean(),
  password: z.boolean(),
});
export type SignInMethods = z.infer<typeof SignInMethodsSchema>;

/** A one-time setup token, as found in the link's #fragment (never sent in a URL path or query). */
export const SetupToken = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/, 'This setup link is incomplete. Ask for a new one.');

/** POST /v1/auth/setup/inspect — who a setup link is for, before choosing a password. */
export const InspectSetupSchema = z.strictObject({ token: SetupToken });

export const SetupLinkDetailsSchema = z.object({
  /** Masked, e.g. +254*******01. */
  phone: z.string(),
  displayName: z.string(),
  /** The organisation that sent the link, if any; opening it accepts that invitation. */
  organisationName: z.string().nullable(),
  expiresAt: z.iso.datetime(),
});
export type SetupLinkDetails = z.infer<typeof SetupLinkDetailsSchema>;

/** POST /v1/auth/setup — choose a password with a setup link; signs you in. */
export const CompleteSetupSchema = z.strictObject({
  token: SetupToken,
  password: Password,
  displayName: DisplayName.optional(),
});
export type CompleteSetup = z.infer<typeof CompleteSetupSchema>;

/** POST /v1/orgs/:orgId/members/:userId/setup-link */
export const SetupLinkCreatedSchema = z.object({
  /** Relative link; the app prefixes its own address. The token is in the #fragment. */
  path: z.string(),
  expiresAt: z.iso.datetime(),
});
export type SetupLinkCreated = z.infer<typeof SetupLinkCreatedSchema>;
