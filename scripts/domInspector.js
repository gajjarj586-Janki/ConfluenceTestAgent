/**
 * DOM Inspector
 *
 * When a feature file is selected and a URL is resolved, this module navigates
 * to that URL with a headless Playwright browser, inspects the live DOM, and
 * builds a field-label → CSS-selector map so step definitions are generated
 * with precise, page-specific selectors instead of generic guesses.
 *
 * Also captures API endpoint patterns from network traffic during page load,
 * which are embedded in the navigate step bodies as intercept listeners.
 *
 * Results are cached in .cache/domMaps/<urlHash>.json (24-hour TTL).
 *
 * Exports:
 *   inspectPage(url)                  → Promise<DomMap | null>
 *   resolveFieldSelector(hint, map)   → string | null
 *   resolveButtonSelector(hint, map)  → string | null
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve('.');
const CACHE_DIR = path.join(ROOT, '.cache', 'domMaps');
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ─── Cache Helpers ────────────────────────────────────────────────────────────

function urlHash(url) {
  return crypto.createHash('md5').update(url).digest('hex').slice(0, 12);
}

function loadCached(url) {
  try {
    const file = path.join(CACHE_DIR, `${urlHash(url)}.json`);
    if (!fs.existsSync(file)) return null;
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (Date.now() - new Date(data.cachedAt).getTime() < CACHE_TTL_MS) return data;
  } catch { /* ignore */ }
  return null;
}

function saveCache(url, data) {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
  const file = path.join(CACHE_DIR, `${urlHash(url)}.json`);
  fs.writeFileSync(file, JSON.stringify({ ...data, cachedAt: new Date().toISOString() }, null, 2));
}

// ─── Core Inspector ───────────────────────────────────────────────────────────

/**
 * Navigate to a URL, inspect the live DOM, and return a field-label map.
 * Returns null if the URL is missing or if inspection fails.
 *
 * @param {string} url
 * @returns {Promise<{
 *   url: string,
 *   title: string,
 *   fields: Array<{label:string, selector:string, type:string, name:string, id:string, placeholder:string, ariaLabel:string, required:boolean, tag:string}>,
 *   buttons: Array<{text:string, selector:string, type:string, id:string}>,
 *   errorContainers: Array<{selector:string, cls:string}>,
 *   apiPatterns: string[]
 * } | null>}
 */
export async function inspectPage(url) {
  if (!url || !url.startsWith('http')) return null;

  const cached = loadCached(url);
  if (cached) {
    console.log(`  💾 DOM map loaded from cache for: ${url}`);
    return cached;
  }

  console.log(`  🔍 Inspecting DOM at: ${url}`);
  const capturedRequests = [];

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    // ── Capture network requests for API pattern discovery ────────────────
    page.on('request', (request) => {
      const reqUrl = request.url();
      const method = request.method();
      if (
        method === 'POST' || method === 'PUT' ||
        /\/(api|form|submit|contact|enquiry|register|booking)\//i.test(reqUrl) ||
        reqUrl.includes('.json')
      ) {
        capturedRequests.push({
          method,
          path: reqUrl.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, ''),
        });
      }
    });

    // ── AEM staging warm-up ───────────────────────────────────────────────
    // Staging AEM dispatchers reject cold headless requests until a session
    // cookie is established. Warm up via the site homepage first so subsequent
    // navigation reaches the real page instead of a 404.
    const parsedURL = new URL(url);
    const isStaging = parsedURL.hostname.startsWith('stage.');
    if (isStaging) {
      const homeUrl = `${parsedURL.protocol}//${parsedURL.hostname}/`;
      console.log(`  🔥 AEM warm-up: visiting ${homeUrl} first`);
      await page.goto(homeUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      await page.waitForTimeout(1500);
      // Accept cookie consent if present (prevents overlay blocking form fields)
      const cookieBtn = page.locator('#onetrust-accept-btn-handler, button.onetrust-accept-btn-handler').first();
      if (await cookieBtn.count() > 0) {
        await cookieBtn.click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(800);
      }
    }

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    // Retry once if we landed on a 404 page
    const h1Text = await page.locator('h1').first().textContent({ timeout: 3000 }).catch(() => '');
    if (/404|not found/i.test(h1Text) && isStaging) {
      console.log(`  ⚠️  Got 404 on first visit — retrying after 2s`);
      await page.waitForTimeout(2000);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    }
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // ── Extract form structure from live DOM ──────────────────────────────
    const domData = await page.evaluate(() => {
      const isVisible = (el) => {
        if (!el) return false;
        const s = window.getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return (
          s.display !== 'none' &&
          s.visibility !== 'hidden' &&
          s.opacity !== '0' &&
          r.width > 0 &&
          r.height > 0
        );
      };

      const getText = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();

      // Map element id → label text from explicit <label for="id"> associations
      const labelForMap = {};
      document.querySelectorAll('label[for]').forEach((lbl) => {
        const forAttr = lbl.getAttribute('for');
        if (forAttr) labelForMap[forAttr] = getText(lbl);
      });

      // ── Fields ────────────────────────────────────────────────────────────
      const fields = Array.from(
        document.querySelectorAll(
          'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]), textarea, select'
        )
      )
        .filter(isVisible)
        .map((el) => {
          const id = el.getAttribute('id') || '';
          const name = el.getAttribute('name') || '';
          const type = (el.getAttribute('type') || el.tagName).toLowerCase();
          const placeholder = el.getAttribute('placeholder') || '';
          const ariaLabel = el.getAttribute('aria-label') || '';
          const ariaLabelledby = el.getAttribute('aria-labelledby') || '';

          // Determine the best human-readable label
          let label = labelForMap[id] || ariaLabel || placeholder || '';

          if (!label && ariaLabelledby) {
            const lblEl = document.getElementById(ariaLabelledby);
            if (lblEl) label = getText(lblEl);
          }

          // Walk up the DOM looking for a <label> or <legend> ancestor/sibling
          if (!label) {
            let p = el.parentElement;
            for (let d = 0; d < 4 && p; d++, p = p.parentElement) {
              const lbl = p.querySelector('label') || (p.tagName === 'LABEL' ? p : null);
              if (lbl) { label = getText(lbl).slice(0, 80); break; }
              const leg = p.querySelector('legend');
              if (leg) { label = getText(leg).slice(0, 80); break; }
            }
          }

          // Build the most precise unique selector (priority: id > name > aria > placeholder)
          let selector;
          if (id) {
            selector = `#${CSS.escape(id)}`;
          } else if (name) {
            selector = `${el.tagName.toLowerCase()}[name="${name}"]`;
          } else if (ariaLabel) {
            selector = `[aria-label="${ariaLabel}"]`;
          } else if (placeholder) {
            selector = `[placeholder="${placeholder}"]`;
          } else {
            selector = el.tagName.toLowerCase();
          }

          return {
            label: label || name || id,
            selector,
            type,
            name,
            id,
            placeholder,
            ariaLabel,
            required: el.required,
            tag: el.tagName.toLowerCase(),
          };
        });

      // ── Buttons ───────────────────────────────────────────────────────────
      const buttons = Array.from(
        document.querySelectorAll('button, input[type="submit"], input[type="button"]')
      )
        .filter(isVisible)
        .map((el) => {
          const text = getText(el) || el.getAttribute('value') || '';
          const id = el.getAttribute('id') || '';
          const type = el.getAttribute('type') || '';

          let selector;
          if (id) {
            selector = `#${CSS.escape(id)}`;
          } else if (text) {
            selector = `button:has-text("${text.slice(0, 50).replace(/"/g, '\\"')}")`;
          } else {
            selector = 'button[type="submit"]';
          }

          return { text: text.slice(0, 100), selector, type, id };
        })
        .filter((b) => b.text || b.type === 'submit');

      // ── Error / validation containers ─────────────────────────────────────
      const errorContainers = Array.from(
        document.querySelectorAll(
          '[class*="error" i], [class*="validation" i], [role="alert"], [class*="invalid" i]'
        )
      )
        .slice(0, 10)
        .map((el) => {
          const cls = el.className || '';
          const relevantCls = cls.split(' ').find((c) => /error|valid|invalid|alert/i.test(c)) || cls.split(' ')[0];
          return {
            selector: el.id ? `#${CSS.escape(el.id)}` : `.${relevantCls}`,
            cls,
          };
        });

      return { fields, buttons, errorContainers, title: document.title };
    });

    const result = {
      url,
      title: domData.title,
      fields: domData.fields,
      buttons: domData.buttons,
      errorContainers: domData.errorContainers,
      apiPatterns: [
        ...new Set(capturedRequests.map((r) => r.path)),
      ].filter((p) => p.length > 1).slice(0, 20),
    };

    saveCache(url, result);
    console.log(
      `  ✅ DOM mapped: ${domData.fields.length} field(s), ${domData.buttons.length} button(s), ${result.apiPatterns.length} API pattern(s)`
    );
    return result;
  } catch (err) {
    console.warn(`  ⚠️  DOM inspection failed for ${url}: ${err.message}`);
    return null;
  } finally {
    await browser.close();
  }
}

// ─── Selector Resolvers ───────────────────────────────────────────────────────

/**
 * Resolve the best CSS selector for a field-name hint using the DOM map.
 * Returns null if no match found — caller should fall back to autoHeal.
 *
 * @param {string} hint  e.g. 'First Name', 'email', 'postcode'
 * @param {object} domMap  result of inspectPage()
 * @returns {string | null}
 */
export function resolveFieldSelector(hint, domMap) {
  if (!domMap?.fields?.length) return null;
  const lower = (hint || '').toLowerCase().trim();

  // 1. Exact label match
  const exact = domMap.fields.find((f) => (f.label || '').toLowerCase() === lower);
  if (exact) return exact.selector;

  // 2. Attribute exact match (name / id / placeholder / aria-label)
  const attr = domMap.fields.find(
    (f) =>
      (f.name || '').toLowerCase() === lower ||
      (f.id || '').toLowerCase() === lower ||
      (f.placeholder || '').toLowerCase() === lower ||
      (f.ariaLabel || '').toLowerCase() === lower
  );
  if (attr) return attr.selector;

  // 3. Fuzzy: every significant word in hint appears in the field's metadata
  const words = lower.split(/\s+/).filter((w) => w.length > 2);
  if (words.length > 0) {
    const fuzzy = domMap.fields.find((f) => {
      const haystack = `${f.label} ${f.name} ${f.id} ${f.placeholder} ${f.ariaLabel}`.toLowerCase();
      return words.every((w) => haystack.includes(w));
    });
    if (fuzzy) return fuzzy.selector;
  }

  return null;
}

/**
 * Resolve the best CSS selector for a button hint using the DOM map.
 * Returns null if no match found.
 *
 * @param {string} hint  e.g. 'Submit', 'Register', 'Send Request'
 * @param {object} domMap  result of inspectPage()
 * @returns {string | null}
 */
export function resolveButtonSelector(hint, domMap) {
  if (!domMap?.buttons?.length) return null;
  const lower = (hint || '').toLowerCase().trim();

  const match = domMap.buttons.find(
    (b) =>
      (b.text || '').toLowerCase().includes(lower) ||
      (b.id || '').toLowerCase().includes(lower)
  );
  return match?.selector || null;
}
