/**
 * Shared helper functions — no Cucumber imports.
 *
 * Import from here (not common_steps.js) to avoid loading a step-definition
 * module as a static ESM dependency, which causes Cucumber's builder to run
 * before it reaches 'running' status and throws a PENDING error.
 *
 * Usage:
 *   import { handleLocationModal } from './commonHelpers.js';
 */

/**
 * Dismiss the Hyundai "Set your location" postcode modal.
 * Two inputs share id="locaion-modal-input" (typo in site HTML).
 * The first is 0×0 hidden; we iterate backwards to find the visible one.
 */
export async function handleLocationModal(page, postcode = '2000') {
  const modalContainer = page.locator('.hyu-postcode-modal.tingle-modal--visible').first();
  try {
    await modalContainer.waitFor({ state: 'visible', timeout: 15000 });
  } catch {
    console.log('📍 No location modal appeared — continuing');
    return;
  }
  console.log('📍 Location modal detected — filling postcode via visible input');

  const modalInputs = page.locator('.hyu-postcode-modal input#locaion-modal-input');
  const inputCount = await modalInputs.count();
  let modalInput = null;
  for (let i = inputCount - 1; i >= 0; i--) {
    const el = modalInputs.nth(i);
    if (await el.isVisible().catch(() => false)) { modalInput = el; break; }
  }

  if (modalInput) {
    await modalInput.fill(postcode.toString());
    await page.waitForTimeout(500);
    await modalInput.press('Enter');
    await page.waitForTimeout(2000);

    const resultItem = page.locator('.tingle-modal--visible .hyu-postcode-modal--location-list li').first();
    if ((await resultItem.count()) > 0 && (await resultItem.isVisible().catch(() => false))) {
      const text = await resultItem.textContent().catch(() => '');
      console.log(`📍 Selecting first result: "${text.trim()}"`);
      await resultItem.click();
      await page.waitForTimeout(3000);

      const setDealerBtn = page.locator(
        '.tingle-modal--visible .js-hyu-postcode-modal--btn-set-dealer, ' +
        '.tingle-modal--visible button:has-text("Set dealer")'
      ).first();
      if ((await setDealerBtn.count()) > 0 && (await setDealerBtn.isVisible().catch(() => false))) {
        await setDealerBtn.click();
        await page.waitForTimeout(2000);
        console.log('📍 Clicked Set dealer — modal dismissed');
      }
    } else {
      console.log('⚠️ No results found after Enter — pressing Escape');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }
  } else {
    console.log('⚠️ No visible modal input found — pressing Escape');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }
}

/**
 * Click a variant tile on the Hyundai consumer calculator
 * (e.g. "VENUE Active"). Tries exact text, role-based, then fuzzy.
 */
export async function selectConsumerVariant(page, variant) {
  console.log(`🖱️  Selecting variant on calculator: ${variant}`);
  const escRe = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const candidates = [
    page.getByText(variant, { exact: true }),
    page.getByText(new RegExp(`^\\s*${escRe}\\s*$`, 'i')),
    page.getByRole('button', { name: new RegExp(escRe, 'i') }),
    page.getByRole('link', { name: new RegExp(escRe, 'i') }),
    page.getByText(new RegExp(escRe, 'i')),
  ];
  let target = null;
  for (const loc of candidates) {
    const first = loc.first();
    try {
      await first.waitFor({ state: 'visible', timeout: 4000 });
      target = first;
      break;
    } catch { /* try next */ }
  }
  if (!target) {
    const samples = await page.evaluate(() => {
      const out = []; const seen = new Set();
      document.querySelectorAll('button, a, h2, h3, h4, [role="button"], div, span').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        let t = '';
        for (const n of el.childNodes) if (n.nodeType === 3) t += n.nodeValue;
        t = t.trim();
        if (!t || t.length > 60 || seen.has(t)) return;
        seen.add(t); out.push(t);
      });
      return out.slice(0, 40);
    }).catch(() => []);
    throw new Error(`Could not find variant "${variant}" on the consumer calculator. Visible candidates: ${JSON.stringify(samples)}`);
  }
  await target.scrollIntoViewIfNeeded().catch(() => {});
  await Promise.all([
    page.waitForResponse(r => /variantpricecalc/i.test(r.url()) && r.ok(), { timeout: 30000 }).catch(() => null),
    target.click({ timeout: 8000 }),
  ]);
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
}

/**
 * Click a non-variant option on the Hyundai consumer calculator
 * (powertrain, transmission, option pack value, etc.).
 */
export async function selectConsumerOption(page, label) {
  console.log(`🖱️  Selecting option on calculator: ${label}`);
  const escRe = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const exactRe = new RegExp(`^\\s*${escRe}\\s*$`, 'i');
  const candidates = [
    page.getByRole('button', { name: exactRe }),
    page.getByRole('radio', { name: exactRe }),
    page.getByRole('link', { name: exactRe }),
    page.getByText(label, { exact: true }),
    page.getByText(exactRe),
  ];
  let target = null;
  for (const loc of candidates) {
    const first = loc.first();
    try {
      await first.waitFor({ state: 'visible', timeout: 4000 });
      target = first;
      break;
    } catch { /* try next */ }
  }
  if (!target) {
    const samples = await page.evaluate(() => {
      const out = []; const seen = new Set();
      document.querySelectorAll('button, a, h2, h3, h4, [role="button"], [role="radio"], div, span').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        let t = '';
        for (const n of el.childNodes) if (n.nodeType === 3) t += n.nodeValue;
        t = t.trim();
        if (!t || t.length > 60 || seen.has(t)) return;
        seen.add(t); out.push(t);
      });
      return out.slice(0, 60);
    }).catch(() => []);
    throw new Error(`Could not find consumer option "${label}". Visible candidates: ${JSON.stringify(samples)}`);
  }
  await target.scrollIntoViewIfNeeded().catch(() => {});
  await Promise.all([
    page.waitForResponse(r => /variantpricecalc/i.test(r.url()) && r.ok(), { timeout: 10000 }).catch(() => null),
    target.click({ timeout: 8000 }),
  ]);
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
}
