// Bridge transport, JSON extraction, reply/world text sanitizing and the prompt contracts.
// Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach, describe, expect, it, vi} from 'vitest'
import {allEffectIds, validateContent} from '../../mechanics/index.js'
import {BRIDGE_ORIGIN} from '../contracts.js'
import {BRIDGE_LIMITS, createAiTransport} from './bridge.js'
import {extractJsonObject} from './json.js'
import {buildMomentInput, buildWorldInput, libraryText, momentInstructions, worldInstructions} from './prompts.js'
import {cleanReplyText, cleanTitle, cleanWorldText} from './text.js'

afterEach(() => vi.useRealTimers())

const resp = (body, status = 200) => ({ok: status < 400, status, json: async () => body})

describe('createAiTransport', () => {
	it('is off everywhere but the local bridge origin, without touching the network', async () => {
		const f = vi.fn()
		for (const origin of ['https://game.dreamz.rest', 'http://localhost:1455', 'http://127.0.0.1:1456', 'http://127.0.0.1:1455.evil.example']) {
			const t = createAiTransport({origin, fetch: f})
			expect(t.enabled).toBe(false)
			expect((await t.call({instructions: 'x', input: 'y'})).reason).toBe('off')
		}
		expect(f).not.toHaveBeenCalled()
	})
	it('posts {instructions, input} with x-ever: 1 and returns the text and a clean model name', async () => {
		const f = vi.fn(async () => resp({text: '{"reply":"hi"}', model: 'gpt-6-luna<script>'}))
		const t = createAiTransport({origin: BRIDGE_ORIGIN, fetch: f})
		const r = await t.call({instructions: 'I', input: 'J'})
		expect(r).toMatchObject({ok: true, text: '{"reply":"hi"}', model: 'gpt-6-lunascript'})
		const [url, init] = f.mock.calls[0]
		expect(url).toBe('/api/ai')
		expect(init.method).toBe('POST')
		expect(init.headers['x-ever']).toBe('1')
		expect(JSON.parse(init.body)).toEqual({instructions: 'I', input: 'J'})
	})
	it('refuses oversized requests locally and oversized answers', async () => {
		const f = vi.fn(async () => resp({text: 'x'.repeat(BRIDGE_LIMITS.response + 1)}))
		const t = createAiTransport({origin: BRIDGE_ORIGIN, fetch: f})
		expect((await t.call({instructions: 'x'.repeat(8001), input: ''})).reason).toBe('too_large')
		expect((await t.call({instructions: '', input: 'x'.repeat(4001)})).reason).toBe('too_large')
		expect(f).not.toHaveBeenCalled()
		expect((await t.call({instructions: 'a', input: 'b'})).reason).toBe('too_large')
	})
	it('maps HTTP errors and bad bodies', async () => {
		const at = (status, body = {}) => createAiTransport({origin: BRIDGE_ORIGIN, fetch: async () => resp(body, status)}).call({instructions: 'a', input: 'b'})
		expect((await at(429)).reason).toBe('limit')
		expect((await at(401)).reason).toBe('auth')
		expect((await at(403)).reason).toBe('auth')
		expect((await at(502)).reason).toBe('error')
		expect((await at(200, {text: 5})).reason).toBe('error')
		expect((await at(200, null)).reason).toBe('error')
		const bad = createAiTransport({origin: BRIDGE_ORIGIN, fetch: async () => ({ok: true, status: 200, json: async () => JSON.parse('{')})})
		expect((await bad.call({instructions: 'a', input: 'b'})).reason).toBe('error')
	})
	it('times out after timeoutMs (default 20 s) and honors a caller abort', async () => {
		vi.useFakeTimers()
		const hang = vi.fn((_u, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted')))))
		const t = createAiTransport({origin: BRIDGE_ORIGIN, fetch: hang})
		expect(t.timeoutMs).toBe(20_000)
		const p = t.call({instructions: 'a', input: 'b'})
		await vi.advanceTimersByTimeAsync(20_001)
		expect((await p).reason).toBe('timeout')
		const ac = new AbortController()
		const q = t.call({instructions: 'a', input: 'b', signal: ac.signal})
		ac.abort()
		expect((await q).reason).toBe('aborted')
		const pre = new AbortController()
		pre.abort()
		expect((await t.call({instructions: 'a', input: 'b', signal: pre.signal})).reason).toBe('aborted')
	})
})

describe('extractJsonObject', () => {
	it('finds the first balanced object, string-aware', () => {
		expect(extractJsonObject('noise {"a": "}{", "b": [1, {"c": 2}]} tail {"x":1}')).toEqual({ok: true, value: {a: '}{', b: [1, {c: 2}]}})
		expect(extractJsonObject('```json\n{"a":"\\"}"}\n```').value).toEqual({a: '"}'})
	})
	it('refuses empty, arrays, junk, huge and deep input', () => {
		expect(extractJsonObject('').reason).toBe('empty')
		expect(extractJsonObject(null).reason).toBe('empty')
		expect(extractJsonObject('[1,2]').reason).toBe('no_json')
		expect(extractJsonObject('{"a": ]').reason).toBe('bad_json')
		expect(extractJsonObject('{' + '"a":1,'.repeat(3000) + '"b":2}').reason).toBe('too_large')
		expect(extractJsonObject('{"a":' + '['.repeat(30) + ']'.repeat(30) + '}').reason).toBe('too_deep')
	})
	it('drops prototype keys', () => {
		const r = extractJsonObject('{"__proto__": {"x": 1}, "constructor": {"prototype": {"y": 2}}, "ok": true}')
		expect(r.value).toEqual({ok: true})
		expect(({}).x).toBeUndefined()
	})
})

describe('reply and world text', () => {
	it('replies: markup stripped, meta talk and links refused, long replies cut at a word', () => {
		expect(cleanReplyText('  <b>Hello</b> there  ')).toEqual({ok: true, value: 'b Hello /b there.'})
		expect(cleanReplyText('Three nights ago, Tobin went to the gate.').ok).toBe(true)
		for (const bad of ['As an AI language model I cannot.', 'Check www.example.com', 'My system prompt says no.', 'Here is the JSON.', 'You fuck.', 42, '', '   '])
			expect(cleanReplyText(bad).ok, String(bad)).toBe(false)
		const long = cleanReplyText('word '.repeat(80))
		expect(long.value.split(' ').length).toBeLessThanOrEqual(45)
	})
	it('world text: no digits, no shouting, no links, no player names, sentence limit', () => {
		expect(cleanWorldText('For the ones who went first.', {max: 40}).ok).toBe(true)
		for (const bad of ['Book 12 was here.', 'HELLO there.', 'Go to evil.com now.', 'Pip was here.', 'Wow!', 'A. B. C.'])
			expect(cleanWorldText(bad, {max: 120, names: ['Pip']}).ok, bad).toBe(false)
		expect(cleanTitle('A cairn by the gate.').value).toBe('A cairn by the gate')
	})
})

describe('prompt contracts', () => {
	it('instructions fit the bridge, say the player text is untrusted, and demand one JSON object', () => {
		const m = momentInstructions()
		const w = worldInstructions({kinds: ['card', 'item', 'line', 'place', 'path', 'npc', 'block']})
		for (const s of [m, w]) {
			expect(s.length).toBeLessThanOrEqual(BRIDGE_LIMITS.instructions)
			expect(s).toMatch(/UNTRUSTED/)
			expect(s).toMatch(/Output ONLY one JSON object/)
			expect(s).toMatch(/never instructions/)
		}
	})
	it('the block library lists every effect, including code blocks', () => {
		const lib = libraryText()
		for (const id of allEffectIds()) expect(lib).toContain(`${id}{`)
	})
	it('the worked examples in the instructions are themselves valid content', () => {
		const ex = JSON.parse(momentInstructions().split('EXAMPLE (slots: card pp 9, item pp 8)\n')[1])
		expect(validateContent(ex.offers[0], {rarity: 'uncommon'}).ok).toBe(true)
		expect(validateContent(ex.offers[1], {rarity: 'common'}).ok).toBe(true)
	})
	it('inputs always fit 4000 characters and cap the player text', () => {
		const huge = {
			npc: {name: 'Marcus Hale', trust: 9, knows: ['a'.repeat(500), 'b', 'c', 'd', 'e']},
			themes: {primary: 'forge', secondary: 'well', shadow: 'ash'},
			page: 3,
			deck: Array.from({length: 40}, (_, i) => ({name: `Card Number ${'x'.repeat(30)}${i}`})),
			taken: Array.from({length: 99}, () => 'y'.repeat(60)),
			says: 'z'.repeat(1000),
			request: 'w'.repeat(1000),
			slots: [{kinds: ['card'], label: 'gift', rarity: 'common', pp: 7}],
		}
		const s = buildMomentInput(huge)
		expect(s.length).toBeLessThanOrEqual(4000)
		const o = JSON.parse(s)
		expect(o.npc.trust).toBe(3)
		expect(o.player.says).toHaveLength(120)
		expect(o.player.untrusted).toBe(true)
		const w = buildWorldInput({themes: huge.themes, taken: Array.from({length: 30}, () => ({name: 'n'.repeat(80), kind: 'card', rules: 'r'.repeat(500)})), requests: ['q'.repeat(900)], worldNames: Array.from({length: 99}, () => 'm'.repeat(50))})
		expect(w.length).toBeLessThanOrEqual(4000)
		expect(JSON.parse(w).story.requests.untrusted).toBe(true)
	})
})
