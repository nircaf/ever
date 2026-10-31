// EVER room logic: everything a room decides, as a plain class with no Workers APIs.
// OWNER: network engineer. The Durable Object (room.js) is a thin shell around it:
// it feeds socket events in and carries frames out. vitest drives it with plain objects.
//
// Authority (TECH 6.4): the room never trusts client numbers except the movement sample
// (which it clamps), runs every book change through applyBookAction with ITS OWN
// context, and every card play through the combat rules. Clients only send intents.
//
// Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later

import {
	CLOSE,
	GATE_COUNTDOWN_MS,
	MAX_SEATS,
	MSG,
	PROTOCOL_VERSION,
	ROOM_IDLE_CLOSE_MS,
	SEAT_RECONNECT_MS,
	SPAWN,
	STATIONS,
	cleanName,
	decodeClient,
	encode,
	inStationRange,
	newBook,
	spendTokensForCombat,
} from '../../game/src/core/contracts.js'
import {RATE, checkMove, cleanClientMsg, createBucket} from './schema.js'

/** Seconds a socket may stay open without sending hello. */
export const HELLO_TIMEOUT_MS = 10_000
/** Combat timers are checked this often while a fight runs. */
export const COMBAT_TICK_MS = 1_000
/** Positions are written to storage at most this often (they are cheap to lose). */
export const POS_SAVE_MS = 2_000
/** A seat is "talking" until it walks this far past Marcus's radius. */
const TALK_SLACK = 2
const ENEMY_ID = 'ashWarden'
const ERROR_CODES = new Set(['version', 'no_room', 'full', 'bad_msg', 'not_allowed', 'too_far', 'not_your_turn', 'not_in_fight', 'rate', 'server'])

/**
 * @typedef {object} SeatState   (plain JSON; stored in DO storage)
 * @prop {number} seat
 * @prop {string} name
 * @prop {string} seatToken      secret; never broadcast
 * @prop {string|null} cid       current connection id (null = dropped)
 * @prop {number|null} droppedAt
 * @prop {import('../../game/src/core/contracts.js').Book} book
 * @prop {[number, number, number]} pos  server copy [x, z, yaw]
 * @prop {0|1} walking
 * @prop {number} moveBudget
 * @prop {number} lastMoveAt
 * @prop {boolean} ready
 * @prop {boolean} inFight
 * @prop {boolean} talking
 * @prop {boolean} vote
 */

/**
 * What the core needs from its host. The DO maps cids to WebSockets; tests record frames.
 * @typedef {object} RoomIO
 * @prop {(cid: string, frame: string) => void} send
 * @prop {(cid: string, code: number, reason: string) => void} close
 * @prop {(cid: string, seat: number|null) => void} bind      remember cid -> seat on the socket
 * @prop {() => void} [scheduleMoves]                         call core.flushMoves() in ~100 ms
 * @prop {() => number} now
 * @prop {() => string} token                                 144-bit random, url-safe
 * @prop {() => number} [random]                               for combat seeds
 */

/**
 * The rules the room runs. Defaults are the real shared modules (room.js passes them);
 * tests may pass fakes with the same contract.
 * @typedef {object} RoomRules
 * @prop {typeof import('../../game/src/core/rules/book.js').applyBookAction} applyBookAction
 * @prop {(o: any) => any} createPartyCombat
 * @prop {(pc: any, seat: number, action: any, now: number) => {pc: any, events: any[], error?: string}} combatStep
 * @prop {(pc: any, now: number) => {pc: any, events: any[]}} tickTimers
 * @prop {(pc: any, seat: number) => any} viewFor
 * @prop {(pc: any) => null | {won: boolean, bySeat: Record<number, {hpLeft: number, dead: boolean}>, rounds: number}} outcome
 */

export class RoomCore {
	/**
	 * @param {RoomIO} io
	 * @param {RoomRules} rules
	 * @param {any} [saved]  output of toJSON()
	 */
	constructor(io, rules, saved = null) {
		this.io = io
		this.rules = rules
		this.code = saved?.code ?? null
		this.created = Boolean(saved?.created)
		this.createdAt = saved?.createdAt ?? 0
		/** @type {(SeatState|null)[]} */
		this.seats = saved?.seats ?? Array(MAX_SEATS).fill(null)
		/** @type {'village'|'fighting'|'epilogue'} */
		this.phase = saved?.phase ?? 'village'
		this.struck = Boolean(saved?.struck)
		this.lobbyStartsAt = saved?.lobbyStartsAt ?? null
		this.pc = saved?.pc ?? null
		this.fight = saved?.fight ?? null // {seats: number[], round, startedAt}
		this.emptySince = saved?.emptySince ?? null
		this.closed = Boolean(saved?.closed)
		// runtime only
		/** @type {Map<string, {openedAt: number, bucket: ReturnType<typeof createBucket>, strikes: number, bad: number, lastRateErr: number, seat: number|null}>} */
		this.conns = new Map()
		this.dirtyMoves = new Set()
		this.dirty = false
		this.posDirty = false
		this.lastPosSave = 0
	}

	// ---------------------------------------------------------------- lifecycle

	/** POST /init from the Worker. @returns {boolean} false if the code is taken */
	init(code) {
		if (this.created) return false
		const now = this.io.now()
		Object.assign(this, {code, created: true, createdAt: now, closed: false, emptySince: now})
		this.dirty = true
		return true
	}

	toJSON() {
		return {
			code: this.code,
			created: this.created,
			createdAt: this.createdAt,
			seats: this.seats,
			phase: this.phase,
			struck: this.struck,
			lobbyStartsAt: this.lobbyStartsAt,
			pc: this.pc,
			fight: this.fight,
			emptySince: this.emptySince,
			closed: this.closed,
		}
	}

	/**
	 * After a DO restart / hibernation wake: `live` maps cid -> seat for sockets that
	 * are still open. Seats whose socket is gone count as dropped from now.
	 * @param {Map<string, number|null>} live
	 */
	reconcile(live) {
		const now = this.io.now()
		for (const [cid, seat] of live) {
			if (!this.conns.has(cid)) this.conns.set(cid, this.newConn(now, seat))
		}
		for (const s of this.livingSeats()) {
			if (s.cid && !live.has(s.cid)) this.markDropped(s, now)
		}
	}

	newConn(now, seat = null) {
		return {openedAt: now, bucket: createBucket(now), strikes: 0, bad: 0, lastRateErr: 0, seat}
	}

	/** A socket was accepted for this room. */
	open(cid) {
		this.conns.set(cid, this.newConn(this.io.now()))
	}

	/** @param {string} cid @param {unknown} raw */
	message(cid, raw) {
		const now = this.io.now()
		let c = this.conns.get(cid)
		if (!c) {
			c = this.newConn(now)
			this.conns.set(cid, c)
		}
		if (!c.bucket.take(now)) {
			c.strikes++
			if (c.strikes > RATE.maxStrikes) return this.kick(cid, CLOSE.BAD, 'flood')
			if (now - c.lastRateErr > 1000) {
				c.lastRateErr = now
				this.io.send(cid, encode(MSG.ERROR, {code: 'rate'}))
			}
			return
		}
		const d = decodeClient(typeof raw === 'string' ? raw : null)
		const m = d.ok ? cleanClientMsg(d.msg) : d
		if (!m.ok) {
			this.io.send(cid, encode(MSG.ERROR, {code: m.error, ref: refOf(raw)}))
			if (m.error === 'version') return this.kick(cid, CLOSE.VERSION, 'version')
			if (++c.bad > RATE.maxBad) return this.kick(cid, CLOSE.BAD, 'bad')
			return
		}
		const msg = m.msg
		const me = c.seat === null ? null : this.seats[c.seat]
		if (!me || me.cid !== cid) {
			if (msg.t !== MSG.HELLO) return this.kick(cid, CLOSE.BAD, 'hello first')
			return this.hello(cid, msg)
		}
		if (msg.t === MSG.HELLO) return this.send(me, MSG.ERROR, {code: 'bad_msg'})
		this.onMessage(me, msg, now)
	}

	/** The socket closed (or errored). */
	close(cid) {
		const c = this.conns.get(cid)
		this.conns.delete(cid)
		if (!c || c.seat === null) return
		const s = this.seats[c.seat]
		if (s && s.cid === cid) this.markDropped(s, this.io.now(), true)
	}

	kick(cid, code, reason) {
		const c = this.conns.get(cid)
		this.conns.delete(cid)
		this.io.close(cid, code, reason)
		if (c && c.seat !== null) {
			const s = this.seats[c.seat]
			if (s && s.cid === cid) this.markDropped(s, this.io.now(), true)
		}
	}

	// ---------------------------------------------------------------- seats

	hello(cid, m) {
		const now = this.io.now()
		if (this.closed || !this.created) {
			this.io.send(cid, encode(MSG.ERROR, {code: 'no_room'}))
			return this.kick(cid, CLOSE.NO_ROOM, 'no_room')
		}
		let s = m.seatToken ? this.livingSeats().find((x) => x.seatToken === m.seatToken) : null
		let event = 'back'
		if (s) {
			if (s.cid && s.cid !== cid) {
				const old = s.cid
				this.conns.delete(old)
				this.io.close(old, CLOSE.REPLACED, 'replaced')
			}
		} else {
			const idx = this.seats.findIndex((x) => !x)
			if (idx < 0) {
				this.io.send(cid, encode(MSG.ERROR, {code: 'full'}))
				return this.kick(cid, CLOSE.FULL, 'full')
			}
			const bw = Number.isInteger(m.booksWritten) && m.booksWritten >= 0 ? Math.min(m.booksWritten, 999_999) : 0
			s = {
				seat: idx,
				name: cleanName(m.name) || 'Reader',
				seatToken: this.io.token(),
				cid: null,
				droppedAt: null,
				book: newBook({meta: {booksWritten: bw, rememberedLine: ''}, now}),
				pos: [SPAWN[0], SPAWN[1], 0],
				walking: 0,
				moveBudget: 0,
				lastMoveAt: now,
				ready: false,
				inFight: false,
				talking: false,
				vote: false,
			}
			this.seats[idx] = s
			event = 'join'
		}
		s.cid = cid
		s.droppedAt = null
		s.lastMoveAt = now
		const c = this.conns.get(cid)
		if (c) c.seat = s.seat
		this.io.bind(cid, s.seat)
		this.emptySince = null
		this.dirty = true
		this.send(s, MSG.WELCOME, {
			code: this.code,
			seat: s.seat,
			seatToken: s.seatToken,
			room: this.snapshot(),
			book: s.book,
			peers: this.livingSeats().map((x) => [x.seat, r2(x.pos[0]), r2(x.pos[1]), r2(x.pos[2]), x.walking]),
		})
		this.broadcast(MSG.PEER, {seat: s.seat, e: event, name: s.name}, s)
		if (event === 'back' && s.inFight && this.pc) {
			this.runCombat(s.seat, {type: 'reconnect'})
		}
		this.recomputeLobby(now)
		this.broadcastRoom()
	}

	markDropped(s, now, announce = true) {
		s.cid = null
		s.droppedAt = now
		s.walking = 0
		s.ready = false
		this.dirty = true
		if (s.talking) this.setTalking(s, false)
		if (announce) this.broadcast(MSG.PEER, {seat: s.seat, e: 'drop', name: s.name})
		if (s.inFight && this.pc) this.runCombat(s.seat, {type: 'disconnect'})
		if (!this.livingSeats().some((x) => x.cid)) this.emptySince = now
		this.recomputeLobby(now)
		this.broadcastRoom()
	}

	/** Free a seat at once (bye, or 120 s expiry). */
	free(s, e) {
		if (this.seats[s.seat] !== s) return
		if (s.inFight && this.pc) {
			s.inFight = false
			this.runCombat(s.seat, {type: 'remove'})
		}
		if (s.cid) {
			const c = this.conns.get(s.cid)
			if (c) c.seat = null
			this.io.bind(s.cid, null)
		}
		this.seats[s.seat] = null
		this.dirtyMoves.delete(s.seat)
		this.dirty = true
		this.broadcast(MSG.PEER, {seat: s.seat, e, name: s.name})
		if (!this.livingSeats().some((x) => x.cid)) this.emptySince ??= this.io.now()
		this.recomputeLobby(this.io.now())
		this.recomputeVotes()
		this.broadcastRoom()
	}

	livingSeats() {
		return /** @type {SeatState[]} */ (this.seats.filter(Boolean))
	}
	connectedSeats() {
		return this.livingSeats().filter((s) => s.cid)
	}

	// ---------------------------------------------------------------- messages

	/** @param {SeatState} me */
	onMessage(me, m, now) {
		switch (m.t) {
			case MSG.MOVE:
				return this.onMove(me, m, now)
			case MSG.PING:
				return this.send(me, MSG.PONG, {ts: m.ts})
			case MSG.BYE: {
				const cid = me.cid
				this.free(me, 'left')
				if (cid) {
					this.conns.delete(cid)
					this.io.close(cid, CLOSE.LEAVE, 'bye')
				}
				return
			}
			case MSG.ACT:
				return this.onAct(me, m, now)
			case MSG.GATE:
				return this.onGate(me, m, now)
			case MSG.PLAY:
			case MSG.END: {
				if (!me.inFight || !this.pc) return this.send(me, MSG.ERROR, {code: 'not_in_fight', ref: m.ref})
				const action = m.t === MSG.PLAY ? {type: 'play', cardId: m.cardId, ...(m.target ? {target: m.target} : {})} : {type: 'end'}
				return this.runCombat(me.seat, action, m.ref)
			}
			case MSG.VOTE:
				return this.onVote(me, m)
		}
	}

	onMove(me, m, now) {
		if (me.inFight) return // staged at the gate while fighting; the world owns the camera
		const r = checkMove(me, m.x, m.z, m.yaw, now)
		me.pos = r.pos
		me.moveBudget = r.moveBudget
		me.lastMoveAt = r.lastMoveAt
		me.walking = m.w
		this.posDirty = true
		if (r.clamped) {
			// Tell the mover where the room thinks they are (they snap if far off).
			const dx = r.pos[0] - m.x
			const dz = r.pos[1] - m.z
			if (Math.hypot(dx, dz) > 1) this.send(me, MSG.PEERS, {m: [], fix: [r2(r.pos[0]), r2(r.pos[1])]})
		}
		if (me.talking && !inStationRange('marcus', me.pos[0], me.pos[1], 1 + TALK_SLACK)) this.setTalking(me, false)
		if (me.ready && !inStationRange('gate', me.pos[0], me.pos[1])) {
			me.ready = false
			this.recomputeLobby(now)
			this.broadcastRoom()
		}
		this.dirtyMoves.add(me.seat)
		this.io.scheduleMoves?.()
	}

	/** 10 Hz batch of positions that changed (called by the host's timer). */
	flushMoves() {
		const m = []
		for (const i of this.dirtyMoves) {
			const s = this.seats[i]
			if (s) m.push([s.seat, r2(s.pos[0]), r2(s.pos[1]), r2(s.pos[2]), s.walking])
		}
		this.dirtyMoves.clear()
		if (m.length) this.broadcast(MSG.PEERS, {m})
		const now = this.io.now()
		if (this.posDirty && now - this.lastPosSave >= POS_SAVE_MS) {
			this.posDirty = false
			this.lastPosSave = now
			this.dirty = true
		}
	}

	ctxFor(s, now) {
		return {pos: /** @type {[number, number]} */ ([s.pos[0], s.pos[1]]), now, coop: true, friendStruck: this.struck && !s.book.marcus?.flags?.struck}
	}

	onAct(me, m, now) {
		if (me.inFight || me.book.status === 'fighting') return this.send(me, MSG.ERROR, {code: 'not_allowed', ref: m.ref})
		const before = me.book
		let r
		try {
			r = this.rules.applyBookAction(before, m.a, this.ctxFor(me, now))
		} catch (err) {
			console.error('[room] applyBookAction', err)
			return this.send(me, MSG.ERROR, {code: 'server', ref: m.ref})
		}
		if (!r || !r.ok) return this.send(me, MSG.ERROR, {code: r?.error === 'too_far' ? 'too_far' : 'not_allowed', ref: m.ref})
		me.book = r.book
		this.dirty = true
		const fx = Array.isArray(r.effects) ? r.effects : []
		this.send(me, MSG.BOOK, {ref: m.ref, book: me.book, fx})
		if (m.a.type === 'marcus.talk' || m.a.type === 'marcus.option' || m.a.type === 'marcus.free') this.setTalking(me, !fx.some((e) => e.k === 'close'))
		if (me.book.hp !== before.hp || me.book.bookNo !== before.bookNo) this.broadcastRoom()
		// GDD 7.2 shared memory: someone struck Marcus -> every other player's trust drops once.
		if (!before.marcus?.flags?.struck && me.book.marcus?.flags?.struck && !this.struck) this.onStruck(me, now)
	}

	onStruck(me, now) {
		this.struck = true
		this.dirty = true
		this.broadcast(MSG.ANN, {seat: me.seat, e: 'struck'})
		for (const o of this.livingSeats()) {
			if (o === me || o.book.marcus?.flags?.struck || o.book.marcus?.flags?.friendStruck) continue
			try {
				const r = this.rules.applyBookAction(o.book, {type: 'marcus.friendStruck'}, {...this.ctxFor(o, now), friendStruck: true})
				if (r?.ok) {
					o.book = r.book
					this.send(o, MSG.BOOK, {book: o.book, fx: r.effects || []})
				}
			} catch (err) {
				console.error('[room] friendStruck', err)
			}
		}
		this.broadcastRoom()
	}

	setTalking(s, on) {
		if (s.talking === on) return
		s.talking = on
		this.broadcast(MSG.ANN, {seat: s.seat, e: on ? 'talking' : 'quiet'})
	}

	// ---------------------------------------------------------------- gate lobby (GDD 7.4)

	onGate(me, m, now) {
		if (!m.ready) {
			if (me.ready) {
				me.ready = false
				this.recomputeLobby(now)
				this.broadcastRoom()
			}
			return
		}
		if (this.phase !== 'village' || me.inFight || me.book.status !== 'exploring') return this.send(me, MSG.ERROR, {code: 'not_allowed'})
		if (!inStationRange('gate', me.pos[0], me.pos[1])) return this.send(me, MSG.ERROR, {code: 'too_far'})
		me.ready = true
		this.recomputeLobby(now)
		this.broadcastRoom()
	}

	lobbyCounts() {
		const pool = this.connectedSeats().filter((s) => !s.inFight)
		return {ready: pool.filter((s) => s.ready).length, of: pool.length}
	}

	recomputeLobby(now) {
		if (this.phase !== 'village') {
			this.lobbyStartsAt = null
			return
		}
		const {ready, of} = this.lobbyCounts()
		if (ready > 0 && ready === of) return this.startFight(now)
		if (ready > of / 2) this.lobbyStartsAt ??= now + GATE_COUNTDOWN_MS
		else this.lobbyStartsAt = null
		this.dirty = true
	}

	// ---------------------------------------------------------------- combat (GDD 7.3)

	startFight(now) {
		const fs = this.connectedSeats().filter((s) => s.ready && !s.inFight && s.book.status === 'exploring')
		this.lobbyStartsAt = null
		if (!fs.length) return
		const prior = new Map(fs.map((s) => [s.seat, s.book]))
		const fighters = fs.map((s) => {
			const {book, spent} = spendTokensForCombat(s.book)
			s.book = {...book, status: 'fighting'}
			// `book` = deck/hp after tokens are spent; `tokens` = what to apply (TECH 5.1).
			return {seat: s.seat, name: s.name, book: s.book, tokens: spent, spent}
		})
		try {
			this.pc = this.rules.createPartyCombat({fighters, enemyId: ENEMY_ID, seed: Math.floor((this.io.random?.() ?? Math.random()) * 2 ** 32), now})
		} catch (err) {
			console.error('[room] createPartyCombat', err)
			for (const s of fs) {
				s.book = prior.get(s.seat)
				s.ready = false
				this.send(s, MSG.ERROR, {code: 'server'})
			}
			this.pc = null
			this.broadcastRoom()
			return
		}
		this.phase = 'fighting'
		this.fight = {seats: fs.map((s) => s.seat), round: 1, startedAt: now}
		for (const s of fs) {
			s.inFight = true
			s.ready = false
			s.walking = 0
			if (s.talking) this.setTalking(s, false)
			this.send(s, MSG.BOOK, {book: s.book, fx: []})
		}
		this.dirty = true
		this.sendViews(Array.isArray(this.pc?.startEvents) ? this.pc.startEvents : [], null, undefined)
		this.broadcastRoom()
	}

	/**
	 * Run one combat action through the rules and fan out the result.
	 * @param {number} seat @param {any} action @param {number} [ref]
	 */
	runCombat(seat, action, ref) {
		const now = this.io.now()
		let r
		try {
			r = this.rules.combatStep(this.pc, seat, action, now)
		} catch (err) {
			console.error('[room] combatStep', err)
			const s = this.seats[seat]
			if (s && ref !== undefined) this.send(s, MSG.ERROR, {code: 'server', ref})
			return
		}
		if (r.error) {
			const s = this.seats[seat]
			// `why` carries the rules' detail ('energy', 'unplayable', ...) for the UI copy.
			if (s && ref !== undefined) this.send(s, MSG.ERROR, {code: ERROR_CODES.has(r.error) ? r.error : 'not_allowed', why: String(r.error).slice(0, 24), ref})
			if (r.pc) this.pc = r.pc
			return
		}
		this.pc = r.pc
		this.dirty = true
		this.afterCombat(r.events || [], seat, ref)
	}

	/** Called every COMBAT_TICK_MS while fighting (60 s turn timer). */
	tickCombat(now) {
		if (!this.pc) return
		let r
		try {
			r = this.rules.tickTimers(this.pc, now)
		} catch (err) {
			console.error('[room] tickTimers', err)
			return
		}
		if (r.pc !== this.pc || (r.events && r.events.length)) {
			this.pc = r.pc
			this.dirty = true
			if (r.events?.length) this.afterCombat(r.events, null, undefined)
		}
	}

	afterCombat(events, seat, ref) {
		this.sendViews(events, seat, ref)
		// Deaths: a fighter at HP < 1 closes their book at once and starts a new one (GDD 7.3).
		for (const i of this.fight?.seats ?? []) {
			const s = this.seats[i]
			if (!s || !s.inFight) continue
			const f = this.fighterView(i)
			if (f?.dead) this.fighterDied(s)
		}
		let o = null
		try {
			o = this.rules.outcome(this.pc)
		} catch (err) {
			console.error('[room] outcome', err)
		}
		if (o) this.endFight(o)
		else {
			const round = this.fighterRound()
			if (this.fight && round !== this.fight.round) {
				this.fight.round = round
				this.broadcastRoom()
			}
		}
	}

	fighterView(seat) {
		try {
			return this.rules.viewFor(this.pc, seat)?.fighters?.find((f) => f.seat === seat) ?? null
		} catch {
			return null
		}
	}
	fighterRound() {
		try {
			return this.rules.viewFor(this.pc, this.fight?.seats?.[0] ?? -1)?.round ?? this.fight?.round ?? 0
		} catch {
			return this.fight?.round ?? 0
		}
	}

	sendViews(events, seat, ref) {
		for (const i of this.fight?.seats ?? []) {
			const s = this.seats[i]
			if (!s || !s.inFight || !s.cid) continue
			let view
			try {
				view = this.rules.viewFor(this.pc, i)
			} catch (err) {
				console.error('[room] viewFor', err)
				continue
			}
			this.send(s, MSG.COMBAT, {...(i === seat && ref !== undefined ? {ref} : {}), view, ev: events})
		}
	}

	/** @param {SeatState} s */
	fighterDied(s) {
		s.inFight = false
		const turns = this.fighterRound()
		this.send(s, MSG.DONE, {won: false, hpLeft: 0, turns, dead: true})
		this.newBookFor(s) // the death screen (GDD 6) is driven by DONE {dead: true}
		this.dirty = true
	}

	/** @param {SeatState} s */
	newBookFor(s, fx = []) {
		const now = this.io.now()
		s.book = newBook({meta: {booksWritten: s.book.booksWritten + 1, rememberedLine: ''}, now})
		s.pos = [SPAWN[0], SPAWN[1], 0]
		s.moveBudget = 0
		s.lastMoveAt = now
		s.ready = false
		s.vote = false
		s.talking = false
		this.send(s, MSG.BOOK, {book: s.book, fx})
		this.send(s, MSG.PEERS, {m: [], fix: [SPAWN[0], SPAWN[1]]})
		this.dirtyMoves.add(s.seat)
		this.io.scheduleMoves?.()
	}

	endFight(o) {
		const fought = this.fight?.seats ?? []
		if (o.won) {
			this.phase = 'epilogue'
			for (const s of this.livingSeats()) {
				const res = o.bySeat?.[s.seat]
				if (s.inFight && fought.includes(s.seat)) {
					const hpLeft = Math.max(1, Math.min(s.book.maxHp, Math.round(res?.hpLeft ?? s.book.hp)))
					s.book = {...s.book, hp: hpLeft, status: 'won', stats: {...s.book.stats, turns: o.rounds ?? 0}}
					this.send(s, MSG.DONE, {won: true, hpLeft, turns: o.rounds ?? 0, dead: false})
				} else {
					// GDD 7.3: everyone in the room sees "Chapter complete".
					s.book = {...s.book, status: 'won'}
				}
				s.inFight = false
				s.ready = false
				s.vote = false
				this.send(s, MSG.BOOK, {book: s.book, fx: []})
			}
		} else {
			// Every fighter fell or was removed: the Warden resets (dead ones already have new books).
			this.phase = 'village'
			for (const s of this.livingSeats()) {
				if (!s.inFight) continue
				const res = o.bySeat?.[s.seat]
				s.inFight = false
				s.book = {...s.book, hp: Math.max(1, Math.round(res?.hpLeft ?? s.book.hp)), status: 'exploring'}
				this.send(s, MSG.DONE, {won: false, hpLeft: s.book.hp, turns: o.rounds ?? 0, dead: false})
				this.send(s, MSG.BOOK, {book: s.book, fx: []})
			}
		}
		this.pc = null
		this.fight = null
		this.dirty = true
		this.broadcastRoom()
	}

	// ---------------------------------------------------------------- new-book vote (GDD 7.5)

	onVote(me, m) {
		if (this.phase !== 'epilogue') return this.send(me, MSG.ERROR, {code: 'not_allowed'})
		me.vote = m.newBook
		this.dirty = true
		if (!this.recomputeVotes()) this.broadcastRoom()
	}

	/** @returns {boolean} true if the village was reset */
	recomputeVotes() {
		if (this.phase !== 'epilogue') return false
		const c = this.connectedSeats()
		if (!c.length || !c.every((s) => s.vote)) return false
		this.phase = 'village'
		this.struck = false
		for (const s of this.livingSeats()) this.newBookFor(s)
		this.dirty = true
		this.broadcastRoom()
		return true
	}

	// ---------------------------------------------------------------- timers

	/** Earliest time the host must call tick(), or null. */
	nextWake() {
		const t = []
		const now = this.io.now()
		for (const s of this.livingSeats()) if (s.droppedAt !== null) t.push(s.droppedAt + SEAT_RECONNECT_MS)
		if (this.created && !this.closed && this.emptySince !== null) t.push(this.emptySince + ROOM_IDLE_CLOSE_MS)
		if (this.lobbyStartsAt !== null) t.push(this.lobbyStartsAt)
		if (this.pc) t.push(now + COMBAT_TICK_MS)
		for (const c of this.conns.values()) if (c.seat === null) t.push(c.openedAt + HELLO_TIMEOUT_MS)
		return t.length ? Math.max(now, Math.min(...t)) : null
	}

	/** Run everything that is due. @returns {'closed'|null} */
	tick() {
		const now = this.io.now()
		for (const [cid, c] of [...this.conns]) {
			if (c.seat === null && now - c.openedAt >= HELLO_TIMEOUT_MS) this.kick(cid, CLOSE.BAD, 'hello timeout')
		}
		for (const s of this.livingSeats()) {
			if (s.droppedAt !== null && now - s.droppedAt >= SEAT_RECONNECT_MS) this.free(s, 'left')
		}
		if (this.lobbyStartsAt !== null && now >= this.lobbyStartsAt) this.startFight(now)
		if (this.pc) this.tickCombat(now)
		if (this.created && !this.closed && this.emptySince !== null && now - this.emptySince >= ROOM_IDLE_CLOSE_MS && !this.connectedSeats().length) {
			this.shutdown()
			return 'closed'
		}
		return null
	}

	/** 10 minutes with nobody connected: forget everything (GDD 7.1 item 6). */
	shutdown() {
		for (const cid of [...this.conns.keys()]) this.kick(cid, CLOSE.IDLE, 'idle')
		this.seats = Array(MAX_SEATS).fill(null)
		this.pc = null
		this.fight = null
		this.closed = true
		this.created = false
		this.dirty = true
	}

	// ---------------------------------------------------------------- output

	/** @returns {import('../../game/src/core/contracts.js').RoomSnapshot} */
	snapshot() {
		const {ready, of} = this.lobbyCounts()
		return {
			code: this.code,
			v: PROTOCOL_VERSION,
			phase: this.phase,
			seats: this.livingSeats().map((s) => ({seat: s.seat, name: s.name, connected: !!s.cid, hp: s.book.hp, maxHp: s.book.maxHp, ready: s.ready, inFight: s.inFight, talking: s.talking, bookNo: s.book.bookNo})),
			warden: {state: this.phase === 'fighting' ? 'fighting' : this.phase === 'epilogue' ? 'defeated' : 'dormant', round: this.fight?.round ?? 0},
			struck: this.struck,
			lobby: {ready, of, startsAt: this.lobbyStartsAt},
			votes: {newBook: this.livingSeats().filter((s) => s.vote).map((s) => s.seat)},
		}
	}

	send(s, t, body) {
		if (s?.cid) this.io.send(s.cid, encode(t, body))
	}
	broadcast(t, body, except = null) {
		const frame = encode(t, body)
		for (const s of this.seats) if (s && s !== except && s.cid) this.io.send(s.cid, frame)
	}
	broadcastRoom() {
		this.broadcast(MSG.ROOM, {room: this.snapshot()})
	}
}

const r2 = (v) => Math.round(v * 100) / 100

function refOf(raw) {
	if (typeof raw !== 'string' || raw.length > 4096) return undefined
	try {
		const r = JSON.parse(raw)?.ref
		return Number.isInteger(r) && r >= 0 ? r : undefined
	} catch {
		return undefined
	}
}

/** Stations exported for tests (keeps the import graph obvious). */
export {STATIONS}
