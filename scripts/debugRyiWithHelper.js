import { chromium } from 'playwright';
import { fillGenesisFieldsFromDataTable, clickSubmitAndCapture } from '../features/cucumber/support/genesisFormHelpers.js';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 2400 } });
await page.goto('https://stage.genesis-motors.com.au/au/en/models/gv60-magma-teaser.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(2000);
await page.locator('form#form-ryi-form').first().scrollIntoViewIfNeeded().catch(() => {});

const entries = [
  ['First Name', 'Janki'],
  ['Last Name', 'Tester'],
  ['Email', 'tester@example.com'],
  ['Contact Number', '0431667796'],
  ['Postal Code', '2000'],
  ['Preferred Contact Method', 'Email'],
  ['Terms and Conditions', 'Checked'],
];

await fillGenesisFieldsFromDataTable(page, entries);
console.log('filled mobile value', await page.locator('#mobile').inputValue().catch(() => 'N/A'));
console.log('filled post code', await page.locator('#inpCode1').inputValue().catch(() => 'N/A'));
console.log('checked terms', await page.locator('#agreeCheck').isChecked().catch(() => false));

const state = await clickSubmitAndCapture(page, 'Last Name');
console.log(JSON.stringify(state, null, 2));
console.log('url after helper', page.url());
await page.screenshot({ path: 'screenshots/debug-ryi-helper.png', fullPage: true });
await browser.close();
