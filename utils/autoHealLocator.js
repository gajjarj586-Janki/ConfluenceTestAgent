/**
 * Auto-Heal Locator
 *
 * When a selector fails to find an element, automatically tries a ranked list
 * of semantic fallback selectors derived from the element hint (field name,
 * button label, etc.).
 *
 * Healed locators are logged and saved to .cache/healed-locators.json so
 * developers can inspect what changed and update the originals if needed.
 *
 * Usage in step definitions (via World helpers):
 *   const el = await this.findElement('email');          // any input-like
 *   const el = await this.findButton('Submit');          // any button-like
 *   await this.fillField('first name', 'Janki');         // fill a field
 *   await this.selectOption('model', 'KONA');            // select a value
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CACHE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', '.cache', 'healed-locators.json'
);

// ─── Selector Strategy Builders ──────────────────────────────────────────────

/**
 * Build a ranked list of fallback selectors for an INPUT/TEXTAREA field.
 * Ordered from most-specific (name attribute exact-ish) to most-generic.
 */
export function buildFieldSelectors(hint) {
  const h = (hint || '').toLowerCase().trim();
  const words = h.split(/[\s_-]+/);
  const first = words[0];

  // Well-known field type shortcuts
  const known = {
    'email':        ['input[type="email"]', 'input[name*="email" i]', 'input[id*="email" i]', 'input[placeholder*="email" i]', 'input[aria-label*="email" i]'],
    'phone':        ['input[type="tel"]', 'input[name*="phone" i]', 'input[name*="mobile" i]', 'input[id*="phone" i]', 'input[placeholder*="phone" i]', 'input[aria-label*="phone" i]'],
    'mobile':       ['input[type="tel"]', 'input[name*="mobile" i]', 'input[name*="phone" i]', 'input[id*="mobile" i]', 'input[placeholder*="mobile" i]'],
    'first name':   ['input[name*="FirstName" i]', 'input[name*="first" i]', 'input[id*="first" i]', 'input[placeholder*="first" i]', 'input[aria-label*="first name" i]'],
    'first':        ['input[name*="FirstName" i]', 'input[name*="first" i]', 'input[id*="first" i]', 'input[placeholder*="first" i]'],
    'last name':    ['input[name*="LastName" i]', 'input[name*="last" i]', 'input[id*="last" i]', 'input[placeholder*="last" i]', 'input[aria-label*="last name" i]'],
    'last':         ['input[name*="LastName" i]', 'input[name*="last" i]', 'input[id*="last" i]', 'input[placeholder*="last" i]'],
    'lastname':     ['input[name*="LastName" i]', 'input[name*="last" i]', 'input[id*="last" i]', 'input[placeholder*="last" i]', 'input[aria-label*="last" i]'],
    'firstname':    ['input[name*="FirstName" i]', 'input[name*="first" i]', 'input[id*="first" i]', 'input[placeholder*="first" i]', 'input[aria-label*="first" i]'],
    'postcode':     ['input[name*="postcode" i]', 'input[name*="zip" i]', 'input[id*="postcode" i]', 'input[placeholder*="postcode" i]', 'input[placeholder*="suburb" i]'],
    'address':      ['input[name*="address" i]', 'input[id*="address" i]', 'input[name*="street" i]', 'input[placeholder*="address" i]', 'input[aria-label*="address" i]'],
    'suburb':       ['input[name*="suburb" i]', 'input[id*="suburb" i]', 'input[name*="city" i]', 'input[placeholder*="suburb" i]', 'input[aria-label*="suburb" i]'],
    'state':        ['select[name*="state" i]', 'select[id*="state" i]', 'select[aria-label*="state" i]', 'input[name*="state" i]', 'input[id*="state" i]'],
    'title':        ['select[name*="title" i]', 'select[id*="title" i]', 'select[name*="salut" i]', 'input[name*="salut" i]', 'input[id*="title" i]'],
    'salutation':   ['select[name*="salut" i]', 'select[id*="salut" i]', 'select[name*="title" i]', 'input[name*="salut" i]'],
    'vin':          ['[aria-label="Enter your VIN"]', 'input[name*="vin" i]', 'input[id*="vin" i]', 'input[placeholder*="VIN" i]', 'input[aria-label*="VIN" i]'],
    'message':      ['textarea[name*="message" i]', 'textarea[name*="enquiry" i]', 'textarea', 'input[name*="message" i]'],
    'enquiry':      ['textarea[name*="enquiry" i]', 'textarea[name*="message" i]', 'textarea', 'input[name*="enquiry" i]'],
    'subject':      ['input[name*="subject" i]', 'input[id*="subject" i]', 'input[placeholder*="subject" i]'],
    'password':     ['input[type="password"]'],
    'search':       ['input[type="search"]', 'input[name*="search" i]', 'input[placeholder*="search" i]'],
    'comment':      ['textarea[name*="comment" i]', 'textarea', 'input[name*="comment" i]'],
    'name':         ['input[name*="name" i]', 'input[id*="name" i]', 'input[placeholder*="name" i]', 'input[aria-label*="name" i]'],
  };

  if (known[h]) return known[h];

  // Fallback: generate from the hint words
  return [
    `input[name*="${h}" i]`,
    `input[id*="${h}" i]`,
    `input[placeholder*="${h}" i]`,
    `input[aria-label*="${h}" i]`,
    `textarea[name*="${h}" i]`,
    `textarea[placeholder*="${h}" i]`,
    `[name*="${first}" i]`,
    `[id*="${first}" i]`,
    `[placeholder*="${first}" i]`,
    // label-based: find label containing the hint text, then get associated input
    `input:near(:text("${h}"))`,
  ];
}

/**
 * Build a ranked list of fallback selectors for a BUTTON / link.
 * The order goes from most-specific (real <button> with exact text) to
 * most-permissive (any visible element whose text contains the label),
 * because modern React/AEM pages often render "buttons" as <div>/<span>
 * with click handlers and no role/type attributes.
 */
export function buildButtonSelectors(label) {
  const l = (label || '').trim();
  const lLower = l.toLowerCase();
  const slug = lLower.replace(/\s+/g, '-');
  return [
    // Native buttons / role=button — exact text first, then case-insensitive contains
    `button:visible:has-text("${l}")`,
    `[role="button"]:visible:has-text("${l}")`,
    `input[type="submit"][value="${l}"]`,
    `input[type="button"][value="${l}"]`,
    // Anchor with text (used as button)
    `a:visible:has-text("${l}")`,
    // Aria-label match
    `[aria-label="${l}" i]:visible`,
    `[aria-label*="${l}" i]:visible`,
    // data-testid / id slug
    `[data-testid*="${slug}" i]:visible`,
    `[id*="${slug}" i]:visible`,
    // Generic clickable elements (React-style) — leaf-ish containers with the text
    `button:visible:text-matches("${escapeRe(l)}", "i")`,
    `[role="button"]:visible:text-matches("${escapeRe(l)}", "i")`,
    `[onclick]:visible:has-text("${l}")`,
    // Any visible element whose visible text equals or contains the label.
    // Restricted to common interactive containers to avoid matching huge ancestors.
    `:is(button,a,div,span,li,label,input):visible:text-is("${l}")`,
    `:is(button,a,div,span,li,label):visible:has-text("${l}")`,
    // Last-resort: any submit button on the page
    `button[type="submit"]:visible`,
  ];
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a ranked list of fallback selectors for a SELECT dropdown.
 */
export function buildSelectSelectors(hint) {
  const h = (hint || '').toLowerCase().trim();
  const first = h.split(/[\s_-]+/)[0];
  return [
    `select[name*="${h}" i]`,
    `select[id*="${h}" i]`,
    `select[aria-label*="${h}" i]`,
    `select[name*="${first}" i]`,
    `select[id*="${first}" i]`,
    `select:visible`,
  ];
}

/**
 * Build a ranked list of fallback selectors for a CHECKBOX.
 */
export function buildCheckboxSelectors(hint) {
  const h = (hint || '').toLowerCase().trim();
  return [
    `input[type="checkbox"][name*="${h}" i]`,
    `input[type="checkbox"][id*="${h}" i]`,
    `input[type="checkbox"][aria-label*="${h}" i]`,
    `input[type="checkbox"]`,
  ];
}

// ─── Core Auto-Heal Engine ────────────────────────────────────────────────────

/**
 * Try a list of selectors in order. Returns the first one that resolves
 * to a visible element within the timeout.
 *
 * @param {import('playwright').Page} page
 * @param {string[]} selectors  - Ordered list of CSS/Playwright selectors to try
 * @param {object}   options
 * @param {number}   options.timeout     - Per-selector timeout in ms (default 3000)
 * @param {string}   options.state       - Playwright state to wait for (default 'visible')
 * @param {string}   options.hint        - Human-readable description for logging
 * @param {string}   options.stepContext - Step text for healed-locator logging
 * @returns {{ locator: import('playwright').Locator, selector: string, healed: boolean }}
 */
export async function autoHeal(page, selectors, options = {}) {
  const { timeout = 3000, state = 'visible', hint = '', stepContext = '' } = options;

  if (!selectors || selectors.length === 0) {
    throw new Error(`autoHeal: no selectors provided for "${hint}"`);
  }

  let lastError = null;

  for (let i = 0; i < selectors.length; i++) {
    const sel = selectors[i];
    try {
      const locator = page.locator(sel).first();
      await locator.waitFor({ state, timeout });
      const count = await locator.count();
      if (count === 0) continue;

      const healed = i > 0;
      if (healed) {
        console.log(`🔧 Auto-heal: "${hint}" — selector #${i + 1} worked: ${sel}`);
        console.log(`   (primary was: ${selectors[0]})`);
        saveHealedLocator({ hint, primary: selectors[0], healed: sel, stepContext });
      }

      return { locator, selector: sel, healed };
    } catch (err) {
      lastError = err;
      // Try next selector
    }
  }

  // All selectors failed — throw with helpful message
  throw new Error(
    `Auto-heal failed for "${hint}": tried ${selectors.length} selector(s):\n` +
    selectors.map((s, i) => `  ${i + 1}. ${s}`).join('\n') +
    `\nLast error: ${lastError?.message || 'element not found'}`
  );
}

/**
 * High-level helper: find any interactive element by semantic hint.
 * The type ('input'|'button'|'select'|'checkbox') controls which strategy is used.
 */
export async function findByHint(page, hint, type = 'input', options = {}) {
  let selectors;
  switch (type) {
    case 'button':   selectors = buildButtonSelectors(hint); break;
    case 'select':   selectors = buildSelectSelectors(hint); break;
    case 'checkbox': selectors = buildCheckboxSelectors(hint); break;
    default:         selectors = buildFieldSelectors(hint); break;
  }
  return autoHeal(page, selectors, { ...options, hint });
}

// ─── Healed Locator Log ───────────────────────────────────────────────────────

function saveHealedLocator(entry) {
  try {
    const cacheDir = path.dirname(CACHE_PATH);
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

    let log = [];
    if (fs.existsSync(CACHE_PATH)) {
      try { log = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8')); } catch { log = []; }
    }

    // Avoid duplicate entries for the same hint+primary
    const exists = log.findIndex(e => e.hint === entry.hint && e.primary === entry.primary);
    const record = { ...entry, timestamp: new Date().toISOString() };
    if (exists >= 0) log[exists] = record;
    else log.push(record);

    fs.writeFileSync(CACHE_PATH, JSON.stringify(log, null, 2));
  } catch { /* non-critical */ }
}

/**
 * Read the healed locator log (for report generation).
 */
export function getHealedLocators() {
  try {
    if (fs.existsSync(CACHE_PATH)) return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
  } catch { /* ignore */ }
  return [];
}
