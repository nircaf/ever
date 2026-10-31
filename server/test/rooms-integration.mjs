// Room server integration test: starts `wrangler dev` on a free port, connects two
// WebSocket clients, hosts, joins, moves (legally, at walking speed) to the Ash Gate,
// readies up, plays a co-op combat round, drops and reconnects one client to the same
// seat mid-fight, leaves, then stops wrangler. No Cloudflare login needed.
//
// Usage: node server/test/rooms-integration.mjs
//        node server/test/rooms-integration.mjs --keep-logs
// Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdtempSync, rmSync} from 'node:fs'
import {createServer} from 'node:net'
import {tmpdir} from 'node:os'
import {join, dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {CLOSE, MSG, PROTOCOL_VERSION, ROOM_ROUTES, STATIONS, encode, isValidRoomCode} from '../../game/src/core/contracts.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function freePort() {
	return new Promise((resolve, reject) => {
		const s = createServer()
		s.unref()
		s.on('error', reject)
		s.listen(0, '127.0.0.1', () => {
			const {port} = s.address()
			s.close(() => resolve(port))
		})
	})
}

async function startWrangler() {
	const port = await freePort()
	const inspector = await freePort()
	const persist = mkdtempSync(join(tmpdir(), 'ever-rooms-'))
	const args = ['wrangler', 'dev', '--config', 'server/wrangler.toml', '--ip', '127.0.0.1', '--port', String(port), '--inspector-port', String(inspector), '--persist-to', persist, '--show-interactive-dev-session=false', '--log-level', 'warn']
	const child = spawn('npx', args, {cwd: ROOT, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: {...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1'}})
	let log = ''
	child.stdout.on('data', (d) => (log += d))
	child.stderr.on('data', (d) => (log += d))
	const base = `http://127.0.0.1:${port}`
	const stop = async () => {
		if (child.exitCode === null) {
			try {
				process.kill(-child.pid, 'SIGTERM')
			} catch {}
			for (let i = 0; i < 50 && child.exitCode === null; i++) await sleep(100)
			if (child.exitCode === null) {
				try {
					process.kill(-child.pid, 'SIGKILL')
				} catch {}
			}
		}
		rmSync(persist, {recursive: true, force: true})
	}
	const deadline = Date.now() + 90_000
	while (Date.now() < deadline) {
		if (child.exitCode !== null) break
		try {
			const r = await fetch(base + ROOM_ROUTES.health)
			if (r.ok) return {base, stop, log: () => log}
		} catch {}
		await sleep(300)
	}
	await stop()
	throw new Error('wrangler dev did not start:\n' + log)
}

function open(WS, path) {
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
	const next = (pred, ms = 5000, what = 'frame') => {
		const i = inbox.findIndex(pred)
		if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0])
		return new Promise((resolve, reject) => {
			const w = {pred, resolve}
			waiters.push(w)
			setTimeout(() => {
				const k = waiters.indexOf(w)
				if (k >= 0) {
					waiters.splice(k, 1)
					reject(new Error(`timeout waiting for ${what}`))
				}
			}, ms)
		})
	}
	let ref = 0
	return {
		ws,
		next,
		closed,
		ready: new Promise((r, j) => {
			ws.addEventListener('open', r)
			ws.addEventListener('error', j)
		}),
		send: (t, b = {}) => ws.send(encode(t, b)),
		request(t, b = {}) {
			const r = ++ref
			ws.send(encode(t, {...b, ref: r}))
			return next((m) => m.ref === r, 5000, `${t} reply`)
		},
		drain: () => inbox.splice(0),
	}
}

/** Walk from `from` to `to` at 8.5 u/s in 10 Hz steps (the room allows 9 u/s). */
async function walk(c, from, to) {
	let [x, z] = from
	for (;;) {
		const dx = to[0] - x
		const dz = to[1] - z
		const d = Math.hypot(dx, dz)
		if (d < 0.01) break
		const step = Math.min(d, 0.85)
		x += (dx / d) * step
		z += (dz / d) * step
		c.send(MSG.MOVE, {p: [x, z, 0], w: 1})
		await sleep(100)
	}
	c.send(MSG.MOVE, {p: [x, z, 0], w: 0})
	return [x, z]
}

const srv = await startWrangler()
const WS = srv.base.replace(/^http/, 'ws')
let ok = false
try {
	const t0 = Date.now()
	// host
	const created = await fetch(srv.base + ROOM_ROUTES.create, {method: 'POST', headers: {'content-type': 'application/json', origin: 'http://127.0.0.1:5173'}, body: JSON.stringify({v: PROTOCOL_VERSION})})
	assert.equal(created.status, 201)
	const {code} = await created.json()
	assert.ok(isValidRoomCode(code), code)
	const a = open(WS, ROOM_ROUTES.socket(code))
	await a.ready
	a.send(MSG.HELLO, {name: 'Ana'})
	const wa = await a.next((m) => m.t === MSG.WELCOME)
	assert.equal(wa.seat, 0)

	// join
	const b = open(WS, ROOM_ROUTES.socket(code))
	await b.ready
	b.send(MSG.HELLO, {name: 'Bob'})
	const wb = await b.next((m) => m.t === MSG.WELCOME)
	assert.equal(wb.seat, 1)
	assert.equal((await a.next((m) => m.t === MSG.PEER && m.e === 'join')).seat, 1)
	console.log(`  host + join ok (room ${code})`)

	// a village action with server-side distance: too far from the grindstone at spawn
	assert.equal((await a.request(MSG.ACT, {a: {type: 'grindstone.take'}})).code, 'too_far')

	// move: both walk to the Ash Gate; each sees the other's positions
	const gate = STATIONS.gate.pos
	await Promise.all([walk(a, [0, 22], [gate[0] - 0.5, gate[1]]), walk(b, [0, 22], [gate[0] + 0.5, gate[1]])])
	const seen = await a.next((m) => m.t === MSG.PEERS && m.m.some((p) => p[0] === 1 && Math.abs(p[2] - gate[1]) < 0.6), 3000, 'peer at gate')
	assert.ok(seen)
	console.log('  movement relay ok')

	// gate lobby -> fight
	a.send(MSG.GATE, {ready: true})
	const lob = await b.next((m) => m.t === MSG.ROOM && m.room.lobby.ready === 1)
	assert.equal(lob.room.lobby.of, 2)
	b.send(MSG.GATE, {ready: true})
	const ca = await a.next((m) => m.t === MSG.COMBAT && !m.ref)
	const cb = await b.next((m) => m.t === MSG.COMBAT && !m.ref)
	assert.equal(ca.view.round, 1)
	assert.equal(ca.view.warden.maxHp, 184)
	assert.equal(ca.view.hand.length, 5)
	assert.equal(cb.view.you, 1)
	console.log('  fight started (Warden 184 HP, 2 fighters)')

	// a combat round
	const card = ca.view.hand.find((c) => c.playable)
	const played = await a.request(MSG.PLAY, {cardId: card.id})
	assert.equal(played.t, MSG.COMBAT, JSON.stringify(played))
	assert.ok(played.ev.some((e) => e.k === 'play' && e.seat === 0))
	const bad = await a.request(MSG.PLAY, {cardId: 'c999'})
	assert.equal(bad.t, MSG.ERROR)
	assert.equal((await a.request(MSG.END)).t, MSG.COMBAT)
	const handB = cb.view.hand.map((c) => c.id)

	// drop Bob mid-fight: the Warden acts without him; he reconnects to the same seat
	b.ws.close()
	assert.equal((await a.next((m) => m.t === MSG.PEER && m.e === 'drop')).seat, 1)
	const r2 = await a.next((m) => m.t === MSG.COMBAT && m.view.round === 2, 5000, 'round 2')
	assert.ok(r2.ev.some((e) => e.k === 'intent'))
	console.log('  round resolved while Bob was away')

	const b2 = open(WS, ROOM_ROUTES.socket(code))
	await b2.ready
	b2.send(MSG.HELLO, {name: 'Bob', seatToken: wb.seatToken})
	const wb2 = await b2.next((m) => m.t === MSG.WELCOME)
	assert.equal(wb2.seat, 1)
	assert.equal(wb2.book.seed, wb.book.seed)
	const back = await b2.next((m) => m.t === MSG.COMBAT && m.view.you === 1)
	assert.deepEqual(back.view.hand.map((c) => c.id), handB, 'hand kept while away')
	assert.equal((await a.next((m) => m.t === MSG.PEER && m.e === 'back')).seat, 1)
	console.log('  reconnect to the same seat ok, hand returned')

	// round 2: both end, the Warden acts again
	assert.equal((await a.request(MSG.END)).t, MSG.COMBAT)
	assert.equal((await b2.request(MSG.END)).t, MSG.COMBAT)
	await a.next((m) => m.t === MSG.COMBAT && m.view.round === 3, 5000, 'round 3')
	console.log('  co-op round 2 resolved')

	// bad frames, version, unknown room
	b2.ws.send('{nope')
	assert.equal((await b2.next((m) => m.t === MSG.ERROR)).code, 'bad_msg')
	const v = open(WS, `/room/${code}?v=999`)
	assert.equal((await v.next((m) => m.t === MSG.ERROR)).code, 'version')
	assert.equal(await v.closed, CLOSE.VERSION)

	// leave
	b2.send(MSG.BYE)
	assert.equal(await b2.closed, CLOSE.LEAVE)
	assert.equal((await a.next((m) => m.t === MSG.PEER && m.e === 'left')).seat, 1)
	a.ws.close()

	// The Technical Director's smoke test, against the same server.
	const smoke = spawn(process.execPath, [join(ROOT, 'server/test/rooms-smoke.mjs'), srv.base], {stdio: 'inherit'})
	assert.equal(await new Promise((r) => smoke.on('exit', r)), 0, 'rooms-smoke.mjs failed')
	ok = true
	console.log(`rooms integration ok in ${((Date.now() - t0) / 1000).toFixed(1)} s`)
} catch (err) {
	console.error(err)
	console.error('--- wrangler log ---\n' + srv.log())
} finally {
	await srv.stop()
}
if (process.argv.includes('--keep-logs')) console.log(srv.log())
process.exit(ok ? 0 : 1)
