/**
 * Shared helper functions — no Cucumber imports.
 *
 * Import from here (not common_steps.js) to avoid loading a step-definition
 * module as a static ESM dependency, which causes Cucumber's builder to run
 * before it reaches 'running' status and throws a PENDING error.
 *
 * Usage:
 *   import { handleLocationModal } from './commonHelpers.js';
 */

/**
 * Dismiss the Hyundai "Set your location" postcode modal.
 * Two inputs share id="locaion-modal-input" (typo in site HTML).
 * The first is 0×0 hidden; we iterate backwards to find the visible one.
 */
export async function handleLocationModal(page, postcode = '2000') {
  const modalContainer = page.locator('.hyu-postcode-modal.tingle-modal--visible').first();
  try {
    await modalContainer.waitFor({ state: 'visible', timeout: 15000 });
  } catch {
    console.log('📍 No location modal appeared — continuing');
    return;
  }
  console.log('📍 Location modal detected — filling postcode via visible input');

  const modalInputs = page.locator('.hyu-postcode-modal input#locaion-modal-input');
  const inputCount = await modalInputs.count();
  let modalInput = null;
  for (let i = inputCount - 1; i >= 0; i--) {
    const el = modalInputs.nth(i);
    if (await el.isVisible().catch(() => false)) { modalInput = el; break; }
  }

  if (modalInput) {
    await modalInput.fill(postcode.toString());
    await page.waitForTimeout(500);
    await modalInput.press('Enter');
    await page.waitForTimeout(2000);

    const resultItem = page.locator('.tingle-modal--visible .hyu-postcode-modal--location-list li').first();
    if ((await resultItem.count()) > 0 && (await resultItem.isVisible().catch(() => false))) {
      const text = await resultItem.textContent().catch(() => '');
      console.log(`📍 Selecting first result: "${text.trim()}"`);
      await resultItem.click();
      await page.waitForTimeout(3000);

      const setDealerBtn = page.locator(
        '.tingle-modal--visible .js-hyu-postcode-modal--btn-set-dealer, ' +
        '.tingle-modal--visible button:has-text("Set dealer")'
      ).first();
      if ((await setDealerBtn.count()) > 0 && (await setDealerBtn.isVisible().catch(() => false))) {
        await setDealerBtn.click();
        await page.waitForTimeout(2000);
        console.log('📍 Clicked Set dealer — modal dismissed');
      }
    } else {
      console.log('⚠️ No results found after Enter — pressing Escape');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }
  } else {
    console.log('⚠️ No visible modal input found — pressing Escape');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }
}
