const SUBMIT_SELECTORS = [
  'form#form-ryi-form button[type="submit"]',
  'form#form-ryi-form input[type="submit"]',
  '.cp-ryi__form button[type="submit"]',
  '.cp-ryi__form button:has-text("Submit")',
  'form button[type="submit"]',
  'form input[type="submit"]',
  'button[type="submit"]',
  'button:has-text("Submit")',
  'button:has-text("Send Enquiry")',
  'button:has-text("Book a test drive")',
  'input[type="submit"]',
];

const SUCCESS_SELECTORS = [
  '.thank-you',
  '.thank-you h1',
  '[class*="thank-you"]',
  '[class*="success"]',
  '[class*="confirmation"]',
];

const ERROR_SELECTORS = [
  '[role="alert"]',
  '.error-message',
  '.validation-error',
  '[class*="error"]',
  '[class*="validation"]',
];

const FIELD_SELECTOR_MAP = {
  'last name': [
    'input[name="lastName"]',
    'input#lastName',
    'input[name*="LastName" i]',
    'input[name*="lastName" i]',
    'input[name*="last_name" i]',
    'input[id*="LastName" i]',
    'input[id*="lastName" i]',
    'input[placeholder*="Last Name" i]',
    'input[placeholder*="Last name" i]',
    'input[aria-label*="Last Name" i]',
  ],
  'first name': [
    'input[name="firstName"]',
    'input#firstName',
    'input[name*="FirstName" i]',
    'input[name*="firstName" i]',
    'input[name*="first_name" i]',
    'input[id*="FirstName" i]',
    'input[id*="firstName" i]',
    'input[placeholder*="First Name" i]',
    'input[placeholder*="First name" i]',
    'input[aria-label*="First Name" i]',
  ],
  email: [
    'input[name="email"]',
    'input#email',
    'input[name*="Email" i]',
    'input[type="email"]',
    'input[id*="email" i]',
    'input[placeholder*="Email" i]',
  ],
  'contact number': [
    'input[name="mobile"]',
    'input#mobile',
    'input[name*="Phone" i]',
    'input[name*="Mobile" i]',
    'input[name*="mobile" i]',
    'input[type="tel"]',
    'input[id*="phone" i]',
    'input[id*="mobile" i]',
    'input[placeholder*="Phone" i]',
    'input[placeholder*="Mobile" i]',
    'input[aria-label*="Phone" i]',
  ],
  'postal code': [
    'input[name="postCode"]',
    'input#inpCode1',
    'input[name*="Postcode" i]',
    'input[name*="Postal" i]',
    'input[name*="postCode" i]',
    'input[id*="postcode" i]',
    'input[placeholder*="Postcode" i]',
    'input[placeholder*="Postal" i]',
    'input[aria-label*="Postcode" i]',
  ],
  address: [
    'input[name*="Address" i]',
    'input[id*="address" i]',
    'input[placeholder*="Address" i]',
    'textarea[name*="Address" i]',
    'textarea[placeholder*="Address" i]',
  ],
  vin: [
    'input[name*="VIN" i]',
    'input[id*="vin" i]',
    'input[placeholder*="VIN" i]',
  ],
  'registration number': [
    'input[name*="Registration" i]',
    'input[id*="registration" i]',
    'input[placeholder*="Registration" i]',
    'input[name*="rego" i]',
    'input[id*="rego" i]',
  ],
  'preferred date': [
    'input[type="date"]',
    'input[name*="Date" i]',
    'input[id*="date" i]',
    'input[placeholder*="Date" i]',
  ],
};

const SELECT_SELECTOR_MAP = {
  'vehicle selection': [
    'select[name*="Vehicle" i]',
    'select[name*="Model" i]',
    'select[id*="vehicle" i]',
    'select[id*="model" i]',
  ],
  'time purchase dropdown': [
    'select[name*="Purchase" i]',
    'select[id*="purchase" i]',
    'select:has(option:has-text("Within 3 months"))',
  ],
  'preferred contact method': [
    'select[name*="Contact" i]',
    'select[id*="contact" i]',
  ],
};

const CHECKBOX_SELECTOR_MAP = {
  'terms and conditions': [
    'input[type="checkbox"][name*="terms" i]',
    'input[type="checkbox"][id*="terms" i]',
    'input[type="checkbox"][name*="privacy" i]',
    'input[type="checkbox"][id*="privacy" i]',
    'input[type="checkbox"][name*="consent" i]',
  ],
};

const DEFAULT_GENESIS_DATA = {
  common: {
    'First Name': 'Janki',
    'Last Name': 'TheTester',
    'Email': 'TheTester@orchard.com.au',
    'Postal Code': '2000',
    'Terms and Conditions': 'Checked',
  },
  bookatestdrive: {
    'Vehicle Selection': 'GV60',
    'Contact Number': '0431667796',
    'Preferred Contact Method': 'Email',
    'Time Purchase Dropdown': 'Within 3 months',
  },
  generalenquiry: {
    'Type of Sub Enquiry': '__FIRST__',
    'Vehicle Selection': 'GV60',
    'Address': '123 Test Street, Sydney',
    'Time Purchase Dropdown': 'Within 3 months',
  },
  downloadebrochure: {
    'Vehicle Selection': 'GV60',
    'Time Purchase Dropdown': 'Within 3 months',
  },
  bookaservice: {
    'Contact Number': '0431667796',
    'VIN': 'KMHLT4AG1NU000001',
    'Registration Number': 'ABC123',
    'Preferred Date': '2026-08-15',
  },
  subscribe: {
    'Contact Number': '0431667796',
    'Preferred Contact Method': 'Email',
    'Time Purchase Dropdown': 'Within 3 months',
  },
  ryi: {
    'Contact Number': '0431667796',
    'Preferred Contact Method': 'Email',
  },
};

function normalizeFieldName(fieldName) {
  return String(fieldName || '').trim().toLowerCase();
}

function detectGenesisFormType(url) {
  const value = String(url || '').toLowerCase();
  if (value.includes('#bookatestdrive')) return 'bookatestdrive';
  if (value.includes('#generalenquiry')) return 'generalenquiry';
  if (value.includes('#downloadebrochure')) return 'downloadebrochure';
  if (value.includes('/book-a-service')) return 'bookaservice';
  if (value.includes('/subscribe')) return 'subscribe';
  if (value.includes('/gv60-magma-teaser')) return 'ryi';
  return 'common';
}

function mergeDefaultGenesisData(entries, url, excludedFields = []) {
  const excluded = new Set(excludedFields.map((field) => normalizeFieldName(field)));
  const provided = new Map();

  for (const [fieldName, rawValue] of entries) {
    const normalizedField = normalizeFieldName(fieldName);
    if (!normalizedField || (normalizedField === 'field' && /^value$/i.test(String(rawValue || '').trim()))) {
      continue;
    }
    provided.set(fieldName, rawValue == null ? '' : String(rawValue).trim());
  }

  const formType = detectGenesisFormType(url);
  const merged = new Map();
  const defaults = {
    ...DEFAULT_GENESIS_DATA.common,
    ...(DEFAULT_GENESIS_DATA[formType] || {}),
  };

  for (const [fieldName, value] of Object.entries(defaults)) {
    if (excluded.has(normalizeFieldName(fieldName))) {
      continue;
    }
    merged.set(fieldName, value);
  }

  for (const [fieldName, value] of provided.entries()) {
    if (excluded.has(normalizeFieldName(fieldName))) {
      continue;
    }
    merged.set(fieldName, value);
  }

  return Array.from(merged.entries());
}

function buildFieldPattern(fieldName) {
  const escaped = String(fieldName || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(${escaped}|required|invalid|please\\s+(enter|select)|must\\s+be)`, 'i');
}

async function firstVisibleLocator(root, selectors) {
  for (const selector of selectors) {
    const locator = root.locator(selector);
    const count = await locator.count();
    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      if (await candidate.isVisible().catch(() => false)) {
        return candidate;
      }
    }
  }
  return null;
}

async function findFieldLocator(page, fieldName) {
  const selectors = FIELD_SELECTOR_MAP[normalizeFieldName(fieldName)] || [];
  return firstVisibleLocator(page, selectors);
}

async function fillLocator(locator, value) {
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  await locator.fill('');
  await locator.fill(String(value));
}

async function selectLocatorOption(locator, value) {
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  await locator.selectOption({ label: String(value) }).catch(async () => {
    await locator.selectOption({ value: String(value) }).catch(async () => {
      const options = await locator.locator('option').allTextContents().catch(() => []);
      const matched = options.find((option) => option.trim().toLowerCase() === String(value).trim().toLowerCase());
      if (matched) {
        await locator.selectOption({ label: matched }).catch(() => {});
      }
    });
  });
}

async function setCheckboxValue(locator, desiredValue) {
  const shouldCheck = !/^(false|no|unchecked)$/i.test(String(desiredValue || 'checked'));
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  const isChecked = await locator.isChecked().catch(() => false);
  if (shouldCheck === isChecked) {
    return;
  }

  const label = locator.locator('xpath=ancestor::label[1]').first();
  if ((await label.count()) > 0 && (await label.isVisible().catch(() => false))) {
    await label.click({ force: true }).catch(() => {});
  } else {
    await locator.evaluate((element) => element.click()).catch(() => {});
  }
}

async function locatorFromLabel(page, fieldName) {
  const labelLocator = page.getByLabel(fieldName, { exact: false }).first();
  if ((await labelLocator.count()) > 0 && (await labelLocator.isVisible().catch(() => false))) {
    return labelLocator;
  }
  return null;
}

function buildWordSelectors(fieldName, tags) {
  const words = normalizeFieldName(fieldName).split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [];
  }

  return tags.map((tag) => `${tag}[name*="${words[0]}" i], ${tag}[id*="${words[0]}" i], ${tag}[placeholder*="${words[0]}" i], ${tag}[aria-label*="${fieldName}" i]`);
}

async function trySetRadioOrTextOption(page, fieldName, value) {
  const optionText = String(value);

  // Pattern 1: input is INSIDE the label (label:has-text > input)
  const radio = page.locator(`label:has-text("${optionText}") input[type="radio"], label:has-text("${optionText}") input[type="checkbox"]`).first();
  if ((await radio.count()) > 0 && (await radio.isVisible().catch(() => false))) {
    await radio.evaluate((element) => element.click()).catch(() => {});
    return true;
  }

  // Pattern 2: input is a SIBLING of the label (label[for] → radio/checkbox input)
  // Filter labels to only those whose associated input is a radio or checkbox
  const allSiblingLabels = page.locator(`label:has-text("${optionText}")`);
  const labelCount = await allSiblingLabels.count().catch(() => 0);
  for (let i = 0; i < labelCount; i += 1) {
    const labelEl = allSiblingLabels.nth(i);
    const forAttr = await labelEl.getAttribute('for').catch(() => '');
    if (!forAttr) {
      continue;
    }
    const associatedInput = page.locator(`#${forAttr}`).first();
    const inputType = await associatedInput.getAttribute('type').catch(() => '');
    if (inputType === 'radio' || inputType === 'checkbox') {
      // Only click visible inputs — the page may have multiple tab sections each
      // containing a similarly-named checkbox (only one tab's checkbox is visible)
      const inputVisible = await associatedInput.isVisible().catch(() => false);
      if (inputVisible) {
        await associatedInput.evaluate((element) => element.click()).catch(() => {});
        return true;
      }
    }
  }

  // Pattern 3: click the first VISIBLE matching label via JS eval
  for (let i = 0; i < labelCount; i += 1) {
    const labelEl = allSiblingLabels.nth(i);
    if (await labelEl.isVisible().catch(() => false)) {
      await labelEl.evaluate((element) => element.click()).catch(() => {});
      return true;
    }
  }

  // Pattern 4: last resort — getByText match (handles non-label wrappers on some forms)
  // Use JS eval click (not coordinate-based) to avoid triggering link navigation
  const textMatch = page.getByText(optionText, { exact: false }).first();
  if ((await textMatch.count()) > 0 && (await textMatch.isVisible().catch(() => false))) {
    await textMatch.evaluate((element) => element.click()).catch(() => {});
    return true;
  }

  return false;
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function clickBestTextMatch(page, text, options = {}) {
  const pattern = options.exact
    ? new RegExp(`^${escapeRegExp(text)}$`, 'i')
    : new RegExp(escapeRegExp(text), 'i');
  const locator = page.getByText(pattern).locator('visible=true');
  const count = await locator.count().catch(() => 0);
  let best = null;

  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    const visible = await candidate.isVisible().catch(() => false);
    if (!visible) {
      continue;
    }

    const box = await candidate.boundingBox().catch(() => null);
    if (!box) {
      continue;
    }

    const score = (options.preferLowerPage ? box.y : -box.y) + (box.width * 0.001);
    if (!best || score > best.score) {
      best = { candidate, score };
    }
  }

  if (!best) {
    return false;
  }

  await best.candidate.scrollIntoViewIfNeeded().catch(() => {});
  await best.candidate.click({ force: true }).catch(async () => {
    await best.candidate.evaluate((element) => element.click()).catch(() => {});
  });
  return true;
}

async function handleSpecialGenesisField(page, fieldName, value, scope = page) {
  const normalizedField = normalizeFieldName(fieldName);

  if (normalizedField === 'vehicle selection') {
    const formScope = '.cp-contact-us__form-fields';
    const clickableSelectors = [
      `${formScope} .swiper-slide:has-text("${value}")`,
      `${formScope} .vehicle-selection__tab-title:has-text("${value}")`,
      `${formScope} .vehicle-name:has-text("${value}")`,
      `${formScope} [class*="vehicle"]:has-text("${value}")`,
      `${formScope} [class*="model"]:has-text("${value}")`,
    ];

    // Try clicking directly first
    let target = await firstVisibleLocator(page, clickableSelectors);
    if (target) {
      await target.scrollIntoViewIfNeeded().catch(() => {});
      await target.click({ force: true }).catch(async () => {
        await target.evaluate((element) => element.click()).catch(() => {});
      });
      return true;
    }

    // If not found, navigate the swiper to find the vehicle
    const swiperNextSelectors = [
      `${formScope} .swiper-button-next`,
      `${formScope} [class*="swiper"] .swiper-button-next`,
      '.vehicle-selection .swiper-button-next',
    ];
    const swiperPaginationDots = `${formScope} .swiper-pagination-bullet`;

    // Try clicking swiper next buttons up to 6 times
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const nextBtn = await firstVisibleLocator(page, swiperNextSelectors);
      if (nextBtn) {
        await nextBtn.click({ force: true }).catch(() => {});
        await page.waitForTimeout(400);
      } else {
        // Try pagination dots
        const dots = page.locator(swiperPaginationDots);
        const dotCount = await dots.count();
        if (attempt < dotCount) {
          await dots.nth(attempt).click({ force: true }).catch(() => {});
          await page.waitForTimeout(400);
        }
      }

      target = await firstVisibleLocator(page, clickableSelectors);
      if (target) {
        await target.scrollIntoViewIfNeeded().catch(() => {});
        await target.click({ force: true }).catch(async () => {
          await target.evaluate((element) => element.click()).catch(() => {});
        });
        return true;
      }
    }

    // Last resort: use evaluate to find and click within the form DOM directly
    const clicked = await page.evaluate((vehicleName) => {
      const formFields = document.querySelector('.cp-contact-us__form-fields');
      if (!formFields) return false;
      const slides = formFields.querySelectorAll('.swiper-slide');
      for (const slide of slides) {
        if (slide.textContent.trim().toLowerCase().includes(vehicleName.toLowerCase())) {
          slide.click();
          return true;
        }
      }
      return false;
    }, value);

    return clicked;
  }

  if (normalizedField === 'time purchase dropdown') {
    const normalizedValue = /^within\s+3\s+months$/i.test(String(value))
      ? 'In the next few months'
      : String(value);
    const triggerSelectors = [
      '.dropdown-container[data-dropdown-name="purchaseTimeline"] .cm-select__placeholder',
      '.dropdown-container[data-dropdown-name="purchaseTimeline"] .cm-select',
      'select[name*="Purchase" i]',
      'select[id*="purchase" i]',
      '[role="combobox"]',
      '[aria-haspopup="listbox"]',
      'a.cm-select__placeholder:has-text("Select Expected Purchase Schedule")',
    ];

    const selectLike = await firstVisibleLocator(page, triggerSelectors);
    if (selectLike) {
      const tagName = await selectLike.evaluate((element) => element.tagName.toLowerCase()).catch(() => 'div');
      if (tagName === 'select') {
        await selectLocatorOption(selectLike, normalizedValue);
        return true;
      }

      await selectLike.scrollIntoViewIfNeeded().catch(() => {});
      await selectLike.click({ force: true }).catch(async () => {
        await selectLike.evaluate((element) => element.click()).catch(() => {});
      });
      await page.waitForTimeout(300);
      const optionLocator = await firstVisibleLocator(page, [
        `.cm-select__options a[role="option"]:has-text("${normalizedValue}")`,
        `.cm-select__options [role="option"]:has-text("${normalizedValue}")`,
      ]);
      if (optionLocator) {
        await optionLocator.click({ force: true }).catch(async () => {
          await optionLocator.evaluate((element) => element.click()).catch(() => {});
        });
        return true;
      }

      if (normalizedValue === '__FIRST__') {
        const firstOption = await firstVisibleLocator(page, [
          '.cm-select__options li[role="presentation"] a[role="option"]',
          '.cm-select__options a[role="option"]',
        ]);
        if (firstOption) {
          await firstOption.click({ force: true }).catch(async () => {
            await firstOption.evaluate((element) => element.click()).catch(() => {});
          });
          return true;
        }
      }

      if (await clickBestTextMatch(page, normalizedValue, { exact: false, preferLowerPage: true })) {
        return true;
      }
    }

    return false;
  }

  if (normalizedField === 'type of sub enquiry') {
    const trigger = await firstVisibleLocator(page, [
      '.dropdown-container[data-dropdown-name*="sub" i] .cm-select__placeholder',
      '.dropdown-container[data-dropdown-name*="sub" i] .cm-select',
      'a.cm-select__placeholder:has-text("Select Sub Enquiry Type")',
    ]);
    if (!trigger) {
      return false;
    }

    await trigger.click({ force: true }).catch(async () => {
      await trigger.evaluate((element) => element.click()).catch(() => {});
    });
    await page.waitForTimeout(300);

    if (value === '__FIRST__') {
      const firstOption = await firstVisibleLocator(page, [
        '.cm-select__options li[role="presentation"] a[role="option"]',
        '.cm-select__options a[role="option"]',
      ]);
      if (firstOption) {
        await firstOption.click({ force: true }).catch(async () => {
          await firstOption.evaluate((element) => element.click()).catch(() => {});
        });
        return true;
      }
    }

    return clickBestTextMatch(page, value, { exact: false, preferLowerPage: true });
  }

  if (normalizedField === 'preferred contact method') {
    return trySetRadioOrTextOption(scope, fieldName, value);
  }

  if (normalizedField === 'terms and conditions') {
    const checked = await trySetRadioOrTextOption(scope, fieldName, /checked/i.test(value) ? 'I have read the terms agreement' : value);
    if (checked) {
      return true;
    }

    const termsCheckbox = await firstVisibleLocator(scope, [
      'input[type="checkbox"][name*="terms" i]',
      'input[type="checkbox"][id*="terms" i]',
      'input[type="checkbox"][name*="agreement" i]',
      'input[type="checkbox"][id*="agreement" i]',
      'input[type="checkbox"][name*="consent" i]',
    ]);
    if (termsCheckbox) {
      await setCheckboxValue(termsCheckbox, value);
      return true;
    }
  }

  return false;
}

export async function fillGenesisFieldsFromDataTable(page, dataTable, options = {}) {
  const entries = typeof dataTable?.rowsHash === 'function'
    ? Object.entries(dataTable.rowsHash())
    : Array.isArray(dataTable)
      ? dataTable
      : Object.entries(dataTable || {});

  const mergedEntries = mergeDefaultGenesisData(entries, page.url(), options.excludeFields || []);
  const formRoot = await firstVisibleLocator(page, ['form#form-ryi-form', '.cp-ryi__form']) || page;

  for (const [fieldName, rawValue] of mergedEntries) {
    const normalizedField = normalizeFieldName(fieldName);
    const value = rawValue == null ? '' : String(rawValue).trim();
    if (!normalizedField || (normalizedField === 'field' && /^value$/i.test(value))) {
      continue;
    }

    if (await handleSpecialGenesisField(page, fieldName, value, formRoot)) {
      continue;
    }

    const checkboxSelectors = CHECKBOX_SELECTOR_MAP[normalizedField] || [];
    if (checkboxSelectors.length > 0) {
      const checkbox = await firstVisibleLocator(formRoot, checkboxSelectors);
      if (checkbox) {
        await setCheckboxValue(checkbox, value || 'Checked');
        continue;
      }
    }

    const selectSelectors = SELECT_SELECTOR_MAP[normalizedField] || [];
    if (selectSelectors.length > 0) {
      const select = await firstVisibleLocator(formRoot, selectSelectors);
      if (select) {
        await selectLocatorOption(select, value);
        continue;
      }
      if (await trySetRadioOrTextOption(formRoot, fieldName, value)) {
        continue;
      }
    }

    const mappedField = await findFieldLocator(formRoot, fieldName);
    if (mappedField) {
      await fillLocator(mappedField, value);
      continue;
    }

    const labeledField = await locatorFromLabel(formRoot, fieldName);
    if (labeledField) {
      const tagName = await labeledField.evaluate((element) => element.tagName.toLowerCase()).catch(() => 'input');
      if (tagName === 'select') {
        await selectLocatorOption(labeledField, value);
      } else if (tagName === 'input' || tagName === 'textarea') {
        await fillLocator(labeledField, value);
      }
      continue;
    }

    const genericTextField = await firstVisibleLocator(formRoot, buildWordSelectors(fieldName, ['input', 'textarea']));
    if (genericTextField) {
      await fillLocator(genericTextField, value);
      continue;
    }

    const genericSelect = await firstVisibleLocator(formRoot, buildWordSelectors(fieldName, ['select']));
    if (genericSelect) {
      await selectLocatorOption(genericSelect, value);
      continue;
    }

    console.warn(`⚠️ Unable to resolve Genesis field: ${fieldName}`);
  }

  await page.waitForTimeout(500);
  return Object.fromEntries(mergedEntries);
}

async function visibleTextMatches(page, text) {
  const locator = page.getByText(text, { exact: false });
  const matches = [];
  const count = await locator.count();

  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    const visible = await candidate.isVisible().catch(() => false);
    if (!visible) {
      continue;
    }

    const candidateText = (await candidate.textContent().catch(() => ''))?.trim();
    if (candidateText) {
      matches.push(candidateText);
    }
  }

  return matches;
}

async function successState(page) {
  const result = { successVisible: false, successText: '' };

  const successLocator = await firstVisibleLocator(page, SUCCESS_SELECTORS);
  if (successLocator) {
    result.successVisible = true;
    result.successText = ((await successLocator.textContent().catch(() => '')) || '').trim();
    return result;
  }

  const textMatches = await visibleTextMatches(page, /thank you|confirmation|submitted|we.?ll be in touch|received your/i);
  if (textMatches.length > 0) {
    result.successVisible = true;
    result.successText = textMatches[0];
  }

  return result;
}

async function confirmGenesisSubmitIfPrompted(page) {
  // First check for DOM-based modals
  const modalSelectors = [
    '.modal:has-text("confirm and submit")',
    '.popup:has-text("confirm and submit")',
    '[role="dialog"]:has-text("confirm and submit")',
    '.modal:has-text("Would you like to confirm")',
    '.popup:has-text("Would you like to confirm")',
    '[role="dialog"]:has-text("Would you like to confirm")',
    '[class*="popup"]:has-text("confirm and submit")',
    '[class*="modal"]:has-text("confirm and submit")',
    '[class*="layer"]:has-text("confirm and submit")',
    '[class*="popup"]:has-text("Would you like to confirm")',
    '[class*="modal"]:has-text("Would you like to confirm")',
    '[class*="layer"]:has-text("Would you like to confirm")',
  ];

  const modal = await firstVisibleLocator(page, modalSelectors);
  if (modal) {
    const confirmButton = await firstVisibleLocator(modal, [
      'button:has-text("OK")',
      'button:has-text("Confirm")',
      'button:has-text("Yes")',
      'a:has-text("OK")',
      'a:has-text("Confirm")',
    ]);

    if (confirmButton) {
      await confirmButton.scrollIntoViewIfNeeded().catch(() => {});
      await confirmButton.click({ force: true }).catch(async () => {
        await confirmButton.evaluate((element) => element.click()).catch(() => {});
      });
      await page.waitForTimeout(1500);
      return true;
    }
  }

  // Also check for any visible overlay with OK/Confirm buttons containing "confirm"
  const okButton = await firstVisibleLocator(page, [
    'button:has-text("OK")',
    'a:has-text("OK")',
  ]);
  if (okButton) {
    const parentText = await okButton.evaluate((el) => {
      let current = el.parentElement;
      let depth = 0;
      while (current && depth < 5) {
        const text = (current.textContent || '').toLowerCase();
        if (text.includes('confirm') || text.includes('submit your enquiry')) {
          return text.slice(0, 200);
        }
        current = current.parentElement;
        depth += 1;
      }
      return '';
    }).catch(() => '');

    if (parentText) {
      await okButton.scrollIntoViewIfNeeded().catch(() => {});
      await okButton.click({ force: true }).catch(async () => {
        await okButton.evaluate((element) => element.click()).catch(() => {});
      });
      await page.waitForTimeout(1500);
      return true;
    }
  }

  return false;
}

// URL normalization: some Confluence feature files reference embedded tab forms
// (e.g. contact-us.html#bookatestdrive) which fail at the API level because the
// server rejects the formId. Map these to their correct standalone page URLs.
const GENESIS_URL_OVERRIDES = {
  '/support/contact-us.html#bookatestdrive': '/shopping/book-a-test-drive.html#bookatestdrive',
};

function normalizeGenesisUrl(url) {
  for (const [from, to] of Object.entries(GENESIS_URL_OVERRIDES)) {
    if (url.includes(from)) {
      return url.replace(from, to);
    }
  }
  return url;
}

export async function navigateToGenesisForm(page, url) {
  const resolvedUrl = normalizeGenesisUrl(url);
  if (resolvedUrl !== url) {
    console.log(`🔀 URL redirected: ${url} → ${resolvedUrl}`);
  }
  await page.goto(resolvedUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

  const readySelectors = [
    ...SUBMIT_SELECTORS,
    'form',
    'input',
    'textarea',
    'select',
  ];

  for (const selector of readySelectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) > 0) {
      await locator.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
      break;
    }
  }

  if (/\/gv60-magma-teaser/i.test(url)) {
    const ryiForm = page.locator('form#form-ryi-form, .cp-ryi__form').first();
    await ryiForm.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    await ryiForm.scrollIntoViewIfNeeded().catch(() => {});
  }

  await page.waitForTimeout(1000);
}

export async function clickSubmitAndCapture(page, preferredFieldName) {
  const urlBefore = page.url();
  const ryiForm = await firstVisibleLocator(page, ['form#form-ryi-form', '.cp-ryi__form']);
  const formRoot = ryiForm || page;
  const targetField = preferredFieldName ? await findFieldLocator(formRoot, preferredFieldName) : null;

  let submitButton = null;
  if (ryiForm) {
    submitButton = await firstVisibleLocator(ryiForm, SUBMIT_SELECTORS);
  }

  if (targetField) {
    const parentForm = targetField.locator('xpath=ancestor::form[1]').first();
    if ((await parentForm.count()) > 0) {
      submitButton = await firstVisibleLocator(parentForm, SUBMIT_SELECTORS);
    }

    if (!submitButton) {
      const parentSection = targetField.locator('xpath=ancestor::*[self::section or self::div][1]').first();
      if ((await parentSection.count()) > 0) {
        submitButton = await firstVisibleLocator(parentSection, SUBMIT_SELECTORS);
      }
    }
  }

  if (!submitButton) {
    submitButton = await firstVisibleLocator(page, SUBMIT_SELECTORS);
  }

  if (!submitButton) {
    return {
      submitFound: false,
      targetFieldFound: Boolean(targetField),
      urlBefore,
      urlAfter: page.url(),
      successVisible: false,
      successText: '',
    };
  }

  await submitButton.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(200);

  // Auto-accept any native browser confirm/alert dialogs triggered by submit
  const dialogHandler = (dialog) => dialog.accept().catch(() => {});
  page.on('dialog', dialogHandler);

  try {
    await submitButton.click({ timeout: 5000 });
  } catch {
    await submitButton.evaluate((element) => element.click()).catch(() => {});
  }

  await page.waitForTimeout(800);
  await confirmGenesisSubmitIfPrompted(page);

  // Remove the dialog handler to avoid side effects on subsequent interactions
  page.removeListener('dialog', dialogHandler);

  await page.waitForTimeout(2000);

  return {
    submitFound: true,
    targetFieldFound: Boolean(targetField),
    urlBefore,
    urlAfter: page.url(),
    ...(await successState(page)),
  };
}

export async function collectFieldValidationEvidence(page, fieldName) {
  const field = await findFieldLocator(page, fieldName);

  if (!field) {
    return {
      fieldFound: false,
      fieldName,
      inputState: null,
      describedByTexts: [],
      nearbyErrors: [],
      hasVisibleError: false,
    };
  }

  const inputState = await field.evaluate((element) => ({
    ariaInvalid: element.getAttribute('aria-invalid'),
    ariaRequired: element.getAttribute('aria-required'),
    describedBy: element.getAttribute('aria-describedby') || '',
    required: 'required' in element ? Boolean(element.required) : false,
    validationMessage: typeof element.validationMessage === 'string' ? element.validationMessage : '',
  }));

  const describedByTexts = [];
  const describedByIds = inputState.describedBy.split(/\s+/).filter(Boolean);
  for (const id of describedByIds) {
    const describedByLocator = page.locator(`[id="${id}"]`).first();
    if ((await describedByLocator.count()) === 0) {
      continue;
    }

    const visible = await describedByLocator.isVisible().catch(() => false);
    if (!visible) {
      continue;
    }

    const text = ((await describedByLocator.textContent().catch(() => '')) || '').trim();
    if (text) {
      describedByTexts.push(text);
    }
  }

  const nearbyErrors = await field.evaluate((element, errorSelectors) => {
    const matches = [];
    const isVisible = (node) => {
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };

    const distanceToField = (fieldRect, nodeRect) => {
      const horizontalDistance = nodeRect.right < fieldRect.left
        ? fieldRect.left - nodeRect.right
        : nodeRect.left > fieldRect.right
          ? nodeRect.left - fieldRect.right
          : 0;

      const verticalDistance = nodeRect.bottom < fieldRect.top
        ? fieldRect.top - nodeRect.bottom
        : nodeRect.top > fieldRect.bottom
          ? nodeRect.top - fieldRect.bottom
          : 0;

      return horizontalDistance + verticalDistance;
    };

    const fieldRect = element.getBoundingClientRect();

    let current = element.parentElement;
    let depth = 0;
    while (current && depth < 4) {
      for (const selector of errorSelectors) {
        current.querySelectorAll(selector).forEach((node) => {
          const text = node.textContent?.trim();
          if (text && isVisible(node)) {
            const rect = node.getBoundingClientRect();
            const horizontalAligned = rect.right >= fieldRect.left - 24 && rect.left <= fieldRect.right + 24;
            const verticalNearby = Math.abs(rect.top - fieldRect.bottom) <= 160 || Math.abs(fieldRect.top - rect.bottom) <= 80;

            if (horizontalAligned && verticalNearby) {
              matches.push({ text, distance: distanceToField(fieldRect, rect) });
            }
          }
        });
      }
      current = current.parentElement;
      depth += 1;
    }

    matches.sort((left, right) => left.distance - right.distance);
    return matches.slice(0, 3).map((match) => match.text);
  }, ERROR_SELECTORS);

  const pattern = buildFieldPattern(fieldName);
  const hasVisibleError = [...describedByTexts, ...nearbyErrors].some((text) => pattern.test(text));

  return {
    fieldFound: true,
    fieldName,
    inputState,
    describedByTexts,
    nearbyErrors,
    hasVisibleError,
  };
}

export async function textIsVisible(page, text) {
  const matches = await visibleTextMatches(page, text);
  return {
    visible: matches.length > 0,
    matches,
  };
}

export async function waitForVisibleText(page, text, timeoutMs = 15000) {
  const attempts = Math.max(1, Math.ceil(timeoutMs / 1000));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await textIsVisible(page, text);
    if (result.visible) {
      return result;
    }
    await page.waitForTimeout(1000);
  }
  return textIsVisible(page, text);
}

export async function collectVisibleErrorTexts(page) {
  const texts = [];
  for (const selector of ERROR_SELECTORS) {
    const locator = page.locator(selector);
    const count = await locator.count();
    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      const visible = await candidate.isVisible().catch(() => false);
      if (!visible) {
        continue;
      }
      const text = ((await candidate.textContent().catch(() => '')) || '').trim();
      if (text && !texts.includes(text)) {
        texts.push(text);
      }
    }
  }
  return texts;
}

export async function submissionWasPrevented(page, priorState) {
  const state = priorState || (await clickSubmitAndCapture(page));
  const formVisible = (await firstVisibleLocator(page, ['form', 'input', 'textarea', 'select'])) !== null;

  return {
    ...state,
    formVisible,
    prevented: state.submitFound && !state.successVisible && formVisible,
  };
}

export async function detectDownloadBrochureFiles(page, selectedModel) {
  const fileLocator = page.locator('a[href*=".pdf"], a:has-text("Download"), [class*="brochure"] a, [class*="file"] a');
  const count = await fileLocator.count().catch(() => 0);
  const visibleTexts = [];

  for (let index = 0; index < count; index += 1) {
    const candidate = fileLocator.nth(index);
    const visible = await candidate.isVisible().catch(() => false);
    if (!visible) {
      continue;
    }
    const text = ((await candidate.textContent().catch(() => '')) || '').trim();
    const href = await candidate.getAttribute('href').catch(() => '');
    visibleTexts.push(`${text} ${href}`.trim());
  }

  const modelPattern = selectedModel ? new RegExp(escapeRegExp(selectedModel), 'i') : null;
  const hasModelContext = modelPattern
    ? (await textIsVisible(page, modelPattern)).visible || visibleTexts.some((text) => modelPattern.test(text))
    : true;
  const hasFileLinks = visibleTexts.length > 0;

  return {
    visible: hasModelContext && hasFileLinks,
    items: visibleTexts,
  };
}

export async function waitForDownloadBrochureFiles(page, selectedModel, timeoutMs = 15000) {
  const attempts = Math.max(1, Math.ceil(timeoutMs / 1000));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await detectDownloadBrochureFiles(page, selectedModel);
    if (result.visible) {
      return result;
    }
    await page.waitForTimeout(1000);
  }
  return detectDownloadBrochureFiles(page, selectedModel);
}