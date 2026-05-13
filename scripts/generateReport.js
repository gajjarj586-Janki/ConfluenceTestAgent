/**
 * PDF Report Generator for Confluence Test Agent
 *
 * Reads Cucumber JSON results, builds an HTML report matching the
 * existing framework style (dark-navy header, summary cards, colour-coded
 * status badges), and renders to PDF via headless Chromium.
 *
 * Usage:  node scripts/generateReport.js [cucumber-report.json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

// ─── Defaults ─────────────────────────────────────────────────
const DEFAULT_RESULTS_PATH = path.resolve('test-results', 'cucumber-report.json');
const OUTPUT_DIR = path.resolve('excel-reports');
const SCREENSHOTS_DIR = path.resolve('screenshots');

// ─── Read Cucumber JSON ──────────────────────────────────────
function loadResults(jsonPath) {
  if (!fs.existsSync(jsonPath)) {
    console.warn(`⚠️  No results file at ${jsonPath} — generating empty report`);
    return [];
  }
  const content = fs.readFileSync(jsonPath, 'utf-8').trim();
  if (!content) {
    console.warn(`⚠️  Results file is empty at ${jsonPath} — Cucumber may have crashed before writing output`);
    return [];
  }
  return JSON.parse(content);
}

/**
 * Clean up step names for the report:
 *  - "from the Excel file ..." → "from Confluence"
 *  - hardcoded prod URLs → "using the Stage environment URL"
 */
function cleanStepName(name) {
  if (!name) return name;
  return name
    .replace(/the test data from the Excel file .*/i, 'the test data from Confluence')
    .replace(/the Contact a Dealer page "https?:\/\/[^"]*"/i, 'the Contact a Dealer page using the Stage environment URL')
    .replace(/the Contact Us page "https?:\/\/[^"]*"/i, 'the Contact Us page using the Stage environment URL');
}

function sanitizeScenarioName(name) {
  return String(name || '').replace(/[^a-zA-Z0-9]/g, '_');
}

function findLatestScenarioScreenshot(scenarioName, featureName) {
  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    return '';
  }

  const featureKey = featureName
    ? String(featureName).replace(/[^a-zA-Z0-9]/g, '_') + '-'
    : '';
  const nameKey = sanitizeScenarioName(scenarioName);
  // Try feature-scoped name first (avoids collisions), fall back to name-only
  const prefixes = featureKey
    ? [`cucumber-${featureKey}${nameKey}-`, `cucumber-${nameKey}-`]
    : [`cucumber-${nameKey}-`];

  for (const prefix of prefixes) {
    const matches = fs.readdirSync(SCREENSHOTS_DIR)
      .filter((fileName) => fileName.startsWith(prefix) && /\.png$/i.test(fileName))
      .sort((left, right) => right.localeCompare(left));
    if (matches.length > 0) return path.join(SCREENSHOTS_DIR, matches[0]);
  }
  return '';
}

function findLatestPayloadScreenshot(scenarioName, featureName) {
  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    return '';
  }

  const featureKey = featureName
    ? String(featureName).replace(/[^a-zA-Z0-9]/g, '_') + '-'
    : '';
  const nameKey = sanitizeScenarioName(scenarioName);
  const prefixes = featureKey
    ? [`payload-${featureKey}${nameKey}-`, `payload-${nameKey}-`]
    : [`payload-${nameKey}-`];

  for (const prefix of prefixes) {
    const matches = fs.readdirSync(SCREENSHOTS_DIR)
      .filter((fileName) => fileName.startsWith(prefix) && /\.png$/i.test(fileName))
      .sort((left, right) => right.localeCompare(left));
    if (matches.length > 0) return path.join(SCREENSHOTS_DIR, matches[0]);
  }
  return '';
}

function findLatestPayloadJson(scenarioName, featureName) {
  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    return null;
  }

  const featureKey = featureName
    ? String(featureName).replace(/[^a-zA-Z0-9]/g, '_') + '-'
    : '';
  const nameKey = sanitizeScenarioName(scenarioName);
  const prefixes = featureKey
    ? [`payload-${featureKey}${nameKey}-`, `payload-${nameKey}-`]
    : [`payload-${nameKey}-`];

  for (const prefix of prefixes) {
    const matches = fs.readdirSync(SCREENSHOTS_DIR)
      .filter((fileName) => fileName.startsWith(prefix) && /\.json$/i.test(fileName))
      .sort((left, right) => right.localeCompare(left));
    if (matches.length > 0) {
      try { return JSON.parse(fs.readFileSync(path.join(SCREENSHOTS_DIR, matches[0]), 'utf-8')); } catch { return null; }
    }
  }
  return null;
}

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function humanizeFieldEvidence(errorMessage) {
  const fieldMatch = errorMessage.match(/validation error for "([^"]+)"/i);
  const fieldName = fieldMatch?.[1] || 'field';
  const describedByMatch = errorMessage.match(/describedByTexts=(\[[^\]]*\])/);
  const nearbyErrorsMatch = errorMessage.match(/nearbyErrors=(\[[^\]]*\])/);
  const inputStateMatch = errorMessage.match(/inputState=(\{.*\})/);

  const describedByTexts = safeJsonParse(describedByMatch?.[1] || '[]', []);
  const nearbyErrors = safeJsonParse(nearbyErrorsMatch?.[1] || '[]', []);
  const inputState = safeJsonParse(inputStateMatch?.[1] || '{}', {});

  const evidence = [];
  if (inputState.ariaInvalid) evidence.push(`aria-invalid=${inputState.ariaInvalid}`);
  if (inputState.ariaRequired) evidence.push(`aria-required=${inputState.ariaRequired}`);
  if (inputState.describedBy) evidence.push(`aria-describedby=${inputState.describedBy}`);
  if (inputState.required === true) evidence.push('required=true');
  if (inputState.validationMessage) evidence.push(`browser validation="${inputState.validationMessage}"`);
  if (describedByTexts.length > 0) evidence.push(`describedBy text: ${describedByTexts.join('; ')}`);
  if (nearbyErrors.length > 0) evidence.push(`nearby error: ${nearbyErrors.join('; ')}`);

  const summary = `No visible validation was associated with ${fieldName} after submit.`;
  const detail = evidence.length > 0
    ? `Observed evidence: ${evidence.join(' | ')}`
    : `Observed evidence: no aria-invalid, no aria-describedby, no required flag, and no nearby visible error text.`;

  return { summary, detail };
}

function summarizeError(errorMessage, failedStepName, failedStatus) {
  const error = String(errorMessage || '').trim();
  if (!error && failedStatus === 'undefined') {
    return {
      summary: 'Step definition is missing for this scenario.',
      detail: failedStepName ? `Missing step: ${failedStepName}` : '',
    };
  }

  if (!error && failedStatus === 'pending') {
    return {
      summary: 'Step definition exists but is still pending implementation.',
      detail: failedStepName ? `Pending step: ${failedStepName}` : '',
    };
  }

  if (!error && failedStatus === 'ambiguous') {
    return {
      summary: 'Multiple step definitions matched the same step.',
      detail: failedStepName ? `Ambiguous step: ${failedStepName}` : '',
    };
  }

  if (!error) {
    return {
      summary: failedStepName ? `Step failed: ${failedStepName}` : 'Scenario failed.',
      detail: '',
    };
  }

  if (/Expected a visible validation error for/i.test(error)) {
    return humanizeFieldEvidence(error);
  }

  if (/Expected to see success message/i.test(error)) {
    const successMatch = error.match(/Expected to see success message "([^"]+)"/i);
    const successText = successMatch?.[1] || 'success message';
    return {
      summary: `Success message "${successText}" was not visible after submit.`,
      detail: 'The scenario submitted the form, but the expected confirmation text was not found on the page.',
    };
  }

  if (/Did not expect visible validation errors/i.test(error)) {
    return {
      summary: 'Validation errors remained visible after submit.',
      detail: error.split('\n')[0],
    };
  }

  if (/function has \d+ arguments, should have \d+/i.test(error)) {
    return {
      summary: 'Step definition does not accept the feature table arguments.',
      detail: 'The scenario passed a data table, but the matched step definition signature does not accept it.',
    };
  }

  if (/Expected to find the ".*" field on the form/i.test(error)) {
    const fieldMatch = error.match(/Expected to find the "([^"]+)" field on the form/i);
    const fieldName = fieldMatch?.[1] || 'target';
    return {
      summary: `${fieldName} field was not found on the page.`,
      detail: 'The scenario could not validate this field because the input was not visible or not present in the loaded form.',
    };
  }

  if (/Expected a visible submit button, but none was found/i.test(error)) {
    return {
      summary: 'Submit button was not found for the active form.',
      detail: 'The page loaded, but no visible submit control matched the scenario selectors.',
    };
  }

  if (/Expected submission to be prevented/i.test(error)) {
    return {
      summary: 'Form submission was not blocked as expected.',
      detail: error.split('\n')[0],
    };
  }

  if (/Timeout/i.test(error)) {
    return {
      summary: failedStepName ? `Timed out while running: ${failedStepName}` : 'Scenario timed out.',
      detail: error.split('\n')[0],
    };
  }

  const firstLine = error.split('\n')[0].replace(/^AssertionError\s*\[[^\]]+\]:\s*/i, '').trim();
  return {
    summary: firstLine || (failedStepName ? `Step failed: ${failedStepName}` : 'Scenario failed.'),
    detail: firstLine === error ? '' : error,
  };
}

/**
 * Flatten Cucumber JSON into a simple test-case array:
 *   { id, feature, scenario, steps, status, duration, error }
 */
function flattenResults(cucumberJson) {
  const cases = [];
  const failureStatuses = new Set(['failed', 'undefined', 'pending', 'ambiguous']);
  let counter = 1;
  for (const feature of cucumberJson) {
    const featureName = feature.name || feature.uri || 'Unknown Feature';
    for (const scenario of feature.elements || []) {
      if (scenario.type === 'background') continue;
      const steps = (scenario.steps || [])
        .filter(s => s.keyword?.trim() !== 'Before' && s.keyword?.trim() !== 'After')
        .map(s => ({
          keyword: s.keyword?.trim(),
          name: cleanStepName(s.name),
          status: s.result?.status || 'undefined',
          duration: s.result?.duration || 0,
          error: s.result?.error_message || '',
        }));
      const failed = steps.find(s => failureStatuses.has(s.status));
      const allSkipped = steps.length > 0 && steps.every(s => s.status === 'skipped');
      const status = failed ? 'FAIL' : allSkipped ? 'SKIPPED' : 'PASS';
      const errorSummary = failed
        ? summarizeError(
            failed.error || '',
            `${failed.keyword} ${failed.name}`,
            failed.status || ''
          )
        : { summary: '', detail: '' };
      // Extract the test URL from navigation steps (e.g. 'I navigate to "https://..."')
      const navStep = steps.find(s => /navigate to "(https?:\/\/[^"]+)"/i.test(s.name));
      let testUrl = navStep ? navStep.name.match(/"(https?:\/\/[^"]+)"/)?.[1] || '' : '';

      // Read metadata JSON file saved by world.js (has the real navigated testUrl)
      // This is the most reliable source — it captures the actual browser URL
      let successMessage = '';
      const featureFileKey = (feature.uri || featureName || '')
        .replace(/\\/g, '/')
        .split('/')
        .pop()
        .replace(/\.feature$/i, '')
        .replace(/[^a-zA-Z0-9]/g, '_');
      try {
        // Try feature-scoped metadata first, then fall back to name-only
        const metaKeyScopedPath = `screenshots/metadata-${featureFileKey}-${sanitizeScenarioName(scenario.name || 'Unnamed_Scenario')}.json`;
        const metaKeySimplePath = `screenshots/metadata-${sanitizeScenarioName(scenario.name || 'Unnamed_Scenario')}.json`;
        const metaPath = fs.existsSync(metaKeyScopedPath) ? metaKeyScopedPath : metaKeySimplePath;
        if (fs.existsSync(metaPath)) {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
          if (meta.testUrl) testUrl = meta.testUrl;  // Always prefer metadata URL
          if (meta.successMessage) {
            successMessage = typeof meta.successMessage === 'string'
              ? meta.successMessage
              : meta.successMessage.text || JSON.stringify(meta.successMessage);
          }
        }
      } catch { /* ignore */ }

      // Fall back to activeEnvironment.json page URLs based on feature/scenario name
      if (!testUrl) {
        try {
          const envCachePath = path.resolve('.cache', 'activeEnvironment.json');
          if (fs.existsSync(envCachePath)) {
            const envData = JSON.parse(fs.readFileSync(envCachePath, 'utf-8'));
            const pageUrls = envData.pageUrls || {};
            const scenarioLower = (scenario.name || '').toLowerCase();
            for (const [key, url] of Object.entries(pageUrls)) {
              if (url && (scenarioLower.includes(key) || key.split(' ').some(w => w.length > 3 && scenarioLower.includes(w)))) {
                testUrl = url;
                break;
              }
            }
          }
        } catch { /* ignore */ }
      }

      // Also try to load API status code from payload JSON
      const payloadData = findLatestPayloadJson(scenario.name || 'Unnamed Scenario', featureFileKey);
      let apiStatusCode = '';
      if (payloadData && payloadData.length > 0) {
        const lastSubmission = payloadData[payloadData.length - 1];
        apiStatusCode = String(lastSubmission.statusCode || '');
      }

      const payloadScreenshotPath = findLatestPayloadScreenshot(scenario.name || 'Unnamed Scenario', featureFileKey);

      cases.push({
        id: `TC-${String(counter++).padStart(2, '0')}`,
        feature: featureName,
        scenario: scenario.name || 'Unnamed Scenario',
        steps: steps.map(s => `${s.keyword} ${s.name}`).join('\n'),
        status,
        duration: steps.reduce((sum, s) => sum + s.duration, 0),
        error: failed?.error || '',
        failedStep: failed ? `${failed.keyword} ${failed.name}` : '',
        errorSummary: errorSummary.summary,
        errorDetail: errorSummary.detail,
        screenshotPath: findLatestScenarioScreenshot(scenario.name || 'Unnamed Scenario', featureFileKey),
        testUrl,
        successMessage,
        apiStatusCode,
        payloadScreenshotPath,
      });
    }
  }
  return cases;
}

// ─── Summary Stats ────────────────────────────────────────────
function computeStats(cases) {
  const total = cases.length;
  const pass = cases.filter(c => c.status === 'PASS').length;
  const fail = cases.filter(c => c.status === 'FAIL').length;
  const skipped = cases.filter(c => c.status === 'SKIPPED').length;
  const passRate = total > 0 ? ((pass / total) * 100).toFixed(1) : '0.0';
  return { total, pass, fail, skipped, passRate };
}

// ─── HTML Builder ─────────────────────────────────────────────
function buildHTML(cases, stats) {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  // Build report title from unique feature names in results
  const uniqueFeatures = [...new Set(cases.map(c => c.feature).filter(Boolean))];
  const reportTitle = uniqueFeatures.length > 0
    ? uniqueFeatures.join(', ') + ' — Test Report'
    : 'Test Report';

  // Extract environment info from active environment cache
  let envName = '';
  let envBaseUrl = '';
  try {
    const envCachePath = path.resolve('.cache', 'activeEnvironment.json');
    if (fs.existsSync(envCachePath)) {
      const envData = JSON.parse(fs.readFileSync(envCachePath, 'utf-8'));
      envName = envData.activeEnvironment || '';
      envBaseUrl = envData.baseUrl || '';
    }
  } catch { /* ignore */ }

  const statusBadge = (status) => {
    const colors = {
      PASS: { bg: '#C6EFCE', fg: '#276221' },
      FAIL: { bg: '#FFC7CE', fg: '#9C0006' },
      SKIPPED: { bg: '#FFF3CD', fg: '#856404' },
    };
    const c = colors[status] || { bg: '#E0E0E0', fg: '#333' };
    return `<span style="background:${c.bg};color:${c.fg};padding:3px 10px;border-radius:4px;font-weight:bold;font-size:10px;">${status}</span>`;
  };

  const escapeHtml = (str) =>
    String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');

  const renderScreenshotCell = (caseData) => {
    if (!caseData.screenshotPath) {
      return '<div style="color:#777;">No screenshot captured</div>';
    }

    const imageUrl = pathToFileURL(caseData.screenshotPath).href;
    return `
      <div style="display:flex;flex-direction:column;gap:4px;">
        <img src="${imageUrl}" alt="${escapeHtml(caseData.scenario)} screenshot" style="width:320px;max-height:200px;object-fit:contain;border:1px solid #CCD3E0;border-radius:4px;" />
        <div style="font-size:8px;color:#555;word-break:break-all;">${escapeHtml(path.basename(caseData.screenshotPath))}</div>
      </div>`;
  };

  const renderPayloadCell = (caseData) => {
    if (caseData.payloadScreenshotPath) {
      const imageUrl = pathToFileURL(caseData.payloadScreenshotPath).href;
      return `
        <div style="display:flex;flex-direction:column;gap:4px;">
          <img src="${imageUrl}" alt="API payload" style="width:340px;max-height:220px;object-fit:contain;border:1px solid #CCD3E0;border-radius:4px;" />
          <div style="font-size:8px;color:#555;word-break:break-all;">${escapeHtml(path.basename(caseData.payloadScreenshotPath))}</div>
        </div>`;
    }
    if (caseData.apiStatusCode) {
      const code = parseInt(caseData.apiStatusCode, 10);
      const isOk = code < 400;
      const bg = isOk ? '#C6EFCE' : '#FFC7CE';
      const fg = isOk ? '#276221' : '#9C0006';
      return `<div style="text-align:center;padding:8px 0;"><span style="background:${bg};color:${fg};padding:4px 12px;border-radius:4px;font-weight:bold;font-size:13px;">HTTP ${escapeHtml(caseData.apiStatusCode)}</span></div>`;
    }
    return '<div style="color:#777;font-size:9px;">No API call captured</div>';
  };

  const rows = cases
    .map(
      (c) => `
      <tr>
        <td style="font-weight:bold;">${c.id}</td>
        <td>${escapeHtml(c.feature)}</td>
        <td>${escapeHtml(c.scenario)}</td>
        <td style="font-size:9px;max-width:200px;word-break:break-all;">${c.testUrl ? `<a href="${escapeHtml(c.testUrl)}" style="color:#1F3864;text-decoration:underline;">${escapeHtml(c.testUrl)}</a>` : '<span style="color:#999;">—</span>'}</td>
        <td style="text-align:center;">${statusBadge(c.status)}</td>
        <td style="font-size:9px;">${renderScreenshotCell(c)}</td>
        <td style="font-size:9px;">${renderPayloadCell(c)}</td>
        <td style="font-size:9px;max-width:250px;">
          <div style="font-weight:bold;color:${c.status === 'FAIL' ? '#9C0006' : '#333'};margin-bottom:4px;">${escapeHtml(c.errorSummary || '')}</div>
          ${c.failedStep ? `<div style="margin-bottom:4px;"><strong>Failed step:</strong> ${escapeHtml(c.failedStep)}</div>` : ''}
          ${c.errorDetail ? `<div style="color:#555;">${escapeHtml(c.errorDetail)}</div>` : ''}
        </td>
      </tr>`,
    )
    .join('\n');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body { font-family: Arial, sans-serif; margin: 0; padding: 20px 16px; font-size: 11px; color: #333; -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  /* ── Header ── */
  .header { background: #1F3864; color: #fff; padding: 18px 24px; border-radius: 8px 8px 0 0; display: flex; justify-content: space-between; align-items: center; }
  .header h1 { margin: 0; font-size: 20px; letter-spacing: 0.5px; }
  .header .meta { text-align: right; font-size: 11px; line-height: 1.6; }

  /* ── Summary Cards ── */
  .summary { display: flex; gap: 16px; flex-wrap: wrap; margin: 18px 0; }
  .card { min-width: 130px; flex: 1; border-radius: 8px; padding: 14px 12px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.12); }
  .card .value { font-size: 28px; font-weight: bold; }
  .card .label { font-size: 11px; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
  .card-total { background: #E8F4FD; color: #1F3864; }
  .card-pass  { background: #C6EFCE; color: #276221; }
  .card-fail  { background: #FFC7CE; color: #9C0006; }
  .card-skip  { background: #FFF3CD; color: #856404; }
  .card-rate  { background: #EDE7F6; color: #4A148C; }

  /* ── Table ── */
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th { background: #1F3864; color: #fff; padding: 8px 6px; font-size: 10px; text-align: left; text-transform: uppercase; letter-spacing: 0.4px; }
  td { padding: 7px 6px; border-bottom: 1px solid #DDE; vertical-align: top; font-size: 10px; }
  tr:nth-child(even) td { background: #F8F9FB; }

  /* ── Legend ── */
  .legend { display: flex; gap: 14px; margin: 14px 0 6px; font-size: 10px; }
  .legend span { display: inline-flex; align-items: center; gap: 5px; }
  .legend .dot { width: 12px; height: 12px; border-radius: 3px; display: inline-block; }

  /* ── Print ── */
  @media print { body { padding: 8px; } .header { page-break-after: avoid; } }
</style>
</head>
<body>

<div class="header">
  <h1>${escapeHtml(reportTitle)}</h1>
  <div class="meta">
    <div><strong>Date:</strong> ${dateStr}</div>
    <div><strong>Time:</strong> ${timeStr}</div>
    <div><strong>Environment:</strong> ${envName || 'N/A'}</div>
    ${envBaseUrl ? `<div><strong>Base URL:</strong> ${envBaseUrl}</div>` : ''}
    <div><strong>Source:</strong> Confluence (AI Agent)</div>
  </div>
</div>

<div class="summary">
  <div class="card card-total"><div class="value">${stats.total}</div><div class="label">Total</div></div>
  <div class="card card-pass"><div class="value">${stats.pass}</div><div class="label">Passed</div></div>
  <div class="card card-fail"><div class="value">${stats.fail}</div><div class="label">Failed</div></div>
  <div class="card card-skip"><div class="value">${stats.skipped}</div><div class="label">Skipped</div></div>
  <div class="card card-rate"><div class="value">${stats.passRate}%</div><div class="label">Pass Rate</div></div>
</div>

<div class="legend">
  <span><span class="dot" style="background:#C6EFCE;"></span> PASS</span>
  <span><span class="dot" style="background:#FFC7CE;"></span> FAIL</span>
  <span><span class="dot" style="background:#FFF3CD;"></span> SKIPPED</span>
</div>

<table>
  <thead>
    <tr>
      <th style="width:50px;">TC #</th>
      <th style="width:120px;">Feature</th>
      <th style="width:160px;">Scenario</th>
      <th style="width:180px;">Test URL</th>
      <th style="width:70px;text-align:center;">Status</th>
      <th style="width:340px;">Screenshot</th>
      <th style="width:360px;">API Payload</th>
      <th style="width:220px;">Failure Summary</th>
    </tr>
  </thead>
  <tbody>
    ${rows || '<tr><td colspan="7" style="text-align:center;padding:20px;">No test results found.</td></tr>'}
  </tbody>
</table>

</body>
</html>`;
}

// ─── Render HTML → PDF via Playwright ────────────────────────
async function generatePDF() {
  const jsonPath = process.argv[2] || DEFAULT_RESULTS_PATH;
  console.log(`📄 Loading results from: ${jsonPath}`);

  const raw = loadResults(jsonPath);
  const cases = flattenResults(raw);
  const stats = computeStats(cases);

  console.log(`📊 Total: ${stats.total} | Pass: ${stats.pass} | Fail: ${stats.fail} | Skipped: ${stats.skipped} | Rate: ${stats.passRate}%`);

  const html = buildHTML(cases, stats);

  // Ensure output dir exists
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const _ts1 = new Date();
  const _pad = n => String(n).padStart(2, '0');
  const timestamp = `${_ts1.getFullYear()}-${_pad(_ts1.getMonth()+1)}-${_pad(_ts1.getDate())}-${_pad(_ts1.getHours())}-${_pad(_ts1.getMinutes())}-${_pad(_ts1.getSeconds())}`;
  const htmlPath = path.join(OUTPUT_DIR, `TestReport_${timestamp}.html`);
  const pdfPath = path.join(OUTPUT_DIR, `TestReport_${timestamp}.pdf`);

  fs.writeFileSync(htmlPath, html, 'utf-8');
  console.log(`📝 HTML report: ${htmlPath}`);

  // Headless Chromium → PDF
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`file:///${htmlPath.replace(/\\/g, '/')}`, { waitUntil: 'networkidle' });
  await page.pdf({
    path: pdfPath,
    format: 'A3',
    landscape: true,
    printBackground: true,
    margin: { top: '15mm', bottom: '15mm', left: '10mm', right: '10mm' },
  });
  await browser.close();

  console.log(`✅ PDF report generated: ${pdfPath}`);
  return { htmlPath, pdfPath, stats };
}

// ─── Per-Feature PDF Generator ───────────────────────────────
/**
 * Generate a PDF report containing only the scenarios from one feature file.
 *
 * @param {string} jsonPath        Path to cucumber-report.json
 * @param {string} featureFilename The .feature filename (e.g. "contact_us__1_.feature")
 * @returns {{ htmlPath, pdfPath, stats, featureFilename } | null}
 */
export async function generatePDFForFeature(jsonPath, featureFilename) {
  const raw = loadResults(jsonPath);

  // Normalize helper — same logic used by fetchFeatures.js when saving files
  const normalize = (n) => String(n).replace(/[^a-zA-Z0-9_\-.]/g, '_').toLowerCase();
  const normalizedTarget = normalize(featureFilename);

  // Filter the cucumber JSON to only scenarios from this feature
  const featureData = raw.filter((f) => {
    const basename = path.basename((f.uri || f.name || '').replace(/\\/g, '/'));
    return normalize(basename) === normalizedTarget;
  });

  if (featureData.length === 0) {
    console.warn(`⚠️  No results found in JSON for feature: ${featureFilename}`);
    return null;
  }

  const cases = flattenResults(featureData);
  const stats = computeStats(cases);
  const html = buildHTML(cases, stats);

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const featureSlug = featureFilename.replace(/\.feature$/i, '').replace(/[^a-zA-Z0-9_\-]/g, '_');
  const _ts2 = new Date();
  const _pad2 = n => String(n).padStart(2, '0');
  const timestamp = `${_ts2.getFullYear()}-${_pad2(_ts2.getMonth()+1)}-${_pad2(_ts2.getDate())}-${_pad2(_ts2.getHours())}-${_pad2(_ts2.getMinutes())}-${_pad2(_ts2.getSeconds())}`;
  const htmlPath = path.join(OUTPUT_DIR, `TestReport_${featureSlug}_${timestamp}.html`);
  const pdfPath  = path.join(OUTPUT_DIR, `TestReport_${featureSlug}_${timestamp}.pdf`);

  fs.writeFileSync(htmlPath, html, 'utf-8');
  console.log(`📝 HTML report: ${htmlPath}`);

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`file:///${htmlPath.replace(/\\/g, '/')}`, { waitUntil: 'networkidle' });
  await page.pdf({
    path: pdfPath,
    format: 'A3',
    landscape: true,
    printBackground: true,
    margin: { top: '15mm', bottom: '15mm', left: '10mm', right: '10mm' },
  });
  await browser.close();

  console.log(`✅ PDF report generated: ${pdfPath}`);
  return { htmlPath, pdfPath, stats, featureFilename };
}

// ─── CLI entry ────────────────────────────────────────────────
export { generatePDF, loadResults, flattenResults, computeStats, buildHTML };

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  generatePDF().catch((err) => {
    console.error('❌ Report generation failed:', err.message);
    process.exit(1);
  });
}
