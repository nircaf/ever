// Contract tests (Technical Director). If one fails, a seam moved: update docs/TECH.md.
// Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later
import {describe, expect, it} from 'vitest'
import * as C from '../../game/src/core/contracts.js'
import {ASHBROOK, STATION_RADIUS} from '../../game/src/shared/style.js'
import {ENEMIES, createEnemy, createFighterState, ensureEngine} from '../../game/src/combat/rules/index.js'
import {canPlay} from '../../vendor/slaytheweb/src/game/conditions.js'

describe('book', () => {
	it('new book matches GDD 1.3', () => {
		const b = C.newBook({meta: {booksWritten: 4, rememberedLine: ''}, seed: 42})
		expect(b.bookNo).toBe(5)
		expect(b.hp).toBe(50)
		expect(b.deck.map((c) => c.id).sort()).toEqual([...C.STARTER_DECK].sort())
		expect(new Set(b.lecternOffer).size).toBe(3)
		expect(C.newBook({seed: 42}).lecternOffer).toEqual(b.lecternOffer) // seeded
		expect(JSON.parse(JSON.stringify(b))).toEqual(b) // plain JSON (wire + DO storage)
	})
	it('deck helpers are pure', () => {
		const b0 = C.newBook({seed: 1})
		const b1 = C.addCard(b0, 'Iron Wave')
		expect(b0.deck).toHaveLength(10)
		expect(b1.deck).toHaveLength(11)
		const b2 = C.upgradeCard(C.removeCard(b1, 'c0'), 'c9')
		expect(b2.deck.find((c) => c.uid === 'c9').upgraded).toBe(true)
		expect(() => C.upgradeCard(b2, 'c9')).toThrow()
		const b3 = C.addCurse(b2, 'shrine', 2)
		expect(b3.deck.filter((c) => c.id === 'Doubt')).toHaveLength(2)
		expect(b3.curses.shrine).toBe(2)
		expect(C.upgradableCards(b3).some((c) => c.id === 'Doubt')).toBe(false)
		const b4 = C.addToken(C.addToken(C.addToken(b3, 'whetstone'), 'ember'), 'ember')
		expect(b4.tokens).toEqual(['ember', 'whetstone'])
		const {book, spent} = C.spendTokensForCombat(b4)
		expect(spent).toEqual(['ember', 'whetstone'])
		expect(book.tokens).toEqual([])
	})
})

describe('map data', () => {
	it('STATIONS agree with the art kit layout', () => {
		for (const k of ['well', 'grindstone', 'lectern', 'shrine', 'marcus']) expect(C.STATIONS[k].pos).toEqual(ASHBROOK[k])
		expect(C.STATIONS.gate.pos).toEqual(ASHBROOK.gateCircle)
		expect(C.SPAWN).toEqual(ASHBROOK.spawn)
		for (const k of ['well', 'grindstone', 'lectern', 'shrine', 'gate']) expect(C.STATIONS[k].radius).toBe(STATION_RADIUS[k])
	})
	it('range check uses radius + tolerance', () => {
		expect(C.inStationRange('well', 3.4, 0)).toBe(true)
		expect(C.inStationRange('well', 3.6, 0)).toBe(false)
		expect(C.inStationRange('well', 3.4, 0, 0)).toBe(false)
	})
})

describe('protocol', () => {
	it('room codes', () => {
		for (let i = 0; i < 200; i++) expect(C.isValidRoomCode(C.makeRoomCode())).toBe(true)
		expect(C.isValidRoomCode('ABCDE')).toBe(false) // vowels
		expect(C.normalizeRoomCode(' bc-dfg ')).toBe('BCDFG')
	})
	it('decodeClient accepts good frames and rejects bad ones', () => {
		expect(C.decodeClient(C.encode(C.MSG.HELLO, {name: 'Ana'})).ok).toBe(true)
		expect(C.decodeClient(C.encode(C.MSG.MOVE, {p: [1, 2, 3], w: 1})).ok).toBe(true)
		expect(C.decodeClient(JSON.stringify({v: 999, t: 'hello', name: 'x'}))).toEqual({ok: false, error: 'version'})
		expect(C.decodeClient(C.encode(C.MSG.MOVE, {p: [1, 'x', 3]})).ok).toBe(false)
		expect(C.decodeClient(C.encode(C.MSG.ACT, {ref: 1, a: {type: 'marcus.friendStruck'}})).ok).toBe(false)
		expect(C.decodeClient(C.encode(C.MSG.WELCOME, {})).ok).toBe(false) // server-only type
		expect(C.decodeClient('x'.repeat(5000)).ok).toBe(false)
	})
	it('cleanName', () => {
		expect(C.cleanName('  <Bo>  b  ')).toBe('Bo b')
		expect(C.cleanName('abcdefghijklmnop')).toHaveLength(12)
	})
	it('resolveRoomServer', () => {
		expect(C.resolveRoomServer({href: 'https://game.dreamz.rest/'})).toEqual({http: 'https://game.dreamz.rest', ws: 'wss://game.dreamz.rest'})
		expect(C.resolveRoomServer({href: 'http://127.0.0.1:1455/'}).ws).toBe('ws://127.0.0.1:8787')
		expect(C.resolveRoomServer({href: 'http://localhost:5173/'}).ws).toBe('ws://localhost:5173')
		expect(C.resolveRoomServer({href: 'https://game.dreamz.rest/?rooms=http://127.0.0.1:9000'}).http).toBe('http://127.0.0.1:9000')
		expect(C.resolveRoomServer({href: 'https://game.dreamz.rest/?rooms=https://evil.example'}).http).toBe('https://game.dreamz.rest')
	})
})

describe('AI validation (GDD 2.5 steps 1-4)', () => {
	it('parses, clamps, sanitizes', () => {
		const r = C.validateAiProposal('sure! {"reply":"  <b>Hm.</b>  ok ", "intent":"help", "trust": 7} trailing')
		expect(r).toEqual({ok: true, proposal: {reply: 'b Hm. /b ok', intent: 'help', trust: 1}})
		expect(C.validateAiProposal('{"reply":"x","intent":"heal","trust":0}').ok).toBe(false)
		expect(C.validateAiProposal('{"reply":"","intent":"ask"}').ok).toBe(false)
		expect(C.validateAiProposal('no json').ok).toBe(false)
		expect(C.validateAiProposal({reply: 'x', intent: 'ask', trust: 'abc'})).toEqual({ok: true, proposal: {reply: 'x', intent: 'ask', trust: 0}})
	})
	it('bridge client is inert off the bridge origin', async () => {
		let called = false
		const bc = C.createBridgeClient({origin: 'https://game.dreamz.rest', fetch: () => (called = true)})
		expect(await bc.status()).toEqual({signedIn: false})
		expect(await bc.ask('{}')).toEqual({ok: false, reason: 'off'})
		expect(called).toBe(false)
	})
})

describe('bus', () => {
	it('on/once/off', () => {
		const b = C.createBus()
		const seen = []
		const off = b.on('x', (p) => seen.push(p))
		b.once('x', (p) => seen.push('once' + p))
		b.emit('x', 1)
		off()
		b.emit('x', 2)
		expect(seen).toEqual([1, 'once1'])
	})
})

describe('vendored engine + EVER content', () => {
	it('Doubt is registered and unplayable; Warden HP scales', () => {
		ensureEngine()
		const b = C.addCurse(C.newBook({seed: 3}), 'cold')
		const s = createFighterState(b, createEnemy('ashWarden', 1))
		expect(s.player.maxHealth).toBe(50)
		expect(s.hand).toHaveLength(5)
		const doubt = s.deck.find((c) => c.name === 'Doubt')
		expect(doubt.type).toBe('curse')
		expect(canPlay({...s, hand: [doubt]}, doubt)).toBe(false)
		expect(createEnemy('ashWarden', 4).maxHealth).toBe(374)
		expect(ENEMIES.ashWarden.intents).toHaveLength(4)
	})
})
