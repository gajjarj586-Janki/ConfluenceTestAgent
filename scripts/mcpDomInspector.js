/**
 * MCP-Aware DOM Inspector
 *
 * Connects to the Playwright MCP server programmatically, navigates a page,
 * replays interaction steps (e.g. clicking "Book a test drive" to open a modal),
 * then extracts field/button selectors from the LIVE DOM at that state.
 *
 * Unlike domInspector.js, which only sees the initial page load, this module
 * can inspect modals, lazy-loaded dropdowns, and any dynamic state that requires
 * prior user interactions to reach.
 *
 * Integration:
 *   generateStepDefs.js calls mcpInspectModal() when it detects click steps that
 *   precede form-interaction steps in the feature file. The returned DomMap is
 *   merged with the base static DomMap, giving step generation accurate selectors
 *   for modal fields from the very first generation pass.
 *
 * Exports:
 *   mcpInspectModal(url, clickSequence)  → Promise<DomMap | null>
 *   detectModalTriggers(parsedFeature)   → string[]   (button texts to click)
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve('.');
const CACHE_DIR = path.join(ROOT, '.cache', 'mcpDomMaps');
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ─── Cache helpers ────────────────────────────────────────────────────────────

function cacheKey(url, clickSequence) {
  const raw = url + '|' + clickSequence.join('|');
  return crypto.createHash('md5').update(raw).digest('hex').slice(0, 12);
}

function loadCached(key) {
  try {
    const file = path.join(CACHE_DIR, `${key}.json`);
    if (!fs.existsSync(file)) return null;
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (Date.now() - new Date(data.cachedAt).getTime() < CACHE_TTL_MS) return data;
  } catch { /* ignore */ }
  return null;
}

function saveCache(key, data) {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
  const file = path.join(CACHE_DIR, `${key}.json`);
  fs.writeFileSync(file, JSON.stringify({ ...data, cachedAt: new Date().toISOString() }, null, 2));
}

// ─── MCP client helpers ───────────────────────────────────────────────────────

async function mcpCall(client, toolName, args = {}) {
  const result = await client.callTool({ name: toolName, arguments: args });
  // Playwright MCP returns content as array of {type, text} objects
  const text = (result.content || []).map(c => c.text || '').join('');
  return { raw: result, text };
}

// ─── DOM extraction script (runs inside the browser via browser_evaluate) ────

const DOM_EXTRACTOR = `(() => {
  const isVisible = el => {
    if (!el) return false;
    const s = window.getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && parseFloat(s.opacity) > 0
      && r.width > 0 && r.height > 0;
  };
  const getText = el => (el?.textContent || '').replace(/\\s+/g, ' ').trim();

  const labelForMap = {};
  document.querySelectorAll('label[for]').forEach(lbl => {
    if (lbl.getAttribute('for')) labelForMap[lbl.getAttribute('for')] = getText(lbl);
  });

  const fields = Array.from(document.querySelectorAll(
    'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]), textarea, select'
  )).filter(isVisible).map(el => {
    const id = el.getAttribute('id') || '';
    const name = el.getAttribute('name') || '';
    const type = (el.getAttribute('type') || el.tagName).toLowerCase();
    const placeholder = el.getAttribute('placeholder') || '';
    const ariaLabel = el.getAttribute('aria-label') || '';
    const ariaLabelledby = el.getAttribute('aria-labelledby') || '';

    let label = labelForMap[id] || ariaLabel || placeholder || '';
    if (!label && ariaLabelledby) {
      const lel = document.getElementById(ariaLabelledby);
      if (lel) label = getText(lel);
    }
    if (!label) {
      let p = el.parentElement;
      for (let d = 0; d < 4 && p; d++, p = p.parentElement) {
        const lbl = p.querySelector('label') || (p.tagName === 'LABEL' ? p : null);
        if (lbl) { label = getText(lbl).slice(0, 80); break; }
        const leg = p.querySelector('legend');
        if (leg) { label = getText(leg).slice(0, 80); break; }
      }
    }

    let selector;
    if (id) selector = '#' + CSS.escape(id);
    else if (name) selector = el.tagName.toLowerCase() + '[name="' + name + '"]';
    else if (ariaLabel) selector = '[aria-label="' + ariaLabel + '"]';
    else if (placeholder) selector = '[placeholder="' + placeholder + '"]';
    else selector = el.tagName.toLowerCase();

    return { label: label || name || id, selector, type, name, id, placeholder, ariaLabel, required: el.required, tag: el.tagName.toLowerCase() };
  });

  const buttons = Array.from(document.querySelectorAll('button, input[type=submit], input[type=button]'))
    .filter(isVisible).map(el => {
      const text = getText(el) || el.getAttribute('value') || '';
      const id = el.getAttribute('id') || '';
      const type = el.getAttribute('type') || '';
      let selector;
      if (id) selector = '#' + CSS.escape(id);
      else if (text) selector = 'button:has-text("' + text.slice(0, 50).replace(/"/g, '\\\\"') + '")';
      else selector = 'button[type=submit]';
      return { text: text.slice(0, 100), selector, type, id };
    }).filter(b => b.text || b.type === 'submit');

  return JSON.stringify({ fields, buttons });
})()`;

// ─── Accessibility-tree snapshot parser ───────────────────────────────────────

/**
 * Parse the text accessibility tree returned by browser_snapshot and extract
 * elements with their ARIA roles and names, supplementing the raw CSS selectors.
 *
 * @param {string} snapshotText  raw text from browser_snapshot
 * @returns {Array<{role:string, name:string, ref:string}>}
 */
function parseSnapshot(snapshotText) {
  const items = [];
  const lineRe = /^\s*-\s+(\w+)\s+"([^"]+)"(?:\s+\[ref=(e\d+)\])?/;
  for (const line of (snapshotText || '').split('\n')) {
    const m = line.match(lineRe);
    if (m) items.push({ role: m[1], name: m[2], ref: m[3] || '' });
  }
  return items;
}

// ─── Core inspector ───────────────────────────────────────────────────────────

/**
 * Navigate to a URL, replay interaction steps (button clicks) to open modals,
 * then extract a DomMap from the live DOM at that state using the Playwright MCP server.
 *
 * @param {string}   url            The page URL to navigate to
 * @param {string[]} clickSequence  Button texts to click in order before inspection
 *                                  e.g. ['Book a test drive']
 * @returns {Promise<DomMap | null>}
 */
export async function mcpInspectModal(url, clickSequence = []) {
  if (!url || !url.startsWith('http')) return null;

  const key = cacheKey(url, clickSequence);
  const cached = loadCached(key);
  if (cached) {
    console.log(`  💾 MCP DOM map loaded from cache (clicks: [${clickSequence.join(', ')}])`);
    return cached;
  }

  console.log(`  🔌 MCP DOM inspect: ${url}`);
  console.log(`     Interactions: [${clickSequence.length > 0 ? clickSequence.join(' → ') : 'none'}]`);

  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['@playwright/mcp@latest', '--headless'],
    env: { ...process.env },
  });
  const client = new Client(
    { name: 'confluence-test-agent', version: '1.0.0' },
    { capabilities: {} }
  );

  try {
    await client.connect(transport);

    // ── AEM staging warm-up (same approach as domInspector.js) ──────────────
    const parsedUrl = new URL(url);
    const isStaging = parsedUrl.hostname.startsWith('stage.');
    if (isStaging) {
      const homeUrl = `${parsedUrl.protocol}//${parsedUrl.hostname}/`;
      console.log(`  🔥 Staging warm-up: ${homeUrl}`);
      await mcpCall(client, 'browser_navigate', { url: homeUrl });
      await sleep(1500);
      // Accept cookie consent via JS evaluate (avoids needing a snapshot ref)
      await mcpCall(client, 'browser_evaluate', {
        expression: `(() => {
          const btn = document.querySelector('#onetrust-accept-btn-handler, .onetrust-accept-btn-handler');
          if (btn) { btn.click(); return true; }
          return false;
        })()`
      }).catch(() => {});
      await sleep(800);
    }

    // ── Navigate to target page ──────────────────────────────────────────────
    await mcpCall(client, 'browser_navigate', { url });
    await sleep(2500);

    // Accept cookies on target page too (may appear again)
    await mcpCall(client, 'browser_evaluate', {
      expression: `(() => {
        const btn = document.querySelector('#onetrust-accept-btn-handler, .onetrust-accept-btn-handler');
        if (btn && btn.offsetParent) { btn.click(); return true; }
        return false;
      })()`
    }).catch(() => {});
    await sleep(500);

    // ── Replay click sequence to reach the modal state ───────────────────────
    for (const btnText of clickSequence) {
      console.log(`  🖱️  Clicking: "${btnText}"`);
      // Use browser_evaluate for reliable clicks — avoids ref lookup complexity
      const clicked = await mcpCall(client, 'browser_evaluate', {
        expression: `(() => {
          const words = ${JSON.stringify(btnText.toLowerCase().split(/\s+/).filter(Boolean))};
          const el = Array.from(document.querySelectorAll('button, a, [role="button"], [class*="cta"]')).find(el => {
            const t = el.textContent.trim().toLowerCase();
            return words.every(w => t.includes(w));
          });
          if (el) { el.click(); return el.textContent.trim(); }
          return null;
        })()`
      });
      console.log(`     → clicked: ${clicked.text || '(not found)'}`);
      await sleep(3000); // wait for modal animation + async option loading
    }

    // ── Extract DOM fields from live state ───────────────────────────────────
    let fields = [];
    let buttons = [];

    const evalResult = await mcpCall(client, 'browser_evaluate', { expression: DOM_EXTRACTOR });
    try {
      const parsed = JSON.parse(evalResult.text);
      fields = parsed.fields || [];
      buttons = parsed.buttons || [];
    } catch {
      console.warn('  ⚠️  Could not parse DOM extractor result');
    }

    // ── Accessibility tree snapshot — provides role+name pairs ───────────────
    const snapshotResult = await mcpCall(client, 'browser_snapshot', {});
    const ariaRoles = parseSnapshot(snapshotResult.text);

    const result = {
      url,
      clickSequence,
      title: '',
      fields,
      buttons,
      ariaRoles,
      errorContainers: [],
      apiPatterns: [],
    };

    saveCache(key, result);
    console.log(`  ✅ MCP DOM mapped: ${fields.length} field(s), ${buttons.length} button(s), ${ariaRoles.length} ARIA role(s)`);
    return result;

  } catch (err) {
    console.warn(`  ⚠️  MCP DOM inspection failed: ${err.message}`);
    return null;
  } finally {
    try { await client.close(); } catch { /* ignore */ }
  }
}

// ─── Trigger detection ────────────────────────────────────────────────────────

/**
 * Scan a parsed feature's step sequence and identify button-click steps that
 * appear to open modals (i.e. they precede form-filling / dropdown-selection steps).
 *
 * Returns the ordered list of button texts to click to reach the first modal state.
 * If the feature has multiple modal triggers (e.g. BATD and CAD in separate scenarios),
 * returns only the triggers from the first scenario that has them.
 *
 * @param {{ allSteps: Array<{keyword:string, text:string}> }} parsedFeature
 * @returns {string[]}  e.g. ['Book a test drive']
 */
export function detectModalTriggers(parsedFeature) {
  const MODAL_CLICK_PATTERN = /test.?drive|contact.?dealer|book.?service|quote.*book|enquiry|contact.*dealer/i;
  const FORM_STEP_PATTERN   = /fills?\s+|selects?\s+model|selects?\s+powertrain|selects?\s+variant|inputs?\s+/i;

  const steps = parsedFeature.allSteps || [];
  const triggers = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const m = step.text.match(/clicks?\s+(?:on\s+)?(.+)/i);
    if (!m) continue;

    const btnText = m[1].trim();
    if (!MODAL_CLICK_PATTERN.test(btnText)) continue;

    // Confirm there's at least one form-interaction step within the next 10 steps
    const nextForm = steps.slice(i + 1, i + 11).some(s => FORM_STEP_PATTERN.test(s.text));
    if (nextForm) {
      triggers.push(btnText);
      // Only collect triggers up to and including the first modal-opening click
      // (we inspect the page state after the first modal opens; deeper states
      //  like multi-step wizards are handled by the fix loop)
      break;
    }
  }

  return triggers;
}

// ─── Merge helper (exported for generateStepDefs.js) ─────────────────────────

/**
 * Merge a modal-state DomMap into the base static DomMap.
 * Modal fields/buttons are prepended so they take priority in selector resolution.
 *
 * @param {object} baseDomMap   result of domInspector.inspectPage()
 * @param {object} modalDomMap  result of mcpInspectModal()
 * @returns {object}  merged DomMap
 */
export function mergeDomMaps(baseDomMap, modalDomMap) {
  if (!modalDomMap) return baseDomMap;
  if (!baseDomMap) return modalDomMap;

  // Deduplicate by selector — modal fields take priority
  const seenSelectors = new Set(modalDomMap.fields.map(f => f.selector));
  const baseFields = (baseDomMap.fields || []).filter(f => !seenSelectors.has(f.selector));

  const seenBtnSelectors = new Set(modalDomMap.buttons.map(b => b.selector));
  const baseButtons = (baseDomMap.buttons || []).filter(b => !seenBtnSelectors.has(b.selector));

  return {
    ...baseDomMap,
    fields: [...modalDomMap.fields, ...baseFields],
    buttons: [...modalDomMap.buttons, ...baseButtons],
    ariaRoles: modalDomMap.ariaRoles || [],
    errorContainers: [...(modalDomMap.errorContainers || []), ...(baseDomMap.errorContainers || [])],
    apiPatterns: [...new Set([...(modalDomMap.apiPatterns || []), ...(baseDomMap.apiPatterns || [])])],
  };
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
