// @protected
/**
 * Common Step Definitions — shared across ALL feature files.
 *
 * Any step defined here is automatically available to every .feature file
 * loaded by Cucumber (cucumber.js loads all step_definitions/**\/*.js).
 *
 * Steps:
 *   - "the user sets location postcode {string}"
 *     Handles the Hyundai "Set your location" modal that appears on any
 *     stage/production CPC or calculator page. Use this in any feature file
 *     that navigates to a page where the location modal appears.
 *
 *     Example:
 *       And the user sets location postcode "2000"
 */
import { Given, Then } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import { handleLocationModal } from './commonHelpers.js';
export { handleLocationModal };

// ─── Step: set location postcode ─────────────────────────────
// Use in any feature file:
//   And the user sets location postcode "2000"
//   And the user sets location postcode "3000"
Given('the user sets location postcode {string}', async function (postcode) {
  console.log(`📍 Setting location postcode: ${postcode}`);
  await handleLocationModal(this.page, postcode);
  console.log(`✅ Location set to postcode: ${postcode}`);
});

// ─── Reusable performance assertions ─────────────────────────
// These read metrics that are populated either by a preceding step that
// installed a perf observer (e.g. the "variant tab" click) or by reading the
// browser's Navigation/PerformanceObserver entries on demand.

/**
 * Capture current page perf metrics into `this.perfMetrics` if not already set.
 * Safe to call multiple times — it only refreshes if the page has navigated
 * since the last capture.
 */
async function ensurePerfMetrics(world) {
  if (world.perfMetrics && world.perfMetrics._url === world.page.url()) return world.perfMetrics;
  const m = await world.page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const longTasks = (window.__ctaLongTasks || []).map(e => ({
      duration: Math.round(e.duration),
      startTime: Math.round(e.startTime),
    }));
    return {
      responseTimeMs: nav.responseEnd && nav.requestStart ? Math.round(nav.responseEnd - nav.requestStart) : null,
      ttfbMs: nav.responseStart && nav.requestStart ? Math.round(nav.responseStart - nav.requestStart) : null,
      domContentLoadedMs: nav.domContentLoadedEventEnd ? Math.round(nav.domContentLoadedEventEnd) : null,
      loadEventMs: nav.loadEventEnd ? Math.round(nav.loadEventEnd) : null,
      longTasks,
    };
  }).catch(() => ({ responseTimeMs: null, longTasks: [] }));
  m._url = world.page.url();
  world.perfMetrics = m;
  return m;
}

Then('the current URL should not contain {string}', async function (forbidden) {
  const url = this.page.url();
  console.log(`📋 URL check — current="${url}" forbidden="${forbidden}"`);
  assert.ok(!url.includes(forbidden), `Expected URL to NOT contain "${forbidden}" but got: ${url}`);
});

Then('the page response time should be less than {int} ms', async function (thresholdMs) {
  const m = await ensurePerfMetrics(this);
  console.log(`📋 Response time: ${m.responseTimeMs}ms (threshold: <${thresholdMs}ms)  ttfb=${m.ttfbMs}ms`);
  assert.ok(m.responseTimeMs !== null, 'Navigation timing not available for this page');
  assert.ok(m.responseTimeMs < thresholdMs,
    `Page response time was ${m.responseTimeMs}ms, expected < ${thresholdMs}ms`);
});

Then('no renderer long task longer than {int} ms should occur', async function (thresholdMs) {
  const m = await ensurePerfMetrics(this);
  const offenders = (m.longTasks || []).filter(t => t.duration > thresholdMs);
  console.log(`📋 Long tasks: ${m.longTasks?.length || 0} total, ${offenders.length} over ${thresholdMs}ms`);
  if (offenders.length > 0) {
    console.log('   Offenders:', JSON.stringify(offenders));
  }
  assert.equal(offenders.length, 0,
    `Found ${offenders.length} renderer long task(s) over ${thresholdMs}ms: ${JSON.stringify(offenders)}`);
});
