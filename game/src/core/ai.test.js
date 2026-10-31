// AI client: strict validation of model output, offline by default, 20 s timeout, fallback.
// Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach, describe, expect, it, vi} from 'vitest'
import {AI_INSTRUCTIONS, AI_TIMEOUT_MS, BRIDGE_ORIGIN, buildAiInput, createBridgeClient, newBook, validateAiProposal} from './contracts.js'
import {createAiController, proposeFreeText} from './ai.js'

afterEach(() => vi.useRealTimers())

describe('validateAiProposal (GDD 2.5 steps 1-4)', () => {
	const good = {reply: 'Hm. You have decent hands.', intent: 'help', trust: 1}
	it('accepts a clean object and a JSON string with chatter around it', () => {
		expect(validateAiProposal(good)).toEqual({ok: true, proposal: good})
		expect(validateAiProposal('Sure! ' + JSON.stringify(good) + ' hope that helps')).toEqual({ok: true, proposal: good})
		expect(validateAiProposal('```json\n' + JSON.stringify(good) + '\n```').ok).toBe(true)
	})
	it('rejects anything that is not exactly the contract', () => {
		for (const bad of ['', 'no json here', '{broken', '{"reply": "x"}', null, undefined, 3, [], {reply: 'x', intent: 'heal', trust: 0}, {reply: 'x', intent: 'HELP', trust: 0}, {reply: 5, intent: 'help', trust: 0}, {reply: '   ', intent: 'help', trust: 0}, {reply: '<>`', intent: 'help', trust: 0}])
			expect(validateAiProposal(bad).ok, JSON.stringify(bad)).toBe(false)
	})
	it('accepts all eight intents and nothing else', () => {
		for (const intent of ['help', 'threaten', 'bribe', 'deceive', 'flatter', 'steal', 'attack', 'ask']) expect(validateAiProposal({reply: 'x', intent, trust: 0}).ok).toBe(true)
		for (const intent of ['give_item', 'upgrade', 'heal', '', 'ask ', 'Ask']) expect(validateAiProposal({reply: 'x', intent, trust: 0}).ok).toBe(false)
	})
	it('clamps and rounds trust to -1..1, NaN becomes 0', () => {
		const t = (trust) => validateAiProposal({reply: 'x', intent: 'ask', trust}).proposal.trust
		expect([t(9), t(-9), t(0.4), t(0.6), t('1'), t('abc'), t(undefined), t(null), t(Infinity)]).toEqual([1, -1, 0, 1, 1, 0, 0, 0, 1])
	})
	it('strips markup and control characters and caps the reply length', () => {
		const p = validateAiProposal({reply: '  <b>Hello</b>\n\t`code`\u0000 there  ', intent: 'ask', trust: 0}).proposal
		expect(p.reply).toBe('b Hello /b code there')
		expect(p.reply).not.toMatch(/[<>`\u0000-\u001f]/)
		expect(validateAiProposal({reply: 'a'.repeat(1000), intent: 'ask', trust: 0}).proposal.reply).toHaveLength(240)
	})
})

describe('instructions and input', () => {
	it('instructions keep the contract words', () => {
		expect(AI_INSTRUCTIONS).toContain('Reply with ONLY a JSON object')
		expect(AI_INSTRUCTIONS).toContain('"help"|"threaten"|"bribe"|"deceive"|"flatter"|"steal"|"attack"|"ask"')
	})
	it('input is JSON, caps the player text at 120 chars, and hides secrets until the confession', () => {
		const b = newBook({seed: 1})
		const inp = JSON.parse(buildAiInput(b, 'x'.repeat(500)))
		expect(inp.player.says).toHaveLength(120)
		expect(inp.npc).toMatchObject({name: 'Marcus Hale', mood: 'Guarded', trust: 0})
		expect(JSON.stringify(inp.npc.knows)).not.toContain('built the Warden')
		b.marcus.flags.confessed = true
		expect(JSON.stringify(JSON.parse(buildAiInput(b, 'hi')).npc.knows)).toContain('built the Warden')
	})
})

const okFetch = (body, status = 200) => vi.fn(async () => ({ok: status < 400, status, json: async () => body}))

describe('bridge client', () => {
	it('does nothing on the hosted site: no network calls at all', async () => {
		const f = vi.fn()
		for (const origin of ['https://game.dreamz.rest', 'http://127.0.0.1:1456', 'http://localhost:1455', 'http://127.0.0.1:1455.evil.example']) {
			const c = createBridgeClient({origin, fetch: f})
			expect(c.enabled).toBe(false)
			expect(await c.status()).toEqual({signedIn: false})
			expect(await c.ask('{}')).toEqual({ok: false, reason: 'off'})
			expect(await c.login()).toBe(false)
		}
		expect(f).not.toHaveBeenCalled()
	})
	it('on the bridge it posts instructions + input with the x-ever header', async () => {
		const f = okFetch({text: '{"reply":"Hm.","intent":"ask","trust":0}', model: 'm'})
		const c = createBridgeClient({origin: BRIDGE_ORIGIN, fetch: f})
		const r = await c.ask('INPUT')
		expect(r).toEqual({ok: true, proposal: {reply: 'Hm.', intent: 'ask', trust: 0}, model: 'm'})
		const [url, init] = f.mock.calls[0]
		expect(url).toBe('/api/ai')
		expect(init.method).toBe('POST')
		expect(init.headers['x-ever']).toBe('1')
		expect(JSON.parse(init.body)).toEqual({instructions: AI_INSTRUCTIONS, input: 'INPUT'})
	})
	it('maps 429, 401 and junk output to reasons, never to a proposal', async () => {
		const run = async (fetch) => createBridgeClient({origin: BRIDGE_ORIGIN, fetch}).ask('x')
		expect(await run(okFetch({}, 429))).toEqual({ok: false, reason: 'limit'})
		expect(await run(okFetch({}, 401))).toEqual({ok: false, reason: 'auth'})
		expect(await run(okFetch({}, 500))).toEqual({ok: false, reason: 'error'})
		expect(await run(okFetch({text: 'I am a language model'}))).toEqual({ok: false, reason: 'invalid'})
		expect(await run(okFetch({text: '{"reply":"x","intent":"give_item","trust":1}'}))).toEqual({ok: false, reason: 'invalid'})
		expect(await run(vi.fn(async () => { throw new Error('offline') }))).toEqual({ok: false, reason: 'error'})
	})
	it('times out after 20 seconds', async () => {
		vi.useFakeTimers()
		const f = vi.fn((url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))))
		const p = createBridgeClient({origin: BRIDGE_ORIGIN, fetch: f}).ask('x')
		await vi.advanceTimersByTimeAsync(AI_TIMEOUT_MS - 1)
		let settled = false
		p.then(() => (settled = true))
		await Promise.resolve()
		expect(settled).toBe(false)
		await vi.advanceTimersByTimeAsync(2)
		expect(await p).toEqual({ok: false, reason: 'error'})
		expect(AI_TIMEOUT_MS).toBe(20_000)
	})
})

describe('proposeFreeText', () => {
	const book = newBook({seed: 1})
	const bridgeWith = (fetch) => createBridgeClient({origin: BRIDGE_ORIGIN, fetch})
	it('offline: returns the trimmed text and no proposal, without touching the network', async () => {
		const f = vi.fn()
		const r = await proposeFreeText(book, '  hello   there ', createBridgeClient({origin: 'https://game.dreamz.rest', fetch: f}))
		expect(r).toEqual({text: 'hello there'})
		expect(f).not.toHaveBeenCalled()
		expect(await proposeFreeText(book, 'hi', null)).toEqual({text: 'hi'})
	})
	it('active bridge: returns a validated proposal', async () => {
		const f = okFetch({text: 'ok {"reply":"Hm.","intent":"help","trust":1}'})
		const r = await proposeFreeText(book, 'I help', bridgeWith(f))
		expect(r.ai).toEqual({reply: 'Hm.', intent: 'help', trust: 1})
		expect(JSON.parse(JSON.parse(f.mock.calls[0][1].body).input).player.says).toBe('I help')
	})
	it('inactive (signed out or blocked): no call', async () => {
		const f = okFetch({})
		expect(await proposeFreeText(book, 'x', bridgeWith(f), {active: false})).toEqual({text: 'x'})
		expect(f).not.toHaveBeenCalled()
	})
	it('falls back to the local script with a notice on every failure', async () => {
		expect((await proposeFreeText(book, 'x', bridgeWith(okFetch({}, 429)))).notice).toBe('limit')
		expect((await proposeFreeText(book, 'x', bridgeWith(okFetch({}, 401)))).notice).toBe('auth')
		expect((await proposeFreeText(book, 'x', bridgeWith(okFetch({text: 'nope'})))).notice).toBe('unavailable')
		const r = await proposeFreeText(book, 'x', bridgeWith(okFetch({}, 500)))
		expect(r.ai).toBeUndefined()
	})
	it('never throws, even if the bridge object misbehaves', async () => {
		const evil = {enabled: true, ask: async () => { throw new Error('boom') }}
		expect(await proposeFreeText(book, 'x', evil)).toEqual({text: 'x', notice: 'unavailable'})
	})
})

describe('controller', () => {
	const texts = {unavailable: 'U', limit: 'L'}
	it('is off and silent on the hosted site (no Connect button state)', async () => {
		const f = vi.fn()
		const c = createAiController({origin: 'https://game.dreamz.rest', fetch: f, texts})
		expect(c.enabled).toBe(false)
		await c.refresh()
		await c.connect()
		expect(c.isActive(newBook({seed: 1}))).toBe(false)
		expect(f).not.toHaveBeenCalled()
	})
	it('detects the bridge via /api/status and turns active only when signed in with plan use', async () => {
		const f = vi.fn(async () => ({ok: true, status: 200, json: async () => ({signedIn: true, email: 'a@b.c', planUse: true})}))
		const c = createAiController({origin: BRIDGE_ORIGIN, fetch: f, texts})
		expect(c.isActive(newBook({seed: 1}))).toBe(false)
		await c.refresh()
		expect(f.mock.calls[0][0]).toBe('/api/status')
		expect(c.state.email).toBe('a@b.c')
		expect(c.isActive(newBook({seed: 1}))).toBe(true)
	})
	it('429 blocks the AI for the rest of that book only, with one toast', async () => {
		const toasts = []
		const f = vi.fn(async (url) => (url === '/api/status' ? {ok: true, status: 200, json: async () => ({signedIn: true, planUse: true})} : {ok: false, status: 429, json: async () => ({})}))
		const c = createAiController({origin: BRIDGE_ORIGIN, fetch: f, texts, toast: (t) => toasts.push(t)})
		await c.refresh()
		const b1 = newBook({seed: 1, meta: {booksWritten: 0, rememberedLine: ''}})
		const r = await c.propose(b1, 'hi')
		expect(r.notice).toBe('limit')
		expect(toasts).toEqual(['L'])
		expect(c.isActive(b1)).toBe(false)
		await c.propose(b1, 'again')
		expect(f.mock.calls.filter(([u]) => u === '/api/ai')).toHaveLength(1) // not called again
		expect(c.isActive(newBook({seed: 2, meta: {booksWritten: 1, rememberedLine: ''}}))).toBe(true) // next book
	})
	it('warns once about an unavailable AI, then stays quiet', async () => {
		const toasts = []
		const f = vi.fn(async (url) => (url === '/api/status' ? {ok: true, status: 200, json: async () => ({signedIn: true, planUse: true})} : {ok: false, status: 500, json: async () => ({})}))
		const c = createAiController({origin: BRIDGE_ORIGIN, fetch: f, texts, toast: (t) => toasts.push(t)})
		await c.refresh()
		const b = newBook({seed: 1})
		await c.propose(b, 'a')
		await c.propose(b, 'b')
		expect(toasts).toEqual(['U'])
	})
})
