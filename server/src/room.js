// EVER Room: one Durable Object per room code. A thin shell around RoomCore
// (room-core.js), which holds every decision. OWNER: network engineer.
//
// - WebSocket Hibernation API: sockets are accepted with state.acceptWebSocket(), so an
//   idle room costs nothing; each socket carries {cid, seat} as its attachment.
// - Room state (seats, books, party combat) is saved to DO storage after every
//   authoritative change, so a hibernation wake or eviction restores the room.
// - One storage alarm drives seat expiry (120 s), the gate countdown (30 s), the combat
//   turn timer (1 s ticks while fighting), the hello timeout and the 10-minute idle close.
// - Movement is batched at 10 Hz with a short setTimeout (only while someone moves).
//
// Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later

import {CLOSE, MOVE_HZ, MSG, PROTOCOL_VERSION, encode} from '../../game/src/core/contracts.js'
import {RoomCore} from './room-core.js'
import {RULES} from './rules.js'

const STORAGE_KEY = 'room'

export function randomToken(bytes = 18) {
	const b = crypto.getRandomValues(new Uint8Array(bytes))
	return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export class Room {
	/** @param {DurableObjectState} state @param {any} env */
	constructor(state, env) {
		this.state = state
		this.env = env
		this.alarmAt = undefined
		this.moveTimer = null
		const io = {
			send: (cid, frame) => {
				const ws = this.socket(cid)
				if (!ws) return
				try {
					ws.send(frame)
				} catch {}
			},
			close: (cid, code, reason) => {
				const ws = this.socket(cid)
				if (!ws) return
				try {
					ws.close(code, reason)
				} catch {}
			},
			bind: (cid, seat) => {
				const ws = this.socket(cid)
				if (ws) ws.serializeAttachment({cid, seat})
			},
			scheduleMoves: () => {
				if (this.moveTimer) return
				this.moveTimer = setTimeout(() => {
					this.moveTimer = null
					this.core.flushMoves()
					this.after()
				}, 1000 / MOVE_HZ)
			},
			now: () => Date.now(),
			token: () => randomToken(),
			random: () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32,
		}
		this.core = new RoomCore(io, RULES)
		this.ready = state.blockConcurrencyWhile(async () => {
			const saved = await state.storage.get(STORAGE_KEY)
			if (saved) this.core = new RoomCore(io, RULES, saved)
			const live = new Map()
			for (const ws of state.getWebSockets()) {
				const a = ws.deserializeAttachment()
				if (a?.cid) live.set(a.cid, a.seat ?? null)
			}
			this.core.reconcile(live)
		})
	}

	/** @param {string} cid */
	socket(cid) {
		return this.state.getWebSockets(cid)[0] ?? null
	}

	/** Persist if anything authoritative changed, and keep the alarm in step. */
	async after() {
		const core = this.core
		if (core.dirty) {
			core.dirty = false
			// Idle close: forget the room entirely; a fresh core (created=false) answers no_room.
			if (core.closed && !core.created) await this.state.storage.deleteAll()
			else await this.state.storage.put(STORAGE_KEY, core.toJSON())
		}
		const next = core.nextWake()
		if (next !== this.alarmAt) {
			this.alarmAt = next
			if (next === null) await this.state.storage.deleteAlarm()
			else await this.state.storage.setAlarm(next)
		}
	}

	/** @param {Request} req */
	async fetch(req) {
		await this.ready
		const url = new URL(req.url)
		if (url.pathname === '/init') {
			const ok = this.core.init(url.searchParams.get('code'))
			await this.after()
			return new Response(ok ? 'created' : 'exists', {status: ok ? 201 : 409})
		}
		if (req.headers.get('upgrade') !== 'websocket') return new Response('upgrade', {status: 426})
		const pair = new WebSocketPair()
		const [client, server] = Object.values(pair)
		if (Number(url.searchParams.get('v')) !== PROTOCOL_VERSION) this.reject(server, 'version', CLOSE.VERSION)
		else if (!this.core.created || this.core.closed) this.reject(server, 'no_room', CLOSE.NO_ROOM)
		else {
			const cid = randomToken(9)
			this.state.acceptWebSocket(server, [cid])
			server.serializeAttachment({cid, seat: null})
			this.core.open(cid)
			await this.after()
		}
		return new Response(null, {status: 101, webSocket: client})
	}

	reject(ws, code, closeCode) {
		ws.accept()
		ws.send(encode(MSG.ERROR, {code}))
		ws.close(closeCode, code)
	}

	/** @param {WebSocket} ws @param {string|ArrayBuffer} data */
	async webSocketMessage(ws, data) {
		await this.ready
		const a = ws.deserializeAttachment()
		if (!a?.cid) return ws.close(CLOSE.BAD, 'no id')
		this.core.message(a.cid, typeof data === 'string' ? data : null)
		await this.after()
	}

	/** @param {WebSocket} ws */
	async webSocketClose(ws, code, reason) {
		await this.ready
		const a = ws.deserializeAttachment()
		if (a?.cid) this.core.close(a.cid)
		try {
			ws.close(code === 1005 || code === 1006 ? 1000 : code, 'bye')
		} catch {}
		await this.after()
	}

	/** @param {WebSocket} ws */
	async webSocketError(ws) {
		await this.ready
		const a = ws.deserializeAttachment()
		if (a?.cid) this.core.close(a.cid)
		await this.after()
	}

	async alarm() {
		await this.ready
		this.alarmAt = undefined
		this.core.tick()
		await this.after()
	}
}
