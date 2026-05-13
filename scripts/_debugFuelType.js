import { chromium } from 'playwright';
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  await page.goto('https://stage.hyundai.com.au/au/en/book-a-test-drive', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);

  const cookie = page.locator('#onetrust-accept-btn-handler').first();
  if (await cookie.count() > 0) { await cookie.click(); await page.waitForTimeout(1000); }

  await page.locator('select[name="ModelOfinterest__c"]').selectOption({ label: 'KONA' });
  console.log('Selected KONA');

  await page.locator('select[name="FuelType__c"]').waitFor({ state: 'visible', timeout: 6000 });
  await page.locator('select[name="FuelType__c"]').selectOption({ label: 'Hybrid' });
  console.log('Selected Hybrid');
  await page.waitForTimeout(1500);

  const result = await page.evaluate(() => {
    // Try every form selector used in the submit step
    const form = document.querySelector('form.test-drive')
      || document.querySelector('form.hyu-page-form')
      || document.querySelector('form');

    if (!form) return { formFound: false };

    const allNames = Array.from(form.querySelectorAll('input, select, textarea'))
      .map(el => `${el.name || el.id}=${el.value}`);

    return {
      formClass: form.className,
      fuelInForm: !!form.querySelector('select[name="FuelType__c"]'),
      modelInForm: !!form.querySelector('select[name="ModelOfinterest__c"]'),
      fuelValAnywhere: document.querySelector('select[name="FuelType__c"]')?.value,
      modelValAnywhere: document.querySelector('select[name="ModelOfinterest__c"]')?.value,
      allFormFields: allNames,
      formHTML: form.outerHTML.substring(0, 500),
    };
  });

  console.log('Form class:', result.formClass);
  console.log('FuelType IN form?', result.fuelInForm);
  console.log('Model IN form?', result.modelInForm);
  console.log('FuelType value (anywhere on page):', result.fuelValAnywhere);
  console.log('Model value (anywhere on page):', result.modelValAnywhere);
  console.log('Form fields collected:', result.allFormFields);
  console.log('Form HTML snippet:', result.formHTML);
  await browser.close();
})();
