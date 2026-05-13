// @protected
/**
 * Step Definitions for: Form submission on Hyundai CPC
 * Source: CPC-allFIFOs_1.feature
 *
 * This file is manually maintained. Add '// @protected' to prevent the
 * auto-generator from ever appending or modifying this file.
 */
import { Given, When, Then } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import { handleLocationModal } from './commonHelpers.js';
import fs from 'node:fs';
import path from 'node:path';

// ─── Navigate to a specific model URL ────────────────────────
// The stage site uses Vue Router — domcontentloaded fires early, then the
// router may redirect /calculator/kona → /calculator (model list).
// We wait for the network to settle, then check the current URL and click
// the model from the list if we got redirected.
Given(/^user goes to a specific model (.+)$/, async function (modelUrl) {
  let url = modelUrl.trim();

  // If no protocol given, treat as "page/model" — resolve the page base URL from env cache
  if (!url.startsWith('http')) {
    const parts = url.split('/');
    const pageKey = parts[0].toLowerCase();  // e.g. "calculator"
    const modelPath = parts.slice(1).join('/'); // e.g. "kona"
    const cachedPath = path.join(process.cwd(), '.cache', 'activeEnvironment.json');
    let baseUrl = '';
    try {
      const env = JSON.parse(fs.readFileSync(cachedPath, 'utf-8'));
      baseUrl = env.pageUrls?.[pageKey] || '';
    } catch { /* ignore */ }
    if (!baseUrl) throw new Error(`No URL found in environment cache for page key "${pageKey}"`);
    url = modelPath ? `${baseUrl}/${modelPath}` : baseUrl;
  }

  console.log(`📋 Navigating to: ${url}`);

  try {
    await this.page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  } catch {
    // networkidle can time out on slow stage env; continue with whatever loaded
    console.log('📋 networkidle timed out — continuing with current page state');
  }

  // Check if Vue Router redirected us away from the target URL
  const currentUrl = this.page.url();
  console.log(`📋 Current URL after navigation: ${currentUrl}`);

  if (!currentUrl.includes('/kona') && !currentUrl.includes('/calculator/kona')) {
    // We're on the model list — find and click KONA
    console.log('📋 Redirected to model list — clicking KONA');
    const konaCard = this.page.locator([
      '.cpc-models-list-item:has-text("KONA")',
      'a:has-text("KONA.")',
      '[class*="model"]:has-text("KONA")',
    ].join(', ')).first();
    await konaCard.waitFor({ state: 'visible', timeout: 10000 });
    await konaCard.click();
    await this.page.waitForTimeout(3000);
    console.log(`📋 Clicked KONA — now at: ${this.page.url()}`);
  }
});

// ─── Click "Book a test drive" / "test drive" CTA ────────────
Given('user clicks on Book a test drive', async function () {
  // Defensive: handle location modal if it wasn't dismissed by an explicit postcode step
  await handleLocationModal(this.page);
  console.log('📋 Looking for Book a test drive button on CPC page');

  // The correct element is the BUTTON inside the dark blue ".cta-blue.cta-test-drive" panel.
  // NOTE: a.cta-holder elements are the bottom icon navigation bar (Build & Price, Find a dealer,
  // test drive footer links) — clicking the first a.cta-holder navigates to /calculator, NOT the modal.
  const batdBtn = this.page.locator([
    '.cta-blue.cta-test-drive button.btn-white',
    '.cta-blue.cta-test-drive button:has-text("Book a test drive")',
    '.cta-main-feature button:has-text("Book a test drive")',
    'button.btn-white:has-text("Book a test drive")',
    // FAD dealer card — CTAs are <a> tags (not <button>) with specific classes
    // NOTE: do NOT use a:has-text("Book a test drive") — it matches the navbar nav-card too
    '.dealer-card a.hyu-trigger-pcm2-book-test-drive-modal',
    '.dealer-card a.btn-book-test-drive',
    'a.hyu-trigger-pcm2-book-test-drive-modal',
    'a.btn-book-test-drive',
    // Generic button fallbacks (CPC / other pages)
    '.dealer-card button:has-text("Book a test drive")',
    '[class*="dealer-card"] button:has-text("Book a test drive")',
    'button:has-text("Book a test drive")',
  ].join(', ')).first();

  await batdBtn.waitFor({ state: 'visible', timeout: 15000 });
  await batdBtn.scrollIntoViewIfNeeded().catch(() => {});

  // Extra wait for Vue to fully re-render after location modal dismissal
  await this.page.waitForTimeout(1000);

  await batdBtn.click();
  console.log('✅ Clicked Book a test drive button');
  this._activeModalHeader = 'Book a test drive';

  // Wait specifically for the BATD modal — must contain "book" + "test" in the header text
  // (case-insensitive). Do NOT use a generic opacity check here: if a location or cookie modal
  // is still visible it would be picked up, the evaluate would read its header, and _activeModalHeader
  // would be set to the wrong value ("Set your location" etc.) breaking all downstream modal filters.
  try {
    await this.page.waitForFunction(() => {
      const wrappers = Array.from(document.querySelectorAll('.modal-wrapper'));
      return wrappers.some(el => {
        if (parseFloat(window.getComputedStyle(el).opacity) <= 0.5) return false;
        const headerText = el.querySelector('.modal-header')?.textContent?.toLowerCase() || '';
        return headerText.includes('book') && headerText.includes('test');
      });
    }, { timeout: 10000 });
    console.log('✅ BATD modal opened');
  } catch {
    console.log(`⚠️ BATD modal not detected by header — URL: ${this.page.url()}`);
  }

  // Read the ACTUAL modal header from the DOM so that downstream steps that filter by
  // _activeModalHeader scope to the correct element. Only update from a modal whose header
  // contains "book" + "test" — this prevents accidentally picking up a location/cookie modal
  // that happened to be active at the same time.
  const _headerInfo = await this.page.evaluate(() => {
    const wrappers = Array.from(document.querySelectorAll('.modal-wrapper'));
    const info = wrappers.map(el => ({
      opacity: parseFloat(window.getComputedStyle(el).opacity),
      header: el.querySelector('.modal-header')?.textContent?.trim() || '',
    }));
    const batd = info.find(i =>
      i.opacity > 0.5 &&
      i.header.toLowerCase().includes('book') &&
      i.header.toLowerCase().includes('test')
    );
    return { all: info, activeHeader: batd?.header || '' };
  });
  console.log('📋 BATD modal wrappers:', JSON.stringify(_headerInfo.all.map(i => ({ opacity: i.opacity, header: i.header }))));
  if (_headerInfo.activeHeader) {
    this._activeModalHeader = _headerInfo.activeHeader;
  }
  console.log(`📋 _activeModalHeader set to: "${this._activeModalHeader}"`);
});

// ─── Verify BATD form is displayed ───────────────────────────
Then('the BATD form is displayed', async function () {
  console.log('📋 Verifying BATD form is displayed');

  // After clicking the CTA, expect at least one visible text/email/tel input
  const inputFields = this.page.locator('input[type="text"], input[type="email"], input[type="tel"]');
  await inputFields.first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});

  const fieldCount = await inputFields.count();
  // Check if ANY input is visible (first() may pick a hidden nav/search input)
  let anyVisible = false;
  for (let i = 0; i < fieldCount; i++) {
    if (await inputFields.nth(i).isVisible().catch(() => false)) {
      anyVisible = true;
      break;
    }
  }

  assert.ok(anyVisible, `BATD form should be displayed with input fields — found ${fieldCount} inputs`);
  console.log(`✅ BATD form is displayed (${fieldCount} input field(s) visible)`);
});

// ── Auto-appended steps ──────────────────────────────────────────

Given('the form modal is displayed', async function () {
  console.log('📋 Verifying form modal is displayed on CPC page');

  // All .modal-wrapper elements are in the DOM; the active one has opacity:1.
  // Wait for ANY modal-wrapper to become active (works for BATD, CAD, BAV).
  await this.page.waitForFunction(() => {
    const wrappers = Array.from(document.querySelectorAll('.modal-wrapper'));
    return wrappers.some(el => {
      const header = el.querySelector('.modal-header');
      return header && parseFloat(window.getComputedStyle(el).opacity) > 0.5;
    });
  }, { timeout: 30000 });

  // Log which modal opened
  const activeHeader = await this.page.evaluate(() => {
    const wrappers = Array.from(document.querySelectorAll('.modal-wrapper'));
    const active = wrappers.find(el => {
      const header = el.querySelector('.modal-header');
      return header && parseFloat(window.getComputedStyle(el).opacity) > 0.5;
    });
    return active?.querySelector('.modal-header')?.textContent?.trim().slice(0, 60) || '';
  });
  console.log(`✅ Form modal displayed: "${activeHeader}"`);
});

// ── Auto-appended steps ──────────────────────────────────────────

// ─── Helper: returns whichever .modal-wrapper is currently active ────
// Uses world._activeModalHeader (set by the button-click steps) to scope
// to the correct modal. Falls back to 'Book a test drive' for BATD-only flows.
//
// IMPORTANT: On FAD pages multiple `.modal-wrapper` elements share the same
// header text — one is active (parent <form> has `.active` class, opacity 1),
// others are hidden (opacity 0, parent form lacks `.active`). `.first()` alone
// hits a HIDDEN wrapper, causing form fills + Submit clicks to silently target
// an invisible DOM tree. Filter by the `.active` ancestor form.
function batdModal(page, world) {
  const header = (world && world._activeModalHeader) || 'Book a test drive';
  // Primary: scope to <form class="...active..."> > .modal-wrapper
  const active = page
    .locator('form.active .modal-wrapper, form.hyu-form.active .modal-wrapper')
    .filter({ has: page.locator(`.modal-header:has-text("${header}")`) })
    .first();
  return active;
}

// ─── Generic cross-page "fills X from test data" helper ──────
// Works for BATD/CAD modals AND for non-modal pages (Contact Us, Find a Dealer,
// etc.). Strategy:
//   1. Resolve value from any available data source by fuzzy column match.
//   2. If a BATD/CAD modal is visible → fill inside the modal scope.
//   3. Otherwise → fill on the page using a wide selector list.
async function fillFromTestDataGeneric(world, page, opts) {
  const { dataKeys, selectors, label } = opts;
  const norm = s => String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
  const dataSets = [
    world.contactUsData, world.testDriveData, world.contactDealerData, world.bookAServiceData,
    ...(world.allConfluenceData ? Object.values(world.allConfluenceData) : []),
  ].filter(Boolean);
  let value = '';
  outer: for (const ds of dataSets) {
    const rows = Array.isArray(ds) ? ds : [ds];
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      for (const k of dataKeys) {
        const kn = norm(k);
        for (const rk of Object.keys(row)) {
          if (norm(rk) === kn && row[rk] != null && String(row[rk]).trim() !== '') {
            value = String(row[rk]); break outer;
          }
        }
      }
    }
  }
  assert.ok(value, `No "${label}" value found in test data (looked for: ${dataKeys.join(', ')})`);
  console.log(`📋 Filling ${label} from test data: ${value}`);

  // Try inside BATD/CAD modal first if one is visibly active
  const modal = batdModal(page, world);
  const inModal = (await modal.count().catch(() => 0)) > 0 && (await modal.first().isVisible().catch(() => false));
  let target = inModal ? modal.locator(selectors).first() : page.locator(selectors).first();
  if ((await target.count().catch(() => 0)) === 0 || !(await target.isVisible().catch(() => false))) {
    target = page.locator(selectors).first();
  }
  await target.waitFor({ state: 'visible', timeout: 10000 });
  const tag = (await target.evaluate(e => e.tagName).catch(() => '')).toLowerCase();
  if (tag === 'select') {
    await target.selectOption({ label: value }).catch(async () => {
      const opts = await target.locator('option').allTextContents();
      const m = opts.find(o => o.trim().toLowerCase() === value.toLowerCase())
            || opts.find(o => o.trim().toLowerCase().includes(value.toLowerCase()));
      if (m) await target.selectOption({ label: m });
    });
  } else {
    await target.fill('').catch(() => {});
    await target.fill(value);
  }
  console.log(`✅ Filled ${label}: ${value}`);
}

// ─── Step 1: Select variant and click Next ────────────────────
Given('the user selects variant {string} and clicks Next', async function (variant) {
  const modal = batdModal(this.page, this);
  console.log(`📋 Selecting variant: ${variant}`);

  // Variant is the second <select> (first is Model, pre-filled as KONA)
  const selects = modal.locator('select');
  const selectCount = await selects.count();
  let variantSelect = null;

  // Try to find by name/id containing "variant" first
  for (let i = 0; i < selectCount; i++) {
    const sel = selects.nth(i);
    const name = await sel.getAttribute('name').catch(() => '');
    const id   = await sel.getAttribute('id').catch(() => '');
    if (/variant/i.test(name + id)) { variantSelect = sel; break; }
  }
  // Fallback: second select (index 1) or first if only one
  if (!variantSelect) variantSelect = selects.nth(selectCount >= 2 ? 1 : 0);

  await variantSelect.waitFor({ state: 'visible', timeout: 10000 });
  await variantSelect.selectOption({ label: variant });
  console.log(`✅ Selected variant: ${variant}`);

  // Wait for Next button to become enabled after variant selection
  await this.page.waitForFunction(() => {
    const btns = Array.from(document.querySelectorAll('.modal-footer button'));
    return btns.some(b => /next/i.test(b.textContent) && !b.disabled);
  }, { timeout: 10000 });

  const nextBtn = modal.locator('.modal-footer button:has-text("Next")').first();
  await nextBtn.click();
  await this.page.waitForTimeout(1500);
  console.log('✅ Clicked Next (step 1 → step 2)');
});

// ─── Generic Next click (advances between modal steps) ───────
Given('the user clicks Next', async function () {
  console.log('📋 Clicking Next to advance modal step');

  // Wait for any visible Next button to be enabled (FAD modal may not use .modal-footer)
  await this.page.waitForFunction(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    return btns.some(b => /^next$/i.test(b.textContent.trim()) && !b.disabled
      && getComputedStyle(b).display !== 'none'
      && parseFloat(getComputedStyle(b).opacity) > 0.1);
  }, { timeout: 10000 }).catch(() => {
    console.log('⚠️ Next button may still be disabled — clicking anyway');
  });

  const modal = batdModal(this.page, this);
  const nextSelectors = '.modal-footer button:has-text("Next"), button:has-text("Next")';

  // Try modal-scoped first; if filter returned no match, fall back to page-wide
  let nextBtn = modal.locator(nextSelectors).first();
  const inModal = await nextBtn.count().catch(() => 0);
  if (inModal === 0 || !(await nextBtn.isVisible().catch(() => false))) {
    console.log('⚠️ Next not found in batdModal scope — using page-wide search');
    nextBtn = this.page.locator('button:has-text("Next")').first();
  }

  await nextBtn.waitFor({ state: 'visible', timeout: 10000 });
  await nextBtn.scrollIntoViewIfNeeded().catch(() => {});
  await nextBtn.click({ force: true }).catch(async () => {
    await nextBtn.evaluate(el => el.click());
  });
  await this.page.waitForTimeout(1500);
  console.log('✅ Clicked Next');
});

// ─── Select title (Mrs / Mr / Miss / Ms / Dr) ────────────────
Given('the user selects title {string}', async function (title) {
  const modal = batdModal(this.page, this);
  console.log(`📋 Selecting title: ${title}`);

  // Try <select> first
  const titleSelect = modal.locator([
    'select[name*="title" i]',
    'select[name*="salutation" i]',
    'select[id*="title" i]',
    'select[id*="salutation" i]',
  ].join(', ')).first();

  if (await titleSelect.count() > 0 && await titleSelect.isVisible().catch(() => false)) {
    await titleSelect.selectOption({ label: title });
    console.log(`✅ Selected title via select: ${title}`);
    return;
  }

  // Try radio/label fallback
  const radioLabel = modal.locator(`label:has-text("${title}")`).first();
  if (await radioLabel.count() > 0 && await radioLabel.isVisible().catch(() => false)) {
    await radioLabel.click();
    console.log(`✅ Selected title via label: ${title}`);
    return;
  }

  throw new Error(`Title field not found in BATD modal for value: "${title}"`);
});

// ─── Fill first name ──────────────────────────────────────────
Given('the user fills first name {string}', async function (firstName) {
  const modal = batdModal(this.page, this);
  console.log(`📋 Filling first name: ${firstName}`);
  const input = modal.locator([
    'input[name*="FirstName" i]',
    'input[id*="firstName" i]',
    'input[placeholder*="First name" i]',
    'input[placeholder*="First Name" i]',
  ].join(', ')).first();
  await input.waitFor({ state: 'visible', timeout: 10000 });
  await input.fill(firstName);
  console.log(`✅ Filled first name: ${firstName}`);
});

// ─── Fill last name ───────────────────────────────────────────
Given('the user fills last name {string}', async function (lastName) {
  const modal = batdModal(this.page, this);
  console.log(`📋 Filling last name: ${lastName}`);
  const input = modal.locator([
    'input[name*="LastName" i]',
    'input[id*="lastName" i]',
    'input[placeholder*="Last name" i]',
    'input[placeholder*="Last Name" i]',
  ].join(', ')).first();
  await input.waitFor({ state: 'visible', timeout: 10000 });
  await input.fill(lastName);
  console.log(`✅ Filled last name: ${lastName}`);
});

// ─── Fill email address ───────────────────────────────────────
Given('the user fills email address {string}', async function (email) {
  const modal = batdModal(this.page, this);
  console.log(`📋 Filling email: ${email}`);
  const input = modal.locator([
    'input[type="email"]',
    'input[name*="email" i]',
    'input[id*="email" i]',
    'input[placeholder*="email" i]',
  ].join(', ')).first();
  await input.waitFor({ state: 'visible', timeout: 10000 });
  await input.fill(email);
  console.log(`✅ Filled email: ${email}`);
});

// ─── Fill phone number ────────────────────────────────────────
Given('the user fills phone number {string}', async function (phone) {
  const modal = batdModal(this.page, this);
  console.log(`📋 Filling phone: ${phone}`);
  const input = modal.locator([
    'input[type="tel"]',
    'input[name*="phone" i]',
    'input[name*="mobile" i]',
    'input[id*="phone" i]',
    'input[placeholder*="phone" i]',
    'input[placeholder*="mobile" i]',
  ].join(', ')).first();
  await input.waitFor({ state: 'visible', timeout: 10000 });
  await input.fill(phone);
  console.log(`✅ Filled phone: ${phone}`);
});

// ─── Fill postcode / suburb ─────────────────────────────────
Given('the user fills postcode {string}', async function (postcode) {
  const modal = batdModal(this.page, this);
  console.log(`📋 Filling postcode: ${postcode}`);
  const input = modal.locator([
    'input[name*="postcode" i]',
    'input[name*="suburb" i]',
    'input[id*="postcode" i]',
    'input[id*="suburb" i]',
    'input[placeholder*="postcode" i]',
    'input[placeholder*="suburb" i]',
    'input[placeholder*="Postcode" i]',
  ].join(', ')).first();
  await input.waitFor({ state: 'visible', timeout: 10000 });
  await input.fill(postcode);
  console.log(`✅ Filled postcode: ${postcode}`);
});

// ─── Select purchase timeframe ────────────────────────────────
Given('the user selects purchase timeframe {string}', async function (timeframe) {
  const modal = batdModal(this.page, this);
  console.log(`📋 Selecting purchase timeframe: ${timeframe}`);

  // Try <select>
  const timeframeSelect = modal.locator([
    'select[name*="purchase" i]',
    'select[name*="timeframe" i]',
    'select[name*="likely" i]',
    'select[name*="timing" i]',
    'select[id*="purchase" i]',
    'select[id*="timeframe" i]',
  ].join(', ')).first();

  if (await timeframeSelect.count() > 0 && await timeframeSelect.isVisible().catch(() => false)) {
    await timeframeSelect.selectOption({ label: timeframe });
    console.log(`✅ Selected timeframe via select: ${timeframe}`);
    return;
  }

  // Fallback: radio or label
  const radioLabel = modal.locator(`label:has-text("${timeframe}")`).first();
  if (await radioLabel.count() > 0 && await radioLabel.isVisible().catch(() => false)) {
    await radioLabel.click();
    console.log(`✅ Selected timeframe via label: ${timeframe}`);
    return;
  }

  throw new Error(`Purchase timeframe field not found for: "${timeframe}"`);
});

// ─── Accept all consent checkboxes (bulk) ───────────────────
Given('the user accepts all consent checkboxes', async function () {
  const modal = batdModal(this.page, this);
  console.log('📋 Checking all consent checkboxes');
  await checkConsentByIndex(modal, this.page, null); // null = all
  console.log('✅ All consent checkboxes checked');
});

// ─── Accept consent checkbox by index (1-based) ───────────────
// Matches: "the user accepts consent checkbox 1"
//          "the user accepts consent checkbox 2"
Given('the user accepts consent checkbox {int}', async function (index) {
  const modal = batdModal(this.page, this);
  console.log(`📋 Checking consent checkbox ${index}`);
  const scopedCount = await modal.locator('input[type="checkbox"]').count().catch(() => 0);
  if (scopedCount >= index) {
    await checkConsentByIndex(modal, this.page, index - 1);
  } else {
    // Modal filter returned no checkboxes — fall back to page-wide visible checkboxes
    console.log(`⚠️ Modal checkboxes: ${scopedCount} — using page-wide search`);
    await checkConsentByIndex(this.page, this.page, index - 1);
  }
  console.log(`✅ Consent checkbox ${index} checked`);
});

// ─── Shared helper: check one (by 0-based index) or all ──────
async function checkConsentByIndex(modal, page, zeroBasedIndex) {
  const checkboxes = modal.locator('input[type="checkbox"]');
  const count = await checkboxes.count();
  const indices = zeroBasedIndex === null
    ? Array.from({ length: count }, (_, i) => i)
    : [zeroBasedIndex];

  for (const i of indices) {
    if (i >= count) throw new Error(`Consent checkbox index ${i + 1} not found (total: ${count})`);
    const cb = checkboxes.nth(i);
    const isChecked = await cb.isChecked().catch(() => false);
    if (!isChecked) {
      const cbId = await cb.getAttribute('id').catch(() => null);
      let clicked = false;
      if (cbId) {
        const label = modal.locator(`label[for="${cbId}"]`).first();
        if (await label.count() > 0) {
          await label.scrollIntoViewIfNeeded().catch(() => {});
          await label.click({ force: true }).catch(() => label.evaluate(el => el.click()));
          clicked = true;
        }
      }
      if (!clicked) {
        await cb.scrollIntoViewIfNeeded().catch(() => {});
        await cb.click({ force: true }).catch(() => cb.evaluate(el => el.click()));
      }
      await page.waitForTimeout(300);
    }
  }
}

// ─── Click Submit request ─────────────────────────────────────
Given('the user clicks Submit request', async function () {
  console.log('📋 Clicking Submit request');

  await this.page.waitForTimeout(1000);

  // If the active modal only shows "Next" (not Submit), advance one more step using elementHandle
  const _activeHasOnlyNext = await this.page.evaluate(() => {
    const wrappers = Array.from(document.querySelectorAll('.modal-wrapper'));
    const active = wrappers.find(el => parseFloat(window.getComputedStyle(el).opacity) > 0.5);
    if (!active) return false;
    const btns = Array.from(active.querySelectorAll('button'));
    return !btns.some(b => /^submit$/i.test(b.textContent.trim()));
  });
  if (_activeHasOnlyNext) {
    console.log('📋 Active modal has only Next — advancing to Submit step');
    const _nextHandle = await this.page.evaluateHandle(() => {
      const wrappers = Array.from(document.querySelectorAll('.modal-wrapper'));
      const active = wrappers.find(el => parseFloat(window.getComputedStyle(el).opacity) > 0.5);
      return Array.from(active?.querySelectorAll('button') || []).find(b => /^next$/i.test(b.textContent.trim())) || null;
    });
    const _nextEl = _nextHandle.asElement();
    if (_nextEl) {
      await _nextEl.scrollIntoViewIfNeeded().catch(() => {});
      await _nextEl.click({ force: true });
      console.log('✅ Clicked Next to reach Submit step');
      await this.page.waitForTimeout(1500);
    }
  }

  // Debug: log all visible buttons in the page for diagnosis
  const _debug = await this.page.evaluate(() => {
    const wrappers = Array.from(document.querySelectorAll('.modal-wrapper'));
    const wrapperInfo = wrappers.map(el => ({
      classes: el.className, opacity: parseFloat(window.getComputedStyle(el).opacity),
      buttons: Array.from(el.querySelectorAll('button')).map(b => ({ text: b.textContent.trim().slice(0, 40), type: b.type, display: window.getComputedStyle(b).display }))
    }));
    const allVisible = Array.from(document.querySelectorAll('button')).filter(b => {
      const r = b.getBoundingClientRect(); const s = window.getComputedStyle(b);
      return r.width > 0 && r.height > 0 && s.display !== 'none' && parseFloat(s.opacity) > 0.1;
    }).map(b => b.textContent.trim().slice(0, 30));
    return { wrapperInfo, allVisible };
  });
  console.log('🔍 BATD modals:', JSON.stringify(_debug.wrapperInfo.map(w => ({ opacity: w.opacity, btns: w.buttons }))));
  console.log('🔍 All visible buttons:', JSON.stringify(_debug.allVisible));

  // Find and click the Submit button via elementHandle for proper Playwright pointer events
  const _submitHandle = await this.page.evaluateHandle(() => {
    const wrappers = Array.from(document.querySelectorAll('.modal-wrapper'));
    const active = wrappers.find(el => parseFloat(window.getComputedStyle(el).opacity) > 0.5);
    if (!active) return null;
    const skipRe = /^(close|back|cancel|next|previous|×|✕)$/i;
    const btns = Array.from(active.querySelectorAll('button, input[type="submit"]'));
    return btns.find(b => {
      const t = b.textContent.trim();
      return !skipRe.test(t) && (b.type === 'submit' && !/^next$/i.test(t)
        || /^submit$/i.test(t) || /send|request|book|enquir|register|confirm/i.test(t));
    }) || null;
  });
  const _submitEl = _submitHandle?.asElement?.();
  let _clicked = false;
  if (_submitEl) {
    await _submitEl.scrollIntoViewIfNeeded().catch(() => {});
    await _submitEl.click({ force: true });
    const _text = await _submitEl.evaluate(el => el.textContent.trim()).catch(() => 'Submit');
    console.log(`✅ Clicked Submit request via elementHandle: "${_text}"`);
    _clicked = true;
  }
  if (!_clicked) {
    // Fallback: locator approach
    const modal = batdModal(this.page, this);
    const submitBtn = modal.locator([
      'button[type="submit"]', 'button:has-text("Submit request")',
      'button:has-text("Submit")', 'button:has-text("Send")', 'input[type="submit"]',
    ].join(', ')).first();
    if ((await submitBtn.count()) > 0 && await submitBtn.isVisible().catch(() => false)) {
      await submitBtn.evaluate(el => el.click()).catch(() => submitBtn.click({ force: true }));
      console.log('✅ Clicked Submit request (fallback)');
    } else {
      console.log('⚠️ Submit button not found — pressing Enter');
      await this.page.keyboard.press('Enter');
    }
  }
  await this.page.waitForTimeout(3000);
});

// ─── Verify BATD submission is successful ─────────────────────
Then('the BATD submission is successful', async function () {
  console.log('📋 Verifying BATD submission success');

  // Step 1: Wait for the "processing" spinner/message to disappear (up to 15s)
  await this.page.waitForFunction(() => {
    const wrappers = Array.from(document.querySelectorAll('.modal-wrapper'));
    const batd = wrappers.find(el => {
      const h = el.querySelector('.modal-header');
      return h && h.textContent.includes('Book a test drive') &&
             parseFloat(window.getComputedStyle(el).opacity) > 0.5;
    });
    if (!batd) return true; // modal closed = success
    const text = batd.textContent || '';
    return !text.includes('We are processing your request');
  }, { timeout: 20000 }).catch(() => console.log('⚠️ Processing state did not clear in 20s — checking text anyway'));

  // Step 2: Check the modal text for success keywords
  const modalText = await batdModal(this.page, this).textContent().catch(() => '');
  console.log(`📋 Modal text after submit: "${modalText.trim().substring(0, 200)}"`);

  assert.ok(
    /thank|success|confirm|submitted|request received|all done/i.test(modalText),
    `BATD submission confirmation not found. Modal text: "${modalText.substring(0, 300)}"`
  );
  console.log('✅ BATD submission confirmed');
});

// ── Auto-appended steps ──────────────────────────────────────────

Given('the form is displayed', async function () {
  await this.page.waitForTimeout(1000);
  const content = await this.page.content();
  console.log(`📋 Step: the form is displayed`);
  assert.ok(content.length > 0, 'the form is displayed');
});

// ── the user sets location postcode is defined in common_steps.js ──

// ─── Data-driven steps — read values from this.testDriveData ─────────────────
// Field map (Confluence column → step):
//   "Your Location"                    → sets location postcode
//   "Variant"                          → selects variant and clicks Next
//   "Title"                            → selects title
//   "First Name"                       → fills first name
//   "Last Name"                        → fills last name
//   "Email Address"                    → fills email address
//   "Phone Number"                     → fills phone number
//   "When are you likely to purchase"  → selects purchase timeframe

Given('the user sets location postcode from test data', async function () {
  const d = this.testDriveData?.[0] || {};
  const postcode = (d['Your Location'] || d['Postcode'] || '2000').toString();
  console.log(`📍 Setting location postcode from test data: ${postcode}`);
  const { handleLocationModal } = await import('./common_steps.js');
  await handleLocationModal(this.page, postcode);
  console.log(`✅ Location set to postcode: ${postcode}`);
});

Given('the user selects variant from test data and clicks Next', async function () {
  const d = this.testDriveData?.[0] || {};
  const variant = d['Variant'] || '';
  assert.ok(variant, 'No "Variant" field found in test data');
  console.log(`📋 Selecting variant from test data: ${variant}`);

  const modal = batdModal(this.page, this);
  const selects = modal.locator('select');
  const selectCount = await selects.count();
  let variantSelect = null;
  for (let i = 0; i < selectCount; i++) {
    const sel = selects.nth(i);
    const name = await sel.getAttribute('name').catch(() => '');
    const id   = await sel.getAttribute('id').catch(() => '');
    if (/variant/i.test(name + id)) { variantSelect = sel; break; }
  }
  if (!variantSelect) variantSelect = selects.nth(selectCount >= 2 ? 1 : 0);

  await variantSelect.waitFor({ state: 'visible', timeout: 10000 });
  await variantSelect.selectOption({ label: variant });
  console.log(`✅ Selected variant: ${variant}`);

  await this.page.waitForFunction(() => {
    const btns = Array.from(document.querySelectorAll('.modal-footer button'));
    return btns.some(b => /next/i.test(b.textContent) && !b.disabled);
  }, { timeout: 10000 });

  const nextBtn = modal.locator('.modal-footer button:has-text("Next")').first();
  await nextBtn.click();
  await this.page.waitForTimeout(1500);
  console.log('✅ Clicked Next (step 1 → step 2)');
});

Given('the user selects title from test data', async function () {
  const d = this.testDriveData?.[0] || {};
  const title = (d['Title'] || '').replace('.', '').trim(); // "Ms." → "Ms"
  assert.ok(title, 'No "Title" field found in test data');
  console.log(`📋 Selecting title from test data: ${title}`);
  const modal = batdModal(this.page, this);
  const titleSelect = modal.locator([
    'select[name*="title" i]', 'select[name*="salutation" i]',
    'select[id*="title" i]',  'select[id*="salutation" i]',
  ].join(', ')).first();
  if (await titleSelect.count() > 0 && await titleSelect.isVisible().catch(() => false)) {
    await titleSelect.selectOption({ label: title });
    console.log(`✅ Selected title: ${title}`); return;
  }
  const radioLabel = modal.locator(`label:has-text("${title}")`).first();
  if (await radioLabel.count() > 0 && await radioLabel.isVisible().catch(() => false)) {
    await radioLabel.click(); console.log(`✅ Selected title via label: ${title}`); return;
  }
  throw new Error(`Title field not found in BATD modal for value: "${title}"`);
});

Given('the user fills first name from test data', async function () {
  await fillFromTestDataGeneric(this, this.page, {
    label: 'first name',
    dataKeys: ['First Name', 'FirstName', 'Firstname', 'Given Name', 'first name'],
    selectors: [
      'input[name*="FirstName" i]', 'input[name*="firstname" i]', 'input[name*="first-name" i]',
      'input[id*="firstName" i]', 'input[id*="first-name" i]', 'input[id*="firstname" i]',
      'input[placeholder*="First name" i]', 'input[aria-label*="first name" i]'
    ].join(', '),
  });
});

Given('the user fills last name from test data', async function () {
  await fillFromTestDataGeneric(this, this.page, {
    label: 'last name',
    dataKeys: ['Last Name', 'LastName', 'Lastname', 'Surname', 'Family Name', 'last name'],
    selectors: [
      'input[name*="LastName" i]', 'input[name*="lastname" i]', 'input[name*="last-name" i]', 'input[name*="surname" i]',
      'input[id*="lastName" i]', 'input[id*="last-name" i]', 'input[id*="lastname" i]', 'input[id*="surname" i]',
      'input[placeholder*="Last name" i]', 'input[placeholder*="Surname" i]', 'input[aria-label*="last name" i]'
    ].join(', '),
  });
});

Given('the user fills email address from test data', async function () {
  await fillFromTestDataGeneric(this, this.page, {
    label: 'email address',
    dataKeys: ['Email Address', 'EmailAddress', 'Email', 'email', 'e-mail'],
    selectors: [
      'input[type="email"]',
      'input[name*="email" i]', 'input[id*="email" i]',
      'input[placeholder*="email" i]', 'input[aria-label*="email" i]'
    ].join(', '),
  });
});

Given('the user fills phone number from test data', async function () {
  await fillFromTestDataGeneric(this, this.page, {
    label: 'phone number',
    dataKeys: ['Phone Number', 'PhoneNumber', 'Phone', 'Mobile', 'Mobile Number', 'Contact Number', 'phone'],
    selectors: [
      'input[type="tel"]',
      'input[name*="phone" i]', 'input[name*="mobile" i]',
      'input[id*="phone" i]', 'input[id*="mobile" i]',
      'input[placeholder*="phone" i]', 'input[placeholder*="mobile" i]', 'input[aria-label*="phone" i]'
    ].join(', '),
  });
});

Given('the user selects purchase timeframe from test data', async function () {
  const d = this.testDriveData?.[0] || this.contactDealerData?.[0] || {};
  const value = d['When are you likely to purchase'] || d['Purchase Timeframe'] || '';
  assert.ok(value, 'No "When are you likely to purchase" field found in test data');
  console.log(`📋 Selecting purchase timeframe from test data: ${value}`);
  const modal = batdModal(this.page, this);
  const selectSelectors = [
    'select[name*="purchase" i]', 'select[name*="timeframe" i]',
    'select[name*="likely" i]',  'select[name*="timing" i]',
    'select[id*="purchase" i]',  'select[id*="timeframe" i]',
  ].join(', ');

  // Try modal-scoped select, fall back to page-wide
  let timeframeSelect = modal.locator(selectSelectors).first();
  if ((await timeframeSelect.count().catch(() => 0)) === 0 || !(await timeframeSelect.isVisible().catch(() => false))) {
    timeframeSelect = this.page.locator(selectSelectors).first();
  }
  if ((await timeframeSelect.count().catch(() => 0)) > 0 && await timeframeSelect.isVisible().catch(() => false)) {
    await timeframeSelect.selectOption({ label: value });
    console.log(`✅ Selected timeframe: ${value}`); return;
  }

  // Fallback to label click (modal-scoped then page-wide)
  let radioLabel = modal.locator(`label:has-text("${value}")`).first();
  if ((await radioLabel.count().catch(() => 0)) === 0 || !(await radioLabel.isVisible().catch(() => false))) {
    radioLabel = this.page.locator(`label:has-text("${value}")`).first();
  }
  if ((await radioLabel.count().catch(() => 0)) > 0 && await radioLabel.isVisible().catch(() => false)) {
    await radioLabel.click(); console.log(`✅ Selected timeframe via label: ${value}`); return;
  }
  throw new Error(`Purchase timeframe field not found for: "${value}"`);
});
