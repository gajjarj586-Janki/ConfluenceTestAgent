import { chromium } from 'playwright';
import dotenv from 'dotenv';
dotenv.config();

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('https://stage.hyundai.com.au/au/en/contact-a-dealer', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(3000);

// Click Set location
const setLocDiv = page.locator('div[role="button"]:has-text("Set location")').first();
await setLocDiv.click();
await page.waitForTimeout(2000);

// Find ALL inputs in the modal
const modalContainer = page.locator('.hyu-postcode-modal');
const allInputs = await modalContainer.locator('input').all();
console.log('Total inputs in modal:', allInputs.length);
for (let i = 0; i < allInputs.length; i++) {
  const el = allInputs[i];
  const details = await el.evaluate(e => ({
    id: e.id,
    type: e.type,
    placeholder: e.placeholder,
    className: e.className,
    visible: e.offsetWidth > 0 && e.offsetHeight > 0,
    visibility: getComputedStyle(e).visibility,
    display: getComputedStyle(e).display,
    width: e.offsetWidth,
    height: e.offsetHeight,
  }));
  console.log(`Input ${i}:`, JSON.stringify(details));
}

// Check the wrapper for visible text input areas
const wrapper = modalContainer.locator('.hyu-postcode-modal--postcode-input-wrapper, .js-hyu-postcode-modal--postcode-input-wrapper');
const wrapperHTML = await wrapper.first().evaluate(e => e.innerHTML.substring(0, 800));
console.log('Wrapper HTML:', wrapperHTML);

// Look for any contenteditable or visible input-like elements
const editableSpans = await modalContainer.locator('[contenteditable], [role="textbox"], [role="combobox"]').all();
console.log('Editable elements:', editableSpans.length);

// Look for a visible input in the box
const inputBox = modalContainer.locator('.hyu-postcode-modal--postcode-input-box');
const boxHTML = await inputBox.first().evaluate(e => e.innerHTML.substring(0, 1000));
console.log('Input box HTML:', boxHTML);

await browser.close();
