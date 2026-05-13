import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const b = await chromium.launch({ headless: false });
const page = await b.newPage();

try {
  await page.goto('https://stage.hyundai.com.au/au/en/crm-ownership-update', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);
  console.log('✅ Page loaded');

  // Fill VIN
  const vin = page.locator('[aria-label="Enter your VIN"]').first();
  await vin.waitFor({ state: 'visible', timeout: 10000 });
  await vin.fill('KMHDB81SMBU123456');
  console.log('✅ VIN filled');

  // Click Check
  const checkBtn = page.locator('button').filter({ hasText: /^check$/i }).first();
  await checkBtn.click({ force: true });
  await page.waitForTimeout(5000);
  console.log('✅ Check clicked');

  // Click Yes
  const yesLabel = page.locator('label').filter({ hasText: /^yes$/i }).first();
  if (await yesLabel.count() > 0) { await yesLabel.click({ force: true }); console.log('✅ Clicked Yes'); }
  await page.waitForTimeout(2000);

  // Fill all visible inputs
  const inputs = await page.locator('input:visible, select:visible, textarea:visible').all();
  console.log(`Found ${inputs.length} visible inputs`);
  for (const inp of inputs) {
    const tag = await inp.evaluate(el => el.tagName.toLowerCase());
    const type = await inp.evaluate(el => el.type || '');
    const id = await inp.evaluate(el => el.id || el.name || '');
    if (tag === 'select') {
      await inp.selectOption({ index: 1 }).catch(() => {});
    } else if (type === 'checkbox' || type === 'radio') {
      // skip
    } else if (type === 'email') {
      await inp.fill('test@test.com').catch(() => {});
    } else if (type === 'tel' || /mobile|phone/i.test(id)) {
      await inp.fill('0400000000').catch(() => {});
    } else if (/post|zip/i.test(id)) {
      await inp.fill('2000').catch(() => {});
    } else if (/first/i.test(id)) {
      await inp.fill('Test').catch(() => {});
    } else if (/last/i.test(id)) {
      await inp.fill('User').catch(() => {});
    } else if (/suburb|city/i.test(id)) {
      await inp.fill('Sydney').catch(() => {});
    } else if (/address/i.test(id)) {
      await inp.fill('1 Test St').catch(() => {});
    }
  }
  await page.waitForTimeout(1000);

  // Check any unset checkboxes that are required (marketing auth etc)
  const unchecked = page.locator('input[type="checkbox"]:visible');
  for (const cb of await unchecked.all()) {
    await cb.check({ force: true }).catch(() => {});
  }

  await page.screenshot({ path: 'scripts/debug_before_submit.png', fullPage: true });
  console.log('📸 Screenshot: debug_before_submit.png');

  // Click Submit
  const submitBtn = page.locator('button').filter({ hasText: /^submit$/i }).first();
  if (await submitBtn.count() > 0) {
    await submitBtn.evaluate(el => el.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(500);
    await submitBtn.click({ force: true });
    console.log('✅ Submit clicked');
  }
  await page.waitForTimeout(5000);

  await page.screenshot({ path: 'scripts/debug_after_submit.png', fullPage: true });
  console.log('📸 Screenshot: debug_after_submit.png');

  // Dump popup / visible buttons
  const result = await page.evaluate(() => {
    const allVisible = Array.from(document.querySelectorAll('*')).filter(el => {
      const s = getComputedStyle(el);
      return el.offsetParent !== null && s.display !== 'none' && s.visibility !== 'hidden';
    });
    const dialogs = allVisible.filter(el => /modal|popup|confirm|dialog|overlay/i.test(el.className + el.id + (el.getAttribute('role') || '')));
    const buttons = Array.from(document.querySelectorAll('button, input[type="submit"]'))
      .filter(b => b.offsetParent !== null)
      .map(b => ({ text: b.textContent.trim(), class: b.className, id: b.id, type: b.type }));
    return {
      dialogCount: dialogs.length,
      dialogs: dialogs.slice(0, 3).map(el => ({ tag: el.tagName, class: el.className, id: el.id, html: el.outerHTML.substring(0, 1500) })),
      buttons,
      bodySnippet: (document.body.innerText || '').substring(0, 600)
    };
  });

  writeFileSync('scripts/popup_dump.json', JSON.stringify(result, null, 2));
  console.log('📄 Dumped to scripts/popup_dump.json');
  console.log('BUTTONS:', JSON.stringify(result.buttons, null, 2));
  console.log('BODY TEXT:', result.bodySnippet);
  console.log('DIALOG COUNT:', result.dialogCount);

} catch (e) {
  console.error('ERROR:', e.message);
}

await b.close();
