/**
 * Temporary inspection script — discovers all fields in the BATD modal
 * across all steps and records structure for test automation.
 * Run: node scripts/inspectBATDModal.js
 */
import { chromium } from 'playwright';

async function handleLocationModal(page) {
  // Wait for the location modal — it appears asynchronously after page load
  await page.waitForTimeout(3000);
  
  // Use the same dual-input trick — last visible input with the postcode ID
  const inputs = page.locator('#locaion-modal-input');
  const count = await inputs.count();
  console.log(`Location modal inputs found: ${count}`);
  
  let visibleInput = null;
  for (let i = count - 1; i >= 0; i--) {
    const el = inputs.nth(i);
    if (await el.isVisible().catch(() => false)) { visibleInput = el; break; }
  }
  if (!visibleInput) {
    console.log('No visible location input — modal may already be dismissed');
    return;
  }
  console.log('Filling postcode 2000...');
  await visibleInput.fill('2000');
  await page.waitForTimeout(500);
  await visibleInput.press('Enter');
  await page.waitForTimeout(2500);
  const resultItem = page.locator('.hyu-postcode-modal--location-list li').first();
  if (await resultItem.count() > 0 && await resultItem.isVisible().catch(() => false)) {
    const text = await resultItem.textContent();
    console.log(`Selecting: ${text.trim()}`);
    await resultItem.click();
    await page.waitForTimeout(2500);
  }
  const setDlr = page.locator('.tingle-modal--visible .js-hyu-postcode-modal--btn-set-dealer, .tingle-modal--visible button:has-text("Set dealer")').first();
  if (await setDlr.count() > 0 && await setDlr.isVisible().catch(() => false)) {
    await setDlr.click();
    console.log('Clicked Set dealer');
    await page.waitForTimeout(2500);
  }
}

async function inspectModalFields(page, stepLabel) {
  const result = await page.evaluate(() => {
    const wrapper = Array.from(document.querySelectorAll('.modal-wrapper')).find(el => {
      const h = el.querySelector('.modal-header');
      return h && h.textContent.includes('Book a test drive') &&
             parseFloat(window.getComputedStyle(el).opacity) > 0.5;
    });
    if (!wrapper) return { error: 'modal not found' };
    const fields = [];
    wrapper.querySelectorAll('input, select, textarea, button, label').forEach(el => {
      if (el.offsetWidth === 0 && el.offsetHeight === 0) return;
      fields.push({
        tag: el.tagName,
        type: el.type || null,
        name: el.name || null,
        id: el.id || null,
        placeholder: el.placeholder || null,
        class: el.className.substring(0, 100),
        value: el.tagName === 'SELECT' ? el.options[el.selectedIndex]?.text : (el.value || null),
        text: el.textContent.trim().substring(0, 60),
        required: el.required || false,
      });
    });
    // Also get select options
    const selects = [];
    wrapper.querySelectorAll('select').forEach(sel => {
      selects.push({
        name: sel.name,
        id: sel.id,
        options: Array.from(sel.options).map(o => ({ value: o.value, text: o.text }))
      });
    });
    return { fields, selects };
  });
  console.log(`\n===== ${stepLabel} =====`);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 200 });
  const page = await browser.newPage();

  console.log('Navigating to KONA CPC page...');
  await page.goto('https://stage.hyundai.com.au/au/en/shop/calculator/kona', {
    waitUntil: 'networkidle',
    timeout: 60000
  }).catch(() => console.log('networkidle timeout — continuing'));

  await handleLocationModal(page);

  // Click BATD button
  const batdBtn = page.locator('.cta-blue.cta-test-drive button.btn-white').first();
  await batdBtn.waitFor({ state: 'visible', timeout: 15000 });
  await batdBtn.scrollIntoViewIfNeeded();
  await batdBtn.click();
  await page.waitForTimeout(3000);

  // --- STEP 1: Inspect ---
  const step1 = await inspectModalFields(page, 'STEP 1 — Model & Variant');

  if (step1.error) {
    console.log('Modal not found. Exiting.');
    await browser.close();
    process.exit(1);
  }

  // Model select is first, Variant is second — both inside the active .modal-wrapper
  // Wait for variant options to populate
  await page.waitForTimeout(1000);
  const selects = await page.locator('.modal-wrapper select').all();
  console.log(`\nNumber of selects in modal: ${selects.length}`);
  for (let i = 0; i < selects.length; i++) {
    const opts = await selects[i].evaluate(el =>
      Array.from(el.options).map(o => `${o.value}|${o.text}`)
    );
    console.log(`Select[${i}] options:`, opts);
  }

  // Select Variant (index 1) — first non-empty option
  if (selects.length >= 2) {
    await selects[1].selectOption({ index: 1 });
    await page.waitForTimeout(1500);
    console.log('Selected variant');
  }

  // Wait for Next to become enabled (up to 10s)
  await page.waitForFunction(() => {
    const btn = document.querySelector('.modal-footer .btn.next, .modal-footer button');
    return btn && !btn.disabled;
  }, { timeout: 10000 }).catch(() => console.log('Next still disabled after 10s'));

  // Click Next
  const nextBtn = page.locator('.modal-footer button:has-text("Next")').first();
  await nextBtn.click({ timeout: 5000 }).catch(e => console.log('Next click err:', e.message));
  await page.waitForTimeout(2000);

  // --- STEP 2: Inspect ---
  await inspectModalFields(page, 'STEP 2 — Personal Details');

  // Try fill personal details
  const firstNameInput = page.locator('.modal-wrapper input[name*="FirstName" i], .modal-wrapper input[placeholder*="First" i]').first();
  const lastNameInput = page.locator('.modal-wrapper input[name*="LastName" i], .modal-wrapper input[placeholder*="Last" i]').first();
  const emailInput = page.locator('.modal-wrapper input[type="email"], .modal-wrapper input[name*="Email" i]').first();
  const phoneInput = page.locator('.modal-wrapper input[type="tel"], .modal-wrapper input[name*="Phone" i], .modal-wrapper input[name*="Mobile" i]').first();
  const postcodeInput = page.locator('.modal-wrapper input[name*="postcode" i], .modal-wrapper input[placeholder*="postcode" i], .modal-wrapper input[placeholder*="suburb" i]').first();

  if (await firstNameInput.count() > 0 && await firstNameInput.isVisible()) await firstNameInput.fill('Test');
  if (await lastNameInput.count() > 0 && await lastNameInput.isVisible()) await lastNameInput.fill('Automation');
  if (await emailInput.count() > 0 && await emailInput.isVisible()) await emailInput.fill('test.automation@hyundai.com.au');
  if (await phoneInput.count() > 0 && await phoneInput.isVisible()) await phoneInput.fill('0400000000');
  if (await postcodeInput.count() > 0 && await postcodeInput.isVisible()) await postcodeInput.fill('2000');
  await page.waitForTimeout(1000);

  // Re-inspect after filling
  await inspectModalFields(page, 'STEP 2 — After filling personal details');

  // Click Next
  const nextBtn2 = page.locator('.modal-footer button:has-text("Next")').first();
  if (await nextBtn2.count() > 0 && await nextBtn2.isVisible()) {
    await nextBtn2.click();
    await page.waitForTimeout(2000);
    await inspectModalFields(page, 'STEP 3 — After Next from step 2');
  }

  // Click Next again if step 3 exists
  const nextBtn3 = page.locator('.modal-footer button:has-text("Next")').first();
  if (await nextBtn3.count() > 0 && await nextBtn3.isVisible()) {
    await nextBtn3.click();
    await page.waitForTimeout(2000);
    await inspectModalFields(page, 'STEP 4 — After Next from step 3');
  }

  // Check for Submit button
  const submitBtn = page.locator('.modal-footer button[type="submit"], .modal-footer button:has-text("Submit"), .modal-footer input[type="submit"]').first();
  if (await submitBtn.count() > 0 && await submitBtn.isVisible()) {
    console.log('\n✅ Submit button found!', await submitBtn.textContent());
  } else {
    const allBtns = await page.locator('.modal-footer button').allTextContents();
    console.log('\nAll footer buttons at last step:', allBtns);
  }

  console.log('\nInspection complete. Keeping browser open 10s...');
  await page.waitForTimeout(10000);
  await browser.close();
})();
