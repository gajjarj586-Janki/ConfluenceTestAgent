/**
 * Login to Hyundai PIM via /api/authenticate, then open the app authenticated.
 *
 * Step 1: POST credentials to /api/authenticate, capture full response (status, headers, body).
 * Step 2: Extract JWT from response (body field, Set-Cookie, or Authorization header).
 * Step 3: If MFA is required, prompt for OTP and POST to a likely MFA endpoint.
 * Step 4: Seed localStorage["user-token"] and navigate to the site.
 *
 * Usage:
 *   $env:PIM_USER = "admin@orchard.com.au"
 *   $env:PIM_PASS = "<password>"
 *   $env:PIM_OTP  = "<otp>"          # optional; will prompt if needed
 *   node scripts/pimLogin.js
 *
 * On first run the full /api/authenticate response is saved to scripts/_pim_auth_response.json
 * so we can adjust field extraction if needed.
 */

import { chromium, request } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BASE = 'https://stage-pim.hyundai.com.au';
const AUTH_PATH = '/api/authenticate';
const STORAGE_KEY = 'user-token';

const USER = process.env.PIM_USER;
const PASS = process.env.PIM_PASS;
let OTP = process.env.PIM_OTP || null;

if (!USER || !PASS) {
    console.error('Missing credentials. Add PIM_USER and PIM_PASS to a local .env file at the repo root.');
    console.error('Example .env:');
    console.error('  PIM_USER=you@example.com');
    console.error('  PIM_PASS=your-password');
    console.error('  # PIM_OTP=123456   # optional');
    process.exit(2);
}

function prompt(q) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((res) => rl.question(q, (a) => { rl.close(); res(a.trim()); }));
}

function decodeJwt(token) {
    try {
        const p = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'));
        return { sub: p.sub, auth: p.Authentication, exp: p.exp, expiresAt: new Date(p.exp * 1000).toISOString(), expired: Date.now() > p.exp * 1000 };
    } catch (e) { return { error: e.message }; }
}

// Try to find a JWT-shaped string in a response (body fields / cookies / headers).
function extractToken(status, headers, body) {
    const jwtRegex = /eyJ[A-Za-z0-9_-]+?\.[A-Za-z0-9_-]+?\.[A-Za-z0-9_-]+/;

    // 1. JSON body — common field names.
    if (body && typeof body === 'object') {
        for (const k of ['id_token', 'token', 'accessToken', 'access_token', 'jwt', 'authToken', 'user-token']) {
            if (typeof body[k] === 'string' && jwtRegex.test(body[k])) return { token: body[k], source: `body.${k}` };
        }
        // Nested
        const flat = JSON.stringify(body);
        const m = flat.match(jwtRegex);
        if (m) return { token: m[0], source: 'body(scanned)' };
    }

    // 2. Authorization response header.
    const authHdr = headers['authorization'] || headers['Authorization'];
    if (authHdr) {
        const m = authHdr.match(jwtRegex);
        if (m) return { token: m[0], source: 'header.authorization' };
    }

    // 3. Set-Cookie.
    const sc = headers['set-cookie'];
    if (sc) {
        const m = (Array.isArray(sc) ? sc.join('\n') : sc).match(jwtRegex);
        if (m) return { token: m[0], source: 'set-cookie' };
    }

    return null;
}

async function postAuth(ctx, body) {
    const res = await ctx.post(AUTH_PATH, { data: body, timeout: 20000 });
    const status = res.status();
    const headers = res.headers();
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status, headers, body: parsed };
}

(async () => {
    const ctx = await request.newContext({
        baseURL: BASE,
        ignoreHTTPSErrors: true,
        extraHTTPHeaders: { 'Content-Type': 'application/json', Accept: 'application/json' },
    });

    // Try a couple of common payload shapes for /api/authenticate.
    const payloadShapes = [
        { username: USER, password: PASS, rememberMe: false },
        { username: USER, password: PASS },
        { email: USER, password: PASS },
    ];

    let auth;
    for (const shape of payloadShapes) {
        console.log(`[auth] POST ${AUTH_PATH} body keys=[${Object.keys(shape).join(',')}]`);
        auth = await postAuth(ctx, shape);
        console.log(`  -> status ${auth.status}`);
        if (auth.status >= 200 && auth.status < 300) break;
    }

    // Persist full response for inspection.
    const dumpPath = path.join(__dirname, '_pim_auth_response.json');
    fs.writeFileSync(dumpPath, JSON.stringify(auth, null, 2));
    console.log(`[auth] full response saved to ${dumpPath}`);

    if (auth.status < 200 || auth.status >= 300) {
        console.error(`[auth] login failed (${auth.status}). Inspect ${dumpPath} and share the body.`);
        process.exit(1);
    }

    let found = extractToken(auth.status, auth.headers, auth.body);
    if (!found) {
        console.error('[auth] response 2xx but no JWT found. Share _pim_auth_response.json so we can adjust field names.');
        process.exit(1);
    }

    console.log(`[auth] token from ${found.source}`);
    let jwt = found.token;
    let info = decodeJwt(jwt);
    console.log('[auth] decoded:', info);

    // If MFA stage, do the OTP exchange.
    if (info.auth && /MFA_REQUIRED|PRE_AUTHORISED|OTP/i.test(info.auth)) {
        if (!OTP) OTP = await prompt('Enter MFA OTP: ');
        console.log('[mfa] exchanging OTP...');
        // Common MFA endpoints — try in order.
        const mfaPaths = ['/api/authenticate/mfa', '/api/auth/mfa', '/api/mfa/verify', '/api/authenticate'];
        let mfaRes;
        for (const p of mfaPaths) {
            const r = await ctx.post(p, {
                data: { otp: OTP, code: OTP, token: jwt },
                headers: { Authorization: `Bearer ${jwt}` },
                timeout: 20000,
            }).catch((e) => ({ _err: e.message }));
            if (r._err) { console.log(`  ${p} -> error ${r._err}`); continue; }
            const st = r.status();
            console.log(`  ${p} -> ${st}`);
            if (st >= 200 && st < 300) {
                const text = await r.text();
                let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
                mfaRes = { status: st, headers: r.headers(), body: parsed };
                break;
            }
        }
        if (!mfaRes) { console.error('[mfa] all candidate MFA endpoints failed. Share network capture.'); process.exit(1); }
        const fresh = extractToken(mfaRes.status, mfaRes.headers, mfaRes.body);
        if (!fresh) { console.error('[mfa] no JWT in MFA response.'); fs.writeFileSync(path.join(__dirname, '_pim_mfa_response.json'), JSON.stringify(mfaRes, null, 2)); process.exit(1); }
        jwt = fresh.token;
        info = decodeJwt(jwt);
        console.log('[mfa] post-MFA token:', info);
    }

    await ctx.dispose();

    // Seed and open the app.
    const browser = await chromium.launch({ headless: false, args: ['--disable-blink-features=AutomationControlled'] });
    const browserCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    await browserCtx.addInitScript(({ key, token }) => {
        try { window.localStorage.setItem(key, token); } catch (e) { }
    }, { key: STORAGE_KEY, token: jwt });

    const page = await browserCtx.newPage();
    console.log(`[nav] opening ${BASE}`);
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => { });
    console.log(`[nav] final URL: ${page.url()}`);

    if (/login|signin/i.test(page.url())) {
        console.warn('[auth] still bounced to login — token rejected by SPA. Inspect response files.');
        return;
    }

    console.log('[auth] success — selecting company "Hyundai"...');
    await selectCompany(page, 'Hyundai');
    console.log('[done] browser stays open. Ctrl+C to exit.');
})();

/**
 * After login the app shows an "Attention! Selected company does not exist" popup
 * and a Vuetify v-select company dropdown in the top-left. Dismiss the popup and
 * pick the company.
 */
async function selectCompany(page, companyName) {
    // 1. Dismiss the "Attention!" modal if present.
    const confirmBtn = page.getByRole('button', { name: /^confirm$/i });
    if (await confirmBtn.isVisible().catch(() => false)) {
        console.log('[company] dismissing Attention! popup');
        await confirmBtn.click().catch(() => { });
        await page.waitForTimeout(400);
    }

    // 2. Open the Vuetify v-select. The visible trigger is .v-select__selections.
    const trigger = page.locator('.v-select__selections').first();
    await trigger.waitFor({ state: 'visible', timeout: 5000 });
    await trigger.click();
    console.log('[company] dropdown opened');

    // 3. Vuetify renders options in .v-list-item inside a portal (.v-menu__content).
    // Match by exact text to avoid hitting "Hyundai PIM" when we want "Hyundai".
    const option = page
        .locator('.v-list-item .v-list-item-title, .v-list-item__title')
        .filter({ hasText: new RegExp(`^\\s*${companyName}\\s*$`, 'i') })
        .first();

    try {
        await option.waitFor({ state: 'visible', timeout: 4000 });
        await option.click();
        console.log(`[company] selected "${companyName}"`);
    } catch (e) {
        // Fallback: click any list item whose text contains the name.
        const fallback = page.locator('.v-list-item').filter({ hasText: companyName }).first();
        if (await fallback.count()) {
            await fallback.click();
            console.log(`[company] selected (fallback) "${companyName}"`);
        } else {
            console.warn(`[company] option "${companyName}" not found in dropdown. Pick manually.`);
            return;
        }
    }

    await page.waitForLoadState('networkidle').catch(() => { });
}
