/**
 * Cucumber World — Confluence-Driven Playwright Integration
 * Sets up browser/page for each scenario with test data from Confluence.
 */
import { setWorldConstructor, Before, After, setDefaultTimeout } from '@cucumber/cucumber';
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ConfluenceReader from '../../../utils/confluenceReader.js';
import config from '../../../utils/confluenceConfig.js';
import { findByHint, autoHeal, buildFieldSelectors, buildButtonSelectors, buildSelectSelectors, buildCheckboxSelectors } from '../../../utils/autoHealLocator.js';

setDefaultTimeout(180000);

class CucumberWorld {
  constructor() {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.testData = null;
    this.environmentName = null;
    this.contactUsUrl = null;
    this.contactDealerUrl = null;
    this.pageUrls = {};
    this.excelRowData = null;
    this.allExcelRows = null;
    this.validationErrors = null;
    this.successMessage = null;
    this.dropdownOptions = [];
    this._capturedApiPayloads = [];
    this._testUrl = null;
  }

  // ── Auto-Heal Locator Helpers ─────────────────────────────────────────────
  // Available in every step definition via `this`.

  /**
   * Find any element by semantic hint with automatic fallback selectors.
   * type: 'input' | 'button' | 'select' | 'checkbox'
   *
   * Example:
   *   const el = await this.findElement('email');
   *   const el = await this.findElement('Submit', 'button');
   */
  async findElement(hint, type = 'input', options = {}) {
    const ctx = options.stepContext || this._currentStep || '';
    return findByHint(this.page, hint, type, { timeout: 5000, ...options, stepContext: ctx });
  }

  /**
   * Find a button or link by its visible label.
   *
   * Example:
   *   const btn = await this.findButton('Submit request');
   *   await btn.locator.click();
   */
  async findButton(label, options = {}) {
    // If a section scope is requested ("in footer", "in header", etc.), search
    // ONLY inside the matching landmark element. This avoids hitting the wrong
    // element when the same label appears in multiple regions (e.g. "Contact us"
    // in both the top nav and the page footer).
    if (options.section) {
      const section = String(options.section).toLowerCase();
      // Force-render lazy landmarks: footers/headers are often below the fold
      // or hydrate on scroll. Scroll to the relevant edge of the page first.
      if (section === 'footer') {
        await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
        await this.page.waitForTimeout(800);
      } else if (section === 'header' || section === 'nav' || section === 'navigation') {
        await this.page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
        await this.page.waitForTimeout(300);
      }
      const sectionLoc = await this._resolveSectionScope(section);
      if (sectionLoc) {
        await sectionLoc.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
        await this.page.waitForTimeout(400);
        const lower = String(label).trim();
        const candidates = [
          `a:has-text("${lower}")`,
          `button:has-text("${lower}")`,
          `[role="button"]:has-text("${lower}")`,
          `:is(a,button,div,span,li):text-is("${lower}")`,
          `:is(a,button,div,span,li):has-text("${lower}")`,
        ];
        for (const sel of candidates) {
          const all = sectionLoc.locator(sel);
          const count = await all.count().catch(() => 0);
          for (let i = 0; i < count; i++) {
            const cand = all.nth(i);
            const visible = await cand.isVisible().catch(() => false);
            if (visible) {
              console.log(`📋 findButton("${label}") scoped to <${section}>: ${sel} [${i}]`);
              return { locator: cand, selector: `<${section}> ${sel}`, healed: false };
            }
          }
        }
        console.warn(`⚠️  findButton("${label}") in <${section}>: landmark resolved but no visible match — falling back to global search`);
      } else {
        console.warn(`⚠️  findButton("${label}"): section "${section}" landmark not found — falling back to global search`);
      }
    }
    // ── Implicit main-content preference for unscoped clicks ────────────────
    // If the label appears in <main>/[role="main"] AND elsewhere (header/footer),
    // prefer the main-content match. This avoids accidentally clicking the
    // header "Contact us" link when the user meant the in-page tile/CTA.
    if (!options.section && !options._skipMainPreference) {
      const mainLoc = this.page.locator('main, [role="main"]').first();
      const mainCount = await mainLoc.count().catch(() => 0);
      if (mainCount > 0) {
        const lower = String(label).trim();
        const candSelectors = [
          `a:has-text("${lower}")`,
          `button:has-text("${lower}")`,
          `[role="button"]:has-text("${lower}")`,
          `:is(a,button,div,span,li):text-is("${lower}")`,
        ];
        for (const sel of candSelectors) {
          const all = mainLoc.locator(sel);
          const c = await all.count().catch(() => 0);
          for (let i = 0; i < c; i++) {
            const cand = all.nth(i);
            const visible = await cand.isVisible().catch(() => false);
            if (visible) {
              console.log(`📋 findButton("${label}") preferring <main>: ${sel} [${i}]`);
              return { locator: cand, selector: `<main> ${sel}`, healed: false };
            }
          }
        }
      }
    }
    // Buttons should already be on the page when we click them. Use a short
    // per-selector timeout so traversing many fallback selectors doesn't take ages.
    return this.findElement(label, 'button', { timeout: 1500, ...options });
  }

  /**
   * Resolve a section qualifier ("footer", "header", "nav", ...) to a Playwright
   * locator that wraps that page region. Prefers the LAST visible match for
   * footer/header (Hyundai-style sites often render duplicate footers, only one
   * of which is the live, visible one). Returns null if no landmark is found.
   */
  async _resolveSectionScope(section) {
    const map = {
      footer: ['footer', '[role="contentinfo"]', '[class*="footer" i]:not([class*="footer-link" i]):not([class*="sub-footer" i])'],
      header: ['header', '[role="banner"]', '[class*="header" i]:not([class*="sub" i])'],
      nav: ['nav', '[role="navigation"]'],
      navigation: ['nav', '[role="navigation"]'],
      sidebar: ['aside', '[role="complementary"]', '[class*="sidebar" i]'],
      main: ['main', '[role="main"]'],
      hero: ['[class*="hero" i]', '[class*="banner" i]'],
      banner: ['[role="banner"]', '[class*="banner" i]'],
      menu: ['[role="menu"]', 'nav', '[class*="menu" i]'],
    };
    const sels = map[String(section).toLowerCase()];
    if (!sels) return null;
    // Try each landmark selector; pick the LAST visible match (footers are usually last).
    for (const sel of sels) {
      const all = this.page.locator(sel);
      const count = await all.count().catch(() => 0);
      if (count === 0) continue;
      // Prefer the last visible one (most pages have the real footer last).
      for (let i = count - 1; i >= 0; i--) {
        const cand = all.nth(i);
        const visible = await cand.isVisible().catch(() => false);
        if (visible) return cand;
      }
      // No visible — return the last one anyway (will be force-scrolled by caller).
      return all.last();
    }
    return null;
  }

  /**
   * Fill a form field identified by semantic hint.
   * Clears the field first, then types the value.
   * Automatically tries fallback selectors if the primary fails.
   *
   * Example:
   *   await this.fillField('email', 'test@example.com');
   *   await this.fillField('first name', 'Janki');
   */
  async fillField(hint, value, options = {}) {
    const { locator, selector, healed } = await this.findElement(hint, 'input', options);
    await locator.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
    await locator.clear().catch(() => {});
    await locator.fill(String(value ?? ''));
    if (healed) console.log(`🔧 fillField("${hint}") healed to: ${selector}`);
    else console.log(`📋 fillField("${hint}"): "${value}"`);
    return locator;
  }

  /**
   * Select an option in a dropdown by semantic hint + option label/value.
   * Strategy:
   *   1. Native <select> via Playwright selectOption (label, then fuzzy match, then JS dispatchEvent).
   *   2. If no native select is found OR selecting fails, fall back to a generic
   *      custom-dropdown walker: locate a clickable element whose visible text /
   *      placeholder / aria-label matches `hint`, click to open it, then click the
   *      option matching `optionLabel`. This handles modern React/AEM combobox
   *      patterns (button + popover list) without any per-feature code.
   *
   * Example:
   *   await this.selectDropdown('model', 'KONA');
   *   await this.selectDropdown('Reason for your enquiry', 'New Cars');
   */
  async selectDropdown(hint, optionLabel, options = {}) {
    const _label = String(optionLabel ?? '');

    // ── Path 1: native <select> ─────────────────────────────────────────────
    const selectors = [
      `select[name="${hint}"]`,
      `select[id="${hint}"]`,
      ...buildSelectSelectors(hint),
    ];
    let nativeFound = false;
    let nativeSelected = false;
    try {
      const { locator, selector, healed } = await autoHeal(this.page, selectors, {
        timeout: 2500, ...options, hint: `select:${hint}`,
      });
      nativeFound = true;
      await locator.selectOption({ label: _label }).then(() => { nativeSelected = true; }).catch(async () => {
        const opts = await locator.locator('option').allTextContents();
        const match = opts.find(o => o.trim().toLowerCase() === _label.toLowerCase())
          || opts.find(o => o.trim().toLowerCase().includes(_label.toLowerCase()));
        if (match) {
          await locator.selectOption({ label: match }).then(() => { nativeSelected = true; }).catch(async () => {
            await locator.evaluate((el, val) => {
              const opt = Array.from(el.options).find(o => o.text.trim() === val);
              if (opt) { el.value = opt.value; el.dispatchEvent(new Event('change', { bubbles: true })); el.dispatchEvent(new Event('input', { bubbles: true })); }
            }, match);
            nativeSelected = true;
          });
        }
      });
      if (nativeSelected) {
        if (healed) console.log(`🔧 selectDropdown("${hint}") healed to: ${selector}`);
        else console.log(`📋 selectDropdown("${hint}"): "${_label}"`);
        return locator;
      }
    } catch { /* native select not found — fall through */ }

    // ── Path 2: custom (non-native) dropdown ────────────────────────────────
    // Locate the deepest visible element whose placeholder/aria-label/text matches `hint`,
    // walk up to a clickable ancestor, click to open, then click the option `optionLabel`.
    const opened = await this.page.evaluate((hint) => {
      const HINT_RE = new RegExp(hint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      // Prefer attribute-based matches (placeholder/aria-label/data-placeholder)
      let trigger = null;
      for (const el of document.querySelectorAll('input, textarea, button, [role="button"], [role="combobox"], [aria-label], [data-placeholder]')) {
        const t = (el.placeholder || el.getAttribute('aria-label') || el.getAttribute('data-placeholder') || '');
        if (t && HINT_RE.test(t)) {
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          if (r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden') { trigger = el; break; }
        }
      }
      // Fallback: visible elements whose innerText contains the hint
      if (!trigger) {
        const cands = [];
        for (const el of document.querySelectorAll('button, [role="button"], [role="combobox"], [class*="select" i], [class*="dropdown" i], div, span, label')) {
          const r = el.getBoundingClientRect();
          if (r.width < 40 || r.height < 16) continue;
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
          const t = (el.innerText || '').trim();
          if (t && t.length < 120 && HINT_RE.test(t)) cands.push(el);
        }
        cands.sort((a, b) => {
          const ra = a.getBoundingClientRect(); const rb = b.getBoundingClientRect();
          return (ra.width * ra.height) - (rb.width * rb.height);
        });
        trigger = cands[0] || null;
      }
      if (!trigger) return { ok: false };
      // Walk up to a clickable ancestor
      let walk = trigger, clicker = trigger;
      for (let d = 0; d < 6 && walk; d++) {
        const cs = getComputedStyle(walk);
        const isClickable = walk.tagName === 'BUTTON' || walk.getAttribute('role') === 'button' ||
          walk.getAttribute('role') === 'combobox' || cs.cursor === 'pointer' ||
          /select|dropdown|combobox|trigger/i.test(walk.className?.toString?.() || '');
        if (isClickable) { clicker = walk; break; }
        walk = walk.parentElement;
      }
      clicker.scrollIntoView({ block: 'center' });
      clicker.click();
      return { ok: true };
    }, String(hint));

    if (!opened.ok) {
      throw new Error(`selectDropdown("${hint}"): no native <select> and no clickable trigger matching "${hint}" found`);
    }
    await this.page.waitForTimeout(600);

    // Click the option matching `optionLabel`
    const optionLoc = this.page.locator(
      `[role="option"]:has-text("${_label}"):visible, ` +
      `li:has-text("${_label}"):visible, ` +
      `[class*="option" i]:has-text("${_label}"):visible, ` +
      `[class*="item" i]:has-text("${_label}"):visible, ` +
      `button:has-text("${_label}"):visible, ` +
      `span:has-text("${_label}"):visible`
    ).first();
    if ((await optionLoc.count()) > 0) {
      await optionLoc.click({ timeout: 5000 });
      console.log(`📋 selectDropdown("${hint}") via custom dropdown: "${_label}"`);
      await this.page.waitForTimeout(300);
      return optionLoc;
    }
    // Last-resort exact-text JS click
    const jsClicked = await this.page.evaluate((label) => {
      const re = new RegExp(`^\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');
      const all = Array.from(document.querySelectorAll('li, span, a, button, div, [role="option"]'));
      const visible = all.filter(el => {
        const r = el.getBoundingClientRect();
        if (r.width < 5 || r.height < 5) return false;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        return el.children.length === 0 || el.tagName === 'LI' || el.tagName === 'BUTTON';
      });
      const m = visible.find(el => re.test((el.innerText || el.textContent || '').trim()));
      if (m) { (m.closest('li, [role="option"], button') || m).click(); return true; }
      return false;
    }, _label);
    if (jsClicked) {
      console.log(`📋 selectDropdown("${hint}") via JS-click: "${_label}"`);
      await this.page.waitForTimeout(300);
      return null;
    }
    throw new Error(`selectDropdown("${hint}"): opened trigger but option "${_label}" was not found`);
  }

  /**
   * Click a button or link by label with auto-heal fallbacks.
   *
   * Example:
   *   await this.clickButton('Submit request');
   *   await this.clickButton('Accept All');
   */
  async clickButton(label, options = {}) {
    // Dismiss any blocking cookie/consent banner once per session before any
    // click — these are the #1 cause of "click landed on wrong element" issues.
    await this._dismissCookieBannerOnce();
    const { locator, selector, healed } = await this.findButton(label, options);
    await locator.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
    // Clickability gate: wait briefly for the element to be enabled (not [disabled] / aria-disabled).
    // If it never becomes clickable, we still attempt the click (force) — but we log a warning
    // so flaky failures are easy to triage.
    const clickable = await locator.evaluate(el => {
      const cs = getComputedStyle(el);
      const disabled = el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true';
      return !disabled && cs.pointerEvents !== 'none' && cs.visibility !== 'hidden';
    }).catch(() => true);
    if (!clickable) {
      console.warn(`⚠️  clickButton("${label}"): element appears disabled / non-interactive; attempting force click`);
    }
    // If this is an anchor with an href, prefer waitForNavigation to avoid the
    // race between click + URL assertion that follows in the next step.
    const linkHref = await locator.evaluate(el => {
      if (el.tagName !== 'A') return null;
      const h = el.getAttribute('href') || '';
      if (!h || h.startsWith('#') || h.startsWith('javascript:')) return null;
      return el.href; // resolved absolute URL
    }).catch(() => null);
    const startUrl = this.page.url();
    if (linkHref) {
      await Promise.race([
        this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => null),
        (async () => {
          await locator.click({ timeout: 5000 }).catch(async () => {
            await locator.click({ force: true, timeout: 5000 }).catch(async () => {
              await locator.evaluate(el => el.click());
            });
          });
        })(),
      ]);
      // Some SPA links intercept synthetic clicks (preventDefault + analytics-only).
      // If after clicking we're still on the same URL but the href points elsewhere,
      // navigate directly to the resolved href — UNLESS the click opened a modal
      // (very common pattern: <a class="hyu-trigger-*-modal" href="..."> where JS
      // calls preventDefault and opens an in-page dialog instead of navigating).
      await this.page.waitForTimeout(800);
      if (this.page.url() === startUrl && linkHref !== startUrl) {
        // Detect a modal/dialog that just opened as a result of the click.
        const modalOpened = await this.page.locator(
          '[role="dialog"], [role="alertdialog"], dialog[open], .modal.show, .modal.in, .modal--open, [class*="modal" i][class*="open" i], [class*="modal" i][class*="active" i], [class*="modal-wrapper" i]'
        ).filter({ has: this.page.locator(':visible') }).first().isVisible().catch(() => false);
        // Also check for trigger-class hints on the clicked element itself —
        // these strongly imply "modal trigger, not navigation".
        const isModalTrigger = await locator.evaluate(el => {
          const cls = (el.className && typeof el.className === 'string' ? el.className : '').toLowerCase();
          return /trigger.*modal|modal.*trigger|js-(open|toggle).*modal|open[-_]?modal/.test(cls);
        }).catch(() => false);
        if (modalOpened || isModalTrigger) {
          console.log(`📋 clickButton("${label}"): modal opened — not following href (anchor was a modal trigger)`);
        } else {
          const sameOrigin = (() => { try { return new URL(linkHref).origin === new URL(startUrl).origin; } catch { return false; } })();
          if (sameOrigin) {
            console.log(`🔁 clickButton("${label}"): synthetic click did not navigate; following href directly: ${linkHref}`);
            await this.page.goto(linkHref, { waitUntil: 'domcontentloaded', timeout: 30000 });
          }
        }
      }
    } else {
      await locator.click({ force: true, timeout: 5000 }).catch(async () => {
        await locator.evaluate(el => el.click());
      });
    }
    if (healed) console.log(`🔧 clickButton("${label}") healed to: ${selector}`);
    else console.log(`📋 clickButton("${label}")`);
    return locator;
  }

  /**
   * Dismiss common cookie/consent banners (OneTrust, generic "Accept all" buttons).
   * Only runs once per scenario — repeated calls are no-ops.
   */
  async _dismissCookieBannerOnce() {
    if (this._cookieBannerDismissed) return;
    this._cookieBannerDismissed = true; // mark first to avoid re-entry on the second call
    const candidates = [
      '#onetrust-accept-btn-handler',
      'button:has-text("Accept All")',
      'button:has-text("Accept all")',
      'button:has-text("Accept All Cookies")',
      'button:has-text("I agree")',
      'button:has-text("Agree")',
      '[aria-label*="accept" i]:has-text("cookie")',
    ];
    for (const sel of candidates) {
      const btn = this.page.locator(sel).first();
      const count = await btn.count().catch(() => 0);
      if (count > 0 && (await btn.isVisible().catch(() => false))) {
        await btn.click({ timeout: 3000 }).catch(() => {});
        await this.page.waitForTimeout(500);
        console.log(`🍪 Dismissed cookie banner: ${sel}`);
        return;
      }
    }
  }

  /**
   * Check/uncheck a checkbox by semantic hint.
   *
   * Example:
   *   await this.setCheckbox('privacy', true);
   *   await this.setCheckbox('marketing consent', false);
   */
  async setCheckbox(hint, checked = true, options = {}) {
    const nth = Number.isInteger(options.nth) && options.nth >= 0 ? options.nth : 0;
    const selectors = buildCheckboxSelectors(hint);
    // For nth > 0 we need the FULL match list, not the first hit. Find the first
    // selector that yields >= (nth+1) matches; otherwise fall back to autoHeal's first.
    let locator = null;
    let selector = null;
    let healed = false;
    if (nth > 0) {
      for (const sel of selectors) {
        const all = this.page.locator(sel);
        const count = await all.count().catch(() => 0);
        if (count > nth) {
          locator = all.nth(nth);
          selector = `${sel} [nth=${nth}]`;
          healed = sel !== selectors[0];
          break;
        }
      }
    }
    if (!locator) {
      ({ locator, selector, healed } = await autoHeal(this.page, selectors, {
        timeout: 5000, ...options, hint: `checkbox:${hint}`,
      }));
    }
    const isChecked = await locator.isChecked().catch(() => false);
    if (isChecked !== checked) {
      const label = locator.locator('xpath=ancestor::label[1]').first();
      const hasLabel = (await label.count()) > 0;
      if (hasLabel) {
        await label.click({ force: true, timeout: 3000 }).catch(async () => {
          await locator.evaluate(el => el.click());
        });
      } else {
        await locator.evaluate(el => el.click());
      }
    }
    if (healed) console.log(`🔧 setCheckbox("${hint}"${nth ? ` #${nth + 1}` : ''}) healed to: ${selector}`);
    else console.log(`📋 setCheckbox("${hint}"${nth ? ` #${nth + 1}` : ''}): ${checked}`);
    return locator;
  }

  /**
   * Assert that an element is visible on the page, trying multiple selectors.
   * Returns true if found, false if not (does not throw).
   *
   * Example:
   *   const visible = await this.isVisible('confirmation message', 'visible');
   */
  async isVisible(hint, type = 'input') {
    try {
      const { locator } = await this.findElement(hint, type, { timeout: 3000 });
      return (await locator.count()) > 0 && (await locator.isVisible().catch(() => false));
    } catch {
      return false;
    }
  }
}

setWorldConstructor(CucumberWorld);

/**
 * Load the active environment configuration written by the orchestrator.
 * Falls back to Confluence API + static config if cache is unavailable.
 */
function loadActiveEnvironment() {
  try {
    const cachePath = path.join(
      path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.cache', 'activeEnvironment.json'
    );
    if (fs.existsSync(cachePath)) {
      const data = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
      return data;
    }
  } catch { /* ignore */ }
  return null;
}

Before(async function () {
  this._scenarioStartTime = Date.now();

  // Launch browser with realistic user agent to avoid bot detection
  const headless = process.env.HEADLESS !== 'false';
  this.browser = await chromium.launch({
    headless,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  this.context = await this.browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    // Grant geolocation so 'Use your current location' works without a permission dialog
    permissions: ['geolocation'],
    geolocation: { latitude: -33.8688, longitude: 151.2093 }, // Sydney CBD (postcode 2000)
  });
  this.page = await this.context.newPage();

  // Remove webdriver property to avoid bot detection
  await this.page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  // Install a PerformanceObserver to buffer long tasks on every page navigation.
  // Long tasks (>50ms main-thread blocks) are only delivered via observer
  // callbacks — they are NOT retrievable via performance.getEntriesByType()
  // unless we push them somewhere ourselves. We stash them on window.__ctaLongTasks
  // so any step can read them later.
  await this.page.addInitScript(() => {
    try {
      if (typeof PerformanceObserver === 'undefined') return;
      // eslint-disable-next-line no-undef
      window.__ctaLongTasks = [];
      const po = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          // eslint-disable-next-line no-undef
          window.__ctaLongTasks.push({ duration: e.duration, startTime: e.startTime });
        }
      });
      po.observe({ type: 'longtask', buffered: true });
      // eslint-disable-next-line no-undef
      window.__ctaLongTaskObserver = po;
    } catch (_) { /* longtask not supported in this browser */ }
  });

  // ── Capture API Payloads via CDP (Chrome DevTools Protocol) ──
  // CDP captures ALL network traffic including service workers, fetch keepalive, etc.
  this._capturedApiPayloads = [];
  this._cdpRequests = new Map(); // requestId → request data

  const cdpSession = await this.page.context().newCDPSession(this.page);
  await cdpSession.send('Network.enable');
  this._cdpSession = cdpSession;

  cdpSession.on('Network.requestWillBeSent', (params) => {
    try {
      const { requestId, request } = params;
      if (request.method === 'POST' || request.method === 'PUT' || request.method === 'PATCH') {
        this._cdpRequests.set(requestId, {
          url: request.url,
          method: request.method,
          requestBody: request.postData || '',
          requestHeaders: request.headers || {},
          timestamp: new Date().toISOString(),
        });
        // Log form-related API calls (check path only, without semicolon path-params, to avoid
        // false positives from analytics URLs like DoubleClick that embed the page path in their params)
        const _reqPath = (() => { try { return new URL(request.url).pathname.split(';')[0]; } catch { return request.url.split('?')[0].split(';')[0]; } })();
        if (/content\/api|\/form\/|\/submit|booktestdrive|enquiry|booking|ownership/i.test(_reqPath)) {
          console.log(`🔍 CDP captured form API request: ${request.method} ${request.url}`);
        }
      }
    } catch { /* ignore */ }
  });

  cdpSession.on('Network.responseReceived', (params) => {
    try {
      const { requestId, response } = params;
      const req = this._cdpRequests.get(requestId);
      if (req) {
        const payload = {
          ...req,
          statusCode: response.status,
          responseHeaders: response.headers || {},
        };
        this._capturedApiPayloads.push(payload);
        // Try to get response body asynchronously
        cdpSession.send('Network.getResponseBody', { requestId })
          .then(body => { payload.responseBody = body.body || ''; })
          .catch(() => { payload.responseBody = ''; });
        this._cdpRequests.delete(requestId);
        // Log form-related API responses (check path only, without semicolon path-params)
        const _resPath = (() => { try { return new URL(req.url).pathname.split(';')[0]; } catch { return req.url.split('?')[0].split(';')[0]; } })();
        if (/content\/api|\/form\/|\/submit|booktestdrive|enquiry|booking|ownership/i.test(_resPath)) {
          console.log(`🔍 CDP captured form API response: ${response.status} ${req.url}`);
        }
      }
    } catch { /* ignore */ }
  });

  // ── Supplementary Playwright native listener ─────────────────────────────
  // Captures responses that CDP may miss (e.g. from child frames).
  // NOTE: The ownership form on staging makes no HTTP API call (client-side success only),
  // so no form payload will be captured for that scenario — prevSuccess fallback handles it.
  const _trackingHostPattern = /google|analytics|doubleclick|snapchat|linkedin|twitter|t\.co|mktoresp|mktoweb|marketo|facebook|gtag|pixel|hotjar|clarity|newrelic|sentry|segment|adsrvr|adservice|adsct|webevents|ccm\/collect/i;

  this.page.on('response', async (response) => {
    try {
      const req = response.request();
      const method = req.method();
      const url = req.url();
      if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
        // Skip tracking/analytics hosts to avoid false positives
        if (_trackingHostPattern.test(new URL(url).hostname)) return;
        if (
          /content\/api|\/form\/|\/submit|booktestdrive|enquiry|booking|ownership|leadCapture|save2|pages\./i.test(url)
        ) {
          // Only add if not already captured by CDP (avoid duplicates)
          const alreadyCaptured = this._capturedApiPayloads.some(p => p.url === url && p.method === method);
          if (!alreadyCaptured) {
            const statusCode = response.status();
            let requestBody = '';
            try { requestBody = req.postData() || ''; } catch { /* ignore */ }
            let responseBody = '';
            try { responseBody = await response.text().catch(() => ''); } catch { /* ignore */ }
            const payload = {
              url,
              method,
              requestBody,
              requestHeaders: req.headers() || {},
              statusCode,
              responseHeaders: response.headers() || {},
              responseBody,
              timestamp: new Date().toISOString(),
              source: 'playwright-native',
            };
            this._capturedApiPayloads.push(payload);
            console.log(`🔍 Playwright captured form API response: ${statusCode} ${method} ${url}`);
          }
        }
      }
    } catch { /* ignore */ }
  });

  // Track the test URL (first navigation)
  this._testUrl = null;
  this.page.on('framenavigated', (frame) => {
    if (frame === this.page.mainFrame() && !this._testUrl) {
      const url = frame.url();
      if (url && url !== 'about:blank') this._testUrl = url;
    }
  });

  // ── Resolve Active Environment ─────────────────────────────
  // Priority: cached activeEnvironment.json (written by orchestrator Step 1.5)
  //   → falls back to Confluence API → static config
  const envCache = loadActiveEnvironment();

  // Load test data from Confluence
  try {
    const allData = await ConfluenceReader.readAllSheets();
    this.allConfluenceData = allData;

    // Determine environment: from cache (orchestrator resolved it from
    // Environment Configuration Status=Yes) → .env → default Production
    if (envCache) {
      this.environmentName = envCache.activeEnvironment;
      this.pageUrls = envCache.pageUrls || {};
      console.log(`📋 Environment (from Confluence config): ${this.environmentName}`);
    } else {
      // No cache — resolve from Confluence directly
      const envConfig = allData['Environment Configuration'] || [];
      const activeRow = envConfig.find(r =>
        r.Status && r.Status.toLowerCase().trim() === 'yes'
      );
      this.environmentName = activeRow
        ? (activeRow.Environment || activeRow.TestName)
        : config.targetEnvironment;

      // Build page URL map
      const envUrls = allData['Environment URLs'] || [];
      this.pageUrls = {};
      for (const row of envUrls) {
        if (row.Page) {
          this.pageUrls[row.Page.toLowerCase()] = row[this.environmentName] || row['Production'] || '';
        }
      }
      console.log(`📋 Environment (resolved live from Confluence): ${this.environmentName}`);
    }

    // Contact Us URL — from resolved page URLs
    this.contactUsUrl = this.pageUrls['contact us']
      || 'https://www.hyundai.com/au/en/customer-care/contact-us';

    // Contact a Dealer URL
    this.contactDealerUrl = this.pageUrls['contact a dealer']
      || 'https://www.hyundai.com/au/en/contact-a-dealer';

    // Load Contact Us test data
    const contactUsDataKey = Object.keys(allData).find(k => k.toLowerCase().includes('contact us form'));
    this.testData = contactUsDataKey ? allData[contactUsDataKey] : [];
    // Alias under a name that auto-generated steps recognise (look up by table-specific source).
    this.contactUsData = this.testData;

    // Load Contact a Dealer test data
    const contactDealerDataKey = Object.keys(allData).find(k => k.toLowerCase().includes('contact a dealer'));
    this.contactDealerData = contactDealerDataKey ? allData[contactDealerDataKey] : [];

    // Load Test Drive form test data
    const testDriveDataKey = Object.keys(allData).find(k => k.toLowerCase().includes('test drive'));
    this.testDriveData = testDriveDataKey ? allData[testDriveDataKey] : [];

    console.log(`📋 Contact Us URL: ${this.contactUsUrl}`);
    console.log(`📋 Contact a Dealer URL: ${this.contactDealerUrl}`);
    console.log(`📋 Contact Us test data rows: ${this.testData.length}`);
    console.log(`📋 Contact a Dealer test data rows: ${this.contactDealerData.length}`);
    console.log(`📋 Test Drive test data rows: ${this.testDriveData.length}`);
  } catch (err) {
    console.error(`⚠️  Failed to load Confluence data: ${err.message}`);
    console.log('   Falling back to Production defaults');
    this.environmentName = envCache?.activeEnvironment || config.targetEnvironment;
    this.pageUrls = envCache?.pageUrls || {};
    this.contactUsUrl = this.pageUrls['contact us'] || 'https://www.hyundai.com/au/en/customer-care/contact-us';
    this.contactDealerUrl = this.pageUrls['contact a dealer'] || 'https://www.hyundai.com/au/en/contact-a-dealer';
    this.testData = [];
    this.contactDealerData = [];
  }
});

After(async function (scenario) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const name = scenario.pickle.name.replace(/[^a-zA-Z0-9]/g, '_');
  // Include the feature file name to avoid collisions when multiple features share the same scenario name
  const featureFile = (scenario.pickle.uri || '')
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    .replace(/\.feature$/i, '')
    .replace(/[^a-zA-Z0-9]/g, '_');
  const fileKey = featureFile ? `${featureFile}-${name}` : name;
  const status = scenario.result?.status?.toString() || 'unknown';
  const testUrl = this._testUrl || (this.page ? this.page.url() : '');

  if (this.page) {
    // Allow time for any pending API responses and DOM updates to settle
    await this.page.waitForTimeout(1500);

    // Scroll to the sorry/thank-you/confirmation result area so the screenshot
    // captures the actual form outcome (not the top-of-page heading).
    await this.page.evaluate(() => {
      const resultEl = document.querySelector(
        '.thank-you, [class*="thank-you"], [class*="success"], [class*="confirmation"], ' +
        '[class*="sorry"], [class*="error-message"], [class*="status-message"], ' +
        '[role="alert"], .cp-ryi__status, .cp-ryi__thank-you'
      );
      if (resultEl) {
        resultEl.scrollIntoView({ behavior: 'instant', block: 'center' });
      }
    }).catch(() => {});
    await this.page.waitForTimeout(400);

    // ── Capture full-page screenshot ──────────────────────────
    try {
      const buf = await this.page.screenshot({ fullPage: true });
      if (typeof this.attach === 'function') this.attach(buf, 'image/png');
      const screenshotPath = `screenshots/cucumber-${fileKey}-${timestamp}.png`;
      fs.writeFileSync(screenshotPath, buf);
      console.log(`📸 Screenshot saved (${status}): ${screenshotPath}`);
    } catch (err) {
      console.warn(`⚠️ Screenshot failed: ${err.message}`);
    }

    // ── Save metadata JSON for report generator ────────────────
    try {
      const formApiCall = findFormSubmissionCall(this._capturedApiPayloads || []);
      const metadata = {
        testUrl,
        successMessage: this.successMessage || '',
        apiStatusCode: formApiCall?.statusCode || null,
        environment: this.environmentName || '',
      };
      const metadataPath = `screenshots/metadata-${fileKey}.json`;
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
      console.log(`📋 Metadata saved: ${metadataPath} (url: ${metadata.testUrl})`);
    } catch { /* ignore */ }

    // ── Render DevTools-style payload panel screenshot ─────────
    try {
      // Reuse the same scrolled-to-result page state; don't reset scroll
      const pageBuf = await this.page.screenshot({ fullPage: true });
      const formApiCall = findFormSubmissionCall(this._capturedApiPayloads || []);
      const html = buildCombinedHtml(
        pageBuf.toString('base64'),
        testUrl,
        formApiCall,
        this._capturedApiPayloads || [],
        scenario.pickle.name
      );
      const tmpBrowser = await chromium.launch({ headless: true });
      const tmpPage = await tmpBrowser.newPage();
      await tmpPage.setViewportSize({ width: 1400, height: 800 });
      await tmpPage.setContent(html, { waitUntil: 'domcontentloaded' });
      await tmpPage.waitForTimeout(300);
      const payloadBuf = await tmpPage.screenshot({ fullPage: false });
      await tmpPage.close();
      await tmpBrowser.close();
      const payloadPath = `screenshots/payload-${fileKey}-${timestamp}.png`;
      fs.writeFileSync(payloadPath, payloadBuf);
      if (typeof this.attach === 'function') this.attach(payloadBuf, 'image/png');
      console.log(`📸 Payload screenshot saved: ${payloadPath}`);
    } catch (err) {
      console.warn(`⚠️ Payload screenshot failed: ${err.message}`);
    }
  }

  // ── Cleanup CDP session ──────────────────────────────────────
  if (this._cdpSession) {
    try { await this._cdpSession.detach(); } catch { /* ignore */ }
  }

  if (this.page) await this.page.close();
  if (this.context) await this.context.close();
  if (this.browser) await this.browser.close();
});

/**
 * Find the most relevant form-submission API call from captured payloads.
 * Filters out analytics/tracking calls and picks the main API POST.
 */
function findFormSubmissionCall(payloads) {
  const trackingPatterns = /google|analytics|doubleclick|snapchat|linkedin|twitter|t\.co|insight|mktoresp|mktoweb|marketo|facebook|gtag|pixel|hotjar|clarity|newrelic|sentry|segment|adsrvr|adservice|adsct|webevents/i;
  // Strip query-string before testing URL to avoid false positive matches on
  // tracking pixels that embed the form page URL in their query parameters.
  const urlPath = (u = '') => { try { const o = new URL(u); return o.origin + o.pathname; } catch { return (u || '').split('?')[0]; } };

  // First: look for API calls to the same domain (form submissions)
  const formApis = payloads.filter(p =>
    (p.method === 'POST' || p.method === 'PUT') &&
    !trackingPatterns.test(urlPath(p.url)) &&
    /content\/api|\/api\/|\/form\/|\/submit|\/enquiry|\/booking|\/register|\/contact/i.test(urlPath(p.url))
  );
  if (formApis.length > 0) return formApis[formApis.length - 1];

  // Second: any non-tracking POST
  const relevant = payloads.filter(p =>
    (p.method === 'POST' || p.method === 'PUT') &&
    !trackingPatterns.test(urlPath(p.url))
  );
  if (relevant.length > 0) return relevant[relevant.length - 1];

  // Third: any POST with a request body that looks like form data (still exclude tracking)
  const withBody = payloads.filter(p =>
    (p.method === 'POST' || p.method === 'PUT') &&
    !trackingPatterns.test(urlPath(p.url)) &&
    p.requestBody && p.requestBody.length > 20
  );
  if (withBody.length > 0) return withBody[withBody.length - 1];

  return null;
}

/**
 * Build a Chrome DevTools-style combined screenshot:
 * Left panel: the actual page screenshot
 * Right panel: Network tab showing Headers + Payload for the form API call
 */
function buildCombinedHtml(pageScreenshotB64, pageUrl, formApiCall, allPayloads, scenarioName) {
  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const pageImgSrc = pageScreenshotB64 ? `data:image/png;base64,${pageScreenshotB64}` : '';

  // Build the "Network" requests list (left sidebar of network panel)
  const trackingPatterns = /google|analytics|doubleclick|snapchat|linkedin|insight|mktoresp|marketo|facebook|gtag|pixel|hotjar|clarity|newrelic|sentry|segment|adsrvr/i;
  const apiCalls = allPayloads.filter(p => !trackingPatterns.test(p.url));

  const requestListHtml = apiCalls.map((p, i) => {
    const urlObj = (() => { try { return new URL(p.url); } catch { return null; } })();
    const shortName = urlObj ? urlObj.pathname.split('/').pop() || urlObj.pathname : p.url.substring(0, 40);
    const isSelected = formApiCall && p.url === formApiCall.url && p.timestamp === formApiCall.timestamp;
    return `<div style="padding:3px 8px;font-size:11px;cursor:default;${isSelected ? 'background:#E8F0FE;font-weight:bold;' : ''}border-bottom:1px solid #eee;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:${p.statusCode >= 400 ? '#9C0006' : '#333'};">${esc(shortName)}</div>`;
  }).join('');

  // Build Headers tab content
  let headersHtml = '<div style="color:#777;padding:12px;">No form API call captured</div>';
  let payloadHtml = '';
  if (formApiCall) {
    const urlObj = (() => { try { return new URL(formApiCall.url); } catch { return null; } })();
    headersHtml = `
      <div style="padding:8px 12px;">
        <div style="font-weight:bold;margin-bottom:8px;font-size:12px;">▼ General</div>
        <table style="width:100%;border-collapse:collapse;font-size:11px;">
          <tr><td style="padding:4px 8px;color:#666;width:160px;border:none;">Request URL:</td><td style="padding:4px 8px;border:none;word-break:break-all;">${esc(formApiCall.url)}</td></tr>
          <tr><td style="padding:4px 8px;color:#666;border:none;">Request Method:</td><td style="padding:4px 8px;border:none;">${esc(formApiCall.method)}</td></tr>
          <tr><td style="padding:4px 8px;color:#666;border:none;">Status Code:</td><td style="padding:4px 8px;border:none;"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${formApiCall.statusCode < 400 ? '#0a0' : '#c00'};margin-right:6px;"></span>${formApiCall.statusCode} ${formApiCall.statusCode < 400 ? 'OK' : 'Error'}</td></tr>
        </table>
        <div style="font-weight:bold;margin:12px 0 8px;font-size:12px;">▼ Response Headers</div>
        <table style="width:100%;border-collapse:collapse;font-size:11px;">
          <tr><td style="padding:3px 8px;color:#666;width:160px;border:none;">Content-Type:</td><td style="padding:3px 8px;border:none;">application/json</td></tr>
          <tr><td style="padding:3px 8px;color:#666;border:none;">Date:</td><td style="padding:3px 8px;border:none;">${esc(formApiCall.timestamp)}</td></tr>
        </table>
      </div>`;

    // Build Payload tab
    let reqBody = formApiCall.requestBody || '';
    try {
      const parsed = JSON.parse(reqBody);
      // Render as key-value pairs like Chrome DevTools
      const entries = Object.entries(parsed);
      payloadHtml = `
        <div style="padding:8px 12px;">
          <div style="font-weight:bold;margin-bottom:8px;font-size:12px;">▼ Request Payload</div>
          <div style="background:#f8f8f8;border:1px solid #e0e0e0;border-radius:4px;padding:8px;font-family:monospace;font-size:11px;">
            ${entries.map(([k, v]) => `<div style="padding:2px 0;"><span style="color:#881391;">${esc(k)}</span>: <span style="color:#1a1aa6;">${esc(typeof v === 'string' ? `"${v}"` : JSON.stringify(v))}</span></div>`).join('')}
          </div>
        </div>`;
    } catch {
      if (reqBody) {
        payloadHtml = `
          <div style="padding:8px 12px;">
            <div style="font-weight:bold;margin-bottom:8px;font-size:12px;">▼ Request Payload</div>
            <pre style="background:#f8f8f8;border:1px solid #e0e0e0;border-radius:4px;padding:8px;font-size:11px;white-space:pre-wrap;word-break:break-all;">${esc(reqBody)}</pre>
          </div>`;
      }
    }
  }

  const requestCount = `${apiCalls.length} / ${allPayloads.length} requests`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; background: #fff; width: 1400px; }
  </style></head><body>
  <div style="display:flex;width:1400px;min-height:700px;">
    <!-- LEFT: Page screenshot -->
    <div style="width:420px;flex-shrink:0;border-right:2px solid #ccc;overflow:hidden;background:#f5f5f5;">
      <!-- Browser address bar -->
      <div style="background:#dee1e6;padding:6px 12px;display:flex;align-items:center;gap:8px;border-bottom:1px solid #bbb;">
        <div style="display:flex;gap:4px;">
          <span style="width:10px;height:10px;border-radius:50%;background:#fc5753;display:inline-block;"></span>
          <span style="width:10px;height:10px;border-radius:50%;background:#fdbc40;display:inline-block;"></span>
          <span style="width:10px;height:10px;border-radius:50%;background:#33c648;display:inline-block;"></span>
        </div>
        <div style="flex:1;background:#fff;border-radius:4px;padding:3px 8px;font-size:11px;color:#333;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">🔒 ${esc(pageUrl)}</div>
      </div>
      ${pageImgSrc ? `<img src="${pageImgSrc}" style="width:100%;display:block;" />` : '<div style="padding:40px;color:#999;text-align:center;">No page screenshot</div>'}
    </div>

    <!-- RIGHT: DevTools Network panel -->
    <div style="flex:1;display:flex;flex-direction:column;background:#fff;">
      <!-- DevTools tabs bar -->
      <div style="background:#f1f3f4;border-bottom:1px solid #ccc;display:flex;align-items:center;padding:0 8px;">
        <div style="padding:6px 12px;font-size:11px;color:#666;">Elements</div>
        <div style="padding:6px 12px;font-size:11px;color:#666;">Console</div>
        <div style="padding:6px 12px;font-size:11px;color:#666;">Sources</div>
        <div style="padding:6px 12px;font-size:11px;color:#1a73e8;font-weight:bold;border-bottom:2px solid #1a73e8;">Network</div>
        <div style="padding:6px 12px;font-size:11px;color:#666;">Performance</div>
      </div>

      <!-- Filter bar -->
      <div style="background:#fff;border-bottom:1px solid #e0e0e0;display:flex;align-items:center;padding:4px 8px;gap:8px;">
        <span style="font-size:10px;padding:2px 8px;background:#1a73e8;color:#fff;border-radius:3px;">Fetch/XHR</span>
        <span style="font-size:10px;color:#666;">All</span>
        <span style="font-size:10px;color:#666;">Doc</span>
        <span style="font-size:10px;color:#666;">CSS</span>
        <span style="font-size:10px;color:#666;">JS</span>
        <span style="flex:1;"></span>
        <span style="font-size:10px;color:#666;">${esc(requestCount)}</span>
      </div>

      <div style="display:flex;flex:1;">
        <!-- Request list -->
        <div style="width:180px;border-right:1px solid #e0e0e0;overflow:hidden;">
          <div style="padding:4px 8px;font-size:10px;font-weight:bold;background:#fafafa;border-bottom:1px solid #e0e0e0;color:#555;">Name</div>
          ${requestListHtml || '<div style="padding:8px;color:#999;font-size:10px;">No requests</div>'}
        </div>

        <!-- Request detail panel -->
        <div style="flex:1;overflow:auto;">
          <!-- Tabs: Headers | Payload -->
          <div style="display:flex;border-bottom:1px solid #e0e0e0;background:#fafafa;">
            <div style="padding:6px 16px;font-size:11px;color:#1a73e8;font-weight:bold;border-bottom:2px solid #1a73e8;">Headers</div>
            <div style="padding:6px 16px;font-size:11px;color:#1a73e8;">Payload</div>
            <div style="padding:6px 16px;font-size:11px;color:#666;">Preview</div>
            <div style="padding:6px 16px;font-size:11px;color:#666;">Response</div>
          </div>

          <!-- Headers content -->
          ${headersHtml}

          <!-- Payload content -->
          ${payloadHtml}
        </div>
      </div>
    </div>
  </div>
  </body></html>`;
}
