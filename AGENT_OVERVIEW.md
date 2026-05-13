# Confluence Test Agent — Overview

A fully automated, Confluence-driven end-to-end test agent for the Hyundai Australia website. It reads test data and feature files directly from Confluence, runs browser automation tests, and generates an HTML report — all from a single command.

---

## What It Does

```
Confluence (test data + feature files)
        │
        ▼
  Fetch & Cache Data           ← reads tables, resolves active environment
        │
        ▼
  Download Feature Files       ← only those marked Run = Yes on Confluence
        │
        ▼
  Auto-Generate Step Defs      ← scaffolds any undefined Cucumber steps
        │
        ▼
  Run Tests (Playwright)       ← headless or headed Chromium browser
        │
        ▼
  Generate HTML Report         ← pass/fail summary + screenshots + API status
```

---

## Pages Under Test

| Feature File | Page Tested |
|---|---|
| `Ownership_smoke.feature` | CRM Ownership Update (`/crm-ownership-update`) |
| `CAD-smoke.feature` | Contact a Dealer (`/contact-a-dealer`) |
| `BATD-smoke.feature` | Book a Test Drive |
| `GenesisRYI.feature` | Genesis Register Your Interest |

---

## Architecture

```
ConfluenceTestAgent/
├── scripts/
│   ├── agentOrchestrator.js    # Master pipeline — runs all 4 steps in sequence
│   ├── fetchFeatures.js        # Downloads .feature files from Confluence attachments
│   ├── generateStepDefs.js     # Auto-scaffolds missing step definitions
│   └── generateReport.js       # Builds HTML report with screenshots & test results
│
├── utils/
│   ├── confluenceConfig.js     # Page IDs, API credentials, table section names
│   └── confluenceReader.js     # Fetches & parses Confluence HTML tables → JSON
│
├── features/cucumber/
│   ├── *.feature               # Gherkin feature files (downloaded from Confluence)
│   ├── step_definitions/       # Step implementation files (JS)
│   └── support/
│       └── world.js            # Playwright browser + network capture setup
│
├── .cache/
│   └── activeEnvironment.json  # Resolved environment config (written at runtime)
├── screenshots/                # Test screenshots + API payload screenshots
├── test-results/               # Cucumber JSON output
└── excel-reports/              # Generated HTML reports
```

---

## How It Works — Step by Step

### Step 1 — Fetch Test Data from Confluence

The agent connects to Confluence via REST API using credentials from `.env`. It reads the **Test Data page** (HTML tables) and parses every table into structured JSON.

Key tables it reads:

- **Environment Configuration** — which environment is active (Dev / Stage / Production)
- **Environment URLs** — page URLs per environment (Contact Us, Ownership, CAD, etc.)
- **Form test data** — field values for each form (name, email, VIN, phone, etc.)

The active environment (marked `Status = Yes`) is resolved and written to `.cache/activeEnvironment.json` so all step definitions can read the correct URLs at runtime.

---

### Step 2 — Download Feature Files from Confluence

The agent reads the **Feature Files page** on Confluence, which contains a table listing all available `.feature` files and a `Run` column.

Only files with `Run = Yes` are downloaded and saved to `features/cucumber/`. This means test execution is **controlled entirely from Confluence** — no code change needed to add or disable a test suite.

---

### Step 2.5 — Auto-Generate Missing Step Definitions

After downloading feature files, the agent scans all `.feature` files for Cucumber step patterns and checks whether matching step definitions exist in the `step_definitions/` folder.

Any **undefined steps** are automatically scaffolded as pending stubs in the appropriate JS file, so the test run does not crash with "undefined step" errors.

---

### Step 3 — Run Tests with Playwright + Cucumber

Cucumber-JS runs all downloaded feature files using Playwright (Chromium). Key behaviours:

**Network capture** — `world.js` attaches both a CDP (Chrome DevTools Protocol) listener and a native Playwright `page.on('response')` listener. These capture form API calls (e.g. `POST /ownershipV2`, `POST /contactUs`) and record the HTTP status code for assertion.

**Smart waiting** — all steps use `waitForSelector` on real DOM signals instead of fixed `setTimeout` delays. For example:
- After clicking "Check" VIN → waits for the "Yes/No" radio to appear
- After selecting "Yes" → waits for contact detail fields to appear
- After clicking "Submit" → waits for confirmation popup text to disappear

**Popup handling** — the Ownership form shows a "Please confirm you are the owner" confirmation popup after Submit. The agent detects this automatically via `waitForFunction`, walks the DOM to find the button inside the popup, and clicks it — without relying on fragile CSS class selectors.

**Screenshots** — the After hook saves a timestamped screenshot after every scenario (pass or fail), and a second screenshot of the API payload. Filenames are scoped per feature file to avoid collision when multiple suites run.

---

### Step 4 — Generate HTML Report

After all tests complete, `generateReport.js` reads the Cucumber JSON output and renders an HTML report containing:

- Overall pass/fail summary
- Per-scenario results with step-level detail
- Embedded screenshots (final page state + API payload)
- API endpoint + status code captured during the run
- Timestamp and environment name

Reports are saved to `excel-reports/` with a timestamp filename.

---

## Running the Agent

### Full pipeline (all features enabled on Confluence)
```powershell
$env:HEADLESS="false"; npm run agent:run
```

### Single feature (faster, for development)
```powershell
$env:HEADLESS="false"; npx cucumber-js --config cucumber.js features/cucumber/Ownership_smoke.feature 2>&1
```

### Skip Confluence fetch, reuse cached data
```powershell
npm run agent:run -- --skip-fetch
```

### Regenerate report only (no tests)
```powershell
npm run agent:run -- --report-only
```

---

## Environment & Credentials

All secrets are stored in `.env` (never committed):

```
CONFLUENCE_BASE_URL=https://yourcompany.atlassian.net/wiki
CONFLUENCE_EMAIL=you@example.com
CONFLUENCE_API_TOKEN=your_api_token
CONFLUENCE_TEST_DATA_PAGE_ID=1776353299
CONFLUENCE_FEATURE_FILE_PAGE_ID=1729724417
```

The **active environment** (Dev / Stage / Production) is set in the Confluence **Environment Configuration** table by changing a `Status` cell to `Yes`. No code change required.

---

## Ownership Form — Test Flow

This is the most complex scenario in the suite:

1. Navigate to the CRM Ownership Update page
2. Enter VIN → click **Check** → wait for vehicle details to populate
3. Select **Yes** for "Do you still own this vehicle?" → wait for contact form to appear
4. Fill in all contact details (Title, First Name, Last Name, Email, Mobile, Address, Suburb, State, Postcode)
5. Check the marketing authorisation checkbox
6. Click **Submit** → ownership confirmation popup appears ("Please confirm you are the owner")
7. Agent automatically detects popup, walks DOM to find the Submit button inside it, clicks it
8. Waits for popup to dismiss (text disappears from page)
9. Asserts success message visible + API `POST /ownershipV2 → 200` captured

---

## Key Design Decisions

| Decision | Reason |
|---|---|
| Confluence as single source of truth | Test data and feature files are managed by QA in Confluence — no dev involvement needed to add/change test cases |
| `waitForSelector` instead of `waitForTimeout` | Tests react to actual DOM state, not arbitrary delays — faster and more reliable |
| DOM-walk for popup click | CSS classes on the Ownership popup (`confirmation`) also match the outer page containers, causing false signals — DOM traversal from the text node is precise |
| Dual network capture (CDP + Playwright native) | CDP can miss some requests on staging; the native listener acts as a fallback |
| Feature-scoped screenshot filenames | Prevents collision when Contact Us and Ownership screenshots are saved in the same run |
