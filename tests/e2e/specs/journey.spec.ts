import { expect, test, type Page } from '@playwright/test';
import { BLUEDATA_URL, logMark, SAMAKIOS_URL, waitForCode } from '../stack.js';

/** Unique Kenyan test numbers per run; local format, as people type them. */
const runSuffix = String(Date.now()).slice(-4);
// 0712 <4-digit run id> <nn>: valid length, and each user's masked log line differs (…nn).
const localNumber = (n: number) => `0712 ${runSuffix} ${n}${n}`;
const toE164 = (local: string) => `+254${local.replace(/\D/g, '').slice(1)}`;

async function signUp(page: Page, local: string, name: string) {
  await page.goto(`${SAMAKIOS_URL}/sign-in`);
  await page.getByLabel('Mobile number').fill(local);
  const mark = logMark();
  await page.getByRole('button', { name: 'Send code' }).click();
  const code = await waitForCode(toE164(local), mark);
  await page.getByLabel('Code').fill(code);
  await page.getByRole('button', { name: 'Verify' }).click();
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(`${SAMAKIOS_URL}/organisations`);
}

async function registerOrganisation(page: Page, legalName: string): Promise<string> {
  await page.getByLabel('Legal name').fill(legalName);
  await page.getByRole('button', { name: 'Trader / aggregator' }).click();
  await page.getByRole('button', { name: 'Register organisation' }).click();
  await expect(page).toHaveURL(/\/o\/[0-9a-f-]{36}$/);
  return new URL(page.url()).pathname.split('/').pop() ?? '';
}

test.describe.serial('platform journey', () => {
  let organisationId = '';

  test('a new user signs up by phone, registers an organisation and reaches its dashboard', async ({
    page,
  }) => {
    await signUp(page, localNumber(1), 'Achieng E2E');
    organisationId = await registerOrganisation(page, `Kisumu E2E Traders ${runSuffix}`);

    await expect(
      page.getByRole('heading', { name: `Kisumu E2E Traders ${runSuffix}` }),
    ).toBeVisible();
    // No fake numbers: every KPI says there is no data yet.
    await expect(page.getByLabel('No data yet')).toHaveCount(4);

    await page.getByRole('link', { name: 'Members' }).click();
    const ownerRow = page.getByRole('row', { name: /Achieng E2E/ });
    await expect(ownerRow).toContainText('Owner');
    await expect(ownerRow).toContainText('+254*******'); // phone masked
    await expect(page.getByRole('button', { name: 'Invite' })).toBeVisible(); // owner may invite

    // Trading partners: typed the local way, stored in E.164, found again by search.
    await page.getByRole('link', { name: 'Suppliers & buyers' }).click();
    await page.getByRole('button', { name: 'Add partner' }).click();
    await page.getByLabel('Name', { exact: true }).fill('Dunga Beach BMU');
    await page.getByLabel('Phone (optional)').fill(`0733 ${runSuffix} 11`);
    await page.getByLabel('Buyer').check();
    await page.getByLabel('Nile perch').check();
    await page.getByRole('button', { name: 'Add partner' }).click();
    const partnerRow = page.getByRole('row', { name: /Dunga Beach BMU/ });
    await expect(partnerRow).toContainText(`+254733${runSuffix}11`);
    await expect(partnerRow).toContainText('Supplier');
    await expect(partnerRow).toContainText('Buyer');
    await page.getByLabel('Search').fill('nobody by this name');
    await expect(page.getByText('No partners match')).toBeVisible();
    await page.getByLabel('Search').fill(`0733 ${runSuffix}`);
    await expect(partnerRow).toBeVisible();

    // Supply: needs an item in the catalogue, then an offer from that supplier.
    await page.getByRole('link', { name: 'Catalogue' }).click();
    await page.getByRole('button', { name: 'Add item' }).click();
    await expect(page.getByText('1 active')).toBeVisible();
    await page.getByRole('link', { name: 'Supply' }).click();
    await page.getByRole('button', { name: 'Record supply' }).click();
    const supplyForm = page.locator('form');
    await supplyForm.getByLabel('Quantity').fill('40');
    await supplyForm.getByLabel('Origin').selectOption('wild');
    await page.getByRole('button', { name: 'Record supply' }).click();
    const offerRow = page.getByRole('row', { name: /Dunga Beach BMU/ });
    await expect(offerRow).toContainText('40 kilogram');
    await expect(offerRow).toContainText('Available');
    await offerRow.getByRole('button', { name: 'Reserve' }).click();
    await expect(offerRow).toContainText('Reserved');
  });

  test('the same session opens BlueData without signing in again, and sign-out ends both', async ({
    page,
  }) => {
    // Each test has a fresh browser context, so this user signs up independently.
    await signUp(page, localNumber(2), 'Baraka E2E');
    const orgId = await registerOrganisation(page, `Mwanza E2E Data ${runSuffix}`);

    await page.goto(`${BLUEDATA_URL}/`);
    await expect(page).toHaveURL(`${BLUEDATA_URL}/o/${orgId}`);
    await expect(page.getByRole('heading', { name: 'Fisheries intelligence' })).toBeVisible();
    await expect(page.getByText('Forecast', { exact: true })).toBeVisible(); // provenance legend

    await page.getByRole('button', { name: 'Switch organisation' }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(`${BLUEDATA_URL}/sign-in`);

    await page.goto(`${SAMAKIOS_URL}/o/${orgId}`);
    await expect(page).toHaveURL(`${SAMAKIOS_URL}/sign-in`);
  });

  test("another user cannot open someone else's organisation", async ({ page }) => {
    expect(organisationId).not.toBe('');
    await signUp(page, localNumber(3), 'Mallory E2E');
    await page.goto(`${SAMAKIOS_URL}/o/${organisationId}`);
    await expect(page).toHaveURL(`${SAMAKIOS_URL}/organisations`);
    await expect(page.getByText(`Kisumu E2E Traders ${runSuffix}`)).toHaveCount(0);
  });
});
