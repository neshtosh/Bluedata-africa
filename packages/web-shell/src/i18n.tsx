'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * Minimal typed i18n for the shared flows (English + Swahili for the MVP).
 * The Swahili strings are a DRAFT and must be reviewed by a native speaker before any pilot.
 * Messages use {name} placeholders. A full library (ICU plurals, formatting) comes with Phase 3.
 */
const en = {
  'common.continue': 'Continue',
  'common.back': 'Back',
  'common.cancel': 'Cancel',
  'common.loading': 'Loading…',
  'common.comingSoon': 'Soon',

  'signIn.title': 'Sign in',
  'signIn.subtitle': 'Use your mobile number. We will send you a one-time code by SMS.',
  'signIn.country': 'Country',
  'signIn.phone': 'Mobile number',
  'signIn.phoneHint': 'For example {example}',
  'signIn.phoneInvalid': 'Enter a valid mobile number for the selected country.',
  'signIn.sendCode': 'Send code',
  'signIn.codeTitle': 'Enter the code',
  'signIn.codeSentTo': 'We sent a 6-digit code to {phone}.',
  'signIn.code': 'Code',
  'signIn.verify': 'Verify',
  'signIn.changeNumber': 'Use a different number',
  'signIn.resend': 'Send a new code',
  'signIn.resendIn': 'You can request a new code in {seconds}s',
  'signIn.nameTitle': 'Welcome — create your account',
  'signIn.nameSubtitle': 'This number has no account yet. What should we call you?',
  'signIn.displayName': 'Your name',
  'signIn.createAccount': 'Create account',
  'signIn.passwordSubtitle': 'Use your mobile number and password.',
  'signIn.password': 'Password',
  'signIn.signIn': 'Sign in',
  'signIn.noPassword':
    'No password yet, or forgotten it? Ask the person who invited you to send you a setup link.',
  'signIn.usePassword': 'Sign in with a password instead',
  'signIn.useCode': 'Get a code by SMS instead',

  'setup.title': 'Set up your account',
  'setup.subtitle':
    'Choose a password. You will sign in with your mobile number and this password.',
  'setup.for': 'Account for {phone}',
  'setup.joining': 'You will join {name}.',
  'setup.name': 'Your name',
  'setup.password': 'New password',
  'setup.passwordHint': 'At least 10 characters. A short sentence is easy to remember.',
  'setup.confirm': 'Repeat the password',
  'setup.mismatch': 'The two passwords are different.',
  'setup.submit': 'Save password and continue',
  'setup.missing':
    'This link is incomplete. Open the whole link you were sent, or ask for a new one.',

  'orgs.title': 'Your organisations',
  'orgs.subtitle': 'Choose an organisation to work in, or register a new one.',
  'orgs.open': 'Open',
  'orgs.invitations': 'Invitations',
  'orgs.invitedBy': 'You have been invited to join {name}.',
  'orgs.accept': 'Accept invitation',
  'orgs.none': 'You are not a member of any organisation yet.',
  'orgs.createTitle': 'Register an organisation',
  'orgs.createSubtitle': 'You will become its Owner and can invite your team afterwards.',
  'orgs.legalName': 'Legal name',
  'orgs.tradingName': 'Trading name (optional)',
  'orgs.slug': 'Short handle',
  'orgs.slugHint': 'Lowercase letters, numbers and hyphens. Used in links.',
  'orgs.country': 'Country of operation',
  'orgs.types': 'What does the organisation do?',
  'orgs.typesHint': 'Choose up to 5.',
  'orgs.create': 'Register organisation',
  'orgs.notIncluded': 'This organisation’s subscription does not include {product}.',

  'switcher.label': 'Switch organisation',
  'switcher.create': 'Register an organisation',
  'switcher.invitations': '{count} pending invitation(s)',
  'switcher.signOut': 'Sign out',

  'error.OTP_INVALID': 'That code is not valid or has expired. Request a new code and try again.',
  'error.RATE_LIMITED': 'Too many attempts. Try again in {seconds} seconds.',
  'error.INVALID_CREDENTIALS': 'Invalid phone number or password.',
  'error.ACCOUNT_SUSPENDED': 'This account is suspended. Contact support.',
  'error.SETUP_LINK_INVALID':
    'This setup link no longer works: it was used already or has expired. Ask for a new one.',
  'error.SMS_UNAVAILABLE': 'Sign-in codes by SMS are not available. Sign in with your password.',
  'error.SLUG_TAKEN': 'That handle is already taken. Choose another.',
  'error.COUNTRY_NOT_SUPPORTED': 'Registration is not open in this country yet.',
  'error.VALIDATION_FAILED': 'Some fields are missing or invalid.',
  'error.network': 'Could not reach the server. Check your connection and try again.',
  'error.generic': 'Something went wrong. Please try again.',
} as const;

export type MessageKey = keyof typeof en;
type Messages = Record<MessageKey, string>;

const sw: Messages = {
  'common.continue': 'Endelea',
  'common.back': 'Rudi',
  'common.cancel': 'Ghairi',
  'common.loading': 'Inapakia…',
  'common.comingSoon': 'Inakuja',

  'signIn.title': 'Ingia',
  'signIn.subtitle': 'Tumia namba yako ya simu. Tutakutumia nambari ya siri kwa SMS.',
  'signIn.country': 'Nchi',
  'signIn.phone': 'Namba ya simu',
  'signIn.phoneHint': 'Kwa mfano {example}',
  'signIn.phoneInvalid': 'Weka namba sahihi ya simu kwa nchi uliyochagua.',
  'signIn.sendCode': 'Tuma nambari',
  'signIn.codeTitle': 'Weka nambari ya siri',
  'signIn.codeSentTo': 'Tumetuma nambari ya tarakimu 6 kwa {phone}.',
  'signIn.code': 'Nambari ya siri',
  'signIn.verify': 'Thibitisha',
  'signIn.changeNumber': 'Tumia namba nyingine',
  'signIn.resend': 'Tuma nambari mpya',
  'signIn.resendIn': 'Unaweza kuomba nambari mpya baada ya sekunde {seconds}',
  'signIn.nameTitle': 'Karibu — fungua akaunti yako',
  'signIn.nameSubtitle': 'Namba hii haina akaunti bado. Tukuite nani?',
  'signIn.displayName': 'Jina lako',
  'signIn.createAccount': 'Fungua akaunti',
  'signIn.passwordSubtitle': 'Tumia namba yako ya simu na nenosiri.',
  'signIn.password': 'Nenosiri',
  'signIn.signIn': 'Ingia',
  'signIn.noPassword':
    'Huna nenosiri bado, au umelisahau? Muombe aliyekualika akutumie kiungo cha kuweka akaunti.',
  'signIn.usePassword': 'Ingia kwa nenosiri badala yake',
  'signIn.useCode': 'Pata nambari kwa SMS badala yake',

  'setup.title': 'Weka akaunti yako',
  'setup.subtitle': 'Chagua nenosiri. Utaingia kwa namba yako ya simu na nenosiri hili.',
  'setup.for': 'Akaunti ya {phone}',
  'setup.joining': 'Utajiunga na {name}.',
  'setup.name': 'Jina lako',
  'setup.password': 'Nenosiri jipya',
  'setup.passwordHint': 'Angalau herufi 10. Sentensi fupi ni rahisi kukumbuka.',
  'setup.confirm': 'Rudia nenosiri',
  'setup.mismatch': 'Manenosiri mawili hayafanani.',
  'setup.submit': 'Hifadhi nenosiri na uendelee',
  'setup.missing': 'Kiungo hiki hakijakamilika. Fungua kiungo kizima ulichotumiwa, au omba kipya.',

  'orgs.title': 'Mashirika yako',
  'orgs.subtitle': 'Chagua shirika la kufanyia kazi, au sajili jipya.',
  'orgs.open': 'Fungua',
  'orgs.invitations': 'Mialiko',
  'orgs.invitedBy': 'Umealikwa kujiunga na {name}.',
  'orgs.accept': 'Kubali mwaliko',
  'orgs.none': 'Bado wewe si mwanachama wa shirika lolote.',
  'orgs.createTitle': 'Sajili shirika',
  'orgs.createSubtitle': 'Utakuwa Mmiliki wake na unaweza kualika timu yako baadaye.',
  'orgs.legalName': 'Jina rasmi',
  'orgs.tradingName': 'Jina la biashara (si lazima)',
  'orgs.slug': 'Jina fupi',
  'orgs.slugHint': 'Herufi ndogo, nambari na vistari. Hutumika kwenye viungo.',
  'orgs.country': 'Nchi ya shughuli',
  'orgs.types': 'Shirika linafanya nini?',
  'orgs.typesHint': 'Chagua hadi 5.',
  'orgs.create': 'Sajili shirika',
  'orgs.notIncluded': 'Usajili wa shirika hili haujumuishi {product}.',

  'switcher.label': 'Badilisha shirika',
  'switcher.create': 'Sajili shirika',
  'switcher.invitations': 'Mialiko {count} inayosubiri',
  'switcher.signOut': 'Toka',

  'error.OTP_INVALID': 'Nambari hiyo si sahihi au imeisha muda. Omba nambari mpya ujaribu tena.',
  'error.RATE_LIMITED': 'Majaribio mengi mno. Jaribu tena baada ya sekunde {seconds}.',
  'error.INVALID_CREDENTIALS': 'Namba ya simu au nenosiri si sahihi.',
  'error.ACCOUNT_SUSPENDED': 'Akaunti hii imesimamishwa. Wasiliana na huduma kwa wateja.',
  'error.SETUP_LINK_INVALID':
    'Kiungo hiki hakifanyi kazi tena: kimeshatumika au muda wake umeisha. Omba kipya.',
  'error.SMS_UNAVAILABLE': 'Nambari za kuingia kwa SMS hazipatikani. Ingia kwa nenosiri lako.',
  'error.SLUG_TAKEN': 'Jina hilo fupi limeshachukuliwa. Chagua jingine.',
  'error.COUNTRY_NOT_SUPPORTED': 'Usajili bado haujafunguliwa katika nchi hii.',
  'error.VALIDATION_FAILED': 'Baadhi ya sehemu hazijajazwa au si sahihi.',
  'error.network': 'Imeshindwa kufikia seva. Angalia mtandao wako ujaribu tena.',
  'error.generic': 'Hitilafu imetokea. Tafadhali jaribu tena.',
};

export const LOCALES = { en, sw } as const;
export type Locale = keyof typeof LOCALES;

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

interface I18nValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translate;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({
  initialLocale = 'en',
  children,
}: {
  initialLocale?: Locale;
  children: ReactNode;
}) {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const t = useCallback<Translate>(
    (key, vars) =>
      (LOCALES[locale][key] ?? en[key]).replace(/\{(\w+)\}/g, (match, name: string) =>
        vars && name in vars ? String(vars[name]) : match,
      ),
    [locale],
  );
  const value = useMemo(() => ({ locale, setLocale, t }), [locale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside <I18nProvider>');
  return value;
}
