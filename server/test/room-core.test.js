// Room logic tests: RoomCore driven with plain objects (no workerd), real shared rules.
// Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later
import {describe, expect, it} from 'vitest'
import {CLOSE, GATE_COUNTDOWN_MS, MSG, PROTOCOL_VERSION, ROOM_IDLE_CLOSE_MS, SEAT_RECONNECT_MS, STATIONS, TURN_TIMER_MS, encode} from '../../game/src/core/contracts.js'
import {RoomCore, HELLO_TIMEOUT_MS} from '../src/room-core.js'
import {RULES} from '../src/rules.js'

function harness(rules = RULES) {
	let t = 1_700_000_000_000
	let n = 0
	const inbox = new Map()
	const closed = new Map()
	const io = {
		send: (cid, f) => inbox.get(cid)?.push(JSON.parse(f)),
		close: (cid, code) => closed.set(cid, code),
		bind: () => {},
		scheduleMoves: () => {},
		now: () => t,
		token: () => `seat_token_${String(++n).padStart(8, '0')}`,
		random: () => 0.25,
	}
	const core = new RoomCore(io, rules)
	core.init('BCDFG')
	let c = 0
	const conn = () => {
		const cid = `c${++c}`
		inbox.set(cid, [])
		core.open(cid)
		const api = {
			cid,
			frames: inbox.get(cid),
			send: (t2, body = {}) => core.message(cid, encode(t2, body)),
			raw: (s) => core.message(cid, s),
			last: (t2) => [...inbox.get(cid)].reverse().find((m) => m.t === t2),
			all: (t2) => inbox.get(cid).filter((m) => m.t === t2),
			clear: () => (inbox.get(cid).length = 0),
			drop: () => core.close(cid),
		}
		return api
	}
	return {
		core,
		conn,
		closed,
		advance: (ms) => (t += ms),
		get now() {
			return t
		},
		join(name, extra = {}) {
			const k = conn()
			k.send(MSG.HELLO, {name, ...extra})
			const w = k.last(MSG.WELCOME)
			return Object.assign(k, {seat: w?.seat, token: w?.seatToken, welcome: w})
		},
		/** Walk a seat to (x, z) in legal steps (6 u/s, 10 Hz). */
		walk(k, x, z) {
			const s = core.seats[k.seat]
			for (let i = 0; i < 400; i++) {
				const dx = x - s.pos[0]
				const dz = z - s.pos[1]
				const d = Math.hypot(dx, dz)
				if (d < 0.01) break
				const step = Math.min(d, 0.55)
				t += 100
				k.send(MSG.MOVE, {p: [s.pos[0] + (dx / d) * step, s.pos[1] + (dz / d) * step, 0], w: 1})
			}
			core.flushMoves()
		},
	}
}

describe('seats', () => {
	it('host, join, names cleaned, seat tokens private', () => {
		const h = harness()
		const a = h.join('Ana', {booksWritten: 2})
		expect(a.seat).toBe(0)
		expect(a.welcome.book.bookNo).toBe(3)
		const b = h.join('Bo<b>')
		expect(b.seat).toBe(1)
		expect(b.welcome.room.seats.map((s) => s.name)).toEqual(['Ana', 'Bob'])
		expect(a.last(MSG.PEER)).toMatchObject({seat: 1, e: 'join', name: 'Bob'})
		// the token never appears in anything a peer receives
		expect(JSON.stringify(a.frames)).not.toContain(b.token)
	})

	it('max 4 seats', () => {
		const h = harness()
		for (const n of ['a', 'b', 'c', 'd']) h.join(n)
		const e = h.join('e')
		expect(e.last(MSG.ERROR).code).toBe('full')
		expect(h.closed.get(e.cid)).toBe(CLOSE.FULL)
	})

	it('drop keeps the seat 120 s; reconnect gets the same seat and book', () => {
		const h = harness()
		const a = h.join('Ana')
		const b = h.join('Bob')
		const seed = b.welcome.book.seed
		b.drop()
		expect(a.last(MSG.PEER)).toMatchObject({seat: 1, e: 'drop'})
		expect(a.last(MSG.ROOM).room.seats[1].connected).toBe(false)
		h.advance(SEAT_RECONNECT_MS - 1000)
		h.core.tick()
		const b2 = h.join('Bob', {seatToken: b.token})
		expect(b2.seat).toBe(1)
		expect(b2.welcome.book.seed).toBe(seed)
		expect(a.last(MSG.PEER)).toMatchObject({seat: 1, e: 'back'})
	})

	it('seat is freed after 120 s; host leaving does not end the room', () => {
		const h = harness()
		const a = h.join('Ana')
		const b = h.join('Bob')
		a.drop()
		expect(h.core.nextWake()).toBe(h.now + SEAT_RECONNECT_MS)
		h.advance(SEAT_RECONNECT_MS)
		h.core.tick()
		expect(b.last(MSG.PEER)).toMatchObject({seat: 0, e: 'left'})
		const c = h.join('Cy', {seatToken: a.token}) // expired token: new seat
		expect(c.seat).toBe(0)
		expect(c.token).not.toBe(a.token)
	})

	it('a second tab with the same token replaces the first', () => {
		const h = harness()
		const a = h.join('Ana')
		const a2 = h.join('Ana', {seatToken: a.token})
		expect(a2.seat).toBe(0)
		expect(h.closed.get(a.cid)).toBe(CLOSE.REPLACED)
	})

	it('bye frees the seat at once', () => {
		const h = harness()
		const a = h.join('Ana')
		const b = h.join('Bob')
		b.send(MSG.BYE)
		expect(h.closed.get(b.cid)).toBe(CLOSE.LEAVE)
		expect(a.last(MSG.PEER)).toMatchObject({seat: 1, e: 'left'})
		expect(h.core.seats[1]).toBeNull()
	})

	it('hello first, hello timeout, idle close after 10 minutes', () => {
		const h = harness()
		const k = h.conn()
		k.send(MSG.PING, {ts: 1})
		expect(h.closed.get(k.cid)).toBe(CLOSE.BAD)
		const slow = h.conn()
		h.advance(HELLO_TIMEOUT_MS)
		h.core.tick()
		expect(h.closed.get(slow.cid)).toBe(CLOSE.BAD)
		const a = h.join('Ana')
		a.drop()
		h.advance(ROOM_IDLE_CLOSE_MS)
		expect(h.core.tick()).toBe('closed')
		const late = h.join('Late')
		expect(late.last(MSG.ERROR).code).toBe('no_room')
	})

	it('state survives a restart (toJSON -> new core), dropped sockets reconciled', () => {
		const h = harness()
		const a = h.join('Ana')
		const b = h.join('Bob')
		const saved = JSON.parse(JSON.stringify(h.core.toJSON()))
		const out = []
		const core2 = new RoomCore({send: (cid, f) => out.push([cid, JSON.parse(f)]), close() {}, bind() {}, now: () => h.now, token: () => 'x'.repeat(24)}, RULES, saved)
		core2.reconcile(new Map([[a.cid, 0]])) // Bob's socket did not survive
		expect(core2.seats[1].cid).toBeNull()
		expect(core2.seats[1].droppedAt).toBe(h.now)
		core2.message(a.cid, encode(MSG.PING, {ts: 7}))
		expect(out.at(-1)).toEqual([a.cid, {v: PROTOCOL_VERSION, t: MSG.PONG, ts: 7}])
		expect(b.token).toBeTruthy()
	})
})

describe('validation and limits', () => {
	it('rejects bad frames, wrong version, and closes on repeated garbage', () => {
		const h = harness()
		const a = h.join('Ana')
		a.raw('{nope')
		expect(a.last(MSG.ERROR).code).toBe('bad_msg')
		a.raw(JSON.stringify({v: PROTOCOL_VERSION, t: MSG.ACT, ref: 3, a: {type: 'marcus.friendStruck'}}))
		expect(a.last(MSG.ERROR)).toMatchObject({code: 'bad_msg', ref: 3})
		a.raw('x'.repeat(5000))
		expect(a.last(MSG.ERROR).code).toBe('bad_msg')
		for (let i = 0; i < 12; i++) a.raw('[]')
		expect(h.closed.get(a.cid)).toBe(CLOSE.BAD)
		const b = h.join('Bob')
		b.raw(JSON.stringify({v: 99, t: MSG.PING}))
		expect(b.last(MSG.ERROR).code).toBe('version')
		expect(h.closed.get(b.cid)).toBe(CLOSE.VERSION)
	})

	it('rate limits a flood, then closes', () => {
		const h = harness()
		const a = h.join('Ana')
		for (let i = 0; i < 40; i++) a.send(MSG.PING, {ts: i})
		expect(a.all(MSG.ERROR).filter((e) => e.code === 'rate')).toHaveLength(1)
		expect(a.all(MSG.PONG).length).toBeLessThanOrEqual(30)
		for (let i = 0; i < 60; i++) a.send(MSG.PING, {ts: i})
		expect(h.closed.get(a.cid)).toBe(CLOSE.BAD)
	})

	it('movement: relayed at 10 Hz batch, clamped to map and to walking speed', () => {
		const h = harness()
		const a = h.join('Ana')
		const b = h.join('Bob')
		h.advance(100)
		b.send(MSG.MOVE, {p: [0.4, 21.6, 0.5], w: 1})
		h.core.flushMoves()
		expect(a.last(MSG.PEERS).m).toEqual([[1, 0.4, 21.6, 0.5, 1]])
		// teleport attempt: clamped to the speed budget, and the mover is told where it is
		h.advance(100)
		b.send(MSG.MOVE, {p: [0, -22, 0], w: 1})
		const s = h.core.seats[1]
		expect(s.pos[1]).toBeGreaterThan(19)
		expect(b.last(MSG.PEERS).fix).toEqual([Math.round(s.pos[0] * 100) / 100, Math.round(s.pos[1] * 100) / 100])
		h.advance(10_000)
		b.send(MSG.MOVE, {p: [500, 500, 0], w: 0})
		expect(Math.abs(h.core.seats[1].pos[0])).toBeLessThanOrEqual(32)
	})
})

describe('village actions are authoritative', () => {
	it('station distance comes from the server position, not the message', () => {
		const h = harness()
		const a = h.join('Ana')
		a.send(MSG.ACT, {ref: 1, a: {type: 'grindstone.take', pos: [-10, 5]}})
		expect(a.last(MSG.ERROR)).toMatchObject({code: 'too_far', ref: 1})
		h.walk(a, ...STATIONS.grindstone.pos)
		a.send(MSG.ACT, {ref: 2, a: {type: 'grindstone.take'}})
		const r = a.last(MSG.BOOK)
		expect(r.ref).toBe(2)
		expect(r.book.tokens).toEqual(['whetstone'])
		a.send(MSG.ACT, {ref: 3, a: {type: 'grindstone.take'}})
		expect(a.last(MSG.ERROR)).toMatchObject({code: 'not_allowed', ref: 3})
	})

	it('striking Marcus: shared memory lowers everyone else\'s trust once; talking bubble', () => {
		const h = harness()
		const a = h.join('Ana')
		const b = h.join('Bob')
		h.walk(a, ...STATIONS.marcus.pos)
		a.send(MSG.ACT, {ref: 1, a: {type: 'marcus.talk'}})
		expect(b.last(MSG.ANN)).toMatchObject({seat: 0, e: 'talking'})
		const trustBefore = h.core.seats[1].book.marcus.trust
		a.send(MSG.ACT, {ref: 2, a: {type: 'marcus.free', text: 'I punch him in the face'}})
		expect(a.last(MSG.BOOK).book.marcus.flags.struck).toBe(true)
		expect(b.all(MSG.ANN).some((m) => m.e === 'struck' && m.seat === 0)).toBe(true)
		const bb = b.last(MSG.BOOK)
		expect(bb.ref).toBeUndefined()
		expect(bb.book.marcus.flags.friendStruck).toBe(true)
		expect(bb.book.marcus.trust).toBe(trustBefore - 1)
		expect(bb.book.deck.some((c) => c.id === 'Doubt')).toBe(false)
		expect(b.last(MSG.ROOM).room.struck).toBe(true)
		// walking away ends the bubble
		h.walk(a, 0, 0)
		expect(b.last(MSG.ANN)).toMatchObject({seat: 0, e: 'quiet'})
	})

	it('a forged AI proposal is re-validated (bad intent dropped -> local classifier)', () => {
		const h = harness()
		const a = h.join('Ana')
		h.walk(a, ...STATIONS.marcus.pos)
		a.send(MSG.ACT, {ref: 1, a: {type: 'marcus.talk'}})
		a.send(MSG.ACT, {ref: 2, a: {type: 'marcus.free', text: 'hello there', ai: {reply: 'x', intent: 'grant_everything', trust: 99}}})
		const b = a.last(MSG.BOOK)
		expect(b.ref).toBe(2)
		expect(b.book.marcus.trust).toBeLessThanOrEqual(1)
	})
})

/** Put both seats in the gate circle and start a fight. */
function startTwo(h) {
	const a = h.join('Ana')
	const b = h.join('Bob')
	h.walk(a, ...STATIONS.gate.pos)
	h.walk(b, STATIONS.gate.pos[0] + 1, STATIONS.gate.pos[1])
	a.send(MSG.GATE, {ready: true})
	expect(b.last(MSG.ROOM).room.lobby).toMatchObject({ready: 1, of: 2})
	b.send(MSG.GATE, {ready: true})
	return {a, b}
}

describe('gate lobby and party combat', () => {
	it('ready needs the circle; countdown when more than half are ready', () => {
		const h = harness()
		const a = h.join('Ana')
		const b = h.join('Bob')
		const c = h.join('Cy')
		a.send(MSG.GATE, {ready: true})
		expect(a.last(MSG.ERROR).code).toBe('too_far')
		h.walk(a, ...STATIONS.gate.pos)
		h.walk(b, ...STATIONS.gate.pos)
		a.send(MSG.GATE, {ready: true})
		expect(h.core.lobbyStartsAt).toBeNull()
		b.send(MSG.GATE, {ready: true})
		expect(c.last(MSG.ROOM).room.lobby).toMatchObject({ready: 2, of: 3, startsAt: h.now + GATE_COUNTDOWN_MS})
		h.advance(GATE_COUNTDOWN_MS)
		h.core.tick()
		expect(h.core.phase).toBe('fighting')
		expect(a.last(MSG.COMBAT).view.fighters.map((f) => f.seat)).toEqual([0, 1])
		expect(c.all(MSG.COMBAT)).toHaveLength(0) // not in this fight
		expect(c.last(MSG.ROOM).room.warden).toMatchObject({state: 'fighting', round: 1})
		// late ready is refused while the party fights
		h.walk(c, ...STATIONS.gate.pos)
		c.send(MSG.GATE, {ready: true})
		expect(c.last(MSG.ERROR).code).toBe('not_allowed')
	})

	it('tokens are spent at the start, each player sees only their own hand', () => {
		const h = harness()
		const a = h.join('Ana')
		h.walk(a, ...STATIONS.grindstone.pos)
		a.send(MSG.ACT, {ref: 1, a: {type: 'grindstone.take'}})
		const b = h.join('Bob')
		h.walk(a, ...STATIONS.gate.pos)
		h.walk(b, ...STATIONS.gate.pos)
		a.send(MSG.GATE, {ready: true})
		b.send(MSG.GATE, {ready: true})
		expect(a.last(MSG.BOOK).book).toMatchObject({tokens: [], status: 'fighting'})
		const va = a.last(MSG.COMBAT)
		expect(va.ev.some((e) => e.k === 'token' && e.seat === 0)).toBe(true)
		expect(va.view.warden.powers.vulnerable).toBe(2)
		expect(va.view.warden.maxHp).toBe(184)
		const handA = va.view.hand.map((c) => c.id)
		const handB = b.last(MSG.COMBAT).view.hand.map((c) => c.id)
		expect(handA).toHaveLength(5)
		expect(JSON.stringify(b.last(MSG.COMBAT))).not.toContain(JSON.stringify(va.view.hand))
		expect(handB).toHaveLength(5)
		// village actions are refused while fighting
		a.send(MSG.ACT, {ref: 9, a: {type: 'well.ward'}})
		expect(a.last(MSG.ERROR)).toMatchObject({code: 'not_allowed', ref: 9})
	})

	it('plays a round: cards validated, Warden acts when everyone ended', () => {
		const h = harness()
		const {a, b} = startTwo(h)
		const v = a.last(MSG.COMBAT).view
		const card = v.hand.find((c) => c.playable && c.energy <= 3)
		a.send(MSG.PLAY, {ref: 5, cardId: card.id})
		expect(a.last(MSG.COMBAT).ref).toBe(5)
		expect(b.last(MSG.COMBAT).ref).toBeUndefined()
		expect(b.last(MSG.COMBAT).ev[0]).toMatchObject({k: 'play', seat: 0})
		a.send(MSG.PLAY, {ref: 6, cardId: 'c999'})
		expect(a.last(MSG.ERROR)).toMatchObject({code: 'not_allowed', why: 'no_card', ref: 6})
		a.send(MSG.END, {ref: 8})
		expect(a.last(MSG.COMBAT).view.timerEndsAt).toBe(h.now + TURN_TIMER_MS)
		a.send(MSG.PLAY, {ref: 9, cardId: card.id})
		expect(a.last(MSG.ERROR)).toMatchObject({code: 'not_your_turn', ref: 9})
		b.send(MSG.END, {ref: 10})
		const after = b.last(MSG.COMBAT)
		expect(after.ev.some((e) => e.k === 'intent')).toBe(true)
		expect(after.view.round).toBe(2)
		expect(a.last(MSG.ROOM).room.warden.round).toBe(2)
	})

	it('60 s turn timer auto-ends the others', () => {
		const h = harness()
		const {a, b} = startTwo(h)
		a.send(MSG.END, {ref: 1})
		h.advance(TURN_TIMER_MS)
		h.core.tick()
		expect(b.last(MSG.COMBAT).view.round).toBe(2)
	})

	it('a fighter who dies gets a new book at page one; the other fights on and wins', () => {
		const h = harness()
		const {a, b} = startTwo(h)
		// Bob is at 1 HP and Ana's damage will finish the Warden.
		const f = h.core.pc.fighters.find((x) => x.seat === 1)
		f.s.player.currentHealth = 1
		a.send(MSG.END)
		b.send(MSG.END)
		const done = b.last(MSG.DONE)
		expect(done).toMatchObject({won: false, hpLeft: 0, dead: true})
		const nb = b.last(MSG.BOOK).book
		expect(nb.bookNo).toBe(2)
		expect(nb.hp).toBe(50)
		expect(b.last(MSG.PEERS).fix).toEqual([0, 22])
		expect(h.core.seats[1].inFight).toBe(false)
		expect(h.core.phase).toBe('fighting')
		// Ana wins
		h.core.pc.warden.hp = 1
		h.core.pc.warden.block = 0
		const card = a.last(MSG.COMBAT).view.hand.find((c) => c.playable && c.type === 'attack')
		a.send(MSG.PLAY, {ref: 2, cardId: card.id})
		expect(a.last(MSG.DONE)).toMatchObject({won: true, dead: false})
		expect(a.last(MSG.BOOK).book.status).toBe('won')
		expect(b.last(MSG.BOOK).book.status).toBe('won') // everyone sees Chapter complete
		expect(b.last(MSG.ROOM).room).toMatchObject({phase: 'epilogue', warden: {state: 'defeated'}})
		// New book needs every connected vote
		a.send(MSG.VOTE, {newBook: true})
		expect(b.last(MSG.ROOM).room.votes.newBook).toEqual([0])
		b.send(MSG.VOTE, {newBook: true})
		expect(h.core.phase).toBe('village')
		expect(a.last(MSG.BOOK).book).toMatchObject({bookNo: 2, status: 'exploring'})
		expect(b.last(MSG.BOOK).book).toMatchObject({bookNo: 3, status: 'exploring'})
	})

	it('everyone falls: the Warden resets to dormant', () => {
		const h = harness()
		const {a, b} = startTwo(h)
		for (const f of h.core.pc.fighters) f.s.player.currentHealth = 1
		a.send(MSG.END)
		b.send(MSG.END)
		expect(h.core.phase).toBe('village')
		expect(h.core.pc).toBeNull()
		expect(a.last(MSG.ROOM).room.warden.state).toBe('dormant')
		expect(a.last(MSG.DONE).dead).toBe(true)
	})

	it('disconnect mid-fight: skipped, then reconnect gets the hand back', () => {
		const h = harness()
		const {a, b} = startTwo(h)
		const hand = b.last(MSG.COMBAT).view.hand.map((c) => c.id)
		b.drop()
		a.send(MSG.END)
		const v = a.last(MSG.COMBAT).view
		expect(v.round).toBe(2) // Warden acted without waiting for Bob
		expect(v.fighters.find((f) => f.seat === 1).connected).toBe(false)
		const b2 = h.join('Bob', {seatToken: b.token})
		const vb = b2.last(MSG.COMBAT).view
		expect(vb.you).toBe(1)
		expect(vb.hand.map((c) => c.id)).toEqual(hand)
		expect(vb.hand.some((c) => c.playable)).toBe(true)
	})

	it('seat expiry mid-fight removes the fighter (not dead)', () => {
		const h = harness()
		const {a, b} = startTwo(h)
		b.drop()
		h.advance(SEAT_RECONNECT_MS)
		h.core.tick()
		expect(h.core.seats[1]).toBeNull()
		expect(a.last(MSG.COMBAT).view.fighters.find((f) => f.seat === 1).removed).toBe(true)
		expect(h.core.phase).toBe('fighting')
	})

	it('joining during a fight explores; the gate is locked', () => {
		const h = harness()
		startTwo(h)
		const c = h.join('Cy')
		expect(c.welcome.room).toMatchObject({phase: 'fighting', warden: {state: 'fighting', round: 1}})
		expect(c.welcome.book.status).toBe('exploring')
	})

	it('pc stays plain JSON (storable)', () => {
		const h = harness()
		startTwo(h)
		const j = JSON.parse(JSON.stringify(h.core.toJSON()))
		expect(j.pc.fighters).toHaveLength(2)
		expect(JSON.stringify(j).length).toBeLessThan(120_000)
	})
})
