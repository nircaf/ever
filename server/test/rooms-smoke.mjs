// Room server smoke test against a running `npm run rooms` (wrangler dev on :8787).
// Usage: node server/test/rooms-smoke.mjs [http://127.0.0.1:8787]
// Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict'
import {MSG, PROTOCOL_VERSION, ROOM_ROUTES, CLOSE, encode, isValidRoomCode} from '../../game/src/core/contracts.js'

const HTTP = process.argv[2] || 'http://127.0.0.1:8787'
const WS = HTTP.replace(/^http/, 'ws')

function open(path) {
	const ws = new WebSocket(WS + path)
	const inbox = []
	const waiters = []
	ws.addEventListener('message', (e) => {
		const m = JSON.parse(e.data)
		const i = waiters.findIndex((w) => w.pred(m))
		if (i >= 0) waiters.splice(i, 1)[0].resolve(m)
		else inbox.push(m)
	})
	const closed = new Promise((r) => ws.addEventListener('close', (e) => r(e.code)))
	const next = (pred, ms = 3000) => {
		const i = inbox.findIndex(pred)
		if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0])
		return new Promise((resolve, reject) => {
			waiters.push({pred, resolve})
			setTimeout(() => reject(new Error('timeout waiting')), ms)
		})
	}
	return {ws, next, closed, ready: new Promise((r) => ws.addEventListener('open', r)), send: (t, b) => ws.send(encode(t, b))}
}

const h = await (await fetch(HTTP + ROOM_ROUTES.health)).json()
assert.deepEqual(h, {ok: true, v: PROTOCOL_VERSION})

const created = await fetch(HTTP + ROOM_ROUTES.create, {method: 'POST', headers: {'content-type': 'application/json', origin: 'http://127.0.0.1:1455'}, body: JSON.stringify({v: PROTOCOL_VERSION})})
assert.equal(created.status, 201)
assert.equal(created.headers.get('access-control-allow-origin'), 'http://127.0.0.1:1455')
const {code} = await created.json()
assert.ok(isValidRoomCode(code), code)

const bad = await fetch(HTTP + ROOM_ROUTES.create, {method: 'POST', headers: {origin: 'https://evil.example'}})
assert.equal(bad.status, 403)

// host
const a = open(ROOM_ROUTES.socket(code))
await a.ready
a.send(MSG.HELLO, {name: 'Ana', booksWritten: 2})
const wa = await a.next((m) => m.t === MSG.WELCOME)
assert.equal(wa.seat, 0)
assert.equal(wa.book.bookNo, 3)
assert.equal(wa.book.deck.length, 10)

// friend
const b = open(ROOM_ROUTES.socket(code))
await b.ready
b.send(MSG.HELLO, {name: 'Bo<b>'})
const wb = await b.next((m) => m.t === MSG.WELCOME)
assert.equal(wb.seat, 1)
assert.equal(wb.room.seats.find((s) => s.seat === 1).name, 'Bob')
assert.equal((await a.next((m) => m.t === MSG.PEER && m.e === 'join')).seat, 1)

// movement relay (a legal step from the spawn at (0, 22); the room clamps faster moves)
await new Promise((r) => setTimeout(r, 150))
b.send(MSG.MOVE, {p: [0.234, 21.678, 0.5], w: 1})
const mv = await a.next((m) => m.t === MSG.PEERS && m.m.some((x) => x[0] === 1))
assert.deepEqual(mv.m.find((x) => x[0] === 1), [1, 0.23, 21.68, 0.5, 1])

// drop + reconnect with the same seat token
b.ws.close()
assert.equal((await a.next((m) => m.t === MSG.PEER && m.e === 'drop')).seat, 1)
const b2 = open(ROOM_ROUTES.socket(code))
await b2.ready
b2.send(MSG.HELLO, {name: 'Bob', seatToken: wb.seatToken})
const wb2 = await b2.next((m) => m.t === MSG.WELCOME)
assert.equal(wb2.seat, 1)
assert.equal(wb2.book.seed, wb.book.seed)
assert.equal((await a.next((m) => m.t === MSG.PEER && m.e === 'back')).seat, 1)

// wrong version, unknown room
const v = open(`/room/${code}?v=999`)
assert.equal((await v.next((m) => m.t === MSG.ERROR)).code, 'version')
assert.equal(await v.closed, CLOSE.VERSION)
const n = open(ROOM_ROUTES.socket('BBBBB'))
assert.equal((await n.next((m) => m.t === MSG.ERROR)).code, 'no_room')
assert.equal(await n.closed, CLOSE.NO_ROOM)

// bye frees the seat
b2.send(MSG.BYE)
assert.equal((await a.next((m) => m.t === MSG.PEER && m.e === 'left')).seat, 1)
a.ws.close()
console.log(`rooms smoke ok (room ${code})`)
process.exit(0)
