# Confluence Test Agent — Pipeline Guide

## Overview

The agent pulls test configuration and data from Confluence, runs Cucumber/Playwright tests, auto-fixes failures using Claude AI, and uploads a PDF report back to Confluence — all in a single command.

```
Confluence ──► Fetch config & features ──► Generate steps ──► Run tests ──► Fix failures ──► Upload report
```

---

## Quick Start

```bash
# Full pipeline (recommended)
node scripts/agentOrchestrator.js

# Skip Confluence fetch — reuse cached data and feature files
node scripts/agentOrchestrator.js --skip-fetch

# Run only specific tags
node scripts/agentOrchestrator.js --tags "@BATD"
node scripts/agentOrchestrator.js --skip-fetch --tags "@CAD"

# Re-generate report from last run without re-running tests
node scripts/agentOrchestrator.js --report-only

# npm aliases
npm run agent:run
npm run agent:run:no-gen     # --skip-fetch --skip-generate
npm run agent:claude-fix     # full pipeline with explicit Claude fix flag
```

---

## Pipeline Steps

### Step 1 — Fetch Test Data from Confluence
**Script:** `agentOrchestrator.js → stepFetchData()`

Reads all sheets from the Confluence "Automation Test Data" page via the Confluence REST API:

| Confluence Sheet | Purpose |
|---|---|
| Environment Configuration | Which environment is active (Status = Yes) |
| Environment URLs | Page URLs per environment (Stage / Production) |
| Feature Selection | Which `.feature` files to run (Run = Yes) |
| Test Drive / Test Drive FIFO PCM2 | BATD test data |
| Contact a Dealer / CAD FIFO PCM2 | CAD test data |
| (others) | Fleet, Genesis, Ownership, Footer, etc. |

Resolved environment and page URLs are cached to `.cache/activeEnvironment.json`.

---

### Step 2 — Download Feature Files
**Script:** `scripts/fetchFeatures.js`

Downloads `.feature` attachment files from Confluence for rows where **Run = Yes** in the Feature Selection table. Feature files are saved to `features/cucumber/`.

Selected feature paths are cached to `.cache/selectedFeatures.json`.

---

### Step 2.5 — Auto-Generate Missing Step Definitions
**Script:** `scripts/generateStepDefs.js`

Scans each feature file, compares steps against all existing step definitions, and uses Claude AI to generate implementations for any undefined steps. Generated files are written to `features/cucumber/step_definitions/<name>_auto.steps.js`.

Files marked `// @protected` at line 1 are never overwritten by the generator or fix loop.

---

### Step 3 — Run Cucumber Tests
**Script:** `npx cucumber-js --config cucumber.js`

Runs all downloaded feature files using Playwright (Chromium, headless). Results are written to `test-results/cucumber-report.json`.

If any scenario fails, the pipeline **automatically** triggers the Claude fix loop (Step 3.1).

---

### Step 3.1 — Claude Auto-Fix Loop (on failure)
**Script:** `scripts/claudeFixLoop.js`

Runs up to **5 iterations**. Each iteration:
1. Parses `cucumber-report.json` for failures
2. Identifies which step definition file(s) contain the failing steps
3. Invokes `claude` CLI with the error + file context, asking it to fix the step
4. Detects whether Claude actually changed any files (via mtime snapshot)
5. If no change detected → escalates to a full-file prompt on the next iteration
6. Re-runs the tests to check if failures are resolved

Fix loop exits early when all scenarios pass. If failures remain after 5 iterations, the report is generated from the last run.

**MCP variant:** `scripts/mcpAutoFixer.js` — uses Playwright MCP for live page inspection during fixes.

```bash
npm run fix:loop            # standalone fix loop (last test run)
npm run fix:mcp             # MCP-assisted fix loop
```

---

### Step 4 & 5 — Generate PDF Report + Upload to Confluence
**Script:** `scripts/generateReport.js` + `scripts/uploadReportToConfluence.js`

Generates a per-feature HTML/PDF report from `cucumber-report.json` and uploads it as an attachment to the Confluence Feature Selection page. The Report column on the Confluence page is updated with a link to the uploaded PDF.

---

## Key Files

| Path | Purpose |
|---|---|
| `scripts/agentOrchestrator.js` | Main pipeline entry point |
| `scripts/claudeFixLoop.js` | AI-powered auto-fix loop |
| `scripts/mcpAutoFixer.js` | MCP-assisted auto-fix loop |
| `scripts/generateStepDefs.js` | Auto-generates missing step definitions |
| `scripts/fetchFeatures.js` | Downloads feature files from Confluence |
| `scripts/generateReport.js` | Generates HTML/PDF test report |
| `scripts/uploadReportToConfluence.js` | Uploads report to Confluence |
| `features/cucumber/` | Feature files (downloaded from Confluence) |
| `features/cucumber/step_definitions/` | Step definition files |
| `features/cucumber/support/world.js` | Playwright browser + Confluence data setup |
| `features/cucumber/step_definitions/commonHelpers.js` | Shared helpers (location modal, etc.) |
| `cucumber.js` | Cucumber configuration |
| `.cache/activeEnvironment.json` | Resolved environment + page URLs |
| `.cache/selectedFeatures.json` | Feature files selected for current run |
| `.cache/domMaps/` | Cached DOM field maps per page URL |
| `test-results/cucumber-report.json` | Cucumber JSON output |
| `screenshots/` | Screenshots on failure |
| `excel-reports/` | Generated PDF reports |

---

## Confluence Configuration

The agent reads all configuration from a single Confluence page. Key tables:

### Environment Configuration
| Environment | Status |
|---|---|
| Stage | **Yes** |
| Production | No |

Set **Status = Yes** on exactly one row to select the active environment.

### Environment URLs
| Page | Stage | Production |
|---|---|---|
| pip page | https://stage.hyundai.com.au/... | https://hyundai.com.au/... |
| test drive | https://stage.hyundai.com.au/... | ... |

### Feature Selection
| Feature File | Run | Report |
|---|---|---|
| pipFIFO.feature | **Yes** | _(auto-filled)_ |
| CPC-allFIFOs.feature | No | |

Set **Run = Yes** to include a feature in the next pipeline run.

---

## Environment Variables

Required in `.env`:

```env
CONFLUENCE_BASE_URL=https://yourorg.atlassian.net/wiki
CONFLUENCE_USERNAME=your.email@example.com
CONFLUENCE_API_TOKEN=your-api-token
CONFLUENCE_PAGE_ID=123456789
ANTHROPIC_API_KEY=your-anthropic-key
```

---

## Step Definition Conventions

| Convention | Detail |
|---|---|
| `// @protected` at line 1 | File is never touched by generator or fix loop |
| `this.testDriveData` | BATD / general test data (array of row objects) |
| `this.contactDealerData` | CAD test data |
| `this.allConfluenceData` | All sheets keyed by sheet name |
| `this.pageUrls` | Page key → URL map for active environment |
| `this._activeModalHeader` | Current modal header text for scoping locators |

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---|---|---|
| "No feature files selected" | No rows have Run = Yes in Confluence | Update Confluence Feature Selection table |
| Step fails with "No Powertrain key found" | Wrong Confluence sheet matched | Check sheet name spelling; the step looks directly in `allConfluenceData` for the FIFO PCM2 key |
| Fix loop iterates 5× with no change | Claude CLI prompt too long (escalated prompt hits OS arg limit) | Reduce number of failing steps or increase max iterations |
| `ReferenceError` on step file load | Fix loop corrupted a `// @protected` file | Manually restore the `*/` comment close on the affected line |
| "Set your location" Next button disabled | Location not set before Next click | The powertrain step now handles this via `handleLocationModal` |
| Wrong element clicked for "Test Drive" | Nav-card elements in main navbar match first | The `user selects Test Drive` step uses `evaluateHandle` to exclude nav-card class and navbar ancestors |
