// EVER world bot: every decision of the major-change pipeline (GDD_V2 14, 17.8), as a plain
// class with no Workers APIs, so tests drive it with a Map and a mocked GitHub.
//
// submit(proposal) -> re-validate (world schema + mechanics validator + balance sim) ->
// rate limits (per IP, per room, per win, global) -> dedupe (content key) -> queue.
// tick() -> at most ONE open bot PR at a time ("Waiting in line"): opens the next PR from
// the queue on top of the current main (data file + manifest edition bump, or one code block +
// blocks/index.js), turns on auto-merge, and follows it until GitHub merges or closes it.
// The GitHub Action (.github/workflows/world-pr.yml) is the second, independent gate.
//
// Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later

import {addToManifest, hasKey, serializeManifest} from '../../game/src/platform/world-manifest.js'
import {LIMITS, addBlockToIndex, entryKey, entryName, entryPath, serializeEntry, sha256Hex, validateProposal, validateWorldEntry} from '../../game/src/platform/world-schema.js'
import {GitHubError} from './github.js'

export const BOT_LIMITS = Object.freeze({
	ipPerDay: 3, // GDD_V2 17.8
	roomPerDay: 3,
	globalPrPerDay: 30,
	prPerHour: 10,
	queueMax: 40,
	blockEveryDays: 7, // kind 7: at most one code block a week
	staleMinutes: 60, // a bot PR not merged by then failed its checks: close it, next in line
	contextTtlMs: 2 * 60 * 1000,
	maxAttempts: 5,
	bodyBytes: 16384,
})

const STATE = 'state'
const SUB = (id) => `sub:${id}`
const MANIFEST_PATH = 'world/manifest.json'
const BLOCKS_DIR = 'game/src/mechanics/blocks'

const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10)
const hourOf = (ms) => new Date(ms).toISOString().slice(0, 13)

function randomId() {
	const b = crypto.getRandomValues(new Uint8Array(9))
	return [...b].map((x) => x.toString(36).padStart(2, '0')).join('').slice(0, 12)
}

/** Reply helper: {http, body}. The Worker turns it into a JSON Response. */
const reply = (http, body) => ({http, body})

export class WorldBotCore {
	/**
	 * @param {{storage: {get: Function, put: Function, delete: Function}, gh: ReturnType<typeof import('./github.js').createGitHub>|null,
	 *          now?: () => number, limits?: Partial<typeof BOT_LIMITS>, blocklist?: string[], sim?: object|false,
	 *          verifyRun?: (run: object, proposal: object) => Promise<{ok: boolean, reason?: string}>, requireReplay?: boolean,
	 *          salt?: string, enabled?: boolean, log?: (msg: string) => void}} deps
	 */
	constructor({storage, gh, now = () => Date.now(), limits = {}, blocklist = [], sim = {fights: 24, seed: 'world-bot'}, verifyRun = null, requireReplay = false, salt = '', enabled = true, log = () => {}}) {
		this.storage = storage
		this.gh = gh
		this.now = now
		this.limits = {...BOT_LIMITS, ...limits}
		this.blocklist = blocklist
		this.sim = sim
		this.verifyRun = verifyRun
		this.requireReplay = requireReplay
		this.salt = salt
		this.enabled = enabled
		this.log = log
		this.ctx = null
	}

	async state() {
		const s = (await this.storage.get(STATE)) ?? {}
		return {queue: [], open: null, rl: {}, lastBlockAt: 0, keys: {}, ...s}
	}
	async saveState(s) {
		// keep only today's and this hour's counters
		const day = dayOf(this.now())
		const hour = hourOf(this.now())
		for (const k of Object.keys(s.rl)) if (!k.includes(day) && !k.includes(hour) && !k.startsWith('win:')) delete s.rl[k]
		await this.storage.put(STATE, s)
	}

	/** Current main: manifest, its sha, the block files. Cached briefly. */
	async worldContext({fresh = false} = {}) {
		if (!fresh && this.ctx && this.now() - this.ctx.at < this.limits.contextTtlMs) return this.ctx
		const sha = await this.gh.baseSha()
		const text = await this.gh.readFile(MANIFEST_PATH, sha)
		if (!text) throw new Error('world/manifest.json missing on main')
		const manifest = JSON.parse(text)
		const blockFiles = (await this.gh.listDir(BLOCKS_DIR, sha)).filter((f) => f.endsWith('.js'))
		this.ctx = {at: this.now(), sha, manifest, blockFiles}
		return this.ctx
	}

	async ipKey(ip) {
		return (await sha256Hex(`${this.salt}|${dayOf(this.now())}|${ip}`)).slice(0, 16)
	}

	/**
	 * @param {{proposal: unknown, source: 'client'|'room', ip?: string|null, room?: string|null}} req
	 * @returns {Promise<{http: number, body: object}>}
	 */
	async submit({proposal, source, ip = null, room = null}) {
		if (!this.enabled || !this.gh) return reply(503, {status: 'offline', error: 'bot_off'})
		if (source !== 'room' && source !== 'client') return reply(400, {status: 'rejected', error: 'source'})
		const now = this.now()
		const day = dayOf(now)
		const s = await this.state()

		// Cheap limits first (before any validation work).
		const ipk = source === 'client' ? `ip:${day}:${await this.ipKey(ip ?? 'unknown')}` : null
		if (ipk && (s.rl[ipk] ?? 0) >= this.limits.ipPerDay) return reply(429, {status: 'rate', error: 'ip'})
		if (s.queue.length >= this.limits.queueMax) return reply(429, {status: 'rate', error: 'busy'})

		let ctx
		try {
			ctx = await this.worldContext()
		} catch (e) {
			this.log(`world bot: context failed: ${e.message}`)
			return reply(503, {status: 'offline', error: 'github'})
		}

		const v = validateProposal(proposal, {names: ctx.manifest.names ?? [], blocklist: this.blocklist, sim: this.sim, today: day, blockFiles: ctx.blockFiles})
		if (!v.ok) {
			// The same content as a world entry fails "name taken": report it as a duplicate.
			const again = v.errors.some((e) => e.code === 'text') ? validateProposal(proposal, {names: [], blocklist: this.blocklist, sim: false, today: day, blockFiles: ctx.blockFiles}) : null
			if (again?.ok && again.entry && hasKey(ctx.manifest, (await entryPath(again.entry)).key)) return reply(409, {status: 'duplicate', error: 'in_world'})
			return reply(400, {status: 'rejected', error: 'invalid', errors: v.errors.slice(0, 12)})
		}
		const run = v.run

		// Who may submit what: co-op wins only through their room (server to server).
		if (source === 'client' && run.room) return reply(403, {status: 'rejected', error: 'room_only'})
		if (source === 'room') {
			if (!room || run.room !== room) return reply(400, {status: 'rejected', error: 'room'})
			if (!run.winId) return reply(400, {status: 'rejected', error: 'win_id'})
		}
		const roomKey = run.room ? `room:${day}:${run.room}` : null
		if (roomKey && (s.rl[roomKey] ?? 0) >= this.limits.roomPerDay) return reply(429, {status: 'rate', error: 'room'})
		const winKey = run.room && run.winId ? `win:${run.room}:${run.winId}` : null
		if (winKey && s.rl[winKey]) return reply(409, {status: 'duplicate', error: 'win_used'})

		// Solo wins carry a replay proof (GDD_V2 17.8); the verifier is pluggable.
		if (source === 'client') {
			if (this.verifyRun) {
				const ok = await this.verifyRun(run, proposal).catch(() => ({ok: false, reason: 'verifier'}))
				if (!ok?.ok) return reply(400, {status: 'rejected', error: 'proof', reason: ok?.reason ?? 'replay'})
			} else if (this.requireReplay) return reply(400, {status: 'rejected', error: 'proof', reason: 'no_verifier'})
		}

		// Presets must match the authored preset exactly.
		if (v.entry?.origin?.src === 'preset') {
			const ok = await this.matchesPreset(ctx, v.entry).catch(() => false)
			if (!ok) return reply(400, {status: 'rejected', error: 'preset'})
		}

		// Kind 7 cadence.
		if (v.kind === 'block') {
			const weekMs = this.limits.blockEveryDays * 86400000
			const queuedBlock = await this.anyQueued(s, (sub) => sub.kind === 'block')
			if (now - (s.lastBlockAt ?? 0) < weekMs || queuedBlock) return reply(429, {status: 'rate', error: 'block_week'})
		}

		// Dedupe by content key (world on main + everything waiting).
		let key, path
		if (v.kind === 'block') {
			key = (await sha256Hex(v.block.source)).slice(0, 8)
			path = `${BLOCKS_DIR}/${v.block.file}`
		} else {
			;({key, path} = await entryPath(v.entry))
			if (hasKey(ctx.manifest, key)) return reply(409, {status: 'duplicate', error: 'in_world'})
			const name = entryName(v.entry)
			if (name && (await this.anyQueued(s, (sub) => sub.name && sub.name.toLowerCase() === name.toLowerCase()))) return reply(409, {status: 'duplicate', error: 'name_waiting'})
		}
		if (s.keys[key]) return reply(409, {status: 'duplicate', error: 'waiting', id: s.keys[key]})

		const id = randomId()
		const {log: _log, ...runPublic} = run
		const sub = {
			id, status: 'queued', kind: v.kind, title: v.title, summary: v.summary, key, path, source, at: now, attempts: 0,
			run: runPublic, name: v.entry ? entryName(v.entry) : null,
			...(v.entry ? {entry: v.entry} : {block: v.block}),
		}
		await this.storage.put(SUB(id), sub)
		s.queue.push(id)
		s.keys[key] = id
		if (ipk) s.rl[ipk] = (s.rl[ipk] ?? 0) + 1
		if (roomKey) s.rl[roomKey] = (s.rl[roomKey] ?? 0) + 1
		if (winKey) s.rl[winKey] = 1
		if (v.kind === 'block') s.lastBlockAt = now
		await this.saveState(s)
		this.log(`world bot: queued ${id} ${v.kind} "${v.title}"`)

		await this.tick().catch((e) => this.log(`world bot: tick failed: ${e.message}`))
		return this.status(id, 202)
	}

	async anyQueued(s, pred) {
		for (const id of [...s.queue, ...(s.open ? [s.open] : [])]) {
			const sub = await this.storage.get(SUB(id))
			if (sub && pred(sub)) return true
		}
		return false
	}

	async matchesPreset(ctx, entry) {
		const f = ctx.manifest.files.find((x) => x.type === 'preset' && x.path.startsWith(`presets/${entry.origin.preset}-`))
		if (!f) return false
		const text = await this.gh.readFile(`world/${f.path}`, ctx.sha)
		const p = validateWorldEntry(JSON.parse(text), {names: []})
		if (!p.ok || p.entry.id !== entry.origin.preset || p.entry.proposal.kind !== entry.type) return false
		const want = entryKey({v: 1, type: entry.type, origin: {}, ...p.entry.proposal.data})
		return want === entryKey(entry)
	}

	/** @returns {Promise<{http: number, body: object}>} */
	async status(id, http = 200) {
		if (typeof id !== 'string' || !/^[a-z0-9]{6,16}$/.test(id)) return reply(404, {status: 'unknown'})
		const sub = await this.storage.get(SUB(id))
		if (!sub) return reply(404, {status: 'unknown'})
		const s = await this.state()
		const position = sub.status === 'queued' ? s.queue.indexOf(id) + 1 : 0
		return reply(http, {status: sub.status, id, kind: sub.kind, title: sub.title, ...(sub.pr ? {pr: sub.pr.url} : {}), ...(sub.edition ? {edition: sub.edition} : {}), ...(position ? {position} : {}), ...(sub.reason ? {reason: sub.reason} : {})})
	}

	/** Follow the open PR, then open the next one if allowed. Safe to call any time. */
	async tick() {
		if (!this.gh) return {idle: true}
		const s = await this.state()
		const out = {}
		if (s.open) {
			const sub = await this.storage.get(SUB(s.open))
			if (!sub?.pr) s.open = null
			else {
				const pr = await this.gh.getPr(sub.pr.number)
				if (pr.merged) {
					sub.status = 'merged'
					out.merged = sub.id
				} else if (pr.state === 'closed') {
					sub.status = 'rejected'
					sub.reason = 'closed'
					out.closed = sub.id
				} else if (this.now() - sub.pr.openedAt > this.limits.staleMinutes * 60000) {
					await this.gh.closePr(sub.pr.number, sub.pr.branch, 'Closed by the world bot: the checks did not pass in time. The world did not take this mark.')
					sub.status = 'rejected'
					sub.reason = 'checks'
					out.closed = sub.id
				}
				if (sub.status !== 'open') {
					await this.storage.put(SUB(sub.id), sub)
					delete s.keys[sub.key]
					s.open = null
					this.ctx = null
				}
			}
		}
		if (!s.open && s.queue.length) {
			const now = this.now()
			const dayK = `pr:${dayOf(now)}`
			const hourK = `prh:${hourOf(now)}`
			if ((s.rl[dayK] ?? 0) >= this.limits.globalPrPerDay || (s.rl[hourK] ?? 0) >= this.limits.prPerHour) out.waiting = 'rate'
			else {
				const id = s.queue[0]
				const sub = await this.storage.get(SUB(id))
				if (!sub) s.queue.shift()
				else {
					try {
						await this.openPr(sub)
						s.queue.shift()
						s.open = id
						s.rl[dayK] = (s.rl[dayK] ?? 0) + 1
						s.rl[hourK] = (s.rl[hourK] ?? 0) + 1
						out.opened = id
					} catch (e) {
						sub.attempts = (sub.attempts ?? 0) + 1
						const permanent = e.permanent || (e instanceof GitHubError && e.status >= 400 && e.status < 500 && e.status !== 403 && e.status !== 429)
						this.log(`world bot: open ${id} failed (${sub.attempts}): ${e.message}`)
						if (permanent || sub.attempts >= this.limits.maxAttempts) {
							sub.status = 'rejected'
							sub.reason = e.reason ?? 'github'
							s.queue.shift()
							delete s.keys[sub.key]
							out.failed = id
						}
						await this.storage.put(SUB(id), sub)
					}
				}
			}
		}
		await this.saveState(s)
		return out
	}

	/** Build the files on top of the current main and open the PR. */
	async openPr(sub) {
		const ctx = await this.worldContext({fresh: true})
		const today = dayOf(this.now())
		let files
		let edition = null
		if (sub.kind === 'block') {
			if (ctx.blockFiles.includes(sub.block.file)) throw Object.assign(new Error('block file exists'), {permanent: true, reason: 'duplicate'})
			const index = await this.gh.readFile(`${BLOCKS_DIR}/index.js`, ctx.sha)
			const next = index && addBlockToIndex(index, sub.block.file)
			if (!next) throw Object.assign(new Error('blocks/index.js not in the expected format'), {permanent: true, reason: 'index'})
			files = [
				{path: sub.path, content: sub.block.source},
				{path: `${BLOCKS_DIR}/index.js`, content: next},
			]
		} else {
			if (hasKey(ctx.manifest, sub.key)) throw Object.assign(new Error('already in the world'), {permanent: true, reason: 'duplicate'})
			const name = entryName(sub.entry)
			if (name && (ctx.manifest.names ?? []).some((n) => n.toLowerCase() === name.toLowerCase())) throw Object.assign(new Error('name taken'), {permanent: true, reason: 'duplicate'})
			const text = serializeEntry(sub.entry)
			const m = await addToManifest(ctx.manifest, {path: sub.path, type: sub.entry.type, text, name, title: sub.title, book: sub.run.bookNo, at: today})
			edition = m.edition
			files = [
				{path: `world/${sub.path}`, content: text},
				{path: MANIFEST_PATH, content: serializeManifest(m)},
			]
			const dataBytes = new TextEncoder().encode(text).length
			if (dataBytes > LIMITS.prDataBytes) throw Object.assign(new Error('too large'), {permanent: true, reason: 'size'})
		}
		if (files.length > LIMITS.prFiles) throw Object.assign(new Error('too many files'), {permanent: true, reason: 'size'})
		const branch = `world/${sub.id}`
		const title = `World: ${sub.title}${sub.run.bookNo ? ` (Book ${sub.run.bookNo})` : ''}`.slice(0, 120)
		const body = prBody(sub, edition)
		const pr = await this.gh.openWorldPr({branch, parent: ctx.sha, title, body, message: `${title}\n\nworld-bot ${sub.id}`, files, labels: ['world-change', sub.kind === 'block' ? 'world-code' : 'world-data']})
		const auto = await this.gh.enableAutoMerge(pr.nodeId)
		sub.status = 'open'
		sub.pr = {number: pr.number, url: pr.url, branch, openedAt: this.now(), autoMerge: auto}
		if (edition) sub.edition = edition
		await this.storage.put(SUB(sub.id), sub)
		this.ctx = null
		this.log(`world bot: opened PR #${pr.number} for ${sub.id}`)
		return pr
	}

	/** When the Durable Object should wake next (ms epoch) or null. */
	async nextWake() {
		const s = await this.state()
		return s.open || s.queue.length ? this.now() + 2 * 60 * 1000 : null
	}
}

/** PR description: data only, rendered by the game's own text functions. */
export function prBody(sub, edition) {
	const lines = [
		`A finished book wrote this into Ashbrook.`,
		'',
		`- Kind: \`${sub.kind}\``,
		`- Change: ${sub.title}`,
		sub.summary ? `- Reads: ${sub.summary}` : null,
		`- File: \`${sub.path.startsWith('game/') ? sub.path : 'world/' + sub.path}\``,
		edition ? `- Edition: ${edition}` : null,
		`- From: Book ${sub.run.bookNo ?? '?'}, seed \`${sub.run.seed ?? '?'}\`, edition ${sub.run.edition ?? '?'}, engine \`${sub.run.engine ?? '?'}\`${sub.run.room ? ', a party' : ''}`,
		`- Source: ${sub.entry?.origin?.src === 'preset' ? 'offline preset' : 'AI proposal, validated by the world bot'}`,
		'',
		'Re-validated by the bot (schema, text rules, power budget, balance sim). The `ever-check` workflow runs the tests, the path allowlist, the size limits and the full balance sim; this PR merges automatically when it passes.',
		'',
		`world-bot id: \`${sub.id}\` · content key: \`${sub.key}\` · shared under AGPL-3.0-or-later`,
	]
	return lines.filter((l) => l !== null).join('\n')
}
