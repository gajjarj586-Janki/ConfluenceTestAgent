/**
 * Stage-PIM (Hyundai) authentication helper.
 *
 * Reads credentials from .env at the repo root:
 *   PIM_USER, PIM_PASS, PIM_OTP (optional), PIM_TOKEN (optional cache)
 *
 * Exports:
 *   authenticatePim(world, opts)  — full flow: login API -> seed localStorage -> navigate
 *   selectCompany(page, name)     — dismiss "Attention!" popup + pick company from v-select
 *   loginViaApi()                 — returns a fresh JWT (no browser involved)
 *
 * The token is cached in-process for the run so multiple scenarios reuse one login.
 */

import { request } from '@playwright/test';
import readline from 'readline';
import 'dotenv/config';

const BASE = 'https://stage-pim.hyundai.com.au';
const AUTH_PATH = '/api/authenticate';
const STORAGE_KEY = 'user-token';

let cachedJwt = null; // process-lifetime cache

function prompt(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(q, (a) => { rl.close(); res(a.trim()); }));
}

function decodeJwt(token) {
  try {
    const p = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'));
    return {
      sub: p.sub,
      auth: p.Authentication,
      exp: p.exp,
      expiresAt: p.exp ? new Date(p.exp * 1000).toISOString() : null,
      expired: p.exp ? Date.now() > p.exp * 1000 : false,
    };
  } catch (e) {
    return { error: e.message };
  }
}

const JWT_RE = /eyJ[A-Za-z0-9_-]+?\.[A-Za-z0-9_-]+?\.[A-Za-z0-9_-]+/;
function extractToken(headers, body) {
  if (body && typeof body === 'object') {
    for (const k of ['id_token', 'token', 'accessToken', 'access_token', 'jwt', 'authToken', 'user-token']) {
      if (typeof body[k] === 'string' && JWT_RE.test(body[k])) return body[k];
    }
    const m = JSON.stringify(body).match(JWT_RE);
    if (m) return m[0];
  }
  const auth = headers['authorization'] || headers['Authorization'];
  if (auth) { const m = auth.match(JWT_RE); if (m) return m[0]; }
  const sc = headers['set-cookie'];
  if (sc) { const m = (Array.isArray(sc) ? sc.join('\n') : sc).match(JWT_RE); if (m) return m[0]; }
  return null;
}

/**
 * Call /api/authenticate and return a JWT. Handles common MFA exchange.
 * Throws on failure.
 */
export async function loginViaApi({ force = false } = {}) {
  if (!force && cachedJwt) {
    const info = decodeJwt(cachedJwt);
    if (!info.expired) return cachedJwt;
  }

  // Prefer a fresh PIM_TOKEN from env if it's still valid.
  const envToken = process.env.PIM_TOKEN;
  if (!force && envToken) {
    const info = decodeJwt(envToken);
    if (!info.expired && info.auth === 'MFA_AUTHORISED') {
      cachedJwt = envToken;
      return envToken;
    }
  }

  const USER = process.env.PIM_USER;
  const PASS = process.env.PIM_PASS;
  if (!USER || !PASS) {
    throw new Error('PIM login requires PIM_USER and PIM_PASS in .env at the repo root.');
  }

  const ctx = await request.newContext({
    baseURL: BASE,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { 'Content-Type': 'application/json', Accept: 'application/json' },
  });

  const shapes = [
    { username: USER, password: PASS, rememberMe: false },
    { username: USER, password: PASS },
    { email: USER, password: PASS },
  ];

  let res;
  for (const body of shapes) {
    res = await ctx.post(AUTH_PATH, { data: body, timeout: 20000 });
    if (res.status() >= 200 && res.status() < 300) break;
  }
  if (!res || res.status() < 200 || res.status() >= 300) {
    await ctx.dispose();
    throw new Error(`PIM /api/authenticate failed (status ${res ? res.status() : 'n/a'}).`);
  }

  const headers = res.headers();
  let text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  let jwt = extractToken(headers, body);
  if (!jwt) { await ctx.dispose(); throw new Error('No JWT found in /api/authenticate response.'); }

  let info = decodeJwt(jwt);
  if (info.auth && /MFA_REQUIRED|PRE_AUTHORISED|OTP/i.test(info.auth)) {
    const otp = process.env.PIM_OTP || (await prompt('Enter PIM MFA OTP: '));
    const mfaPaths = ['/api/authenticate/mfa', '/api/auth/mfa', '/api/mfa/verify', '/api/authenticate'];
    let mfaJwt = null;
    for (const p of mfaPaths) {
      const r = await ctx.post(p, {
        data: { otp, code: otp, token: jwt },
        headers: { Authorization: `Bearer ${jwt}` },
        timeout: 20000,
      }).catch(() => null);
      if (!r) continue;
      if (r.status() >= 200 && r.status() < 300) {
        const t = await r.text();
        let parsed; try { parsed = JSON.parse(t); } catch { parsed = t; }
        mfaJwt = extractToken(r.headers(), parsed);
        if (mfaJwt) break;
      }
    }
    if (!mfaJwt) { await ctx.dispose(); throw new Error('PIM MFA exchange failed.'); }
    jwt = mfaJwt;
  }

  await ctx.dispose();
  cachedJwt = jwt;
  return jwt;
}

/**
 * Full flow: get a JWT, seed it into the cucumber page's context,
 * navigate to the site, and optionally select a company.
 *
 * world: cucumber World (has world.context and world.page set up by Before hook)
 * opts.company: company name to pick (e.g. "Hyundai"); pass null to skip.
 */
export async function authenticatePim(world, { company = 'Hyundai' } = {}) {
  const jwt = await loginViaApi();

  // Seed localStorage BEFORE any page script runs on the PIM origin.
  await world.context.addInitScript(
    ({ key, token }) => { try { window.localStorage.setItem(key, token); } catch (e) { } },
    { key: STORAGE_KEY, token: jwt }
  );

  // If a page already exists and is on about:blank, just navigate it.
  const page = world.page;
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => { });

  if (/login|signin/i.test(page.url())) {
    throw new Error(`PIM auth seeded but app bounced to ${page.url()} — token may be rejected.`);
  }

  if (company) await selectCompany(page, company);
  return jwt;
}

/**
 * Dismiss the "Attention! Selected company does not exist" popup if present,
 * then pick `companyName` from the Vuetify v-select in the top-left.
 */
export async function selectCompany(page, companyName) {
  const confirmBtn = page.getByRole('button', { name: /^confirm$/i });
  if (await confirmBtn.isVisible().catch(() => false)) {
    await confirmBtn.click().catch(() => { });
    await page.waitForTimeout(400);
  }

  const trigger = page.locator('.v-select__selections').first();
  await trigger.waitFor({ state: 'visible', timeout: 5000 });
  await trigger.click();

  const exact = page
    .locator('.v-list-item .v-list-item-title, .v-list-item__title')
    .filter({ hasText: new RegExp(`^\\s*${companyName}\\s*$`, 'i') })
    .first();

  try {
    await exact.waitFor({ state: 'visible', timeout: 4000 });
    await exact.click();
  } catch {
    const fallback = page.locator('.v-list-item').filter({ hasText: companyName }).first();
    if (!(await fallback.count())) throw new Error(`Company option "${companyName}" not found.`);
    await fallback.click();
  }

  await page.waitForLoadState('networkidle').catch(() => { });
}
