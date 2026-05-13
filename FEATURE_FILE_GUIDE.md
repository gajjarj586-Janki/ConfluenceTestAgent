# Feature File Authoring Guide

How to write Gherkin feature files that this agent can auto-generate working step
definitions for, **without writing any glue code**.

The agent's "training" lives in:

- [`scripts/generateStepDefs.js`](scripts/generateStepDefs.js) — verb categorizer + step body emitter
- [`scripts/stepPatternLibrary.js`](scripts/stepPatternLibrary.js) — curated pattern matchers (checked first)
- [`features/cucumber/support/world.js`](features/cucumber/support/world.js) — `clickButton`, `fillField`, `selectDropdown`, `setCheckbox` helpers
- [`utils/autoHealLocator.js`](utils/autoHealLocator.js) — ranked fallback selectors per element type

---

## 1. Verb cheat sheet

Use these phrasings — each maps to a tested helper that auto-heals across
common DOM patterns (native + React/AEM custom controls).

| Phrasing in your feature file | Category | What the agent emits |
|---|---|---|
| `navigates to the X page` / `opens X` / `visits X` | `navigate` | Resolves URL from Confluence pageUrls cache (fuzzy + token-overlap), `page.goto`, sets up network intercepts |
| `is on the X page` / `I am a user on the X page` | `navigate` | Same as above (Background-style implicit nav) |
| `the X page is displayed` / `page has loaded` | `page_loaded` | Waits for `domcontentloaded` + asserts heading/title |
| `clicks the X button` / `clicks on X` / `presses X` / `clicks Submit` | `click` | `clickButton(label)` — checks `disabled` / `aria-disabled` / `pointer-events`, force-clicks if needed |
| `fills X from test data` / `user fills X` | `fill_from_data` | Reads value from Confluence test-data by fuzzy column-name match, dispatches by live tag (input / textarea / select / checkbox / radio) |
| `enters "value" in X field` / `enters X as "value"` / `types "value"` | `fill` | `fillField(hint, value)` — auto-heal across name / id / placeholder / aria-label / label-text |
| `selects "X" from "Y" dropdown` / `selects X as "Y"` / `chooses X` | `select` | `selectDropdown(hint, value)` — native `<select>` first, then custom-dropdown JS walker (button trigger + option-list click) |
| `accepts consent checkbox 1` / `consent checkbox 2` | `checkbox` | `setCheckbox(hint, true, { nth: 0 })` — Nth checkbox targeting |
| `accepts the privacy consent` / `ticks privacy` / `agrees to terms` / `acknowledges X` / `opts in` | `checkbox` | Same — pattern library matches the consent variants |
| `the X modal is displayed` / `is open` / `should appear` | `visible` | Asserts dialog/modal/text visibility |
| `the X modal will close` / `is hidden` / `disappears` | `not_visible` | Asserts hidden / count==0 |
| `submits the form` / `clicks Submit` | pattern lib | Submits + waits for `networkidle` so API response is captured |
| `confirmation message is displayed` / `success message appears` / `thank you` | `success` | Asserts success banner / 200 status / confirmation text |
| `validation error is shown` / `error message appears` | `validation` | Asserts `.invalid-feedback`, `[role=alert]`, `.error-message`, etc. |
| `should not proceed` / `should be blocked` / `proceeds normally` / `accepted without error` | `negative_validation` | Asserts absence of errors / no navigation |
| `the anchor link to "X" should be clickable` | `anchor_link` | Asserts link existence + clickability |
| `the URL should contain "X"` / `is redirected to X` | `url_change` | Asserts `page.url()` matches |
| `remains on the X page` / `stays on X` | `remain` | Asserts URL unchanged |
| `uploads the file "X"` / `attaches X` | `upload` | `setInputFiles` |
| `scrolls to X` | `scroll` | `scrollIntoViewIfNeeded` |
| `leaves X empty` | `clear_field` | Clears the field |

**Order matters in the categorizer:** `checkbox` is matched before `select` so
`accepts consent checkbox 1` is treated as a checkbox toggle, not a dropdown
selection.

---

## 2. Confluence prerequisites

For data-driven steps to work, the Confluence page must have:

### a) A **Page URLs** table

Used by every `navigate` / `is on the X page` step.

| Page Name | URL |
|---|---|
| Hyundai Home | https://www.hyundai.com.au |
| Contact Us | https://www.hyundai.com.au/contact-us |
| Find a Dealer | https://www.hyundai.com.au/find-a-dealer |

The page-name match is fuzzy (lowercase, token-overlap, slug). `Hyundai Home page`,
`home page`, and `Hyundai homepage` all resolve to the same row.

### b) A **test-data table** per scenario

Column headers must semantically match the field hint in the step. The matcher
normalizes both sides (`.toLowerCase().replace(/[^a-z0-9]/g, '')`), so:

- `First Name` ↔ `first_name` ↔ `firstname` ↔ `FirstName` ✅
- `Email Address` ↔ `email` ↔ `Email_Address` ✅
- `Phone Number` ↔ `phone` ↔ `phoneNumber` ✅

Example:

| Title | First Name | Last Name | Email Address | Phone Number | Postcode | Own Hyundai | Model of Interest | Enquiry About | Message |
|---|---|---|---|---|---|---|---|---|---|
| Mr | John | Doe | john@test.com | 0412345678 | 2000 | Yes | KONA | General | Test enquiry |

For Yes/No selects, the helper handles label↔value mapping (e.g. `Yes` ↔ `true`,
`No` ↔ `false`) automatically.

### c) The **feature file** itself (optional)

Feature files can live on Confluence (auto-fetched) or directly under
[`features/cucumber/`](features/cucumber/).

---

## 3. Worked example

**Goal:** Open Hyundai homepage, click "Contact us" in the footer, fill the form
with test data, accept consent, submit, verify confirmation.

### Feature file

```gherkin
Feature: Hyundai homepage Contact Us flow

  Background:
    Given the user has loaded the test data from the Confluence page
    And the user is on the Hyundai Home page

  @smoke @ContactUs @Positive
  Scenario: User submits the Contact Us form from the footer
    When the user clicks on Contact us in footer
    Then the Contact Us page is displayed
    When the user fills Title from test data
    And the user fills First Name from test data
    And the user fills Last Name from test data
    And the user fills Email Address from test data
    And the user fills Phone Number from test data
    And the user fills Postcode from test data
    And the user fills Own Hyundai from test data
    And the user fills Model of Interest from test data
    And the user fills Enquiry About from test data
    And the user fills Message from test data
    And the user accepts consent checkbox 1
    And the user clicks Submit
    Then the confirmation message is displayed
```

### What the agent generates (mental model)

| Gherkin step | Helper call |
|---|---|
| `is on the Hyundai Home page` | `await this.page.goto(<resolved URL>)` |
| `clicks on Contact us in footer` | `await this.clickButton('Contact us')` (trailing "in footer" stripped) |
| `the Contact Us page is displayed` | visibility / heading assertion |
| `fills First Name from test data` | reads `First Name` column → `await this.fillField('First Name', value)` |
| `fills Own Hyundai from test data` | resolves Yes/No → `await this.selectDropdown('Own Hyundai', value)` (native+custom) |
| `accepts consent checkbox 1` | `await this.setCheckbox('consent', true, { nth: 0 })` |
| `clicks Submit` | submit + `waitForLoadState('networkidle')` |
| `confirmation message is displayed` | success-message assertion |

---

## 4. Authoring rules of thumb

1. **One action per step.** Never combine: ❌ `clicks Contact us and fills name`. ✅ Two separate `And` lines.
2. **Use the visible label.** `clicks Send Enquiry` works because the button text is "Send Enquiry". Capitalize as on screen.
3. **Trailing qualifiers are stripped.** `clicks on Talk to an expert on Take the next step section` → looks up "Talk to an expert".
4. **`from test data`** is required for data-driven fills. Without it, the step expects a quoted value.
5. **Quoted values bind to `{string}`.** `enters "john@test.com" in Email field` → `fillField('Email', 'john@test.com')`.
6. **Background must include data load + page load.** `the user has loaded the test data from the Confluence page` then `the user is on the X page`.
7. **Numbered checkboxes** — `consent checkbox 1`, `consent checkbox 2` target distinct DOM checkboxes (Nth, 1-based in feature, 0-based internally).
8. **Always end with an assertion.** A success-only flow that never asserts can pass with a silently-failed submit. Use `confirmation message is displayed` or `URL should contain "..."`.
9. **Tags drive reporting.** Use `@smoke`, `@regression`, `@Positive`, `@Negative`, `@StatusCode200` so the report groups scenarios.

---

## 5. Anti-patterns (will not auto-generate cleanly)

| ❌ Don't write | ✅ Write instead | Why |
|---|---|---|
| `the user does the contact form` | explicit per-field `fills X from test data` | No verb keyword |
| `click the third button on the page` | `clicks the Submit button` | Use the label, not positional |
| `verify everything works` | `the confirmation message is displayed` | Vague assertion |
| `fill in all the fields` | one `fills X from test data` per field | The agent maps one step → one field |
| `select option 2 in dropdown` | `selects "KONA" from "Model" dropdown` | Use the visible option text |

---

## 6. Running the pipeline

```powershell
# Full pipeline: fetch → DOM-inspect → generate steps → run → upload report
npm run agent:run

# Skip fetch + generate (run existing features against existing steps)
node scripts/agentOrchestrator.js --skip-fetch --skip-generate

# Run a single feature file directly
npx cucumber-js features/cucumber/Test_Fleet_Ticket.feature

# Headless toggle
$env:HEADLESS="false"   # show browser
$env:HEADLESS="true"    # default
```

---

## 7. Where to add a new generic verb

If a feature uses a verb the agent doesn't yet handle:

1. **Fast path** — add a regex matcher + emitter to
   [`scripts/stepPatternLibrary.js`](scripts/stepPatternLibrary.js). Patterns are
   checked before the generic categorizer.
2. **Generic path** — add a category to `categorizeStep()` in
   [`scripts/generateStepDefs.js`](scripts/generateStepDefs.js) and a
   corresponding `case` in `generateStepBody()` that calls a World helper.
3. **Helper** — if no existing helper fits, add one to
   [`features/cucumber/support/world.js`](features/cucumber/support/world.js)
   that uses `autoHeal` + builders from
   [`utils/autoHealLocator.js`](utils/autoHealLocator.js).

This three-layer split (pattern library → categorizer → World helper) is what
keeps step generation generic across any feature file.
