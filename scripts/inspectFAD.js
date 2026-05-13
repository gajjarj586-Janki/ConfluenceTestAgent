/**
 * FAD DOM inspector v2 — inspects #dealer-type INPUT and Search button structure.
 */
import { chromium } from 'playwright';

const FAD_URL = 'https://stage.hyundai.com.au/au/en/find-a-dealer';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

console.log(`\n🌐 Navigating …`);
await page.goto(FAD_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(4000);

// ── 1. Full structure around #dealer-type ────────────────────────────────────
const dtStructure = await page.evaluate(() => {
  const el = document.querySelector('#dealer-type');
  if (!el) return { found: false };
  const parent = el.parentElement;
  const grandparent = parent?.parentElement;
  return {
    element: { tag: el.tagName, type: el.type, id: el.id, classes: el.className, value: el.value, readonly: el.readOnly },
    parent: { tag: parent?.tagName, classes: parent?.className, childTags: Array.from(parent?.children || []).map(c => c.tagName + '#' + c.id + '.' + c.className.split(' ')[0]) },
    grandparent: { tag: grandparent?.tagName, classes: grandparent?.className },
    // Look for any <select> or <ul> siblings that might be the real dropdown
    siblings: Array.from(parent?.children || []).map(c => ({ tag: c.tagName, id: c.id, classes: c.className, text: c.textContent?.trim().slice(0, 30) }))
  };
});
console.log('\n── #dealer-type structure ──');
console.log(JSON.stringify(dtStructure, null, 2));

// ── 2. Click the dealer-type input and look for dropdown options ─────────────
console.log('\n── Clicking #dealer-type input …');
await page.locator('#dealer-type').click();
await page.waitForTimeout(1500);

const dropdownAfterClick = await page.evaluate(() => {
  // Look for any newly visible dropdown/list near the dealer-type element
  const selectors = ['ul[role="listbox"]', '[role="listbox"]', '.dealer-type-options', '[class*="dropdown"]:not([style*="display: none"])', 'ul li:has-text("Sales")', '.select-dropdown', '.custom-select__list', '.hyu-select-dropdown'];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) {
      const rect = el.getBoundingClientRect();
      return { selector: sel, visible: rect.width > 0 && rect.height > 0, items: Array.from(el.querySelectorAll('li, [role="option"]')).map(li => li.textContent.trim()) };
    }
  }
  // Scan all visible lists
  const allLists = Array.from(document.querySelectorAll('ul')).filter(ul => {
    const r = ul.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.top < window.innerHeight;
  });
  return { selector: 'none matched', allVisibleLists: allLists.map(ul => ({ classes: ul.className, items: Array.from(ul.querySelectorAll('li')).map(li => li.textContent.trim().slice(0, 30)) })) };
});
console.log('\n── Dropdown after clicking #dealer-type ──');
console.log(JSON.stringify(dropdownAfterClick, null, 2));

// ── 3. Find the Search button and check its visibility ───────────────────────
const searchBtnInfo = await page.evaluate(() => {
  const candidates = Array.from(document.querySelectorAll('button, input[type="submit"]')).filter(b =>
    /search/i.test(b.textContent + b.getAttribute('aria-label') + b.className)
  );
  return candidates.map(b => {
    const r = b.getBoundingClientRect();
    const s = window.getComputedStyle(b);
    return {
      tag: b.tagName, type: b.type, classes: b.className, ariaLabel: b.getAttribute('aria-label'),
      text: b.textContent.trim().slice(0, 20),
      visible: r.width > 0 && r.height > 0,
      display: s.display, visibility: s.visibility, opacity: s.opacity,
      position: { top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width), height: Math.round(r.height) }
    };
  });
});
console.log('\n── Search button info ──');
console.log(JSON.stringify(searchBtnInfo, null, 2));

// ── 4. Fill #location and check Search button visibility after ───────────────
console.log('\n── Filling #location with "2000" …');
await page.keyboard.press('Escape'); // close any dropdown
await page.locator('#location').click();
await page.waitForTimeout(200);
await page.keyboard.press('Control+a');
await page.keyboard.press('Delete');
await page.locator('#location').pressSequentially('2000', { delay: 60 });
await page.waitForTimeout(1500);

const locValue = await page.locator('#location').inputValue();
console.log(`#location value: "${locValue}"`);

const searchBtnAfterFill = await page.evaluate(() => {
  const btn = document.querySelector('button.search-submit, button[aria-label="Search submit"]');
  if (!btn) return 'NOT FOUND';
  const r = btn.getBoundingClientRect();
  const s = window.getComputedStyle(btn);
  return { visible: r.width > 0 && r.height > 0, display: s.display, visibility: s.visibility, opacity: s.opacity, disabled: btn.disabled };
});
console.log('\n── Search button after filling location ──');
console.log(JSON.stringify(searchBtnAfterFill, null, 2));

// ── 5. Try force-clicking Search ────────────────────────────────────────────
console.log('\n── Force-clicking Search button …');
await page.locator('button.search-submit, button[aria-label="Search submit"]').first().click({ force: true }).catch(e => console.log('force click error:', e.message));
await page.waitForTimeout(4000);

// Check for dealer cards
const dealerCards = await page.evaluate(() => {
  const selectors = ['.dealer-card', '.dealer-result', '[class*="dealer-card"]', '[class*="dealer-result"]', '.search-result'];
  for (const sel of selectors) {
    const els = document.querySelectorAll(sel);
    if (els.length > 0) {
      const first = els[0];
      const btns = Array.from(first.querySelectorAll('button, a')).map(b => ({ tag: b.tagName, text: b.textContent.trim().slice(0, 40), classes: b.className }));
      return { selector: sel, count: els.length, firstCardButtons: btns };
    }
  }
  // Check if error message shown
  const err = document.querySelector('.error-message, [class*="error"], .please-enter');
  return { selector: 'none', count: 0, errorText: err?.textContent?.trim() };
});
console.log('\n── Dealer cards after force-search ──');
console.log(JSON.stringify(dealerCards, null, 2));

await browser.close();
console.log('\n✅ Done');
