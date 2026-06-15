/**
 * Calculator pricing step definitions.
 *
 * Iterates every model on the Hyundai calculator landing page, opens each
 * model's calculator, picks up every variant + its visible price (or the
 * single MLP if the model has no variant selector), and flags any model
 * that shows "Pricing coming soon" / "Coming soon at Hyundai".
 *
 * Generates two artefacts at the end of the scenario:
 *   - excel-reports/CalculatorPricing_<timestamp>.html   (human readable)
 *   - excel-reports/CalculatorPricing_<timestamp>.json   (machine readable)
 * The same payload is also attached to the Cucumber report.
 */
import { When, Then } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { handleLocationModal } from './commonHelpers.js';

const COMING_SOON_RE = /(pricing\s+coming\s+soon|coming\s+soon\s+at\s+hyundai)/i;
const PRICE_RE = /\$\s*\d{1,3}(?:,\d{3})+(?:\.\d{2})?/g;

function resolveSiteRoot(world) {
  // Prefer any pageUrls hyundai entry, else fall back to production.
  const candidates = Object.values(world.pageUrls || {});
  for (const u of candidates) {
    try {
      const url = new URL(u);
      if (/hyundai/i.test(url.hostname)) {
        return `${url.protocol}//${url.host}`;
      }
    } catch { /* ignore */ }
  }
  return 'https://www.hyundai.com';
}

When(/^the user navigates to the calculator landing page$/i, async function () {
  const root = resolveSiteRoot(this);
  const url = `${root}/au/en/shop/calculator`;
  await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await this.page.waitForTimeout(2000);
  // Dismiss / fill the "Set your location" modal if it appears.
  try { await handleLocationModal(this.page, '2000'); } catch (e) {
    console.log(`  · location modal handler skipped: ${e.message}`);
  }
  await this.page.waitForTimeout(1500);
  this._calculatorLandingUrl = url;
});

Then(/^the calculator landing page should list at least (\d+) model[s]?$/i, async function (minCount) {
  const min = Number(minCount);
  const models = await this.page.evaluate(() => {
    const seen = new Map();
    document.querySelectorAll('a[href*="/calculator/"]').forEach(a => {
      const href = a.getAttribute('href') || '';
      const m = href.match(/\/calculator\/([a-z0-9-]+)(?:[/?#]|$)/i);
      if (!m) return;
      const slug = m[1].toLowerCase();
      if (slug === 'calculator') return;
      const text = (a.innerText || a.textContent || '').trim().slice(0, 60);
      if (!seen.has(slug)) seen.set(slug, { slug, href, text });
    });
    return Array.from(seen.values());
  });
  // Some calculator pages exist but aren't linked from the landing tile grid
  // (e.g. ioniq-6-n on stage). Probe a known extras list and include if HTTP 200.
  const knownExtras = ['ioniq-6-n'];
  for (const slug of knownExtras) {
    if (models.some(m => m.slug === slug)) continue;
    try {
      const probe = await this.page.context().request.get(`${(this._calculatorLandingUrl || '').replace(/\/calculator.*$/, '')}/calculator/${slug}`, { timeout: 15000 });
      if (probe.ok()) {
        models.push({ slug, href: `/au/en/shop/calculator/${slug}`, text: slug });
        console.log(`Calculator landing → added hidden slug "${slug}" (HTTP ${probe.status()})`);
      }
    } catch { /* ignore */ }
  }
  this._calculatorModels = models;
  console.log(`Calculator landing → discovered ${models.length} model slug(s): ${models.map(m => m.slug).join(', ')}`);
  assert.ok(models.length >= min, `Expected at least ${min} models, found ${models.length}`);
});

/**
 * For each model:
 *   1. Navigate to /shop/calculator/<slug>
 *   2. Wait for content
 *   3. Detect "coming soon"
 *   4. Otherwise capture visible variant labels + prices.
 */
When(/^the user inspects every model and its variants on the calculator$/i, { timeout: 15 * 60 * 1000 }, async function () {
  const root = resolveSiteRoot(this);
  const models = this._calculatorModels || [];
  assert.ok(models.length > 0, 'No models discovered on calculator landing — run the previous step first');

  const results = [];
  for (const m of models) {
    const url = `${root}/au/en/shop/calculator/${m.slug}`;
    const entry = {
      slug: m.slug,
      displayName: m.text || m.slug,
      url,
      comingSoon: false,
      variants: [],   // [{ label, price }]
      prices: [],     // raw price strings detected on page
      error: null,
    };

    try {
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      // Quick-check the location modal (avoid 15s waitFor in helper if not present).
      const hasModal = await this.page.locator('.hyu-postcode-modal.tingle-modal--visible')
        .first().isVisible({ timeout: 1500 }).catch(() => false);
      if (hasModal) {
        try { await handleLocationModal(this.page, '2000'); } catch { /* ignore */ }
      }

      // Wait for the calculator to render (variant tiles or drive-away price).
      // The page shows a transient "Coming soon at Hyundai" placeholder until
      // the dealer-aware calculator JS hydrates, so we explicitly wait for
      // calculator UI to appear — only after a generous timeout do we
      // conclude the model is genuinely "coming soon".
      const rendered = await this.page.waitForFunction(() => {
        const priceRe = /\$\s*\d{1,3}(?:,\d{3})+(?:\.\d{2})?/;
        if (priceRe.test(document.body.innerText || '')) return true;
        // Calculator UI markers
        const sel = 'h2, h3, h4, p, span, div';
        for (const el of document.querySelectorAll(sel)) {
          if (el.offsetParent === null) continue;
          const t = (el.innerText || '').trim();
          if (/^(Select variant|Choose your powertrain|Transmission|Drive Away Price)\.?$/i.test(t)) return true;
        }
        return false;
      }, { timeout: 25000 }).then(() => true).catch(() => false);

      // Extra settle for the price footer to populate.
      await this.page.waitForTimeout(rendered ? 1500 : 500);

      const takeSnapshot = () => this.page.evaluate(() => {
        const priceRe = /\$\s*\d{1,3}(?:,\d{3})+(?:\.\d{2})?/g;
        const body = document.body.innerText || '';
        const prices = body.match(priceRe) || [];

        const headingsText = Array.from(document.querySelectorAll('h1,h2,h3,h4'))
          .filter(el => el.offsetParent !== null)
          .map(el => (el.innerText || '').trim());
        const hasCalcUI = headingsText.some(t =>
          /^(Select energy type|Body Type|Select variant|Choose your powertrain|Transmission|Drive Away Price|Colour)\.?$/i.test(t)
          || /option\s+pack/i.test(t)
        );
        let comingSoon = false;
        if (!hasCalcUI && prices.length === 0) {
          // Only mark coming-soon if the page actually says so. Otherwise the
          // page may just be slow to render the calculator UI.
          const bodyText = (document.body.innerText || '').toLowerCase();
          comingSoon = /pricing\s+coming\s+soon|coming\s+soon\s+at\s+hyundai/.test(bodyText);
        }

        // ── Enumerate every option group on the calculator panel.
        // Each group is a heading (Energy type / Variant / Powertrain /
        // Transmission / *Option Pack) followed by a list of selectable tiles.
        const groupRe = /^(select energy type|body type|select variant|choose your powertrain|transmission)\.?$/i;
        const packRe = /option\s+pack/i; // e.g. "Extended Range Option Pack"
        const sectionRe = /^(select energy type|body type|select variant|choose your powertrain|transmission|colour|drive away price|finance|hyundai finance|novated lease|warranty|servicing|accessories|interior|exterior)\.?$/i;
        const isGroupHeading = (t) => groupRe.test(t) || packRe.test(t);
        const groupHeadings = Array.from(document.querySelectorAll('h1,h2,h3,h4'))
          .filter(el => el.offsetParent !== null && isGroupHeading((el.innerText || '').trim()));

        const allEls = Array.from(document.querySelectorAll('*'));
        const optionGroups = [];
        for (const heading of groupHeadings) {
          const groupName = (heading.innerText || '').trim().replace(/\.$/, '');
          const startIdx = allEls.indexOf(heading);
          const options = [];
          const seen = new Set();
          for (let i = startIdx + 1; i < allEls.length; i++) {
            const el = allEls[i];
            if (!el || el.offsetParent === null) continue;
            const t = (el.innerText || '').trim();
            if (/^H[1-4]$/.test(el.tagName)) {
              if (sectionRe.test(t) && !groupRe.test(t)) break;
              if (isGroupHeading(t) && t.toLowerCase() !== groupName.toLowerCase()) break;
              continue;
            }
            if (el.children.length > 3) continue;
            const r = el.getBoundingClientRect();
            if (r.width < 80 || r.height < 24 || r.height > 90) continue;
            if (!t || t.length > 80) continue;
            if (/\$/.test(t)) continue;
            const label = t.split(/\n+/).map(s => s.trim()).filter(Boolean)[0];
            if (!label) continue;
            if (/^(find what|select|change vehicle|choose|what's detailed|whats detailed)/i.test(label)) continue;
            if (seen.has(label)) continue;
            seen.add(label);
            options.push(label.slice(0, 100));
            if (options.length >= 6) break;
          }
          if (options.length) optionGroups.push({ name: groupName, options });
        }

        return { comingSoon, optionGroups, prices: prices.slice(0, 20) };
      });

      let snapshot = await takeSnapshot();
      // Retry once if the page hasn't surfaced calculator UI yet (slow hydrate).
      if (!snapshot.comingSoon && !snapshot.optionGroups.length && !snapshot.prices.length) {
        await this.page.waitForTimeout(5000);
        snapshot = await takeSnapshot();
      }

      entry.comingSoon = snapshot.comingSoon;
      entry.prices = snapshot.prices;
      entry.optionGroups = snapshot.optionGroups;

      // If calculator is genuinely missing, record a single placeholder row.
      if (snapshot.comingSoon || !snapshot.optionGroups.length) {
        entry.variants = [{ label: '(no variants)', price: null }];
      } else {
        // The calculator's option groups are DYNAMIC: selecting a variant can
        // remove a downstream group entirely (e.g. INSTER Cross has no
        // "Extended Range Option Pack") and selecting an option pack can change
        // the powertrain/transmission labels. A static cartesian product built
        // from the initial snapshot therefore references options that no longer
        // exist for many combinations, which silently dropped them from the
        // report. Instead we walk the groups depth-first, re-reading each
        // group's *live* options after every upstream selection.
        const COMBO_CAP = 40;
        console.log(`    groups (initial): ${snapshot.optionGroups.map(g => `${g.name}(${g.options.length})`).join(' × ')}`);

        const readDriveAway = async () => this.page.evaluate(() => {
          const priceRe = /\$\s*\d{1,3}(?:,\d{3})+(?:\.\d{2})?/g;
          let comingSoon = false;
          // Collect every plausible match, then pick the one most likely to
          // be the real Drive Away footer (shortest text containing both the
          // "drive away" label and a price — most specific = innermost element).
          const candidates = [];
          for (const el of document.querySelectorAll('div, section, footer, span, p, strong, b')) {
            if (el.offsetParent === null) continue;
            if (el.children.length > 8) continue;
            const t = (el.innerText || '').trim();
            if (!t || t.length > 400) continue;
            if (!/drive[\s-]?away/i.test(t)) continue;
            if (/pricing\s+coming\s+soon/i.test(t)) { comingSoon = true; continue; }
            const m = t.match(priceRe);
            if (!m) continue;
            // Skip Hyundai Finance / Novated Lease panels — they show a
            // different number (monthly repayment / lease cost).
            if (/(hyundai\s+finance|novated\s+lease|weekly|monthly|per\s+week|per\s+month|repayment|finance\s+from)/i.test(t)) continue;
            // Prefer "Estimated Drive Away" footer marker if present.
            const isFooter = /estimated\s+drive[\s-]?away/i.test(t);
            candidates.push({ text: t, price: m[m.length - 1], len: t.length, isFooter });
          }
          if (!candidates.length) return { price: null, comingSoon };
          // Footer marker wins; otherwise the shortest text (most specific element).
          candidates.sort((a, b) => (b.isFooter - a.isFooter) || (a.len - b.len));
          return { price: candidates[0].price, comingSoon: false };
        });

        // Scoped, verified tile-click. The TARGETING runs in-page (so we never
        // confuse a breadcrumb / sidebar label for a real tile), but the actual
        // CLICK is performed by Playwright via a marker attribute.
        //
        // IMPORTANT: a synthetic in-page `element.click()` does NOT drive this
        // calculator's variant/powertrain/transmission selection — the CPC
        // widget only reacts to *trusted* pointer events. Using a synthetic
        // click left the selection on the default variant, so every combo read
        // back the same Drive Away price. We therefore mark the resolved tile
        // with `data-pw-target` and let Playwright dispatch a real click.
        const markOption = (groupName, label) => this.page.evaluate(({ groupName, label }) => {
          // Clear any stale marker from a previous click attempt.
          document.querySelectorAll('[data-pw-target]').forEach(el => el.removeAttribute('data-pw-target'));
          const normGroup = groupName.trim().toLowerCase().replace(/\.$/, '');
          const normLabel = label.trim().toLowerCase();
          // 1. Find the heading element for this group.
          const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4'))
            .filter(el => el.offsetParent !== null);
          const heading = headings.find(el => {
            const t = (el.innerText || '').trim().toLowerCase().replace(/\.$/, '');
            return t === normGroup;
          });
          if (!heading) return { ok: false, reason: 'group-heading-not-found' };
          // 2. Determine the tile container: walk up until we find an ancestor
          //    that also contains the NEXT heading; the section before the next
          //    heading is the tile area for THIS group.
          const allHeadings = headings.filter(h => h.offsetParent !== null);
          const hIdx = allHeadings.indexOf(heading);
          const nextHeading = allHeadings[hIdx + 1] || null;
          // 3. Collect candidate tiles between this heading and the next heading,
          //    walking the document in DOM order.
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
          const candidates = [];
          let inRange = false;
          while (walker.nextNode()) {
            const el = walker.currentNode;
            if (el === heading) { inRange = true; continue; }
            if (nextHeading && el === nextHeading) break;
            if (!inRange) continue;
            if (el.offsetParent === null) continue;
            if (el.children.length > 4) continue;
            const t = (el.innerText || '').trim();
            if (!t) continue;
            // Use first line — tiles often have "Label\n+$2,500" upgrades.
            const firstLine = t.split(/\n+/).map(s => s.trim()).filter(Boolean)[0] || '';
            if (firstLine.toLowerCase() !== normLabel) continue;
            // Tag-based filter: skip plain headings inside the range.
            if (/^H[1-4]$/.test(el.tagName)) continue;
            candidates.push(el);
          }
          if (!candidates.length) return { ok: false, reason: 'no-tile-found' };
          // 4. For each candidate, walk up to the nearest clickable ancestor.
          const isClickable = (el) => {
            if (!el || el === document.body) return false;
            if (el.tagName === 'BUTTON' || el.tagName === 'A') return true;
            const role = el.getAttribute && el.getAttribute('role');
            if (role === 'button' || role === 'tab' || role === 'radio' || role === 'option') return true;
            if (el.hasAttribute && el.hasAttribute('tabindex')) return true;
            const cls = (el.className || '').toString();
            // Token-exact match: a hyphenated word boundary makes /\bcpc-option\b/
            // also match the WRAPPER classes "cpc-option-list" / "cpc-option-name"
            // / "cpc-option-price". Marking the list container instead of the tile
            // made clicks land in dead space (transmission never toggled), so we
            // only treat the exact "cpc-option" tile class as clickable.
            const tokens = cls.split(/\s+/);
            if (tokens.includes('cpc-option')) return true;
            if (tokens.some(t => /^(option-tile|tile|btn|button|card|chip)$/i.test(t))) return true;
            if (/cursor-pointer/.test(cls)) return true;
            return false;
          };
          const findClickable = (start) => {
            let el = start;
            for (let i = 0; i < 6 && el && el !== document.body; i++) {
              if (isClickable(el)) return el;
              el = el.parentElement;
            }
            return start;
          };
          const isSelected = (el) => {
            if (!el) return false;
            if (el.getAttribute && (el.getAttribute('aria-selected') === 'true'
              || el.getAttribute('aria-checked') === 'true'
              || el.getAttribute('aria-pressed') === 'true')) return true;
            const cls = el.className || '';
            if (typeof cls === 'string' && /\b(selected|active|is-selected|is-active|checked)\b/i.test(cls)) return true;
            return false;
          };
          // Resolve every candidate (tile, label span, wrapper) to its nearest
          // clickable tile, keeping ONLY real clickables. This discards the list
          // container and bare label spans so we always mark the actual option
          // tile, never its wrapper.
          const resolved = [];
          for (const c of candidates) {
            const cl = findClickable(c);
            if (isClickable(cl) && !resolved.includes(cl)) resolved.push(cl);
          }
          const pool = resolved.length ? resolved : [findClickable(candidates[0])];
          // Prefer a not-yet-selected tile; else fall back to the first
          // (re-clicking an already-selected tile is harmless and idempotent).
          let target = pool.find(el => !isSelected(el));
          const alreadySelected = !target;
          if (!target) target = pool[0];
          // Mark the resolved tile so Playwright can dispatch a trusted click.
          target.setAttribute('data-pw-target', '1');
          return { ok: true, alreadySelected, tag: target.tagName, cls: (target.className || '').toString().slice(0, 120) };
        }, { groupName, label });

        const clickOption = async (groupName, label) => {
          const found = await markOption(groupName, label);
          if (!found || !found.ok) return found || { ok: false, reason: 'unknown' };
          const target = this.page.locator('[data-pw-target="1"]');
          try {
            await target.scrollIntoViewIfNeeded({ timeout: 4000 });
            await target.click({ timeout: 5000 });
          } catch (e) {
            await this.page.evaluate(() => document.querySelector('[data-pw-target="1"]')?.removeAttribute('data-pw-target')).catch(() => {});
            return { ok: false, reason: `click-failed: ${(e.message || '').split('\n')[0]}` };
          }
          // Verify the tile toggled to a selected state, then clear the marker.
          const verify = await this.page.evaluate(() => {
            const el = document.querySelector('[data-pw-target="1"]');
            const isSelected = (el) => {
              if (!el) return false;
              if (el.getAttribute && (el.getAttribute('aria-selected') === 'true'
                || el.getAttribute('aria-checked') === 'true'
                || el.getAttribute('aria-pressed') === 'true')) return true;
              const cls = el.className || '';
              if (typeof cls === 'string' && /\b(selected|active|is-selected|is-active|checked)\b/i.test(cls)) return true;
              return false;
            };
            const selected = isSelected(el);
            if (el) el.removeAttribute('data-pw-target');
            return { selected };
          }).catch(() => ({ selected: false }));
          return { ok: true, alreadySelected: found.alreadySelected, selected: verify.selected, tag: found.tag, cls: found.cls };
        };

        // Read a group's CURRENT (live) options in the page's present state,
        // using the same filters as the initial snapshot. Returns null when the
        // group's heading isn't present (i.e. it doesn't apply to this config).
        const getCurrentOptions = (groupName) => this.page.evaluate((groupName) => {
          const groupRe = /^(select energy type|body type|select variant|choose your powertrain|transmission)\.?$/i;
          const packRe = /option\s+pack/i;
          const sectionRe = /^(select energy type|body type|select variant|choose your powertrain|transmission|colour|drive away price|finance|hyundai finance|novated lease|warranty|servicing|accessories|interior|exterior)\.?$/i;
          const isGroupHeading = (t) => groupRe.test(t) || packRe.test(t);
          const norm = groupName.trim().toLowerCase().replace(/\.$/, '');
          const allEls = Array.from(document.querySelectorAll('*'));
          const heading = Array.from(document.querySelectorAll('h1,h2,h3,h4'))
            .find(el => el.offsetParent !== null && (el.innerText || '').trim().toLowerCase().replace(/\.$/, '') === norm);
          if (!heading) return null;
          const startIdx = allEls.indexOf(heading);
          const options = []; const seen = new Set();
          for (let i = startIdx + 1; i < allEls.length; i++) {
            const el = allEls[i];
            if (!el || el.offsetParent === null) continue;
            const t = (el.innerText || '').trim();
            if (/^H[1-4]$/.test(el.tagName)) {
              if (sectionRe.test(t) && !groupRe.test(t)) break;
              if (isGroupHeading(t) && t.toLowerCase().replace(/\.$/, '') !== norm) break;
              continue;
            }
            if (el.children.length > 3) continue;
            const r = el.getBoundingClientRect();
            if (r.width < 80 || r.height < 24 || r.height > 90) continue;
            if (!t || t.length > 80) continue;
            if (/\$/.test(t)) continue;
            const label = t.split(/\n+/).map(s => s.trim()).filter(Boolean)[0];
            if (!label) continue;
            if (/^(find what|select|change vehicle|choose|what's detailed|whats detailed)/i.test(label)) continue;
            if (seen.has(label)) continue;
            seen.add(label);
            options.push(label.slice(0, 100));
            if (options.length >= 6) break;
          }
          return options;
        }, groupName);

        // Read the option-group headings CURRENTLY present on the page, in DOM
        // order. The set of groups is variant-dependent (e.g. INSTER shows an
        // "Extended Range Option Pack" while INSTER Cross shows a "Roof Basket
        // Option Pack" instead), so we must rediscover them after each selection
        // rather than trust the initial snapshot's group list.
        const getCurrentGroupsInOrder = () => this.page.evaluate(() => {
          const groupRe = /^(select energy type|body type|select variant|choose your powertrain|transmission)\.?$/i;
          const packRe = /option\s+pack/i;
          const isGroupHeading = (t) => groupRe.test(t) || packRe.test(t);
          const seen = new Set(); const out = [];
          for (const el of document.querySelectorAll('h1,h2,h3,h4')) {
            if (el.offsetParent === null) continue;
            const t = (el.innerText || '').trim();
            if (!isGroupHeading(t)) continue;
            const name = t.replace(/\.$/, '');
            const key = name.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(name);
          }
          return out;
        });

        // Wait for the Drive Away price to settle (change off the previous
        // value) then read it.
        const settleAndReadPrice = async (prevPrice) => {
          await this.page.waitForFunction((prev) => {
            const priceRe = /\$\s*\d{1,3}(?:,\d{3})+(?:\.\d{2})?/g;
            const candidates = [];
            for (const el of document.querySelectorAll('div, section, footer, span, p, strong, b')) {
              if (el.offsetParent === null) continue;
              if (el.children.length > 8) continue;
              const t = (el.innerText || '').trim();
              if (!t || t.length > 400) continue;
              if (!/drive[\s-]?away/i.test(t)) continue;
              if (/(hyundai\s+finance|novated\s+lease|weekly|monthly|per\s+week|per\s+month|repayment|finance\s+from|pricing\s+coming\s+soon)/i.test(t)) continue;
              const m = t.match(priceRe);
              if (!m) continue;
              const isFooter = /estimated\s+drive[\s-]?away/i.test(t);
              candidates.push({ price: m[m.length - 1], len: t.length, isFooter });
            }
            if (!candidates.length) return false;
            candidates.sort((a, b) => (b.isFooter - a.isFooter) || (a.len - b.len));
            return prev ? candidates[0].price !== prev : true;
          }, prevPrice, { timeout: 6000 }).catch(() => {});
          await this.page.waitForTimeout(300);
          return readDriveAway();
        };

        const captured = [];
        let lastPrice = null;
        let fatal = false;
        const MAX_DEPTH = 10; // safety bound on how many groups deep we recurse
        const isFatal = (e) => /Target page, context or browser has been closed|Execution context was destroyed/i.test((e && e.message) || '');

        // Depth-first walk of the calculator's option groups. At each step we
        // rediscover the groups currently on the page (DOM order) and process
        // the first one we haven't handled yet — so variant-specific groups
        // (different option packs, etc.) are followed correctly and a leaf is
        // reached only once every present group has a selection.
        const dfs = async (chosen, handled) => {
          if (fatal || captured.length >= COMBO_CAP) return;
          let groups;
          try {
            groups = await getCurrentGroupsInOrder();
          } catch (e) {
            if (isFatal(e)) { fatal = true; return; }
            groups = [];
          }
          const nextGroup = groups.find(g => !handled.has(g.toLowerCase()));
          if (!nextGroup || handled.size >= MAX_DEPTH) {
            // Leaf: every present group has a selection → price this config.
            const r = await settleAndReadPrice(lastPrice);
            if (r.price) { lastPrice = r.price; entry.driveAwayPrice = r.price; }
            const comboLabel = chosen.map(o => `${o.group}: ${o.label}`).join(' | ');
            captured.push({ label: comboLabel, options: [...chosen], price: r.price, pricingComingSoon: r.comingSoon, error: null });
            console.log(`    – ${comboLabel.padEnd(80)} → ${r.price || (r.comingSoon ? 'Pricing coming soon' : 'no price')}`);
            return;
          }
          const nextHandled = new Set(handled);
          nextHandled.add(nextGroup.toLowerCase());

          let opts;
          try {
            opts = await getCurrentOptions(nextGroup);
          } catch (e) {
            if (isFatal(e)) { fatal = true; return; }
            opts = null;
          }
          // Group heading present but no selectable tiles → mark handled and
          // move on (without adding a bogus selection row).
          if (!opts || !opts.length) return dfs(chosen, nextHandled);

          for (const opt of opts) {
            if (fatal || captured.length >= COMBO_CAP) break;
            let result;
            try {
              result = await clickOption(nextGroup, opt);
            } catch (e) {
              if (isFatal(e)) { fatal = true; break; }
              result = { ok: false, reason: (e.message || String(e)).split('\n')[0].slice(0, 120) };
            }
            if (!result || !result.ok) {
              // Surface the failed selection as its own row (the report marks
              // "Cannot select …" rows as N/A rather than failures).
              const comboLabel = [...chosen, { group: nextGroup, label: opt }].map(o => `${o.group}: ${o.label}`).join(' | ');
              captured.push({ label: comboLabel, options: [...chosen, { group: nextGroup, label: opt }], price: null, error: `Cannot select ${nextGroup}="${opt}": ${result?.reason || 'unknown'}` });
              console.log(`    – ${comboLabel.padEnd(80)} → ERR ${result?.reason || 'unknown'}`);
              continue;
            }
            // Settle: a real click triggers an AJAX recalc and may re-render
            // downstream tiles, so let the widget update before recursing.
            await this.page.waitForTimeout(600);
            await dfs([...chosen, { group: nextGroup, label: opt }], nextHandled);
          }
        };

        try {
          await dfs([], new Set());
        } catch (e) {
          if (!entry.error) entry.error = (e.message || String(e)).split('\n')[0];
        }
        entry.variants = captured;
      }
    } catch (err) {
      entry.error = err.message || String(err);
    }

    const label = entry.comingSoon
      ? '⚠ COMING SOON'
      : entry.variants.length
        ? `${entry.variants.length} variant${entry.variants.length === 1 ? '' : 's'} captured`
        : entry.prices.length
          ? `${entry.prices.length} price tag(s)`
          : 'no price found';
    console.log(`  • ${entry.slug.padEnd(20)} → ${label}`);

    results.push(entry);
  }

  this._calculatorResults = results;
});

Then(/^no model should show "Pricing coming soon"$/i, async function () {
  const results = this._calculatorResults || [];
  const offenders = results.filter(r => r.comingSoon);
  const pricingComingSoonVariants = results.flatMap(r =>
    (r.variants || []).filter(v => v.pricingComingSoon).map(v => ({ slug: r.slug, variant: v.label, url: r.url }))
  );
  const missingPrices = results.filter(r => !r.comingSoon && r.prices.length === 0 && !r.error);

  if (offenders.length || pricingComingSoonVariants.length || missingPrices.length) {
    const lines = ['Calculator pricing failures:'];
    if (offenders.length) {
      lines.push(`  CPC page not loading (${offenders.length}):`);
      offenders.forEach(o => lines.push(`    - ${o.slug}`));
    }
    if (pricingComingSoonVariants.length) {
      lines.push(`  Drive Away shows "Pricing coming soon" (${pricingComingSoonVariants.length}):`);
      pricingComingSoonVariants.forEach(o => lines.push(`    - ${o.slug} / ${o.variant}`));
    }
    if (missingPrices.length) {
      lines.push(`  No price detected (${missingPrices.length}):`);
      missingPrices.forEach(o => lines.push(`    - ${o.slug}`));
    }
    this._calculatorPricingFailure = lines.join('\n');
  }
});

Then(/^a calculator pricing report should be generated$/i, async function () {
  const results = this._calculatorResults || [];
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  // Embed environment name in filenames so Stage and Prod reports don't collide.
  let envTag = '';
  try {
    const envCachePath = path.resolve('.cache', 'activeEnvironment.json');
    if (fs.existsSync(envCachePath)) {
      const env = JSON.parse(fs.readFileSync(envCachePath, 'utf-8'));
      if (env.activeEnvironment) envTag = `_${env.activeEnvironment.replace(/[^a-zA-Z0-9]/g, '')}`;
    }
  } catch { /* ignore */ }
  const baseName = `CalculatorPricing${envTag}_${timestamp}`;
  const outDir = path.resolve('excel-reports');
  fs.mkdirSync(outDir, { recursive: true });

  // ── JSON
  const jsonPath = path.join(outDir, `${baseName}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    landingUrl: this._calculatorLandingUrl,
    totalModels: results.length,
    comingSoonCount: results.filter(r => r.comingSoon).length,
    okCount: results.filter(r => !r.comingSoon && r.prices.length).length,
    results,
  }, null, 2));

  // ── HTML — one row per variant
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // Skip combos where the option simply isn't available for that configuration
  // (e.g. KONA Hybrid powertrain not selectable from Petrol state). These are
  // not failures — they're inapplicable combinations and shouldn't show in the report.
  const isUnavailable = (v) => v && v.error && /^Cannot select\b/i.test(v.error);
  const flatRows = [];
  for (const r of results) {
    const applicableVariants = (r.variants || []).filter(v => !isUnavailable(v));
    const variants = applicableVariants.length ? applicableVariants : [{ label: '(no variants)', price: null }];
    variants.forEach((v, idx) => {
      const variantPriced = !!v.price;
      const passed = !r.comingSoon && !r.error && !v.error && !v.pricingComingSoon && variantPriced;
      const testStatus = passed
        ? '<span style="color:#fff;background:#2e7d32;padding:3px 12px;border-radius:4px;font-weight:600">PASS</span>'
        : '<span style="color:#fff;background:#c62828;padding:3px 12px;border-radius:4px;font-weight:600">FAIL</span>';
      const driveAway = v.price
        ? `<strong style="color:#1b5e20">${esc(v.price)}</strong>`
        : v.pricingComingSoon
          ? '<span style="color:#c62828">Pricing coming soon</span>'
          : '<span style="color:#999">—</span>';

      // Build a human-readable failure reason.
      let failureReason = '';
      if (!passed) {
        if (r.comingSoon) {
          failureReason = 'CPC page is not loading';
        } else if (r.error) {
          failureReason = `CPC page failed to load: ${r.error}`;
        } else if (v.error) {
          failureReason = `Unable to select variant "${v.label}": ${v.error}`;
        } else if (v.pricingComingSoon) {
          failureReason = `Drive Away price shows "Pricing coming soon" for variant "${v.label}"`;
        } else if (!variantPriced) {
          failureReason = `Drive Away price not displayed for variant "${v.label}"`;
        }
      }

      const modelCell = idx === 0
        ? `<a href="${esc(r.url)}" target="_blank">${esc(r.displayName || r.slug)}</a>`
        : '';
      flatRows.push(`<tr>
        <td>${modelCell}</td>
        <td style="font-size:12px;line-height:1.5">${esc(v.label).replace(/ \| /g, '<br>').replace(/^([^:]+:)/gm, '<strong>$1</strong>').replace(/(<br>)([^:]+:)/g, '$1<strong>$2</strong>')}</td>
        <td>${driveAway}</td>
        <td>${testStatus}</td>
        <td style="color:#a33">${esc(failureReason)}</td>
      </tr>`);
    });
  }
  const rows = flatRows.join('\n');

  const totalVariants = flatRows.length;
  const passVariants = results.reduce((n, r) => n + (r.variants || []).filter(v => !r.comingSoon && !r.error && !v.error && v.price).length, 0);
  const skippedVariants = results.reduce((n, r) => n + (r.variants || []).filter(isUnavailable).length, 0);
  // Two distinct "coming soon" states:
  //  · pricingComingSoonCount → variant rows whose Drive Away widget literally
  //    shows "Pricing coming soon" (the page loaded but the price isn't live).
  //  · pageNotLoadingCount → models whose whole CPC page never rendered.
  // The summary card used to show only the latter, which didn't match the
  // "Pricing coming soon" rows visible in the table.
  const pricingComingSoonCount = results.reduce((n, r) => n + (r.variants || []).filter(v => v.pricingComingSoon).length, 0);
  const pageNotLoadingCount = results.filter(r => r.comingSoon).length;

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Calculator Pricing Report — ${timestamp}</title>
<style>
  body{font-family:Segoe UI,Arial,sans-serif;margin:24px;color:#222}
  h1{margin:0 0 4px} .meta{color:#666;margin-bottom:16px}
  table{border-collapse:collapse;width:100%;font-size:14px}
  th,td{border:1px solid #ddd;padding:8px;vertical-align:top;text-align:left}
  th{background:#f5f5f5}
  tr:nth-child(even){background:#fafafa}
  .summary{display:flex;gap:12px;margin:12px 0 20px}
  .card{flex:1;border:1px solid #ddd;border-radius:6px;padding:12px;background:#fff}
  .card b{font-size:22px;display:block}
</style></head><body>
<h1>Hyundai Calculator — Pricing Report${envTag ? ` (${envTag.replace(/^_/, '')})` : ''}</h1>
<div class="meta">Environment: <strong>${esc(envTag.replace(/^_/, '') || 'Unknown')}</strong> · Generated ${esc(new Date().toISOString())} · Landing: <a href="${esc(this._calculatorLandingUrl || '')}" target="_blank">${esc(this._calculatorLandingUrl || '')}</a></div>
<div class="summary">
  <div class="card">Total models<b>${results.length}</b></div>
  <div class="card">Total variants<b>${totalVariants}</b></div>
  <div class="card" style="background:#e8f5e9">Variants priced<b>${passVariants}</b></div>
  <div class="card" style="background:#ffebee">Pricing coming soon<b>${pricingComingSoonCount}</b></div>
  <div class="card" style="background:#ffebee">CPC page not loading<b>${pageNotLoadingCount}</b></div>
  <div class="card" style="background:#fff3e0">Failed<b>${totalVariants - passVariants}</b></div>
  <div class="card" style="background:#eceff1;color:#555">N/A combos<b>${skippedVariants}</b></div>
</div>
<table>
  <thead><tr><th>Model</th><th>Configuration</th><th>Drive Away</th><th>Test Status</th><th>Failure Reason</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
</body></html>`;
  const htmlPath = path.join(outDir, `${baseName}.html`);
  fs.writeFileSync(htmlPath, html);

  // ── PDF (headless Chromium prints the HTML)
  const pdfPath = path.join(outDir, `${baseName}.pdf`);
  let pdfWritten = false;
  let pdfBrowser = null;
  try {
    pdfBrowser = await chromium.launch();
    const ctx = await pdfBrowser.newContext();
    const pdfPage = await ctx.newPage();
    await pdfPage.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle' });
    await pdfPage.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' },
    });
    pdfWritten = true;
  } catch (err) {
    console.warn(`⚠  PDF generation failed: ${err.message}`);
  } finally {
    if (pdfBrowser) await pdfBrowser.close().catch(() => {});
  }

  console.log(`📊 Calculator pricing report:`);
  console.log(`   HTML → ${htmlPath}`);
  console.log(`   JSON → ${jsonPath}`);
  if (pdfWritten) console.log(`   PDF  → ${pdfPath}`);

  // Attach to Cucumber report
  if (this.attach) {
    await this.attach(JSON.stringify({
      htmlReport: htmlPath,
      jsonReport: jsonPath,
      pdfReport: pdfWritten ? pdfPath : null,
      totalModels: results.length,
      comingSoon: results.filter(r => r.comingSoon).map(r => r.slug),
      priced: results.filter(r => !r.comingSoon && r.prices.length).map(r => ({ slug: r.slug, variants: r.variants })),
    }, null, 2), 'application/json');
  }

  // Data-content failure (CPC page not loading / "Pricing coming soon" /
  // missing price). The scenario is tagged @no-autofix so the Claude/MCP
  // fix loop will skip it — these are real product issues, not test code
  // bugs that an LLM can repair.
  if (this._calculatorPricingFailure) {
    assert.fail(this._calculatorPricingFailure);
  }
});
