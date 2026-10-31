#!/usr/bin/env node
// EVER local bridge: serves the game on 127.0.0.1 and handles "Sign in with ChatGPT"
// (open-source / locally hosted flow) so AI requests use the player's own ChatGPT plan.
// Zero dependencies. Needs Node 20+.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PORT = +process.env.EVER_PORT || 1455;
const ISS = process.env.EVER_ISS || 'https://auth.openai.com';
const API = process.env.EVER_API || 'https://api.openai.com/v1';
const AUTH_URL = ISS + '/api/accounts/authorize';
const TOKEN_URL = ISS + '/api/accounts/oauth/token';
const APP_NAME = 'EVER Inkwell Grimoire';
const SCOPE = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const DIR = process.env.EVER_HOME || path.join(os.homedir(), '.config', 'ever-bridge');
const FILE = path.join(DIR, 'credentials.json');
const PUB = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const ORIGIN = `http://127.0.0.1:${PORT}`;

/* ---------- credential storage (owner-only file, never sent to the browser) ---------- */
function load() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; } }
function save(d) {
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  const tmp = FILE + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(d, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, FILE);
}
let DB = load();
if (!DB.host) { DB.host = 'urn:uuid:' + crypto.randomUUID(); save(DB); }

const rnd = n => crypto.randomBytes(n).toString('base64url');
const httpErr = (status, code, detail) => Object.assign(new Error(code), { status, detail });

/* ---------- OAuth: authorize, callback, validate ---------- */
const pending = new Map();
function startLogin() {
  const state = rnd(24), nonce = rnd(24), verifier = rnd(48);
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const redirect = `${ORIGIN}/auth/callback`, reg = DB.reg;
  const p = new URLSearchParams({
    client_id: reg ? reg.client_id : 'dynamic_agent_client', ext_agent_host_id: DB.host,
    response_type: 'code', redirect_uri: redirect, scope: SCOPE, resource: API,
    state, nonce, code_challenge_method: 'S256', code_challenge: challenge
  });
  if (!reg) p.set('agent_name_hint', APP_NAME);
  else { if (reg.id_token) p.set('id_token_hint', reg.id_token); if (reg.email) p.set('login_hint', reg.email); }
  for (const [k, v] of pending) if (Date.now() - v.t > 600000) pending.delete(k);
  pending.set(state, { verifier, nonce, redirect, clientId: reg && reg.client_id, t: Date.now() });
  return AUTH_URL + '?' + p;
}
async function form(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(20000) });
  const text = await r.text();
  let j = {}; try { j = JSON.parse(text); } catch { /* not json */ }
  if (!r.ok) throw httpErr(r.status, j.error || 'token_endpoint_error', j.error_description);
  return j;
}
let jwks = null;
async function signingKeys() {
  if (!jwks) {
    const cfg = await (await fetch(ISS + '/.well-known/openid-configuration', { signal: AbortSignal.timeout(15000) })).json();
    jwks = await (await fetch(cfg.jwks_uri, { signal: AbortSignal.timeout(15000) })).json();
    jwks._revocation = cfg.revocation_endpoint;
  }
  return jwks;
}
async function verifyIdToken(jwt, aud, nonce) {
  const [h, p, s] = String(jwt).split('.');
  if (!h || !p || !s) throw httpErr(502, 'bad_id_token');
  const head = JSON.parse(Buffer.from(h, 'base64url')), pay = JSON.parse(Buffer.from(p, 'base64url'));
  if (head.alg !== 'RS256') throw httpErr(502, 'unsupported_id_token_alg');
  const jwk = (await signingKeys()).keys.find(k => k.kid === head.kid);
  if (!jwk) { jwks = null; throw httpErr(502, 'unknown_signing_key'); }
  const ok = crypto.verify('RSA-SHA256', Buffer.from(h + '.' + p), crypto.createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(s, 'base64url'));
  const audOk = Array.isArray(pay.aud) ? pay.aud.includes(aud) : pay.aud === aud;
  if (!ok || pay.iss !== ISS || !audOk || !(pay.exp * 1000 > Date.now()) || pay.nonce !== nonce) throw httpErr(401, 'id_token_validation_failed');
  return pay;
}
async function handleCallback(q) {
  const st = pending.get(q.get('state'));
  if (!st) throw httpErr(400, 'Unknown or expired sign-in attempt. Start again from the game.');
  pending.delete(q.get('state'));
  if (q.get('error')) throw httpErr(400, q.get('error') === 'access_denied' ? 'You declined access, so no ChatGPT plan can be used.' : q.get('error'));
  const cbClient = q.get('client_id'), clientId = st.clientId || cbClient;
  if (!clientId || clientId === 'dynamic_agent_client') throw httpErr(400, 'Registration did not return a client id.');
  if (st.clientId && cbClient && cbClient !== st.clientId) throw httpErr(400, 'Client id mismatch. Sign-in rejected.');
  const tok = await form(TOKEN_URL, new URLSearchParams({
    grant_type: 'authorization_code', client_id: clientId, code: q.get('code') || '',
    code_verifier: st.verifier, redirect_uri: st.redirect, resource: API
  }));
  const claims = await verifyIdToken(tok.id_token, clientId, st.nonce);
  if (DB.reg && DB.reg.subject && DB.reg.subject !== claims.sub) throw httpErr(400, 'That is a different ChatGPT account than the saved one. Sign out first.');
  const scopes = String(tok.scope || q.get('scope') || '').split(/[ +]/).filter(Boolean);
  DB.reg = {
    client_id: clientId, email: claims.email, subject: claims.sub, id_token: tok.id_token,
    access_token: tok.access_token, refresh_token: tok.refresh_token, token_type: tok.token_type || 'Bearer',
    expires_at: Date.now() + (tok.expires_in || 3600) * 1000, scopes, saved_at: new Date().toISOString()
  };
  save(DB);
  return DB.reg.scopes.includes('chatgpt.tokens.use.direct');
}

/* ---------- token refresh (serialized) ---------- */
let refreshing = null;
async function freshToken() {
  const r = DB.reg;
  if (!r || !r.refresh_token) throw httpErr(401, 'not_signed_in');
  if (!r.scopes.includes('chatgpt.tokens.use.direct')) throw httpErr(403, 'plan_use_not_enabled');
  if (r.expires_at - Date.now() > 120000) return r.access_token;
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const t = await form(TOKEN_URL, new URLSearchParams({ grant_type: 'refresh_token', client_id: r.client_id, refresh_token: r.refresh_token, resource: API }));
        Object.assign(r, {
          access_token: t.access_token, refresh_token: t.refresh_token || r.refresh_token, id_token: t.id_token || r.id_token,
          expires_at: Date.now() + (t.expires_in || 3600) * 1000, scopes: t.scope ? String(t.scope).split(' ') : r.scopes
        });
        save(DB);
      } catch (e) {
        if (e.detail === undefined && (e.message === 'invalid_grant')) { DB.reg.access_token = ''; DB.reg.expires_at = 0; }
        throw e;
      } finally { refreshing = null; }
    })();
  }
  await refreshing;
  return DB.reg.access_token;
}
async function logout() {
  const r = DB.reg; let revoked = false;
  if (r && r.refresh_token) {
    try {
      await signingKeys();
      if (jwks._revocation) { await fetch(jwks._revocation, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: r.refresh_token, token_type_hint: 'refresh_token', client_id: r.client_id }), signal: AbortSignal.timeout(15000) }); revoked = true; }
    } catch { /* clear locally anyway */ }
  }
  if (r) { delete r.access_token; delete r.refresh_token; delete r.id_token; r.expires_at = 0; r.scopes = []; r.signedOut = true; }
  save(DB);
  return revoked;
}

/* ---------- AI: Responses API with the player's own plan ---------- */
let modelCache = null;
async function models(token) {
  if (modelCache) return modelCache;
  const r = await fetch(API + '/models', { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw httpErr(r.status, 'models_failed');
  const j = await r.json();
  modelCache = (j.models || []).filter(m => m.visibility === 'list').map(m => ({ slug: m.slug, name: m.display_name, raw: m }));
  return modelCache;
}
async function ask({ instructions, input, model }) {
  const token = await freshToken();
  // NPC chatter is short, so use the smallest current model. OpenAI describes gpt-6-luna as the fast, affordable one;
  // the gpt-5.6 models are older generations. Override with EVER_MODEL.
  const list = await models(token);
  const m = model || process.env.EVER_MODEL || (list.find(x => x.slug === 'gpt-6-luna') || list.find(x => /luna/i.test(x.slug)) || list[0])?.slug;
  if (!m) throw httpErr(502, 'no_model_available');
  const res = await fetch(API + '/responses', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: m, instructions, input: [{ role: 'user', content: String(input) }], reasoning: { effort: 'low' }, store: false, stream: true }),
    signal: AbortSignal.timeout(45000)
  });
  if (!res.ok) { const t = await res.text(); throw httpErr(res.status === 429 ? 429 : 502, 'openai_' + res.status, t.slice(0, 200)); }
  let buf = '', text = '', done = false; const dec = new TextDecoder();
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const raw = buf.slice(0, i); buf = buf.slice(i + 2);
      const line = raw.split('\n').find(l => l.startsWith('data:'));
      if (!line) continue;
      let ev; try { ev = JSON.parse(line.slice(5)); } catch { continue; }
      if (ev.type === 'response.output_text.delta') text += ev.delta;
      else if (ev.type === 'response.failed') { const c = (ev.response && ev.response.error && ev.response.error.code) || 'failed'; throw httpErr(String(c).startsWith('subscription_sharing') ? 429 : 502, c); }
      else if (ev.type === 'response.incomplete') throw httpErr(502, 'incomplete');
      else if (ev.type === 'response.completed') done = true;
    }
  }
  if (!done) throw httpErr(502, 'stream_interrupted');
  return { text, model: m };
}

/* ---------- http server ---------- */
const send = (res, status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
const page = (res, status, title, msg) => { res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(`<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:20px system-ui;max-width:32em;margin:15vh auto;padding:0 20px"><h1>${title}</h1><p>${msg.replace(/[<&]/g, '')}</p><p>You can close this tab and return to the game.</p>`); };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
function body(req) { return new Promise((ok, no) => { let b = ''; req.on('data', c => { b += c; if (b.length > 65536) { no(httpErr(413, 'too_large')); req.destroy(); } }); req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch { no(httpErr(400, 'bad_json')); } }); }); }
function status() {
  const r = DB.reg;
  return { signedIn: !!(r && r.access_token), email: r && r.access_token ? r.email : null, planUse: !!(r && r.access_token && r.scopes.includes('chatgpt.tokens.use.direct')), host: DB.host };
}
function openBrowser(url) {
  if (process.env.EVER_NO_OPEN) return;
  const app = process.env.EVER_BROWSER; // e.g. "Brave Browser" (macOS)
  const [cmd, args] = process.platform === 'darwin' ? ['open', app ? ['-a', app, url] : [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  try { spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch { /* user can open the link by hand */ }
}
const server = http.createServer(async (req, res) => {
  try {
    if (req.headers.host !== `127.0.0.1:${PORT}`) return send(res, 403, { error: 'bad_host' }); // blocks DNS rebinding
    const u = new URL(req.url, ORIGIN);
    if (u.pathname === '/auth/callback') {
      try { const plan = await handleCallback(u.searchParams); return page(res, 200, plan ? 'Signed in' : 'Signed in without plan use', plan ? 'Your ChatGPT plan can now power NPC conversations.' : 'ChatGPT plan use was not granted, so the game keeps using its offline script.'); }
      catch (e) { return page(res, e.status || 500, 'Sign-in did not finish', e.message || 'error'); }
    }
    if (u.pathname.startsWith('/api/')) {
      if (req.headers.origin && req.headers.origin !== ORIGIN) return send(res, 403, { error: 'bad_origin' });
      if (req.method !== 'GET' && req.headers['x-ever'] !== '1') return send(res, 403, { error: 'missing_header' });
      if (u.pathname === '/api/status' && req.method === 'GET') return send(res, 200, status());
      if (u.pathname === '/api/login' && req.method === 'POST') { const url = startLogin(); openBrowser(url); return send(res, 200, { opened: !process.env.EVER_NO_OPEN, url: url.replace(/([?&])(id_token_hint)=[^&]*/, '$1$2=REDACTED') }); }
      if (u.pathname === '/api/logout' && req.method === 'POST') return send(res, 200, { revoked: await logout() });
      if (u.pathname === '/api/models' && req.method === 'GET') { const l = await models(await freshToken()); return send(res, 200, { models: u.searchParams.has('raw') ? l : l.map(({ slug, name }) => ({ slug, name })) }); }
      if (u.pathname === '/api/ai' && req.method === 'POST') {
        const b = await body(req);
        if (typeof b.instructions !== 'string' || typeof b.input !== 'string' || b.instructions.length > 8000 || b.input.length > 4000) throw httpErr(400, 'bad_request');
        return send(res, 200, await ask(b));
      }
      return send(res, 404, { error: 'not_found' });
    }
    // static game files
    let p = path.normalize(path.join(PUB, u.pathname === '/' ? 'index.html' : u.pathname));
    if (!p.startsWith(PUB + path.sep) && p !== PUB) return send(res, 403, { error: 'forbidden' });
    fs.readFile(p, (err, data) => { if (err) return send(res, 404, { error: 'not_found' }); res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(data); });
  } catch (e) {
    const s = e.status || 500; if (s >= 500) console.error('error:', e.message);
    send(res, s, { error: e.message, detail: e.detail });
  }
});
server.listen(PORT, '127.0.0.1', () => {
  console.log(`EVER bridge ready. Open the game: ${ORIGIN}/`);
  console.log(`Credentials are stored only in ${FILE}`);
  if (!process.env.EVER_NO_OPEN && !process.env.EVER_NO_LAUNCH) openBrowser(ORIGIN + '/');
});
