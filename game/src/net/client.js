// Room client (browser). OWNER: network engineer. Contract: contracts.js section 7,
// docs/TECH.md section 6, docs/NETWORK.md. Solo never creates one (no socket at all).
//
// createNetClient() implements NetClient: hostGame, joinGame, leave, onState, on, send,
// request, sendMove, plus reconnect with backoff (same seat for 120 s via the seat token
// in ever.v1.seat.{CODE}), a 20 s ping, and interpolated peer positions (net.peerAt).
//
// Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later

import {
	CLOSE,
	EV,
	MOVE_HZ,
	MSG,
	PROTOCOL_VERSION,
	ROOM_ROUTES,
	SEAT_RECONNECT_MS,
	bus as appBus,
	cleanName,
	clearSeat,
	encode,
	isValidRoomCode,
	loadMeta,
	loadSeat,
	normalizeRoomCode,
	resolveRoomServer,
	saveName,
	saveSeat,
} from '../core/contracts.js'
import {createInterpolator} from './interp.js'

/** Base URLs for the room server for this page. */
export function roomServer() {
	return resolveRoomServer(location, import.meta.env?.VITE_ROOMS_URL || '')
}

/** Cheap reachability probe (used by the title screen to grey out Host/Join). */
export async function probeRooms(server = roomServer()) {
	try {
		const r = await fetch(server.http + ROOM_ROUTES.health, {cache: 'no-store'})
		const j = await r.json()
		return {ok: r.ok && j.v === PROTOCOL_VERSION, v: j.v}
	} catch {
		return {ok: false}
	}
}

/** GDD 6 copy for every way hosting/joining can fail. Key = NetError.code. */
export const NET_ERROR_TEXT = Object.freeze({
	no_room: 'No room with that code.',
	full: 'That room is full.',
	version: 'That room runs a different version of EVER. Refresh the page.',
	network: "Can't reach the room server. Check your connection.",
	name: "Name can't be empty.",
	replaced: 'This seat was opened in another tab.',
	idle: 'No room with that code.',
})

/** GDD 6 in-game copy for peer events ({name} is replaced). The client emits no toasts
 * itself (core/game.js owns them); this table is for UIs that want the copy. */
export const PEER_TEXT = Object.freeze({
	join: '{name} joined.',
	left: '{name} left.',
	drop: '{name} lost connection. Keeping their seat.',
	back: '{name} is back.',
	reconnecting: 'Reconnecting...',
	reconnected: "You're back in the room.",
})

export class NetError extends Error {
	/** @param {keyof typeof NET_ERROR_TEXT} code */
	constructor(code) {
		super(NET_ERROR_TEXT[code] || NET_ERROR_TEXT.network)
		this.code = code
	}
}

/** Reconnect delays (TECH 6.3): 0.5, 1, 2, 4, 8 s, then 8 s until the 120 s seat window ends. */
export const BACKOFF_MS = Object.freeze([500, 1000, 2000, 4000, 8000])
export const PING_MS = 20_000
export const REQUEST_TIMEOUT_MS = 10_000
const FATAL_CLOSE = new Map([
	[CLOSE.LEAVE, 'left'],
	[CLOSE.VERSION, 'version'],
	[CLOSE.NO_ROOM, 'no_room'],
	[CLOSE.FULL, 'full'],
	[CLOSE.REPLACED, 'replaced'],
	[CLOSE.IDLE, 'idle'],
	[CLOSE.BAD, 'network'],
])

/**
 * @param {{
 *   bus?: ReturnType<import('../core/contracts.js').createBus>,
 *   server?: {http: string, ws: string},
 *   fetch?: typeof fetch,
 *   WebSocket?: typeof WebSocket,
 *   storage?: Storage,
 *   now?: () => number,
 *   timers?: {setTimeout: typeof setTimeout, clearTimeout: typeof clearTimeout, setInterval: typeof setInterval, clearInterval: typeof clearInterval},
 *   interp?: Parameters<typeof createInterpolator>[0],
 * }} [opts]
 * @returns {import('../core/contracts.js').NetClient & {
 *   room: import('../core/contracts.js').RoomSnapshot|null, book: import('../core/contracts.js').Book|null,
 *   lastCombat: any, rtt: number|null, peerAt(seat: number, now?: number): ({x: number, z: number, yaw: number, walking: boolean}|null),
 *   peerSeats(): number[], onStatus(fn: (s: string) => void): () => void}}
 */
function sessionStore() {
	try {
		return typeof sessionStorage !== 'undefined' ? sessionStorage : undefined
	} catch {
		return undefined
	}
}

export function createNetClient(opts = {}) {
	const bus = opts.bus ?? appBus
	const doFetch = opts.fetch ?? ((...a) => globalThis.fetch(...a))
	const WS = opts.WebSocket ?? globalThis.WebSocket
	const storage = opts.storage
	// Seat tokens are per TAB (sessionStorage survives a reload of that tab), so two tabs of
	// one browser profile can be two players: with localStorage the joining tab read the
	// host's token and took over the host's seat. Falls back to `storage`/localStorage.
	const seatStorage = opts.storage ?? sessionStore()
	const now = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()))
	const T = opts.timers ?? globalThis
	let server = opts.server ?? null
	const getServer = () => (server ??= roomServer())
	const interp = createInterpolator(opts.interp)

	/** @type {Map<string, Set<(m: any) => void>>} */
	const handlers = new Map()
	const stateSubs = new Set()
	const statusSubs = new Set()
	/** @type {Map<number, {resolve: (m: any) => void, timer: any}>} */
	const pending = new Map()

	let ws = null
	let status = /** @type {import('../core/contracts.js').NetStatus} */ ('idle')
	let code = null
	let seat = null
	let name = 'Reader'
	let seatToken = null // kept in memory too, so reconnect works with storage blocked
	let refSeq = 0
	let leaving = false
	let joinWaiter = null // {resolve, reject} while the first hello is in flight
	let reconnect = null // {startedAt, attempt, timer}
	let pingTimer = null
	let pingSent = 0
	const move = {last: null, lastAt: -Infinity, timer: null, queued: null}

	const client = {
		room: null,
		book: null,
		lastCombat: null,
		rtt: null,
		get status() {
			return status
		},
		get code() {
			return code
		},
		get seat() {
			return seat
		},

		async hostGame({name: n} = {name: ''}) {
			const nm = cleanName(n) || 'Reader'
			let r
			try {
				r = await doFetch(getServer().http + ROOM_ROUTES.create, {
					method: 'POST',
					headers: {'content-type': 'application/json'},
					body: JSON.stringify({v: PROTOCOL_VERSION}),
				})
			} catch {
				throw new NetError('network')
			}
			if (r.status === 426) throw new NetError('version')
			if (r.status !== 201) throw new NetError('network')
			const j = await r.json()
			return client.joinGame(j.code, {name: nm})
		},

		async joinGame(c, {name: n} = {name: ''}) {
			const roomCode = normalizeRoomCode(c)
			if (!isValidRoomCode(roomCode)) throw new NetError('no_room')
			const nm = cleanName(n)
			if (!nm) throw new NetError('name')
			if (ws) client.leave()
			leaving = false
			if (code !== roomCode) seatToken = null
			code = roomCode
			name = nm
			saveName(nm, storage)
			setStatus('connecting')
			return new Promise((resolve, reject) => {
				joinWaiter = {resolve, reject}
				connect()
			})
		},

		leave() {
			leaving = true
			stopReconnect()
			stopPing()
			if (ws) {
				try {
					if (ws.readyState === 1) ws.send(encode(MSG.BYE))
					ws.close(CLOSE.LEAVE, 'bye')
				} catch {}
			}
			ws = null
			if (code) clearSeat(code, seatStorage)
			seatToken = null
			failPending()
			interp.clear()
			client.room = null
			client.book = null
			client.lastCombat = null
			code = null
			seat = null
			setStatus('closed')
		},

		onState(fn) {
			stateSubs.add(fn)
			if (client.room) fn(client.room)
			return () => stateSubs.delete(fn)
		},
		onStatus(fn) {
			statusSubs.add(fn)
			return () => statusSubs.delete(fn)
		},
		on(type, fn) {
			if (!handlers.has(type)) handlers.set(type, new Set())
			handlers.get(type).add(fn)
			return () => handlers.get(type)?.delete(fn)
		},
		send(t, body = {}) {
			if (ws && ws.readyState === 1 && status === 'open') {
				ws.send(encode(t, body))
				return true
			}
			return false
		},
		/** Adds `ref`; resolves with the reply frame (BOOK, COMBAT or ERROR) carrying it. */
		request(t, body = {}) {
			const ref = ++refSeq
			return new Promise((resolve) => {
				if (!client.send(t, {...body, ref})) return resolve({v: PROTOCOL_VERSION, t: MSG.ERROR, code: 'server', ref})
				const timer = T.setTimeout(() => {
					pending.delete(ref)
					resolve({v: PROTOCOL_VERSION, t: MSG.ERROR, code: 'server', ref})
				}, REQUEST_TIMEOUT_MS)
				pending.set(ref, {resolve, timer})
			})
		},
		/** Throttled to MOVE_HZ, only while moving or once when stopping. */
		sendMove(x, z, yaw, walking) {
			const s = [round2(x), round2(z), round2(yaw), walking ? 1 : 0]
			const l = move.last
			if (l && l[0] === s[0] && l[1] === s[1] && l[2] === s[2] && l[3] === s[3]) return
			move.queued = s
			const wait = move.lastAt + 1000 / MOVE_HZ - now()
			if (wait <= 0) flushMove()
			else if (!move.timer) move.timer = T.setTimeout(flushMove, wait)
		},
		/** Interpolated position of another seat for drawing at time `t` (default now). */
		peerAt(s, t = now()) {
			return interp.sample(s, t)
		},
		peerSeats() {
			return interp.seats()
		},
	}

	function flushMove() {
		if (move.timer) T.clearTimeout(move.timer)
		move.timer = null
		const s = move.queued
		if (!s) return
		move.queued = null
		if (client.send(MSG.MOVE, {p: [s[0], s[1], s[2]], w: s[3]})) {
			move.last = s
			move.lastAt = now()
		}
	}

	function setStatus(s) {
		if (status === s) return
		status = s
		for (const fn of [...statusSubs]) fn(s)
		bus.emit(EV.NET_STATUS, {status: s})
	}

	function emit(type, m) {
		for (const fn of [...(handlers.get(type) || [])]) {
			try {
				fn(m)
			} catch (err) {
				console.error(`[net] ${type}`, err)
			}
		}
	}

	function connect() {
		let sock
		try {
			sock = new WS(getServer().ws + ROOM_ROUTES.socket(code))
		} catch {
			return onSocketGone(sock, 0)
		}
		ws = sock
		sock.addEventListener('open', () => {
			if (ws !== sock) return
			const tok = seatToken ?? loadSeat(code, seatStorage)?.seatToken
			sock.send(encode(MSG.HELLO, {name, ...(tok ? {seatToken: tok} : {}), booksWritten: loadMeta(storage).booksWritten}))
		})
		sock.addEventListener('message', (e) => {
			if (ws !== sock) return
			let m
			try {
				m = JSON.parse(typeof e.data === 'string' ? e.data : '')
			} catch {
				return
			}
			if (m && m.v === PROTOCOL_VERSION && typeof m.t === 'string') handle(m)
		})
		sock.addEventListener('close', (e) => onSocketGone(sock, e.code))
		sock.addEventListener('error', () => {})
	}

	function handle(m) {
		switch (m.t) {
			case MSG.WELCOME: {
				stopReconnect()
				seat = m.seat
				code = m.code
				seatToken = m.seatToken
				saveSeat(code, {seatToken: m.seatToken, seat: m.seat, name}, seatStorage)
				client.book = m.book
				setRoom(m.room)
				const t = now()
				for (const [s, x, z, yaw, w] of m.peers || []) if (s !== seat) interp.push(s, t, x, z, yaw, w)
				setStatus('open')
				startPing()
				if (joinWaiter) {
					joinWaiter.resolve({code, seat})
					joinWaiter = null
				}
				break
			}
			case MSG.ERROR:
				if (m.ref !== undefined && settle(m)) break
				if (joinWaiter && (m.code === 'version' || m.code === 'no_room' || m.code === 'full')) failJoin(m.code)
				break
			case MSG.ROOM:
				setRoom(m.room)
				break
			case MSG.PEERS: {
				const t = now()
				for (const [s, x, z, yaw, w] of m.m || []) {
					if (s === seat) continue
					interp.push(s, t, x, z, yaw, w)
					bus.emit(EV.PEER_MOVE, {seat: s, x, z, yaw, walking: Boolean(w)})
				}
				break
			}
			case MSG.PEER:
				if (m.e === 'left') interp.remove(m.seat)
				break
			case MSG.BOOK:
				client.book = m.book
				if (m.ref !== undefined) settle(m)
				break
			case MSG.COMBAT:
				client.lastCombat = m
				if (m.ref !== undefined) settle(m)
				bus.emit(EV.COMBAT_VIEW, {view: m.view})
				break
			case MSG.PONG:
				if (m.ts === pingSent) client.rtt = Math.round(now() - pingSent)
				break
		}
		emit(m.t, m)
	}

	function settle(m) {
		const p = pending.get(m.ref)
		if (!p) return false
		pending.delete(m.ref)
		T.clearTimeout(p.timer)
		p.resolve(m)
		return true
	}

	function failPending() {
		for (const [ref, p] of pending) {
			T.clearTimeout(p.timer)
			p.resolve({v: PROTOCOL_VERSION, t: MSG.ERROR, code: 'server', ref})
		}
		pending.clear()
	}

	function setRoom(room) {
		client.room = room
		const present = new Set(room.seats.map((s) => s.seat))
		for (const s of interp.seats()) if (!present.has(s)) interp.remove(s)
		for (const fn of [...stateSubs]) fn(room)
		bus.emit(EV.ROOM, {room})
	}

	function failJoin(errCode) {
		const w = joinWaiter
		joinWaiter = null
		stopReconnect()
		stopPing()
		const sock = ws
		ws = null
		try {
			sock?.close()
		} catch {}
		if (errCode === 'no_room' || errCode === 'full' || errCode === 'idle') clearSeat(code, seatStorage)
		setStatus('closed')
		w?.reject(new NetError(errCode))
	}

	function onSocketGone(sock, closeCode) {
		if (sock && ws !== sock) return // an old socket we already replaced
		ws = null
		stopPing()
		failPending()
		if (leaving) return
		const fatal = FATAL_CLOSE.get(closeCode)
		if (joinWaiter && !reconnect) {
			// First connection attempt: report it, do not retry.
			return failJoin(fatal && fatal !== 'left' ? fatal : 'network')
		}
		if (fatal) {
			if (fatal === 'no_room' || fatal === 'idle' || fatal === 'full') clearSeat(code, seatStorage)
			if (joinWaiter) return failJoin(fatal === 'left' ? 'network' : fatal)
			setStatus('closed')
			emit('closed', {reason: fatal})
			return
		}
		// Unexpected drop: keep trying within the seat window (TECH 6.3).
		if (!reconnect) {
			reconnect = {startedAt: now(), attempt: 0, timer: null}
			setStatus('reconnecting')
		}
		if (now() - reconnect.startedAt > SEAT_RECONNECT_MS) {
			stopReconnect()
			setStatus('closed')
			emit('closed', {reason: 'network'})
			if (joinWaiter) failJoin('network')
			return
		}
		const delay = BACKOFF_MS[Math.min(reconnect.attempt, BACKOFF_MS.length - 1)]
		reconnect.attempt++
		reconnect.timer = T.setTimeout(() => {
			if (reconnect) reconnect.timer = null
			if (!leaving) connect()
		}, delay)
	}

	function stopReconnect() {
		if (reconnect?.timer) T.clearTimeout(reconnect.timer)
		reconnect = null
	}
	function startPing() {
		stopPing()
		pingTimer = T.setInterval(() => {
			pingSent = Math.round(now())
			client.send(MSG.PING, {ts: pingSent})
		}, PING_MS)
	}
	function stopPing() {
		if (pingTimer) T.clearInterval(pingTimer)
		pingTimer = null
	}

	// Coming back online: retry at once instead of waiting out the backoff.
	if (typeof addEventListener === 'function' && typeof window !== 'undefined') {
		addEventListener('online', () => {
			if (reconnect && !ws && !leaving) {
				if (reconnect.timer) T.clearTimeout(reconnect.timer)
				reconnect.timer = null
				connect()
			}
		})
	}

	return client
}

const round2 = (v) => Math.round(v * 100) / 100
