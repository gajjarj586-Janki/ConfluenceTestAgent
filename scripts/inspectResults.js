import { chromium } from 'playwright';
import dotenv from 'dotenv';
dotenv.config();

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('https://stage.hyundai.com.au/au/en/contact-a-dealer', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(5000);

// Click "Set location"
const setLocBtn = page.locator('div[role="button"]:has-text("Set location")').first();
await setLocBtn.scrollIntoViewIfNeeded().catch(() => {});
await setLocBtn.click({ timeout: 5000 });
console.log('1. Clicked Set location');
await page.waitForTimeout(2000);

// Fill the visible input
const inputs = page.locator('.hyu-postcode-modal input#locaion-modal-input');
const count = await inputs.count();
let visInput = null;
for (let i = count - 1; i >= 0; i--) {
  if (await inputs.nth(i).isVisible().catch(() => false)) { visInput = inputs.nth(i); break; }
}
await visInput.fill('2000');
await page.waitForTimeout(500);
await visInput.press('Enter');
console.log('2. Filled "2000" and pressed Enter');
await page.waitForTimeout(3000);

// Check results
const resultItems = page.locator('.hyu-postcode-modal--location-list li');
const resultCount = await resultItems.count();
console.log(`3. Result items: ${resultCount}`);

// Check footer buttons BEFORE clicking result
const setDealerBtnBefore = page.locator('.js-hyu-postcode-modal--btn-set-dealer').first();
const dealerBtnVisibleBefore = (await setDealerBtnBefore.count()) > 0 && (await setDealerBtnBefore.isVisible().catch(() => false));
console.log(`4. Set dealer button visible BEFORE clicking result: ${dealerBtnVisibleBefore}`);

// Click the first result
if (resultCount > 0) {
  const firstResult = resultItems.first();
  const text = await firstResult.textContent();
  console.log(`5. Clicking result: "${text.trim()}"`);
  await firstResult.click();
  
  // Wait and check
  await page.waitForTimeout(2000);
  
  // Dump full modal HTML after click
  const modalAfter = await page.evaluate(() => {
    const modal = document.querySelector('.tingle-modal--visible .tingle-modal-box__content');
    return modal ? modal.innerHTML.substring(0, 3000) : 'no modal';
  });
  console.log(`\n=== Modal HTML After Click ===\n${modalAfter.substring(0, 1500)}`);
  
  // Check loader
  const loaderVisible = await page.locator('.js-hyu-postcode-loader').isVisible().catch(() => false);
  console.log(`\nLoader visible: ${loaderVisible}`);
  
  // Check all buttons in modal
  const btns = page.locator('.tingle-modal--visible button');
  const btnCount = await btns.count();
  console.log(`\nAll modal buttons (${btnCount}):`);
  for (let i = 0; i < btnCount; i++) {
    const el = btns.nth(i);
    const btnText = (await el.textContent().catch(() => '')).trim();
    const btnVisible = await el.isVisible().catch(() => false);
    const cls = await el.evaluate(e => e.className).catch(() => '');
    console.log(`  [${i}] "${btnText}" visible=${btnVisible} class="${cls}"`);
  }
  
  // Wait longer and check again
  await page.waitForTimeout(5000);
  const modalAfter2 = await page.evaluate(() => {
    const modal = document.querySelector('.tingle-modal--visible .tingle-modal-box__content');
    return modal ? modal.innerHTML.substring(0, 3000) : 'no modal';
  });
  console.log(`\n=== Modal HTML After 7s ===\n${modalAfter2.substring(0, 1500)}`);
  
  const btns2 = page.locator('.tingle-modal--visible button');
  const btnCount2 = await btns2.count();
  console.log(`\nAll modal buttons after 7s (${btnCount2}):`);
  for (let i = 0; i < btnCount2; i++) {
    const el = btns2.nth(i);
    const btnText = (await el.textContent().catch(() => '')).trim();
    const btnVisible = await el.isVisible().catch(() => false);
    console.log(`  [${i}] "${btnText}" visible=${btnVisible}`);
  }
}

// Check final state of the button on the main page
const finalLocBtn = page.locator('div[role="button"]:has-text("Set location")').first();
const finalLocBtnVisible = (await finalLocBtn.count()) > 0 && (await finalLocBtn.isVisible().catch(() => false));
const finalLocBtnText = finalLocBtnVisible ? await finalLocBtn.textContent() : 'N/A';
console.log(`\n6. Final "Set location" button visible: ${finalLocBtnVisible}, text: "${finalLocBtnText.trim()}"`);

await browser.close();
