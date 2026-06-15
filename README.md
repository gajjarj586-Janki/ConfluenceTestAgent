# Confluence Test Agent

AI Test Agent — **Confluence-driven Playwright + Cucumber automation**.

This project reads test scenarios (feature files / test data) from Confluence,
runs them as Playwright + Cucumber tests, and can auto-generate step
definitions, self-heal failing locators, and publish reports back to Confluence.

---

## Prerequisites

Install these once on your machine:

| Tool | Version | Link |
|------|---------|------|
| Node.js | 18 or newer | https://nodejs.org |
| Git | latest | https://git-scm.com |
| VSCode | latest | https://code.visualstudio.com |

Check your versions:

```bash
node -v
git --version
```

---

## Setup (first time)

### 1. Clone the repository

```bash
git clone https://github.com/gajjarj586-Janki/ConfluenceTestAgent.git
cd ConfluenceTestAgent
```

> If the repository is **private**, you must first accept the collaborator
> invitation from the repo owner before cloning.

### 2. Open it in VSCode

```bash
code .
```

VSCode will prompt you to install the recommended extensions (see
[`.vscode/extensions.json`](.vscode/extensions.json)). Click **Install**.

### 3. Install dependencies

```bash
npm install
```

### 4. Install Playwright browsers

These browser binaries are **not** part of `npm install` — install them
separately:

```bash
npx playwright install
```

### 5. Create your `.env` file

Copy the template and fill in **your own** credentials:

```bash
cp .env.example .env
```

Then open `.env` and set the values:

| Variable | Required | What it is |
|----------|----------|------------|
| `CONFLUENCE_BASE_URL` | ✅ | Your Confluence wiki base URL (already filled in the template) |
| `CONFLUENCE_EMAIL` | ✅ | Your own Atlassian/Confluence email |
| `CONFLUENCE_API_TOKEN` | ✅ | **Your own** API token — see below |
| `CONFLUENCE_TEST_DATA_PAGE_ID` | ✅ | Confluence page ID holding test data |
| `CONFLUENCE_FEATURE_FILE_PAGE_ID` | ✅ | Confluence page ID holding feature files |
| `TARGET_ENVIRONMENT` | ✅ | e.g. `Stage` |
| `HEADLESS` | ✅ | `true` to run browsers headless, `false` to watch them |
| `PIM_USER` / `PIM_PASS` | optional | Only needed for the PIM test suites |

**Get your Confluence API token:**
Go to https://id.atlassian.com/manage-profile/security/api-tokens →
click **Create API token** (NOT "Create API token with scopes") → copy it into
`CONFLUENCE_API_TOKEN`.

> ⚠️ **Never commit your `.env` file.** It contains secrets and is already
> listed in `.gitignore`. Each person uses their own credentials.

---

## Running the tests

| Command | What it does |
|---------|--------------|
| `npm run test:cucumber` | Run all Cucumber tests |
| `npm run test:contactus` | Run only the `@contact-us` scenarios |
| `npm run fetch:features` | Pull the latest feature files from Confluence |
| `npm run steps:generate` | Auto-generate step definitions from feature files |
| `npm run report:pdf` | Generate a PDF report of the last run |
| `npm run agent:run` | Run the full agent orchestrator |
| `npm run agent:full` | Fetch features → run tests → generate report |
| `npm run fix:loop` | Auto-fix failing tests in a loop |
| `npm run fix:mcp` | MCP-based auto-fixer |

See the full list of scripts in [`package.json`](package.json).

---

## Recommended VSCode extensions

These are suggested automatically via [`.vscode/extensions.json`](.vscode/extensions.json):

- **Cucumber (Gherkin) Full Support** — `.feature` file syntax highlighting
- **Playwright Test for VSCode** — run and debug tests from the editor
- **ESLint** — linting

---

## Project structure

```
features/
  source/                  Feature files synced from Confluence
  cucumber/                Active feature files + step definitions
    step_definitions/      Cucumber step implementations
    support/               World, hooks, shared helpers
scripts/                   Orchestrator, fetchers, generators, fixers, reporters
utils/                     Confluence reader, auth, locator self-healing
playwright.config.js       Playwright configuration
cucumber.js                Cucumber configuration
```

For deeper architecture details, see [`FRAMEWORK.md`](FRAMEWORK.md) and
[`DEMO_SCRIPT.md`](DEMO_SCRIPT.md).

---

## Troubleshooting

- **`npx playwright install` issues** — make sure step 4 completed; browsers
  must be installed separately from `npm install`.
- **Confluence 401 / 403 errors** — your `CONFLUENCE_API_TOKEN` is wrong or
  scoped. Regenerate a *classic* (unscoped) token.
- **`.env` not loaded** — confirm the file is named exactly `.env` (no
  extension) and lives in the project root.
