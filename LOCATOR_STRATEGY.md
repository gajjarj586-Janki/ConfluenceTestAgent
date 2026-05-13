# Locator Strategy

How the agent finds elements on the page — and what it does when a locator stops working.

---

## Overview

The agent uses a **5-layer locator system**. Each layer acts as a fallback for the one before it. At runtime, the engine tries selectors one by one until something matches — without ever hard-coding a single brittle CSS class or XPath.

```
Layer 1 → LOC dictionary       (shared named constants)
Layer 2 → Attribute wildcards  (name*, id*, placeholder* with i flag)
Layer 3 → Text-based selectors (button text, label text, aria-label)
Layer 4 → Auto-Heal engine     (ranked fallback list tried at runtime)
Layer 5 → DOM walk             (page.evaluate() for popup / no-class elements)
```

---

## Layer 1 — LOC Dictionary (contact_us.steps.js)

Shared forms (Contact Us, CAD, BATD) store all their selectors in one `LOC` object at the top of the file. Each entry is a **comma-separated multi-selector** — Playwright tries them left to right and uses the first match found.

```js
const LOC = {
  form: {
    firstNameInput:
      'input[name*="FirstName" i], ' +
      'input[name*="first_name" i], ' +
      'input[id*="firstName" i], ' +
      'input[placeholder*="First name" i]',

    emailInput:
      'input[name*="Email" i], ' +
      'input[type="email"], ' +
      'input[id*="email" i]',

    titleDropdown:
      'select[name*="Title" i], ' +
      'select[name*="salutation" i], ' +
      'select[id*="title" i]',
  },
  submitButton:
    'button[type="submit"]:has-text("Send Enquiry"), ' +
    'button:has-text("Send Enquiry")',
};
```

Changing or adding a selector here automatically applies it everywhere in the test suite.

---

## Layer 2 — Attribute Wildcards (`*=`) with Case-Insensitive Flag

The `*=` CSS operator matches any attribute **containing** the given string. Adding ` i` makes it case-insensitive.

This means locators survive common HTML changes like renaming `id="emailAddress"` → `id="userEmail"` — as long as "email" is still somewhere in the attribute.

| Selector | Matches |
|---|---|
| `input[name*="vin" i]` | `name="vinNumber"`, `name="VIN"`, `name="vin_input"` |
| `input[id*="first" i]` | `id="firstName"`, `id="first-name"`, `id="firstNameField"` |
| `select[id*="state" i]` | `id="stateSelect"`, `id="State"`, `id="au-state"` |
| `input[placeholder*="suburb" i]` | Any placeholder containing "suburb" |
| `[aria-label*="check" i]` | Any aria-label containing "check" |

---

## Layer 3 — Text-Based & ARIA Selectors

Buttons and labels have unpredictable classes (and sometimes none at all), so they are found by **visible text** or **ARIA label**:

```js
// Playwright :has-text() — element that contains this text anywhere
'button:has-text("Check")'
'button:has-text("Submit")'
'label:has-text("Yes")'

// .filter({ hasText }) — same idea via Playwright's filter API
page.locator('button:visible').filter({ hasText: buttonText }).first()

// ARIA label — most stable when present; checked first
'[aria-label="Enter your VIN"]'      // exact
'[aria-label*="check" i]'            // partial, case-insensitive
```

Buttons are found by what they say, not by what they look like — so visual redesigns don't break the tests.

---

## Layer 4 — Auto-Heal Engine (runtime fallback)

This is the most powerful layer. It lives in `utils/autoHealLocator.js` and is available in every step via `this.findElement()`, `this.fillField()`, `this.clickButton()` etc.

### How it works at runtime

When a step calls `await this.fillField('email', value)`:

1. `buildFieldSelectors('email')` generates a **ranked list** of selectors from a known-field dictionary
2. The `autoHeal()` engine tries each selector in order with a short timeout (3 s each)
3. The **first selector that finds a visible element** wins
4. If a fallback (non-primary) selector was used → it is logged as `🔧 Auto-heal` and written to `.cache/healed-locators.json`

```
Step calls: this.fillField('email', 'test@example.com')
                │
                ▼
buildFieldSelectors('email') returns:
  [1] input[type="email"]              ← try this first
  [2] input[name*="email" i]           ← if #1 not found
  [3] input[id*="email" i]             ← if #2 not found
  [4] input[placeholder*="email" i]    ← if #3 not found
  [5] input[aria-label*="email" i]     ← last resort
                │
                ▼
autoHeal() tries #1 → found → fills field → done
(or) tries #1 → not found → tries #2 → found → logs heal → fills field
```

### Known-field dictionary (in `autoHealLocator.js`)

The dictionary maps plain-English hints to ranked selector lists. Examples:

| Hint | Selectors tried (in order) |
|---|---|
| `'email'` | `input[type="email"]` → `input[name*="email" i]` → `input[id*="email" i]` → `input[placeholder*="email" i]` → `input[aria-label*="email" i]` |
| `'vin'` | `[aria-label="Enter your VIN"]` → `input[name*="vin" i]` → `input[id*="vin" i]` → `input[placeholder*="VIN" i]` |
| `'first name'` | `input[name*="FirstName" i]` → `input[name*="first" i]` → `input[id*="first" i]` → `input[placeholder*="first" i]` → `input[aria-label*="first name" i]` |
| `'state'` | `select[name*="state" i]` → `select[id*="state" i]` → `select[aria-label*="state" i]` → `input[name*="state" i]` |
| `'postcode'` | `input[name*="postcode" i]` → `input[name*="zip" i]` → `input[id*="postcode" i]` → `input[placeholder*="postcode" i]` |

If the hint is not in the dictionary, the engine **generates selectors dynamically** from the hint words:
```js
// hint = "referral code" (not in dictionary)
// generates:
'input[name*="referral code" i]'
'input[id*="referral code" i]'
'input[placeholder*="referral code" i]'
'input[aria-label*="referral code" i]'
'[name*="referral" i]'    ← first word only
'[id*="referral" i]'
```

### World helpers available in every step

| Method | What it does |
|---|---|
| `this.fillField('email', value)` | Find input by hint + fill |
| `this.findButton('Submit')` | Find button by label |
| `this.clickButton('Submit')` | Find + scroll + click button |
| `this.selectDropdown('state', 'NSW')` | Find select by hint + pick option |
| `this.setCheckbox('privacy', true)` | Find checkbox by hint + check/uncheck |
| `this.findElement('vin', 'input')` | Raw find — returns `{ locator, selector, healed }` |
| `this.isVisible('email')` | Returns `true/false`, never throws |

### Healed locator log

When a fallback selector is used instead of the primary, the agent writes a record to `.cache/healed-locators.json`:

```json
[
  {
    "hint": "email",
    "primary": "input[type=\"email\"]",
    "healed": "input[name*=\"email\" i]",
    "stepContext": "the user fills in the contact form",
    "timestamp": "2026-04-15T03:22:10.000Z"
  }
]
```

This lets developers see exactly which selectors changed and update the primary locators accordingly.

---

## Layer 5 — DOM Walk via `page.evaluate()` (popup / no-anchor elements)

Some elements have no unique ID, class, or ARIA role. The Ownership confirmation popup is the main example — its CSS class (`confirmation`) also exists on outer page containers, so CSS selectors give false matches.

The agent solves this with a **JavaScript DOM traversal** run directly in the browser:

```js
await this.page.evaluate(() => {
  // 1. Find the shallowest element that contains ONLY the popup text
  const allEls = Array.from(document.querySelectorAll('*'));
  const confirmNode = allEls.find(el =>
    el.children.length < 8 &&
    el.innerText.includes('Please confirm you are the owner')
  );

  // 2. Walk up ancestor tree until finding a button scoped inside that container
  let container = confirmNode;
  for (let i = 0; i < 8; i++) {
    const btn = container.querySelector('button[type="submit"], button');
    if (btn && btn.offsetParent !== null) {   // offsetParent != null = visible
      btn.click();
      return `clicked "${btn.textContent.trim()}" at depth ${i}`;
    }
    if (!container.parentElement) break;
    container = container.parentElement;
  }
});
```

**Why not use CSS?** `document.querySelector('[class*="confirmation"]')` matches both the popup and the outer section wrapper — clicking the wrong button submits nothing. The DOM walk anchors to the text content, which is unique.

---

## Wait Strategy (paired with every locator)

Finding an element is not enough — it must be in the right **state** before interaction. The agent uses `waitForSelector` with `{ state: 'visible' }` on real DOM signals, not fixed `setTimeout` delays:

| Action | Wait signal |
|---|---|
| After clicking "Check" VIN | `waitForSelector('label:has-text("Yes")', { state: 'visible' })` |
| After clicking "Yes" | `waitForSelector('input[name*="first" i]', { state: 'visible' })` |
| After clicking "Submit" | `waitForFunction(() => !body.innerText.includes('Please confirm'))` |
| After popup Submit click | `waitForFunction(() => modal.offsetParent === null)` |

This means tests react to actual page state — if the server is slow the test simply waits (up to the timeout), and if the element appears early the test moves immediately without wasting time.

---

## Locator Priority Summary

```
Most reliable
     │
     │  1. [aria-label="Enter your VIN"]     exact ARIA — best
     │  2. input[type="email"]               semantic HTML type
     │  3. input[name*="FirstName" i]        name attribute wildcard
     │  4. input[id*="firstName" i]          id attribute wildcard
     │  5. input[placeholder*="First" i]     placeholder wildcard
     │  6. button:has-text("Submit")         visible button text
     │  7. label:has-text("Yes")             label text
     │  8. DOM walk (page.evaluate)          text-content anchor
     │
Least reliable (not used)
     │
     ✗  div.abc-123__field-input            generated class names
     ✗  /html/body/div[3]/form/input[2]     fragile XPath
     ✗  #app > section > div:nth-child(4)   position-based CSS
```
