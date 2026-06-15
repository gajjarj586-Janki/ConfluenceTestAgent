/**
 * Open https://stage-pim.hyundai.com.au/ already authenticated by seeding
 * the JWT into localStorage under the key the app reads: "user-token".
 *
 * Token is read from PIM_TOKEN (in .env at repo root or shell env). Never hardcoded.
 * For credential-based login (preferred), use scripts/pimLogin.js instead.
 *
 * Usage:
 *   # .env at repo root:
 *   #   PIM_TOKEN=eyJ...
 *   node scripts/openPimAuthed.js
 */

import { chromium } from '@playwright/test';
import 'dotenv/config';

const SITE_URL = 'https://stage-pim.hyundai.com.au/';
const STORAGE_KEY = 'user-token';

const token = process.env.PIM_TOKEN;
if (!token) {
    console.error('Missing PIM_TOKEN. Add it to a local .env file at the repo root, or run scripts/pimLogin.js.');
    process.exit(2);
}

function decodeJwt(token) {
    try {
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'));
        const expMs = payload.exp ? payload.exp * 1000 : null;
        return {
            sub: payload.sub,
            exp: payload.exp,
            expiresAt: expMs ? new Date(expMs).toISOString() : null,
            expired: expMs ? Date.now() > expMs : false,
        };
    } catch (e) {
        return { error: e.message };
    }
}

(async () => {
    console.log('[token]', decodeJwt(token));

    const browser = await chromium.launch({
        headless: false,
        args: ['--disable-blink-features=AutomationControlled'],
    });

    const context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
    });

    // Seed localStorage on the target origin BEFORE the SPA boots.
    await context.addInitScript(
        ({ key, token }) => {
            try { window.localStorage.setItem(key, token); } catch (e) { }
        },
        { key: STORAGE_KEY, token }
    );

    const page = await context.newPage();

    console.log(`[nav] opening ${SITE_URL}`);
    await page.goto(SITE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => { });

    // Verify the value actually landed in localStorage (without echoing it).
    const stored = await page.evaluate((k) => window.localStorage.getItem(k), STORAGE_KEY);
    console.log(`[storage] localStorage["${STORAGE_KEY}"] = ${stored ? '<set>' : '(empty)'}`);

    console.log(`[nav] final URL: ${page.url()}`);

    if (/login|signin|auth/i.test(page.url())) {
        console.warn('[auth] still on a login route — token may be expired or rejected by API.');
    } else {
        console.log('[auth] authenticated. Browser stays open; Ctrl+C to exit.');
    }
})();
