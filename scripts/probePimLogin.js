/**
 * Discovery: probe Hyundai PIM auth endpoints to learn the real login shape.
 *
 * Reads credentials from environment variables (do NOT hard-code):
 *   $env:PIM_USER  = "admin@orchard.com.au"
 *   $env:PIM_PASS  = "<password>"
 *   $env:PIM_OTP   = "<otp if you have one>"     # optional
 *
 * Usage:
 *   node scripts/probePimLogin.js
 *
 * Output: writes scripts/_pim_login_probe.json with each attempt's
 * request, status, headers and body so we can identify the real endpoint.
 */

const fs = require('fs');
const path = require('path');
const { request } = require('@playwright/test');

const BASE = 'https://stage-pim.hyundai.com.au';

const USER = process.env.PIM_USER;
const PASS = process.env.PIM_PASS;
const OTP = process.env.PIM_OTP || null;

if (!USER || !PASS) {
    console.error('Set $env:PIM_USER and $env:PIM_PASS before running.');
    process.exit(2);
}

// Candidate endpoints + payload shapes seen in common SPA stacks.
const CANDIDATES = [
    { path: '/api/auth/login', body: { username: USER, password: PASS } },
    { path: '/api/auth/login', body: { email: USER, password: PASS } },
    { path: '/api/login', body: { username: USER, password: PASS } },
    { path: '/api/login', body: { email: USER, password: PASS } },
    { path: '/auth/login', body: { username: USER, password: PASS } },
    { path: '/api/v1/auth/login', body: { username: USER, password: PASS } },
    { path: '/api/users/login', body: { username: USER, password: PASS } },
    { path: '/api/auth/signin', body: { username: USER, password: PASS } },
];

(async () => {
    const ctx = await request.newContext({
        baseURL: BASE,
        ignoreHTTPSErrors: true,
        extraHTTPHeaders: { 'Content-Type': 'application/json', Accept: 'application/json' },
    });

    const results = [];
    for (const c of CANDIDATES) {
        const safeBody = { ...c.body, password: '***' };
        try {
            const res = await ctx.post(c.path, { data: c.body, timeout: 15000 });
            const status = res.status();
            const headers = res.headers();
            const text = await res.text();
            let body;
            try { body = JSON.parse(text); } catch { body = text.slice(0, 500); }
            results.push({ path: c.path, requestBody: safeBody, status, headers, body });
            console.log(`[${status}] POST ${c.path}  body=${JSON.stringify(safeBody)}`);
        } catch (e) {
            results.push({ path: c.path, requestBody: safeBody, error: e.message });
            console.log(`[ERR] POST ${c.path}: ${e.message}`);
        }
    }

    const out = path.join(__dirname, '_pim_login_probe.json');
    fs.writeFileSync(out, JSON.stringify(results, null, 2));
    console.log(`\nSaved full responses to: ${out}`);
    console.log('Look for a 200/201/204 response — that is the real login endpoint.');
    console.log('Inspect its body & "set-cookie" header to see where the JWT lives.');

    await ctx.dispose();
})();
