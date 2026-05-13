# Prompt: Create a Confluence-Driven Playwright + Cucumber Test Agent

> **Copy everything below this line and paste it to your AI agent (e.g. GitHub Copilot) in a new empty project folder. Replace all `{{PLACEHOLDER}}` values with your project-specific details.**

---

## Project Setup Request

Create a fully automated, Confluence-driven end-to-end test agent using **Playwright + Cucumber.js** with a single-command pipeline. The agent should:

1. **Fetch test data** from a Confluence page (tables parsed from HTML)
2. **Download feature files** attached to a Confluence page (only those marked `Run = Yes`)
3. **Auto-generate step definitions** for any undefined Cucumber steps
4. **Run the tests** via Playwright in headless Chrome
5. **Generate a PDF report** with pass/fail status, error summaries, and embedded screenshots

---

## Project Details

- **Project Name:** `{{PROJECT_NAME}}` (e.g. `my-test-agent`)
- **Target Website:** `{{TARGET_WEBSITE_URL}}` (e.g. `https://dev.example.com`)
- **Website Description:** `{{BRIEF_DESCRIPTION}}` (e.g. "An e-commerce site with login, product search, cart, and checkout pages")
- **Forms/Pages to Test:** `{{LIST_OF_PAGES_OR_FORMS}}` (e.g. "Login form, Registration form, Contact Us form, Search page")

### Confluence Details

- **Confluence Base URL:** `{{CONFLUENCE_BASE_URL}}` (e.g. `https://mycompany.atlassian.net/wiki`)
- **Test Data Page ID:** `{{TEST_DATA_PAGE_ID}}` — a Confluence page containing HTML tables with test data (one table per form/page, with column headers as field names and rows as test cases)
- **Feature File Page ID:** `{{FEATURE_FILE_PAGE_ID}}` — a Confluence page with `.feature` files attached and a "Feature Selection" table with columns: `Feature File | Run`

### Environment Configuration (on the Test Data Confluence page)

The test data page should have these two tables:

**Environment Configuration:**
| Environment | Status |
|-------------|--------|
| Dev         | Yes    |
| Stage       | No     |
| Production  | No     |

**Environment URLs:**
| Page            | Dev                          | Stage                         | Production                    |
|-----------------|------------------------------|-------------------------------|-------------------------------|
| {{page_name_1}} | {{dev_url_1}}                | {{stage_url_1}}               | {{prod_url_1}}                |
| {{page_name_2}} | {{dev_url_2}}                | {{stage_url_2}}               | {{prod_url_2}}                |

The agent should read the active environment (Status = "Yes") and resolve URLs dynamically.

---

## Technical Requirements

### Stack
- **Runtime:** Node.js (ESM — `"type": "module"` in package.json)
- **Test Runner:** `@cucumber/cucumber` (latest)
- **Browser Automation:** `playwright` (chromium)
- **HTML Parser:** `cheerio` (for Confluence page parsing)
- **Config:** `dotenv` for secrets

### Folder Structure

```
{{PROJECT_NAME}}/
├── .env                          # Secrets (NEVER commit)
├── .gitignore
├── package.json
├── cucumber.js                   # Cucumber config (reads selected features from cache)
├── playwright.config.js
├── utils/
│   ├── confluenceConfig.js       # Confluence page IDs, base URL, table names
│   └── confluenceReader.js       # Fetches & parses Confluence tables → JSON
├── scripts/
│   ├── agentOrchestrator.js      # Single-command pipeline (npm run agent:run)
│   ├── fetchFeatures.js          # Downloads .feature files from Confluence
│   ├── generateStepDefs.js       # Auto-generates missing step definitions
│   └── generateReport.js         # Builds HTML report → renders PDF via Playwright
├── features/
│   └── cucumber/
│       ├── *.feature             # Downloaded from Confluence (gitignored)
│       ├── support/
│       │   └── world.js          # Cucumber World: browser setup, Confluence data loading
│       └── step_definitions/
│           └── *_auto.steps.js   # Auto-generated + hand-tuned step definitions
├── screenshots/                  # Per-scenario screenshots (pass AND fail)
├── test-results/
│   └── cucumber-report.json      # Cucumber JSON output
├── excel-reports/                # Generated PDF reports
└── .cache/                       # Runtime cache (activeEnvironment.json, selectedFeatures.json)
```

### .env File

```env
CONFLUENCE_BASE_URL={{CONFLUENCE_BASE_URL}}
CONFLUENCE_EMAIL={{YOUR_EMAIL}}
CONFLUENCE_API_TOKEN={{YOUR_API_TOKEN}}
CONFLUENCE_TEST_DATA_PAGE_ID={{TEST_DATA_PAGE_ID}}
CONFLUENCE_FEATURE_FILE_PAGE_ID={{FEATURE_FILE_PAGE_ID}}
TARGET_ENVIRONMENT=Dev
HEADLESS=true
```

### package.json Scripts

```json
{
  "scripts": {
    "fetch:features": "node scripts/fetchFeatures.js",
    "test:cucumber": "npx cucumber-js --config cucumber.js",
    "report:pdf": "node scripts/generateReport.js",
    "steps:generate": "node scripts/generateStepDefs.js",
    "agent:run": "node scripts/agentOrchestrator.js",
    "agent:full": "npm run fetch:features && npm run test:cucumber && npm run report:pdf"
  }
}
```

---

## Component Specifications

### 1. `utils/confluenceReader.js`

- Authenticate with Confluence REST API using Basic Auth (email + API token)
- Fetch page body: `GET /rest/api/content/{pageId}?expand=body.storage`
- Parse **all HTML tables** from the storage-format body using `cheerio`
- Use `<strong>` headings inside `<ol><li>` as section/table names
- Return `{ "Section Name": [ { col1: val1, col2: val2, ... }, ... ], ... }`
- Cache results locally in `.cache/` to avoid repeated API calls

### 2. `scripts/fetchFeatures.js`

- Read the Feature Selection table from the feature file Confluence page
- Only download `.feature` attachments where `Run` column = `Yes` or `✅`
- Save to `features/cucumber/`
- Write `.cache/selectedFeatures.json` with paths of selected features

### 3. `scripts/generateStepDefs.js`

- Parse all `.feature` files to extract Gherkin steps (Given/When/Then/And/But)
- Scan existing `*_auto.steps.js` files for already-defined step patterns
- For undefined steps, generate Playwright-based step definitions:
  - Navigation steps: `await this.page.goto(url)`
  - Form fill steps: locate inputs by label/placeholder and fill
  - Click/submit steps: locate buttons by text/role and click
  - Assertion steps: check for visible text, validation errors, success messages
- Use **case-sensitive** regex matching to align with Cucumber runtime
- Write generated files as `{feature_name}_auto.steps.js`

### 4. `scripts/generateReport.js`

- Read `test-results/cucumber-report.json`
- Flatten into rows: `{ scenario, status, steps, errorMessage, screenshotPath }`
- For each scenario, find the latest matching screenshot from `screenshots/` folder
- Build an HTML report with:
  - Dark navy header with project name and timestamp
  - Summary cards: Total scenarios, Passed, Failed, Pass Rate %
  - Table with columns: #, Scenario, Status (green PASS / red FAIL badge), Error Summary, Screenshot (thumbnail)
  - Treat `undefined`, `pending`, `ambiguous` step statuses as FAIL
- Humanize error messages: extract field names, validation evidence, simplify assertion errors
- Render HTML → PDF using headless Playwright Chromium
- Save to `excel-reports/TestReport_{timestamp}.html` and `.pdf` (if PDF rendering available)

### 5. `features/cucumber/support/world.js`

- **World constructor** with properties: `browser`, `context`, `page`, `testData`, `environmentName`, `pageUrls`
- **Before hook:**
  - Launch Chromium (headless configurable via `HEADLESS` env var)
  - Create browser context with 1920x1080 viewport
  - Load active environment from `.cache/activeEnvironment.json` (written by orchestrator)
  - Load all Confluence test data sections
  - Resolve page URLs for the active environment
- **After hook:**
  - Capture a full-page screenshot for **EVERY** scenario (both pass and fail)
  - Save as `screenshots/cucumber-{scenarioName}-{timestamp}.png`
  - Attach screenshot to Cucumber report
  - Close page, context, browser
- Set default timeout to 120 seconds

### 6. `scripts/agentOrchestrator.js`

- Single entry point: `node scripts/agentOrchestrator.js`
- Pipeline steps with banner logging:
  1. **Fetch Data** — load Confluence tables, resolve active environment, write `.cache/activeEnvironment.json`
  2. **Fetch Features** — download selected `.feature` files
  3. **Generate Step Defs** — auto-create missing step definitions
  4. **Run Tests** — execute Cucumber with JSON output
  5. **Generate Report** — build PDF from results
- Support flags: `--skip-fetch` (reuse cache), `--report-only`, `--tags=@tagname`
- Print summary: pass rate, total time, report path

### 7. `cucumber.js` (config)

- Read `.cache/selectedFeatures.json` for dynamic feature paths
- Fall back to `features/cucumber/**/*.feature` if no cache
- Require `world.js` and all step definitions
- Output formats: `progress-bar` + `json:test-results/cucumber-report.json`
- Timeout: 120000ms

---

## Key Design Patterns to Follow

1. **Confluence is the single source of truth** — test data, feature files, and environment config all come from Confluence. No hardcoded test data in code.

2. **Zero-touch new features** — when a new `.feature` file is added to Confluence and marked `Run = Yes`, the agent auto-generates step definitions and runs it without manual coding.

3. **Screenshots for every scenario** — the After hook captures the final page state regardless of pass/fail. Passing tests should show the success state (e.g., "Thank you" message). Failing tests should show the error state.

4. **Human-readable reports** — error messages in the PDF should be summarized into plain English, not raw assertion dumps. Include screenshot thumbnails inline.

5. **Environment-agnostic** — the same tests run against Dev, Stage, or Production based on the Confluence `Environment Configuration` table. Just flip `Status = Yes` on Confluence to switch environments.

6. **Resilient pipeline** — test failures don't crash the pipeline. The orchestrator always proceeds to report generation even if some tests fail.

---

## After Setup, Verify With

```bash
# Install dependencies
npm install

# Run the full pipeline
npm run agent:run
```

The agent should:
- Connect to Confluence and fetch test data
- Download selected feature files
- Auto-generate any missing step definitions
- Run all selected tests with Playwright
- Generate a PDF report in `excel-reports/`
- Every scenario should have a screenshot in the report

---

## Optional Enhancements (ask for these later)

- **Confluence write-back** — push test results back to a Confluence results page
- **CI/CD integration** — GitHub Actions / Azure DevOps pipeline YAML
- **Parallel execution** — run scenarios in parallel with Cucumber `--parallel` flag
- **Visual regression** — screenshot comparison between runs
- **Slack/Teams notifications** — post summary to chat after each run
- **Retry flaky tests** — auto-retry failed scenarios once before marking as failed
