import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 2400 } });
await page.goto('https://stage.genesis-motors.com.au/au/en/models/gv60-magma-teaser.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(2000);

const form = page.locator('form#form-ryi-form').first();
await form.scrollIntoViewIfNeeded();
await page.locator('#firstName').fill('Janki');
await page.locator('#lastName').fill('Tester');
await page.locator('#email').fill('tester@example.com');
await page.locator('#mobile').fill('0431667796');
await page.locator('#inpCode1').fill('2000');
await page.locator('label[for="methodCheck0"], input#methodCheck0').first().click({ force: true }).catch(()=>{});
await page.locator('label[for="agreeCheck"], input#agreeCheck').first().click({ force: true }).catch(()=>{});
await page.waitForTimeout(500);

const submit = page.locator('form#form-ryi-form button[type="submit"]').first();
console.log('submit count', await submit.count());
console.log('submit text', await submit.textContent());
console.log('url before', page.url());

await submit.click({ force: true }).catch(async () => {
  await submit.evaluate((el) => el.click());
});

await page.waitForTimeout(4000);
console.log('url after', page.url());
const bodyText = await page.locator('body').textContent();
console.log('thankyou?', /thank you/i.test(bodyText || ''));
console.log('sorry?', /sorry/i.test(bodyText || ''));
console.log('lastname visible?', await page.locator('#lastName').isVisible().catch(()=>false));
await page.screenshot({ path: 'screenshots/debug-ryi-submit.png', fullPage: true });
await browser.close();
