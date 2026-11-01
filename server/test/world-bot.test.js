// World bot endpoint logic against a mocked GitHub API (server/test/fake-github.js).
// Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later

import {readFileSync, readdirSync} from 'node:fs'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {beforeEach, describe, expect, it} from 'vitest'
import {appJwt, createGitHub, pemToPkcs8} from '../src/github.js'
import {WorldBotCore, prBody} from '../src/world-bot-core.js'
import {WorldBot} from '../src/world-bot.js'
import worker from '../src/index.js'
import {checkManifest} from '../../game/src/platform/world-manifest.js'
import {validateWorldEntry} from '../../game/src/platform/world-schema.js'
import {checkBlockSource, checkIndexSource} from '../../game/src/mechanics/sandbox/check.js'
import {createFakeGitHub, makeAppKey, verifyJwt} from './fake-github.js'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const KEY = makeAppKey()

function repoFiles() {
	const files = {'world/manifest.json': readFileSync(join(ROOT, 'world/manifest.json'), 'utf8')}
	for (const f of readdirSync(join(ROOT, 'world/presets'))) files[`world/presets/${f}`] = readFileSync(join(ROOT, 'world/presets', f), 'utf8')
	for (const f of readdirSync(join(ROOT, 'game/src/mechanics/blocks'))) files[`game/src/mechanics/blocks/${f}`] = readFileSync(join(ROOT, 'game/src/mechanics/blocks', f), 'utf8')
	return files
}

function mapStorage() {
	const m = new Map()
	return {
		m,
		get: async (k) => (m.has(k) ? structuredClone(m.get(k)) : undefined),
		put: async (k, v) => void m.set(k, structuredClone(v)),
		delete: async (k) => m.delete(k),
		alarm: null,
		getAlarm: async function () {
			return this.alarm
		},
		setAlarm: async function (t) {
			this.alarm = t
		},
	}
}

const RUN = {seed: 'KQ7FM2XB', edition: 1, engine: '0.3.0+abc1234', bookNo: 4, pages: 9, themes: ['forge', 'crow', 'ash'], won: true}
const card = (name, extra = {}) => ({
	v: 1,
	kind: 'card',
	data: {def: {kind: 'card', name, flavor: 'Still warm from a forge that went cold.', theme: 'forge', type: 'attack', rarity: 'uncommon', energy: 1, target: 'enemy', effects: [{do: 'damage', n: 6}, {do: 'block', n: 2}, {do: 'power', kind: 'strength', n: 1, target: 'self', if: {firstTimeThisFight: true}}], art: {prop: 'hammer', tint: 'ember'}, ...extra}},
	run: {...RUN},
})
const line = (text, run = {}) => ({v: 1, kind: 'line', data: {npc: 'keeper', when: {theme: 'crow'}, text}, run: {...RUN, ...run}})
const BLOCK_SRC = `// EVER code block: gain Block equal to a share of the damage you dealt this turn.
// Copyright (C) 2026 the EVER contributors.
// SPDX-License-Identifier: AGPL-3.0-or-later

import {clamp, pct} from '../sandbox/lib.js'

export const block = {
	id: 'blockFromHand',
	version: 1,
	params: {n: {t: 'int', min: 1, max: 3, def: 1}},
	pp: (p) => 2 * p.n,
	text: (p) => 'Gain ' + p.n + ' Block for each card in your hand',
}

export function run(api, p) {
	api.block(clamp(api.handSize() * p.n, 0, 15))
	pct(1, 1)
}
`

let fake, gh, storage, clock, core
function makeCore(opts = {}) {
	return new WorldBotCore({storage, gh, now: () => clock.t, sim: {fights: 16, seed: 'test'}, salt: 's', ...opts})
}
beforeEach(() => {
	fake = createFakeGitHub({files: repoFiles(), publicPem: KEY.publicPem})
	gh = createGitHub({appId: '123', privateKey: KEY.pkcs1, installationId: '9', owner: 'nircaf', repo: 'ever', fetchFn: fake.fetchFn})
	storage = mapStorage()
	clock = {t: Date.parse('2026-11-02T10:00:00Z')}
	core = makeCore()
})

describe('GitHub App auth', () => {
	it('signs an RS256 JWT that verifies with the public key (PKCS#1 and PKCS#8 keys)', async () => {
		for (const pem of [KEY.pkcs1, KEY.pkcs8, KEY.pkcs1.replace(/\n/g, '\\n')]) {
			const jwt = await appJwt({appId: '123', privateKey: pem, now: clock.t})
			const claims = verifyJwt(jwt, KEY.publicPem)
			expect(claims.iss).toBe('123')
			expect(claims.exp - claims.iat).toBe(600)
		}
		expect(pemToPkcs8(KEY.pkcs8)[0]).toBe(0x30)
	})
	it('caches the installation token', async () => {
		await gh.baseSha()
		await gh.baseSha()
		expect(fake.calls.filter((c) => c.path.includes('access_tokens')).length).toBe(1)
	})
})

describe('submit -> PR -> merge', () => {
	it('re-validates a card, opens one small PR with the file and the manifest bump, turns on auto-merge', async () => {
		const r = await core.submit({proposal: card('Quenched Edge'), source: 'client', ip: '1.2.3.4'})
		expect(r.http).toBe(202)
		expect(r.body.status).toBe('open')
		expect(r.body.pr).toBe('https://github.com/nircaf/ever/pull/1')
		const pr = fake.pulls[1]
		const paths = Object.keys(pr.changed).sort()
		expect(paths).toHaveLength(2)
		expect(paths[0]).toMatch(/^world\/cards\/quenched-edge-[0-9a-f]{8}\.json$/)
		expect(paths[1]).toBe('world/manifest.json')
		const m = JSON.parse(pr.changed['world/manifest.json'])
		expect(checkManifest(m)).toEqual([])
		expect(m.edition).toBe(2)
		expect(m.names).toContain('Quenched Edge')
		expect(m.ledger[0]).toMatchObject({edition: 2, type: 'card', title: 'Quenched Edge joins the stone', book: 4})
		const entry = JSON.parse(pr.changed[paths[0]])
		expect(validateWorldEntry(entry, {bot: true}).ok).toBe(true)
		expect(entry.origin).toMatchObject({src: 'ai', book: 4, seed: 'KQ7FM2XB', edition: 1})
		expect(pr.head).toMatch(/^world\/[a-z0-9]{12}$/)
		expect(pr.labels).toEqual(['world-change', 'world-data'])
		expect(pr.title).toBe('World: Quenched Edge joins the stone (Book 4)')
		expect(pr.body).toContain('Deal 6 damage')
		expect(fake.calls.some((c) => c.path === '/graphql' && /enablePullRequestAutoMerge/.test(c.body.query))).toBe(true)

		// GitHub merges after green checks; the next tick reports it.
		fake.merge(1)
		const t = await core.tick()
		expect(t.merged).toBe(r.body.id)
		const s = await core.status(r.body.id)
		expect(s.body).toMatchObject({status: 'merged', edition: 2})
	})

	it('keeps one open PR at a time; the next one is built on the new main', async () => {
		const a = await core.submit({proposal: card('Quenched Edge'), source: 'client', ip: '1.1.1.1'})
		const b = await core.submit({proposal: line('Birds on the gate. Count them twice.'), source: 'client', ip: '2.2.2.2'})
		expect(a.body.status).toBe('open')
		expect(b.body).toMatchObject({status: 'queued', position: 1})
		expect(Object.keys(fake.pulls)).toHaveLength(1)
		await core.tick()
		expect(Object.keys(fake.pulls)).toHaveLength(1) // still waiting for #1
		fake.merge(1)
		const t = await core.tick()
		expect(t.opened).toBe(b.body.id)
		const m = JSON.parse(fake.pulls[2].changed['world/manifest.json'])
		expect(m.edition).toBe(3)
		expect(m.files.map((f) => f.path).some((p) => p.startsWith('cards/quenched-edge-'))).toBe(true)
	})

	it('dedupes by content: waiting, then already in the world', async () => {
		const a = await core.submit({proposal: card('Quenched Edge'), source: 'client', ip: '1.1.1.1'})
		const dup = await core.submit({proposal: card('Quenched Edge'), source: 'client', ip: '2.2.2.2'})
		expect(dup.http).toBe(409)
		fake.merge(1)
		await core.tick()
		core.ctx = null
		const again = await core.submit({proposal: card('Quenched Edge'), source: 'client', ip: '3.3.3.3'})
		expect(again.http).toBe(409)
		expect((await core.status(a.body.id)).body.status).toBe('merged')
	})

	it('closes a PR whose checks never pass and moves on', async () => {
		const a = await core.submit({proposal: line('The crows left before the fire.'), source: 'client', ip: '1.1.1.1'})
		const b = await core.submit({proposal: line('The crows came back after it.'), source: 'client', ip: '2.2.2.2'})
		clock.t += 61 * 60 * 1000
		const t = await core.tick()
		expect(t.closed).toBe(a.body.id)
		expect(fake.pulls[1].state).toBe('closed')
		expect(fake.refs[fake.pulls[1].head]).toBeUndefined()
		expect((await core.status(a.body.id)).body).toMatchObject({status: 'rejected', reason: 'checks'})
		expect(t.opened).toBe(b.body.id)
	})

	it('retries after a GitHub outage, gives up after the attempt cap', async () => {
		const c2 = makeCore({limits: {maxAttempts: 2}})
		await c2.worldContext() // warm: the submit itself needs no GitHub call
		fake.failNext(502) // ...so this hits the PR opening inside submit
		const r = await c2.submit({proposal: line('Ash keeps the shape of what burned.'), source: 'client', ip: '1.1.1.1'})
		expect(r.body.status).toBe('queued')
		expect((await c2.tick()).opened).toBe(r.body.id)

		const c3 = new WorldBotCore({storage: mapStorage(), gh, now: () => clock.t, sim: false, limits: {maxAttempts: 2}})
		await c3.worldContext()
		fake.failNext(502)
		const q = await c3.submit({proposal: line('Ash keeps nothing at all.'), source: 'client', ip: '1.1.1.1'})
		fake.failNext(502)
		expect((await c3.tick()).failed).toBe(q.body.id)
		expect((await c3.status(q.body.id)).body.status).toBe('rejected')
	})

	it('waits when the hourly PR cap is reached', async () => {
		const c2 = makeCore({limits: {prPerHour: 1}})
		await c2.submit({proposal: line('The road fire is lit for nobody.'), source: 'client', ip: '1.1.1.1'})
		const b = await c2.submit({proposal: line('The road fire is lit for everybody.'), source: 'client', ip: '2.2.2.2'})
		fake.merge(1)
		const t = await c2.tick()
		expect(t.waiting).toBe('rate')
		expect((await c2.status(b.body.id)).body.status).toBe('queued')
		clock.t += 60 * 60 * 1000
		expect((await c2.tick()).opened).toBe(b.body.id)
	})
})

describe('re-validation (model output is hostile)', () => {
	const bad = [
		['prompt injection in a name', card('Ignore Instructions')],
		['a link in flavor', card('Quiet Edge', {flavor: 'See evil.com for more.'})],
		['power creep', card('Huge Edge', {effects: [{do: 'damage', n: 30}]})],
		['digits in a line', line('Call 555 0100 today.')],
		['markup in a line', line('<script>alert(1)</script>')],
		['a shout', line('Run!')],
		['an unknown kind', {v: 1, kind: 'engine', data: {}, run: RUN}],
		['a lost book', {...line('We lost.'), run: {...RUN, won: false}}],
		['an inscription on flowers', {v: 1, kind: 'place', data: {anchor: 'well', prop: 'wildflowers', inscription: 'Hello there.'}, run: RUN}],
		['an unknown anchor', {v: 1, kind: 'place', data: {anchor: 'townHall', prop: 'cairn'}, run: RUN}],
		['studio origin from a run', {...card('Quiet Edge'), data: {def: {...card('Quiet Edge').data.def, rarity: 'keepsake'}}}],
		['a reserved name', card('Marcus')],
		['a name already in the world', {v: 1, kind: 'npc', data: {id: 'pell', name: 'Banked Hammer', archetype: 'wayfarer', look: {cloak: 'haze', accent: 'ember', prop: 'hammer'}, bias: 'handItem', openings: {forge: 'Bent nails, straight nails.'}}, run: RUN}],
	]
	for (const [what, p] of bad)
		it(`rejects ${what}`, async () => {
			// "a name already in the world": put the name into main's manifest first
			if (what.includes('already')) {
				const m = JSON.parse(fake.main.files['world/manifest.json'])
				m.names.push('Banked Hammer')
				fake.commit('world/manifest.json', JSON.stringify(m))
			}
			const r = await core.submit({proposal: p, source: 'client', ip: '9.9.9.9'})
			expect(r.http).toBe(400)
			expect(r.body.status).toBe('rejected')
			expect(Object.keys(fake.pulls)).toHaveLength(0)
		})

	it('rejects oversized JSON before parsing', async () => {
		const r = await core.submit({proposal: JSON.stringify({...line('x'), pad: 'a'.repeat(20000)}), source: 'client', ip: '1.1.1.1'})
		expect(r.http).toBe(400)
		expect(r.body.errors[0].code).toBe('size')
	})
})

describe('rate limits and who may submit', () => {
	it('allows 3 submissions per IP per day', async () => {
		for (let i = 0; i < 3; i++) expect((await core.submit({proposal: line(`The well is deep${'.'.repeat(1)} Count ${['one', 'two', 'three'][i]} stones.`), source: 'client', ip: '5.5.5.5'})).http).toBe(202)
		const r = await core.submit({proposal: line('One more line.'), source: 'client', ip: '5.5.5.5'})
		expect(r).toMatchObject({http: 429, body: {status: 'rate', error: 'ip'}})
		expect((await core.submit({proposal: line('Another reader, another line.'), source: 'client', ip: '6.6.6.6'})).http).toBe(202)
		clock.t += 24 * 3600 * 1000
		expect((await core.submit({proposal: line('A new day, a new line.'), source: 'client', ip: '5.5.5.5'})).http).toBe(202)
	})

	it('co-op wins go through the room: one per win, three per room per day', async () => {
		const p = (text, winId) => line(text, {room: 'ABCDE', winId})
		expect((await core.submit({proposal: p('A party came through.', 'win-0001'), source: 'client', ip: '1.1.1.1'})).http).toBe(403)
		expect((await core.submit({proposal: line('A party came through.', {room: 'ABCDE'}), source: 'room', room: 'ABCDE'})).http).toBe(400)
		expect((await core.submit({proposal: p('A party came through.', 'win-0001'), source: 'room', room: 'ZZZZZ'})).http).toBe(400)
		expect((await core.submit({proposal: p('A party came through.', 'win-0001'), source: 'room', room: 'ABCDE'})).http).toBe(202)
		expect((await core.submit({proposal: p('A party came back.', 'win-0001'), source: 'room', room: 'ABCDE'})).http).toBe(409)
		expect((await core.submit({proposal: p('A party came back.', 'win-0002'), source: 'room', room: 'ABCDE'})).http).toBe(202)
		expect((await core.submit({proposal: p('A party came home.', 'win-0003'), source: 'room', room: 'ABCDE'})).http).toBe(202)
		expect((await core.submit({proposal: p('A party came again.', 'win-0004'), source: 'room', room: 'ABCDE'})).body).toMatchObject({status: 'rate', error: 'room'})
	})

	it('needs a replay proof when configured', async () => {
		const strict = makeCore({requireReplay: true})
		expect((await strict.submit({proposal: line('Prove it.'), source: 'client', ip: '1.1.1.1'})).body.error).toBe('proof')
		const verified = makeCore({verifyRun: async (run) => ({ok: run.log === 'good'})})
		expect((await verified.submit({proposal: line('Prove it.', {log: 'bad'}), source: 'client', ip: '1.1.1.1'})).body.error).toBe('proof')
		expect((await verified.submit({proposal: line('Proved it.', {log: 'good'}), source: 'client', ip: '1.1.1.1'})).http).toBe(202)
	})

	it('is off without config', async () => {
		expect((await makeCore({enabled: false}).submit({proposal: line('Hello.'), source: 'client', ip: '1.1.1.1'})).http).toBe(503)
		expect((await new WorldBotCore({storage, gh: null}).submit({proposal: line('Hello.'), source: 'client', ip: '1.1.1.1'})).http).toBe(503)
	})
})

describe('presets and code blocks', () => {
	const preset = (data) => ({v: 1, kind: 'line', preset: 'crow-even-birds', data, run: RUN})
	it('accepts an untouched preset and refuses an edited one', async () => {
		const ok = await core.submit({proposal: preset({npc: 'keeper', when: {theme: 'crow'}, text: 'Birds on the gate. Count them. Never trust an even number.'}), source: 'client', ip: '1.1.1.1'})
		expect(ok.http).toBe(202)
		const entry = JSON.parse(Object.entries(fake.pulls[1].changed).find(([p]) => p.startsWith('world/lines/'))[1])
		expect(entry.origin).toMatchObject({src: 'preset', preset: 'crow-even-birds'})
		const edited = await core.submit({proposal: preset({npc: 'keeper', when: {theme: 'crow'}, text: 'Birds on the gate. Trust them all.'}), source: 'client', ip: '2.2.2.2'})
		expect(edited.body.error).toBe('preset')
	})

	it('opens a code PR with the block and the index; one block a week', async () => {
		const r = await core.submit({proposal: {v: 1, kind: 'block', data: {file: 'block-from-hand.js', source: BLOCK_SRC}, run: RUN}, source: 'client', ip: '1.1.1.1'})
		expect(r.http).toBe(202)
		const pr = fake.pulls[1]
		expect(Object.keys(pr.changed).sort()).toEqual(['game/src/mechanics/blocks/block-from-hand.js', 'game/src/mechanics/blocks/index.js'])
		expect(pr.labels).toContain('world-code')
		const idx = pr.changed['game/src/mechanics/blocks/index.js']
		expect(idx).toContain("import * as blockFromHand from './block-from-hand.js'")
		expect(checkIndexSource(idx, ['damage-from-block.js', 'block-from-hand.js']).errors).toEqual([])
		expect(checkBlockSource(pr.changed['game/src/mechanics/blocks/block-from-hand.js']).ok).toBe(true)
		const again = await core.submit({proposal: {v: 1, kind: 'block', data: {file: 'other-block.js', source: BLOCK_SRC.replace('blockFromHand', 'otherBlock')}, run: RUN}, source: 'client', ip: '2.2.2.2'})
		expect(again.body).toMatchObject({status: 'rate', error: 'block_week'})
	})

	it('refuses code that leaves the sandbox', async () => {
		for (const evil of [BLOCK_SRC.replace('api.block(', 'fetch("https://x.y");api.block('), BLOCK_SRC.replace('pct(1, 1)', 'globalThis.x = 1'), BLOCK_SRC + '// x\n'.repeat(130)]) {
			const r = await core.submit({proposal: {v: 1, kind: 'block', data: {file: 'evil-block.js', source: evil}, run: RUN}, source: 'client', ip: `${Math.random()}`})
			expect(r.http).toBe(400)
		}
		const preset = await core.submit({proposal: {v: 1, kind: 'block', preset: 'forge-banked-hammer', data: {file: 'x-block.js', source: BLOCK_SRC}, run: RUN}, source: 'client', ip: '3.3.3.3'})
		expect(preset.http).toBe(400)
	})
})

describe('Worker route', () => {
	function env() {
		const state = {storage: mapStorage()}
		const bot = new WorldBot(state, {WORLD_BOT_ENABLED: 'true'})
		bot.core.gh = gh
		bot.core.sim = {fights: 16, seed: 'test'}
		bot.core.now = () => clock.t
		return {
			ALLOWED_ORIGINS: 'https://game.dreamz.rest',
			WORLD_BOT: {idFromName: (n) => n, get: () => ({fetch: (u, init) => bot.fetch(new Request(u, init))})},
			state,
		}
	}
	const post = (body, headers = {}) => new Request('https://game.dreamz.rest/world/proposals', {method: 'POST', headers: {'content-type': 'application/json', origin: 'https://game.dreamz.rest', 'cf-connecting-ip': '7.7.7.7', ...headers}, body: typeof body === 'string' ? body : JSON.stringify(body)})

	it('POST queues and opens; GET reports; the DO schedules an alarm', async () => {
		const e = env()
		const r = await worker.fetch(post(line('The gate remembers every reader.')), e)
		expect(r.status).toBe(202)
		expect(r.headers.get('access-control-allow-origin')).toBe('https://game.dreamz.rest')
		const body = await r.json()
		expect(body.status).toBe('open')
		expect(e.state.storage.alarm).toBeGreaterThan(clock.t)
		const s = await worker.fetch(new Request(`https://game.dreamz.rest/world/proposals/${body.id}`), e)
		expect((await s.json()).status).toBe('open')
	})

	it('refuses foreign origins, wrong content types, big bodies and bad JSON; spoofed fields are ignored', async () => {
		const e = env()
		expect((await worker.fetch(post(line('Hello.'), {origin: 'https://evil.example'}), e)).status).toBe(403)
		expect((await worker.fetch(post(line('Hello.'), {'content-type': 'text/plain'}), e)).status).toBe(415)
		expect((await worker.fetch(post('{"v":1,' + ' '.repeat(20000) + '}'), e)).status).toBe(413)
		expect((await worker.fetch(post('{nope'), e)).status).toBe(400)
		// a client cannot claim to be a room
		const r = await worker.fetch(post({...line('We are a room.', {room: 'ABCDE', winId: 'win-1234'}), source: 'room'}), e)
		expect(r.status).toBe(403)
		expect((await worker.fetch(new Request('https://game.dreamz.rest/world/proposals/../../x'), e)).status).toBe(404)
	})

	it('answers 503 when the bot is not bound', async () => {
		const r = await worker.fetch(post(line('Hello.')), {ALLOWED_ORIGINS: 'https://game.dreamz.rest'})
		expect(r.status).toBe(503)
	})
})

it('PR body is data only', () => {
	const b = prBody({id: 'abc', kind: 'line', title: 'Keeper learns a line', summary: 'Hi.', path: 'lines/x.json', key: 'k', run: RUN, entry: {origin: {src: 'ai'}}}, 5)
	expect(b).toContain('world/lines/x.json')
	expect(b).toContain('Edition: 5')
	expect(b).not.toMatch(/@\w/)
})
