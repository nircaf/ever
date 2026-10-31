// Smoke test: runs the bridge against a fake OpenAI (issuer + Responses API) to check
// the OAuth/PKCE flow, ID-token validation, refresh, streaming and the local security checks.
// This proves our code follows the documented flow; it does not talk to the real OpenAI.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FP = 9101, BP = 1466, FAKE = `http://127.0.0.1:${FP}`, BR = `http://127.0.0.1:${BP}`;
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const codes = new Map(); const seen = { refreshes: 0, revoked: 0, badBody: [] };

const fake = http.createServer(async (req, res) => {
  const u = new URL(req.url, FAKE); let raw = ''; for await (const c of req) raw += c;
  const json = (o, s = 200) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (u.pathname === '/.well-known/openid-configuration') return json({ jwks_uri: FAKE + '/jwks', revocation_endpoint: FAKE + '/revoke' });
  if (u.pathname === '/jwks') return json({ keys: [jwk] });
  if (u.pathname === '/api/accounts/authorize') {
    const q = u.searchParams; assert.equal(q.get('code_challenge_method'), 'S256'); assert.equal(q.get('client_id'), 'dynamic_agent_client');
    assert.ok(q.get('ext_agent_host_id').startsWith('urn:uuid:')); assert.match(q.get('scope'), /chatgpt\.tokens\.use\.direct/);
    assert.equal(q.get('redirect_uri'), `${BR}/auth/callback`); assert.equal(q.get('resource'), FAKE + '/v1');
    const code = crypto.randomBytes(8).toString('hex'); codes.set(code, { nonce: q.get('nonce'), challenge: q.get('code_challenge') });
    res.writeHead(302, { Location: `${q.get('redirect_uri')}?code=${code}&state=${q.get('state')}&client_id=oaiapp_fake&scope=chatgpt.tokens.use.direct+email+offline_access+openid+profile+resource.invoke` }); return res.end();
  }
  if (u.pathname === '/api/accounts/oauth/token') {
    const f = new URLSearchParams(raw);
    if (f.get('grant_type') === 'authorization_code') {
      const c = codes.get(f.get('code')); assert.ok(c, 'known code');
      assert.equal(crypto.createHash('sha256').update(f.get('code_verifier')).digest('base64url'), c.challenge, 'PKCE verifies');
      assert.equal(f.get('client_id'), 'oaiapp_fake');
      const h = b64({ alg: 'RS256', kid: 'k1' }), p = b64({ iss: FAKE, aud: 'oaiapp_fake', sub: 'user-1', email: 'player@example.com', exp: Math.floor(Date.now() / 1000) + 600, nonce: c.nonce });
      const sig = crypto.sign('RSA-SHA256', Buffer.from(h + '.' + p), privateKey).toString('base64url');
      return json({ access_token: 'at-1', refresh_token: 'rt-1', id_token: `${h}.${p}.${sig}`, expires_in: 100, scope: 'chatgpt.tokens.use.direct email offline_access openid profile resource.invoke' });
    }
    if (f.get('grant_type') === 'refresh_token') { seen.refreshes++; assert.equal(f.get('refresh_token'), seen.refreshes === 1 ? 'rt-1' : 'rt-2'); return json({ access_token: 'at-' + (seen.refreshes + 1), refresh_token: 'rt-' + (seen.refreshes + 1), expires_in: 3600 }); }
    return json({ error: 'unsupported_grant_type' }, 400);
  }
  if (u.pathname === '/revoke') { seen.revoked++; res.writeHead(200); return res.end(); }
  if (u.pathname === '/v1/models') { assert.ok(req.headers.authorization.startsWith('Bearer at-')); return json({ models: [{ slug: 'hidden', display_name: 'Hidden', visibility: 'hide' }, { slug: 'fake-1', display_name: 'Fake One', visibility: 'list' }] }); }
  if (u.pathname === '/v1/responses') {
    const b = JSON.parse(raw); const bad = ['background', 'conversation', 'max_output_tokens', 'metadata', 'previous_response_id', 'temperature', 'top_p', 'user'].filter(k => k in b);
    if (b.store !== false || b.stream !== true || bad.length || !Array.isArray(b.input) || b.input.some(i => i.role === 'system')) seen.badBody.push(b);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const ev = o => res.write(`event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`);
    if (b.input[0].content.includes('LIMIT')) { ev({ type: 'response.output_text.delta', delta: '{' }); ev({ type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded' } } }); return res.end(); }
    const text = '{"reply":"Hello from the fake model.","intent":"kind","rel":1}';
    ev({ type: 'response.created' }); for (let i = 0; i < text.length; i += 9) ev({ type: 'response.output_text.delta', delta: text.slice(i, i + 9) });
    ev({ type: 'response.completed' }); return res.end();
  }
  res.writeHead(404); res.end();
});
await new Promise(r => fake.listen(FP, '127.0.0.1', r));

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ever-test-'));
const bridge = spawn('node', [path.join(root, 'bridge.mjs')], { env: { ...process.env, EVER_PORT: BP, EVER_ISS: FAKE, EVER_API: FAKE + '/v1', EVER_HOME: home, EVER_NO_OPEN: '1' }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise(r => bridge.stdout.on('data', d => String(d).includes('ready') && r()));
const H = { 'x-ever': '1', 'content-type': 'application/json' };
const api = (p, o = {}) => fetch(BR + p, { ...o, headers: { ...H, ...(o.headers || {}) } });
let pass = 0; const ok = (n, c) => { assert.ok(c, n); console.log('  ok  ' + n); pass++; };
try {
  let s = await (await api('/api/status')).json(); ok('starts signed out', !s.signedIn);
  const lg = await (await api('/api/login', { method: 'POST' })).json(); ok('login returns authorize url without opening a browser in tests', lg.url.startsWith(FAKE));
  const a = await fetch(lg.url, { redirect: 'manual' }); ok('issuer redirects to loopback callback', a.status === 302);
  const cb = await fetch(a.headers.get('location')); const cbText = await cb.text(); ok('callback accepts valid code, id token and scopes', cb.status === 200 && cbText.includes('Signed in'));
  s = await (await api('/api/status')).json(); ok('status shows account and plan use', s.signedIn && s.planUse && s.email === 'player@example.com');
  ok('status never exposes tokens', !JSON.stringify(s).includes('at-1') && !JSON.stringify(s).includes('rt-1'));
  const m = await (await api('/api/models')).json(); ok('models filtered to visibility=list', m.models.length === 1 && m.models[0].slug === 'fake-1');
  let r = await (await api('/api/ai', { method: 'POST', body: JSON.stringify({ instructions: 'Reply as JSON.', input: 'hello' }) })).json();
  ok('streamed text assembled until response.completed', JSON.parse(r.text).reply.startsWith('Hello') && r.model === 'fake-1');
  ok('token near expiry was refreshed once', seen.refreshes === 1);
  const lim = await api('/api/ai', { method: 'POST', body: JSON.stringify({ instructions: 'x', input: 'LIMIT' }) }); ok('usage limit maps to 429', lim.status === 429 && (await lim.json()).error === 'subscription_sharing_usage_limit_exceeded');
  ok('requests used store:false, stream:true and no unsupported fields', seen.badBody.length === 0);
  const hostStatus = await new Promise(r => http.get({ host: '127.0.0.1', port: BP, path: '/api/status', headers: { Host: 'evil.example:1466' } }, res => { res.resume(); r(res.statusCode); }));
  ok('wrong Host header is refused (DNS rebinding guard)', hostStatus === 403);
  ok('foreign Origin is refused', (await api('/api/status', { headers: { Origin: 'https://evil.example' } })).status === 403);
  ok('POST without X-Ever header is refused', (await fetch(BR + '/api/ai', { method: 'POST', body: '{}' })).status === 403);
  ok('bad request body is rejected', (await api('/api/ai', { method: 'POST', body: JSON.stringify({ instructions: 1, input: 2 }) })).status === 400);
  const mode = fs.statSync(path.join(home, 'credentials.json')).mode & 0o777; ok('credentials file is owner-only (0600)', mode === 0o600);
  const lo = await (await api('/api/logout', { method: 'POST' })).json(); ok('logout revokes the refresh token', lo.revoked && seen.revoked === 1);
  const after = await api('/api/ai', { method: 'POST', body: JSON.stringify({ instructions: 'x', input: 'y' }) }); ok('AI refused after logout', after.status === 401);
  console.log(`\nAll ${pass} checks passed.`);
} catch (e) { console.error('\nFAILED:', e.message); process.exitCode = 1; }
finally { bridge.kill(); fake.close(); fs.rmSync(home, { recursive: true, force: true }); }
