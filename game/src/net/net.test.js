// Net client + combat driver + interpolation tests. The fake WebSocket talks to a real
// RoomCore in-process, so these cover the client against the actual room logic.
// Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {CLOSE, MSG, STATIONS, STORAGE_KEYS, createBus, encode} from '../core/contracts.js'
import {RoomCore} from '../../../server/src/room-core.js'
import {RULES} from '../../../server/src/rules.js'
import {BACKOFF_MS, NetError, createNetClient} from './client.js'
import {createNetCombatDriver} from './combat-driver.js'
import {createInterpolator, lerpAngle} from './interp.js'
import {attachPeers} from './peers.js'

function memStorage() {
	const m = new Map()
	return {getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m}
}

/** A fake server: one RoomCore per code, fake sockets delivering frames on microtasks. */
function fakeNet() {
	const rooms = new Map()
	const sockets = new Map()
	let cidN = 0
	let tokN = 0
	let down = false
	const makeRoom = (code) => {
		const core = new RoomCore(
			{
				send: (cid, f) => sockets.get(cid)?._deliver(f),
				close: (cid, code2, reason) => sockets.get(cid)?._serverClose(code2, reason),
				bind() {},
				scheduleMoves: () => queueMicrotask(() => core.flushMoves()),
				now: () => Date.now(),
				token: () => `tok_${String(++tokN).padStart(20, '0')}`,
			},
			RULES,
		)
		core.init(code)
		rooms.set(code, core)
		return core
	}
	class FakeWS {
		constructor(url) {
			this.url = url
			this.readyState = 0
			this.l = {open: [], message: [], close: [], error: []}
			this.cid = `k${++cidN}`
			const code = url.match(/\/room\/([A-Z0-9]{5})/)[1]
			queueMicrotask(() => {
				if (down) return this._serverClose(1006, '')
				this.core = rooms.get(code)
				if (!this.core) {
					this.readyState = 1
					this._deliver(encode(MSG.ERROR, {code: 'no_room'}))
					return this._serverClose(CLOSE.NO_ROOM, 'no_room')
				}
				sockets.set(this.cid, this)
				this.core.open(this.cid)
				this.readyState = 1
				this._emit('open', {})
			})
		}
		addEventListener(t, fn) {
			this.l[t].push(fn)
		}
		_emit(t, e) {
			for (const fn of this.l[t]) fn(e)
		}
		_deliver(f) {
			if (this.readyState !== 1) return
			queueMicrotask(() => this._emit('message', {data: f}))
		}
		_serverClose(code) {
			if (this.readyState === 3) return
			this.readyState = 3
			sockets.delete(this.cid)
			queueMicrotask(() => this._emit('close', {code}))
		}
		send(f) {
			if (this.readyState !== 1) throw new Error('not open')
			this.core.message(this.cid, f)
		}
		close(code = 1000) {
			if (this.readyState === 3) return
			this.readyState = 3
			sockets.delete(this.cid)
			this.core?.close(this.cid)
			queueMicrotask(() => this._emit('close', {code}))
		}
		/** simulate a network drop (server notices, client gets 1006) */
		_cut() {
			this.readyState = 3
			sockets.delete(this.cid)
			this.core.close(this.cid)
			queueMicrotask(() => this._emit('close', {code: 1006}))
		}
	}
	const fetchImpl = async (url, init) => {
		if (down) throw new TypeError('fetch failed')
		if (url.endsWith('/room/new') && init?.method === 'POST') {
			const code = ['BCDFG', 'HJKLM', 'NPQRS'][rooms.size]
			makeRoom(code)
			return {status: 201, json: async () => ({code, v: 1})}
		}
		return {status: 404, json: async () => ({})}
	}
	return {rooms, sockets, FakeWS, fetchImpl, setDown: (v) => (down = v)}
}

const flush = async (n = 6) => {
	for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0))
}

function client(net, extra = {}) {
	return createNetClient({bus: createBus(), server: {http: 'http://127.0.0.1:8787', ws: 'ws://127.0.0.1:8787'}, fetch: net.fetchImpl, WebSocket: net.FakeWS, storage: memStorage(), ...extra})
}

describe('net client', () => {
	it('hosts, joins, sees the room, stores the seat token', async () => {
		const net = fakeNet()
		const a = client(net)
		const host = await a.hostGame({name: 'Ana'})
		expect(host).toEqual({code: 'BCDFG', seat: 0})
		expect(a.status).toBe('open')
		const b = client(net)
		const states = []
		b.onState((r) => states.push(r))
		expect(await b.joinGame('bcd-fg', {name: 'Bob'})).toEqual({code: 'BCDFG', seat: 1})
		await flush()
		expect(states.at(-1).seats.map((s) => s.name)).toEqual(['Ana', 'Bob'])
		expect(a.room.seats).toHaveLength(2)
		expect(a.book.deck).toHaveLength(10)
	})

	it('maps join errors to GDD copy', async () => {
		const net = fakeNet()
		const c = client(net)
		await expect(c.joinGame('ZZZZZ', {name: 'Ana'})).rejects.toMatchObject({code: 'no_room', message: 'No room with that code.'})
		await expect(c.joinGame('AAAAA', {name: 'Ana'})).rejects.toMatchObject({code: 'no_room'}) // not in the alphabet
		await expect(c.joinGame('BCDFG', {name: '   '})).rejects.toMatchObject({code: 'name', message: "Name can't be empty."})
		await c.hostGame({name: 'h'})
		for (const n of ['b', 'c', 'd']) await client(net).joinGame('BCDFG', {name: n})
		await expect(client(net).joinGame('BCDFG', {name: 'e'})).rejects.toMatchObject({code: 'full', message: 'That room is full.'})
		net.setDown(true)
		const err = await client(net).hostGame({name: 'x'}).catch((e) => e)
		expect(err).toBeInstanceOf(NetError)
		expect(err.message).toBe("Can't reach the room server. Check your connection.")
	})

	it('request() resolves with the room reply carrying the same ref', async () => {
		const net = fakeNet()
		const a = client(net)
		await a.hostGame({name: 'Ana'})
		const r = await a.request(MSG.ACT, {a: {type: 'grindstone.take'}})
		expect(r).toMatchObject({t: MSG.ERROR, code: 'too_far'})
		expect(typeof r.ref).toBe('number')
	})

	it('sendMove is throttled to 10 Hz and peers are relayed', async () => {
		vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance']})
		try {
			const net = fakeNet()
			const a = client(net)
			const b = client(net)
			const pa = a.hostGame({name: 'Ana'})
			await vi.advanceTimersByTimeAsync(10)
			await pa
			const pb = b.joinGame('BCDFG', {name: 'Bob'})
			await vi.advanceTimersByTimeAsync(10)
			await pb
			const sent = []
			const core = net.rooms.get('BCDFG')
			const orig = core.message.bind(core)
			core.message = (cid, raw) => (sent.push(JSON.parse(raw)), orig(cid, raw))
			await vi.advanceTimersByTimeAsync(200)
			for (let i = 0; i < 10; i++) b.sendMove(0, 22 - i * 0.05, 0, true)
			expect(sent.filter((m) => m.t === MSG.MOVE)).toHaveLength(1)
			await vi.advanceTimersByTimeAsync(100)
			expect(sent.filter((m) => m.t === MSG.MOVE)).toHaveLength(2)
			expect(sent.filter((m) => m.t === MSG.MOVE).at(-1).p).toEqual([0, 21.55, 0])
			b.sendMove(0, 21.55, 0, true) // unchanged: not sent
			await vi.advanceTimersByTimeAsync(200)
			expect(sent.filter((m) => m.t === MSG.MOVE)).toHaveLength(2)
			b.sendMove(0, 21.55, 0, false) // stopping is always sent
			expect(sent.filter((m) => m.t === MSG.MOVE).at(-1)).toMatchObject({p: [0, 21.55, 0], w: 0})
			await vi.advanceTimersByTimeAsync(300)
			expect(a.peerSeats()).toContain(1)
			expect(a.peerAt(1).z).toBeCloseTo(21.55, 2)
		} finally {
			vi.useRealTimers()
		}
	})

	it('reconnects with backoff to the same seat after a drop', async () => {
		vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance']})
		try {
			const net = fakeNet()
			const a = client(net)
			const b = client(net)
			let p = a.hostGame({name: 'Ana'})
			await vi.advanceTimersByTimeAsync(10)
			await p
			p = b.joinGame('BCDFG', {name: 'Bob'})
			await vi.advanceTimersByTimeAsync(10)
			const {seat} = await p
			const statuses = []
			b.onStatus((s) => statuses.push(s))
			const bookSeed = b.book.seed
			net.setDown(true)
			;[...net.sockets.values()].find((s) => s.core.seats[seat]?.cid === s.cid)._cut()
			await vi.advanceTimersByTimeAsync(BACKOFF_MS[0] + BACKOFF_MS[1] + 50) // two failed tries
			expect(b.status).toBe('reconnecting')
			expect(a.room.seats[1].connected).toBe(false)
			net.setDown(false)
			await vi.advanceTimersByTimeAsync(BACKOFF_MS[2] + 50)
			expect(b.status).toBe('open')
			expect(b.seat).toBe(seat)
			expect(b.book.seed).toBe(bookSeed)
			expect(statuses).toEqual(['reconnecting', 'open'])
			expect(a.room.seats[1].connected).toBe(true)
		} finally {
			vi.useRealTimers()
		}
	})

	it('leave() sends bye, frees the seat and clears the stored token', async () => {
		const net = fakeNet()
		const a = client(net)
		const storage = memStorage()
		const b = client(net, {storage})
		await a.hostGame({name: 'Ana'})
		await b.joinGame('BCDFG', {name: 'Bob'})
		expect(storage.getItem(STORAGE_KEYS.seat('BCDFG'))).toContain('tok_')
		b.leave()
		await flush()
		expect(storage.getItem(STORAGE_KEYS.seat('BCDFG'))).toBeNull()
		expect(a.room.seats).toHaveLength(1)
		expect(b.status).toBe('closed')
	})
})

describe('net combat driver', () => {
	it('plays a co-op round through the room', async () => {
		const net = fakeNet()
		const a = client(net)
		const b = client(net)
		await a.hostGame({name: 'Ana'})
		await b.joinGame('BCDFG', {name: 'Bob'})
		const core = net.rooms.get('BCDFG')
		for (const s of core.seats.filter(Boolean)) s.pos = [STATIONS.gate.pos[0], STATIONS.gate.pos[1], 0] // stand in the circle
		a.send(MSG.GATE, {ready: true})
		b.send(MSG.GATE, {ready: true})
		await flush()
		const da = createNetCombatDriver(a)
		const db = createNetCombatDriver(b)
		expect(da.view().round).toBe(1)
		expect(da.view().hand).toHaveLength(5)
		const seen = []
		db.onView((v, ev) => seen.push(ev))
		const card = da.view().hand.find((c) => c.playable)
		expect(await da.play(card.id)).toEqual({ok: true})
		expect(await da.play('c999')).toEqual({ok: false, error: 'no_card'})
		expect(await da.endTurn()).toEqual({ok: true})
		expect(await db.endTurn()).toEqual({ok: true})
		await flush()
		expect(da.view().round).toBe(2)
		expect(seen.flat().some((e) => e.k === 'play' && e.seat === 0)).toBe(true)
		// finish it
		core.pc.warden.hp = 1
		core.pc.warden.block = 0
		const atk = da.view().hand.find((c) => c.playable && c.type === 'attack')
		await da.play(atk.id)
		await expect(da.done).resolves.toMatchObject({won: true, dead: false})
		await expect(db.done).resolves.toMatchObject({won: true})
	})
})

describe('interpolation', () => {
	it('renders between samples with a delay, extrapolates briefly, snaps on teleport', () => {
		const ip = createInterpolator({delay: 100, maxExtrapolate: 100})
		ip.push(1, 1000, 0, 0, 0, 1)
		ip.push(1, 1100, 1, 0, 0, 1)
		ip.push(1, 1200, 2, 0, 0, 1)
		expect(ip.sample(1, 1150).x).toBeCloseTo(0.5)
		expect(ip.sample(1, 1300).x).toBeCloseTo(2)
		expect(ip.sample(1, 1350).x).toBeCloseTo(2.5) // extrapolated 50 ms
		expect(ip.sample(1, 2000).x).toBeCloseTo(3) // capped at 100 ms
		ip.push(1, 1300, 0, 22, 0, 0) // respawn at page one
		expect(ip.sample(1, 1500)).toMatchObject({x: 0, z: 22, walking: false})
		expect(ip.sample(2, 1500)).toBeNull()
	})
	it('lerps angles the short way round', () => {
		expect(lerpAngle(3, -3, 0.5)).toBeCloseTo(Math.PI, 1)
	})
})

describe('attachPeers', () => {
	it('draws peers through the WorldApi and applies server corrections', () => {
		const handlers = {}
		const fakeNetClient = {
			seat: 0,
			status: 'open',
			room: {seats: [{seat: 0, name: 'Ana'}, {seat: 1, name: 'Bob'}]},
			peerSeats: () => [0, 1],
			peerAt: (s) => ({x: s, z: 1, yaw: 0, walking: true}),
			on: (t, fn) => ((handlers[t] = fn), () => {}),
			moves: [],
			sendMove(...a) {
				this.moves.push(a)
			},
		}
		const calls = []
		const world = {
			upsertPeer: (s, p) => calls.push(['up', s, p.name]),
			removePeer: (s) => calls.push(['rm', s]),
			teleport: (x, z) => calls.push(['tp', x, z]),
			getPlayerPos: () => ({x: 0, z: 22, yaw: 0}),
		}
		let frame
		const detach = attachPeers(fakeNetClient, world, {raf: (fn) => ((frame = fn), 1), caf: () => {}})
		frame()
		expect(calls).toEqual([['up', 1, 'Bob']])
		expect(fakeNetClient.moves).toHaveLength(1)
		handlers[MSG.PEERS]({m: [], fix: [0, 22]})
		expect(calls.at(-1)).toEqual(['tp', 0, 22])
		fakeNetClient.room = {seats: [{seat: 0, name: 'Ana'}]}
		frame()
		expect(calls.at(-1)).toEqual(['rm', 1])
		detach()
	})
})

beforeEach(() => {})
afterEach(() => vi.useRealTimers())
