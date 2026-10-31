// Fake OpenAI issuer + Responses API for manual end-to-end tests (node test/fake-openai.mjs).
// Smoke test: runs the bridge against a fake OpenAI (issuer + Responses API) to check
// the OAuth/PKCE flow, ID-token validation, refresh, streaming and the local security checks.
// This proves our code follows the documented flow; it does not talk to the real OpenAI.
import http from 'node:http';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const FP = +process.env.FAKE_PORT || 9101, BP = +process.env.EVER_PORT || 1466, FAKE = `http://127.0.0.1:${FP}`, BR = `http://127.0.0.1:${BP}`;
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
    const said = (JSON.parse(b.input[0].content).playerSays || '').toLowerCase(); const intent = said.includes('king') ? 'deceive' : said.includes('gold') ? 'bribe' : 'kind'; const text = JSON.stringify({ reply: 'The fake model answers: ' + said.slice(0, 40), intent, rel: 1 });
    ev({ type: 'response.created' }); for (let i = 0; i < text.length; i += 9) ev({ type: 'response.output_text.delta', delta: text.slice(i, i + 9) });
    ev({ type: 'response.completed' }); return res.end();
  }
  res.writeHead(404); res.end();
});
await new Promise(r => fake.listen(FP, '127.0.0.1', r));
console.log('fake OpenAI on', FAKE);
