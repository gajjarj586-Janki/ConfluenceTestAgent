/**
 * AI Test Agent Orchestrator
 *
 * Single-command pipeline that:
 *   1. Fetches test data from Confluence
 *   2. Downloads feature files from Confluence
 *   2.5 Auto-generates step definitions for any undefined steps
 *   3. Runs Cucumber tests via Playwright
 *   4. Generates a PDF report of the results
 *
 * Usage:
 *   node scripts/agentOrchestrator.js                     # full pipeline (existing step files PRESERVED)
 *   node scripts/agentOrchestrator.js --skip-fetch          # reuse cached data & features
 *   node scripts/agentOrchestrator.js --skip-generate       # skip step def generation entirely
 *   node scripts/agentOrchestrator.js --update-steps        # re-generate / append-missing into existing step files
 *   node scripts/agentOrchestrator.js --report-only         # regenerate report from last run
 *   node scripts/agentOrchestrator.js --claude-fix          # full pipeline + Claude auto-fix loop on failure
 *
 * Step-file lifecycle:
 *   • If NO `<feature>_auto.steps.js` exists → DOM inspection (+ MCP) runs and a fresh file is generated.
 *   • If a step file ALREADY exists → it is left untouched on every subsequent run.
 *     Auto-fixes only happen on test failure via the Claude/MCP fix loop, never on a clean run.
 *     Pass `--update-steps` to opt into appending newly-detected steps to existing files.
 */
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config();

// ─── Paths ───────────────────────────────────────────────────
const ROOT = path.resolve('.');
const FEATURES_DIR = path.join(ROOT, 'features', 'cucumber');
const RESULTS_JSON = path.join(ROOT, 'test-results', 'cucumber-report.json');

// ─── Helpers ─────────────────────────────────────────────────
function banner(msg) {
  const line = '═'.repeat(msg.length + 4);
  console.log(`\n╔${line}╗`);
  console.log(`║  ${msg}  ║`);
  console.log(`╚${line}╝\n`);
}

function run(cmd, label) {
  console.log(`▶ ${label}`);
  console.log(`  $ ${cmd}\n`);
  try {
    execSync(cmd, { stdio: 'inherit', cwd: ROOT });
    return true;
  } catch (err) {
    console.error(`✖ ${label} failed (exit ${err.status})`);
    return false;
  }
}

function elapsed(start) {
  const sec = ((Date.now() - start) / 1000).toFixed(1);
  return `${sec}s`;
}

// ─── Pipeline Steps ──────────────────────────────────────────

async function stepFetchData() {
  banner('Step 1 — Fetch Test Data from Confluence');
  // Importing the reader and caching data at startup validates connectivity
  const { default: ConfluenceReader } = await import('../utils/confluenceReader.js');
  const sheets = await ConfluenceReader.readAllSheets();
  const sheetNames = Object.keys(sheets);
  console.log(`✅ Loaded ${sheetNames.length} data sections: ${sheetNames.join(', ')}`);

  // ── Resolve Active Environment from Environment Configuration ──
  banner('Step 1.5 — Resolve Active Environment from Confluence');
  const envConfig = sheets['Environment Configuration'] || [];
  const envUrls = sheets['Environment URLs'] || [];

  // Find which environment(s) have Status = "Yes"
  const activeEnvs = envConfig.filter(r =>
    r.Status && r.Status.toLowerCase().trim() === 'yes'
  );

  // Allow .env TARGET_ENVIRONMENT to override / supply the active env when
  // Confluence has nothing flagged. We deliberately do NOT default to Production
  // — silently switching to prod URLs is dangerous.
  const envOverride = (process.env.TARGET_ENVIRONMENT || '').trim();

  if (activeEnvs.length === 0) {
    if (envOverride) {
      console.log(`⚠️  No environment has Status = "Yes" in Confluence. Using TARGET_ENVIRONMENT=${envOverride} from .env.`);
      activeEnvs.push({ Environment: envOverride, URL: '' });
    } else {
      console.log('⚠️  No environment has Status = "Yes" in Confluence and TARGET_ENVIRONMENT is not set in .env.');
      console.log('   Defaulting to Stage to avoid accidentally hitting Production.');
      activeEnvs.push({ Environment: 'Stage', URL: '' });
    }
  }

  // Use the first active environment
  const activeEnv = activeEnvs[0];
  const activeEnvName = activeEnv.Environment || activeEnv.TestName || envOverride || 'Stage';

  console.log(`📋 Environment Configuration from Confluence:`);
  for (const row of envConfig) {
    const marker = (row.Status || '').toLowerCase().trim() === 'yes' ? '✅' : '☐';
    console.log(`   ${marker} ${row.Environment || row.TestName} — Status: ${row.Status || 'N/A'}`);
  }
  console.log(`\n🎯 Active Environment: ${activeEnvName}`);

  // Build page URL map for the active environment.
  // IMPORTANT: do NOT fall back to row['Production'] — if the active env cell is
  // empty we want to know about it, not silently hit prod.
  const pageUrlMap = {};
  const missingUrlPages = [];
  for (const row of envUrls) {
    if (row.Page) {
      const url = (row[activeEnvName] || '').trim();
      pageUrlMap[row.Page.toLowerCase()] = url;
      if (!url) missingUrlPages.push(row.Page);
    }
  }
  console.log(`📋 Resolved ${Object.keys(pageUrlMap).length} page URLs for ${activeEnvName}`);
  if (missingUrlPages.length > 0) {
    console.log(`⚠️  No ${activeEnvName} URL configured for: ${missingUrlPages.join(', ')}`);
    console.log(`   These pages will have an empty URL — add a value in the Confluence Environment URLs table.`);
  }

  // Write to cache so world.js and step definitions can read it
  const cacheDir = path.join(ROOT, '.cache');
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

  const envCacheData = {
    activeEnvironment: activeEnvName,
    baseUrl: activeEnv.URL || '',
    requiresAuth: activeEnv.RequiresAuth || 'No',
    pageUrls: pageUrlMap,
    resolvedAt: new Date().toISOString(),
  };
  fs.writeFileSync(
    path.join(cacheDir, 'activeEnvironment.json'),
    JSON.stringify(envCacheData, null, 2)
  );
  console.log(`✅ Active environment config written to .cache/activeEnvironment.json`);

  return sheets;
}

async function stepFetchFeatures() {
  banner('Step 2 — Download Selected Feature Files from Confluence');
  const ok = run('node scripts/fetchFeatures.js', 'Fetch selected .feature attachments');
  if (!ok) throw new Error('Feature file download failed');

  // Count downloaded features
  const featureFiles = fs.readdirSync(FEATURES_DIR).filter(f => f.endsWith('.feature'));
  console.log(`✅ ${featureFiles.length} feature files in ${FEATURES_DIR}`);

  if (featureFiles.length === 0) {
    throw new Error('No feature files selected on Confluence page. Check the Feature Selection table and mark features with Run = Yes.');
  }

  return featureFiles;
}

async function stepGenerateStepDefs() {
  banner('Step 2.5 — Auto-Generate Missing Step Definitions');
  const { generateStepDefinitions } = await import('./generateStepDefs.js');
  const result = await generateStepDefinitions();
  if (result.generated > 0) {
    console.log(`✅ Auto-generated ${result.generated} step definition(s) in ${result.files.length} file(s)`);
    for (const f of result.files) console.log(`   📄 ${f}`);
  } else {
    console.log('✅ All steps already have definitions — nothing to generate');
  }
  return result;
}

function stepRunTests(tags) {
  banner('Step 3 — Run Cucumber Tests');

  // Ensure results dir exists
  const resultsDir = path.dirname(RESULTS_JSON);
  if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });

  const tagArg = tags ? ` --tags "${tags}"` : '';
  // Use a relative path so there is no Windows drive-letter colon (C:\) to confuse the parser.
  // The deprecation warning is harmless — the file is still written correctly.
  const formatArg = '--format json:test-results/cucumber-report.json';
  const cmd = `npx cucumber-js --config cucumber.js ${formatArg}${tagArg}`;
  const ok = run(cmd, `Cucumber${tags ? ` (${tags})` : ''}`);

  if (fs.existsSync(RESULTS_JSON)) {
    const raw_content = fs.readFileSync(RESULTS_JSON, 'utf-8').trim();
    if (raw_content) {
      try {
        const raw = JSON.parse(raw_content);
        const scenarios = raw.flatMap(f => (f.elements || []).filter(e => e.type !== 'background'));
        const BAD = new Set(['failed', 'ambiguous', 'undefined', 'pending']);
        const pass = scenarios.filter(s =>
          (s.steps || []).filter(st => !['Before','After'].includes((st.keyword||'').trim()))
                         .every(st => !BAD.has(st.result?.status))
        ).length;
        const fail = scenarios.length - pass;
        console.log(`📊 Scenarios: ${scenarios.length} total | ${pass} passed | ${fail} failed`);
      } catch { /* ignore parse errors here — report step will surface them */ }
    }
  }

  return ok;
}

async function stepGenerateAndUploadReports(runStartMs, reportOnly = false) {
  banner('Step 4 & 5 — Generate Per-Feature Reports and Upload to Confluence');
  const { generatePDFForFeature, generatePDF } = await import('./generateReport.js');
  const { uploadReportToConfluence } = await import('./uploadReportToConfluence.js');

  // Propagate active environment name so uploadReportToConfluence targets the
  // env-specific column (e.g. "Stage Report" / "Production Report").
  try {
    const cachePath = path.join(ROOT, '.cache', 'activeEnvironment.json');
    if (fs.existsSync(cachePath)) {
      const cache = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
      if (cache.activeEnvironment) {
        // The report must target the column for the environment the tests
        // ACTUALLY ran against (resolved into the cache) — NOT a stale
        // TARGET_ENVIRONMENT left in .env. Otherwise a Production run gets
        // logged under the Stage Report column.
        if (process.env.TARGET_ENVIRONMENT && process.env.TARGET_ENVIRONMENT !== cache.activeEnvironment) {
          console.log(`   → Ignoring TARGET_ENVIRONMENT="${process.env.TARGET_ENVIRONMENT}" from .env; using active environment "${cache.activeEnvironment}" from this run.`);
        }
        process.env.TARGET_ENVIRONMENT = cache.activeEnvironment;
        console.log(`   → Target Confluence column: "${cache.activeEnvironment} Report"`);
      }
    }
  } catch (e) {
    console.warn(`   ⚠️  Could not read activeEnvironment.json: ${e.message}`);
  }

  // Load the feature filenames that were selected for this run
  const selectedCachePath = path.join(ROOT, '.cache', 'selectedFeatures.json');
  let testedFeatureFiles = [];
  if (fs.existsSync(selectedCachePath)) {
    const selectedPaths = JSON.parse(fs.readFileSync(selectedCachePath, 'utf-8'));
    testedFeatureFiles = selectedPaths.map(p => path.basename(p));
  }

  // Fallback: generate one combined report when no selection info is available
  if (testedFeatureFiles.length === 0) {
    console.log('⚠️  No selected-feature cache found — generating combined report');
    const origArgv = process.argv;
    process.argv = [process.argv[0], process.argv[1], RESULTS_JSON];
    const result = await generatePDF();
    process.argv = origArgv;
    return [result];
  }

  const reports = [];
  for (const featureFile of testedFeatureFiles) {
    console.log(`\n📄 Generating report for: ${featureFile}`);
    const result = await generatePDFForFeature(RESULTS_JSON, featureFile);
    if (!result) continue;

    // ── Special case: some scenarios write their OWN rich per-feature PDF to
    // excel-reports/<Prefix>_<env>_<timestamp>.pdf (e.g. CalculatorPricing_*,
    // CpcPageLoad_*). Prefer that artefact over the generic Cucumber TestReport.
    let uploadPath = result.pdfPath;
    const customReport = [
      { match: /calculator[_-]?pricing/i, prefix: 'CalculatorPricing', label: 'calculator pricing' },
      { match: /cpc[_-]?pageload/i,       prefix: 'CpcPageLoad',       label: 'CPC page-load' },
    ].find(c => c.match.test(featureFile));
    if (customReport) {
      try {
        const dir = path.join(ROOT, 'excel-reports');
        const envName = (process.env.TARGET_ENVIRONMENT || '').trim().replace(/[^a-zA-Z0-9]/g, '');
        const prefix = customReport.prefix;
        const envRe = envName
          ? new RegExp(`^${prefix}_${envName}_.*\\.pdf$`, 'i')
          : new RegExp(`^${prefix}(?:_[A-Za-z0-9]+)?_.*\\.pdf$`, 'i');
        // Only consider custom PDFs that were (re)generated by THIS run, so a
        // stale report from a previous run is never uploaded. A report-only
        // run reuses the last run's artefacts, so the freshness gate is skipped.
        const isFromThisRun = (fileName) => {
          if (reportOnly || !runStartMs) return true;
          try {
            return fs.statSync(path.join(dir, fileName)).mtimeMs >= runStartMs;
          } catch {
            return false;
          }
        };
        let candidates = fs.readdirSync(dir).filter(f => envRe.test(f) && isFromThisRun(f)).sort();
        // Fallback to any matching-prefix PDF from this run if env-specific not found.
        if (!candidates.length) {
          candidates = fs.readdirSync(dir)
            .filter(f => new RegExp(`^${prefix}.*\\.pdf$`, 'i').test(f) && isFromThisRun(f))
            .sort();
        }
        if (candidates.length) {
          uploadPath = path.join(dir, candidates.at(-1));
          console.log(`   → Using ${customReport.label} report: ${path.basename(uploadPath)}`);
        } else {
          console.warn(
            `   ⚠️  No fresh ${customReport.label} report from this run — ` +
            `uploading this run's generic report instead of a stale one: ${path.basename(uploadPath)}`
          );
        }
      } catch (e) {
        console.warn(`   ⚠️  Could not locate ${customReport.prefix} PDF: ${e.message}`);
      }
    }

    reports.push({ ...result, uploadedPdfPath: uploadPath });
    console.log(`\n📤 Uploading report for: ${featureFile}`);
    const status = (result.stats && typeof result.stats.fail === 'number')
      ? (result.stats.fail === 0 && result.stats.pass > 0 ? 'PASS' : 'FAIL')
      : '';
    await uploadReportToConfluence(uploadPath, [featureFile], status);
  }

  return reports;
}

// ─── Main Orchestrator ───────────────────────────────────────
async function orchestrate() {
  const args = process.argv.slice(2);
  const skipFetch = args.includes('--skip-fetch');
  const skipGenerate = args.includes('--skip-generate');
  const updateSteps = args.includes('--update-steps');
  const reportOnly = args.includes('--report-only');
  const claudeFix = args.includes('--claude-fix');
  const mcpFix = args.includes('--mcp-fix');
  const tags = args.find(a => a.startsWith('--tags='))?.split('=')[1] || '';

  const start = Date.now();

  banner('🤖 Confluence Test Agent — Starting Pipeline');
  console.log(`  Skip fetch:     ${skipFetch}`);
  console.log(`  Skip generate:  ${skipGenerate}`);
  console.log(`  Update steps:   ${updateSteps}  ${updateSteps ? '' : '(existing step files will be preserved)'}`);
  console.log(`  Report only:    ${reportOnly}`);
  console.log(`  Claude fix:     ${claudeFix}`);
  console.log(`  MCP fix:        ${mcpFix}`);
  if (tags) console.log(`  Tags filter: ${tags}`);

  try {
    if (!reportOnly) {
      if (!skipFetch) {
        await stepFetchData();
        await stepFetchFeatures();
      } else {
        console.log('⏭  Skipping fetch (--skip-fetch)');
      }
      if (skipGenerate) {
        console.log('⏭  Skipping step generation (--skip-generate)');
      } else {
        // Pass --update-steps through to the generator via env so we don't
        // need to plumb argv through every import boundary.
        if (updateSteps) process.env.UPDATE_STEPS = '1';
        await stepGenerateStepDefs();
      }

      if (mcpFix) {
        // MCP-first fix loop — uses Playwright MCP for interactive live-page inspection
        banner('Step 3 — Run Tests + MCP Auto-Fix Loop (Playwright MCP)');
        const { spawnSync } = await import('node:child_process');
        const mcpFixArgs = ['scripts/mcpAutoFixer.js'];
        if (tags) mcpFixArgs.push('--tags', tags);
        console.log(`▶ node ${mcpFixArgs.join(' ')}\n`);
        const result = spawnSync(process.execPath, mcpFixArgs, {
          stdio: 'inherit',
          cwd: ROOT,
        });
        if (result.status !== 0) {
          console.log('\n⚠️  MCP fix loop exited with failures — generating report from last run.');
        }
      } else if (claudeFix) {
        // Standard Claude fix loop — uses pre-scraped DOM + MCP for inspection
        banner('Step 3 — Run Tests + Claude Auto-Fix Loop');
        const { spawnSync } = await import('node:child_process');
        const claudeFixArgs = ['scripts/claudeFixLoop.js'];
        if (tags) claudeFixArgs.push('--tags', tags);
        console.log(`▶ node ${claudeFixArgs.join(' ')}\n`);
        const result = spawnSync(process.execPath, claudeFixArgs, {
          stdio: 'inherit',
          cwd: ROOT,
        });
        if (result.status !== 0) {
          console.log('\n⚠️  Claude fix loop exited with failures — generating report from last run.');
        }
      } else {
        const passed = stepRunTests(tags);
        if (!passed) {
          banner('Step 3.1 — Tests Failed — Triggering Auto-Fix Loop');
          console.log('⚠️  Tests failed. Automatically invoking Claude fix loop to repair step definitions.\n');
          const { spawnSync } = await import('node:child_process');
          const claudeFixArgs = ['scripts/claudeFixLoop.js'];
          if (tags) claudeFixArgs.push('--tags', tags);
          console.log(`▶ node ${claudeFixArgs.join(' ')}\n`);
          const fixResult = spawnSync(process.execPath, claudeFixArgs, {
            stdio: 'inherit',
            cwd: ROOT,
          });
          if (fixResult.status !== 0) {
            console.log('\n⚠️  Fix loop exited with remaining failures — generating report from last run.');
          }
        }
      }
    } else {
      console.log('⏭  Skipping to report generation (--report-only)');
    }

    const reports = await stepGenerateAndUploadReports(start, reportOnly);

    banner('✅ Pipeline Complete');
    for (const r of reports) {
      console.log(`  PDF report: ${r.pdfPath}  (pass rate: ${r.stats.passRate}%)`);
    }
    console.log(`  Total time: ${elapsed(start)}`);
  } catch (err) {
    console.error(`\n❌ Pipeline failed: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  }
}

orchestrate();
