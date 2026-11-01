// EVER room server: deep validation of client frames + per-socket rate limits.
// OWNER: network engineer. decodeClient() in contracts.js checks the envelope (version,
// type whitelist, 4 KB cap, basic field shapes). This module goes one level deeper:
// every field the room will use is re-checked and REBUILT, so nothing the client sent
// beyond the whitelisted fields ever reaches the rules modules.
// Pure: no Workers APIs, imported by vitest directly.
// Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later

import {FREE_TEXT_MAX, MSG, STATIONS, validateAiProposal} from '../../game/src/core/contracts.js'

/** Map half-size (GDD 5: 64 x 64 units, origin at the well). */
export const MAP_HALF = 32
/** GDD 5: the player walks at 6 u/s. */
export const WALK_SPEED = 6
/** Movement budget: speed x slack per second, never more than CAP seconds banked. */
export const MOVE_SLACK = 1.5
export const MOVE_BANK_S = 2
export const MOVE_GRACE = 0.5

/** Per-socket token bucket (TECH 6.4). */
export const RATE = Object.freeze({burst: 30, perSec: 15, maxStrikes: 40, maxBad: 10})

const UID = /^c\d{1,5}$/
const CARD_ID = /^[A-Za-z][A-Za-z +'-]{0,31}$/
const OPTION_ID = /^[A-Za-z0-9_.:-]{1,32}$/
const TYPE_ID = /^[a-z]{2,16}(\.[A-Za-z]{2,20})?$/

const str = (x, max) => typeof x === 'string' && x.length > 0 && x.length <= max
const int = (x, lo, hi) => Number.isInteger(x) && x >= lo && x <= hi
const SEED = /^[BCDFGHJKLMNPQRSTVWXZ2-9]{8}$/
/** v2 actions the room runs only by itself (fight results); never accepted from a client. */
const INTERNAL_V2 = new Set(['fight.result', 'fight.begin', 'fight.cancel', 'book.unfinished'])
/** Largest generated-offer definition a client may send (the mechanics validator caps it again). */
const DEF_MAX = 3000

/** A plain JSON copy of an AI offer object, or null (size-capped, no prototype keys). */
function cleanDef(def) {
	if (!def || typeof def !== 'object' || Array.isArray(def)) return null
	let text
	try {
		text = JSON.stringify(def)
	} catch {
		return null
	}
	if (typeof text !== 'string' || text.length > DEF_MAX) return null
	try {
		return JSON.parse(text, (k, v) => (k === '__proto__' || k === 'constructor' || k === 'prototype' ? undefined : v))
	} catch {
		return null
	}
}
const withPage = (a, out) => (int(a.page, 0, 30) ? {...out, page: a.page} : out)

/**
 * Rebuild a BookAction from untrusted input. Returns null if it is not acceptable.
 * Known action types are rebuilt field by field. Unknown types (the systems engineer
 * may add some) pass with at most 4 primitive fields; the rules module rejects them if
 * they mean nothing. 'marcus.friendStruck' is room-internal and always refused.
 * @returns {import('../../game/src/core/contracts.js').BookAction|null}
 */
export function cleanBookAction(a) {
	if (!a || typeof a !== 'object' || Array.isArray(a) || typeof a.type !== 'string') return null
	const type = a.type
	if (!TYPE_ID.test(type) || type === 'marcus.friendStruck' || INTERNAL_V2.has(type)) return null
	switch (type) {
		// ---- v2 (GDD_V2): seeded rooms, pages, offers. The rules re-check everything. ----
		case 'room.seed':
			return SEED.test(a.seed ?? '') ? {type, seed: a.seed, ...(int(a.edition, 0, 999_999) ? {edition: a.edition} : {})} : null
		case 'offer.take': {
			if (!int(a.slot, 0, 3)) return null
			const out = withPage(a, {type, slot: a.slot})
			if (a.swap === true) out.swap = true
			if (a.def !== undefined) {
				const def = cleanDef(a.def)
				if (!def) return null
				out.def = def
			}
			return out
		}
		case 'spoils.take':
			return int(a.slot, 0, 7) ? {type, slot: a.slot, ...(a.swap === true ? {swap: true} : {})} : null
		case 'spoils.leave':
			return {type}
		case 'offer.decline':
		case 'page.skip':
		case 'moment.talk':
		case 'hearth.rest':
			return withPage(a, {type})
		case 'moment.option':
			return str(a.option, 32) && OPTION_ID.test(a.option) ? withPage(a, {type, option: a.option}) : null
		case 'moment.free': {
			if (typeof a.text !== 'string' || a.text.length > FREE_TEXT_MAX) return null
			const text = a.text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
			return text ? withPage(a, {type, text}) : null
		}
		case 'grind.upgrade':
		case 'hearth.burn':
		case 'hearth.remove':
			return str(a.uid, 8) && UID.test(a.uid) ? withPage(a, {type, uid: a.uid}) : null
		case 'hearth.temper': {
			if (!(str(a.uid, 8) && UID.test(a.uid))) return null
			const out = withPage(a, {type, uid: a.uid})
			if (a.uid2 !== undefined) {
				if (!(str(a.uid2, 8) && UID.test(a.uid2))) return null
				out.uid2 = a.uid2
			}
			return out
		}
		case 'visit':
			return Object.hasOwn(STATIONS, a.place) ? {type, place: a.place} : null
		case 'well.remove':
		case 'anvil.upgrade':
			return str(a.uid, 8) && UID.test(a.uid) ? withPage(a, {type, uid: a.uid}) : null
		case 'lectern.take':
			// v2: a slot of the generated offer; MVP: an engine card id
			if (int(a.slot, 0, 5)) return withPage(a, {type, slot: a.slot})
			return str(a.id, 32) && CARD_ID.test(a.id) ? {type, id: a.id} : null
		case 'marcus.option':
			return str(a.option, 32) && OPTION_ID.test(a.option) ? {type, option: a.option} : null
		case 'marcus.free': {
			if (typeof a.text !== 'string' || a.text.length > FREE_TEXT_MAX) return null
			const text = a.text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
			if (!text) return null
			const out = {type, text}
			// GDD 2.5 accepted risk: the room cannot verify the model ran. Re-validate the
			// proposal shape (steps 1-4); rules apply steps 5-7 and the +2 free-text cap.
			if (a.ai !== undefined && a.ai !== null) {
				const v = validateAiProposal(typeof a.ai === 'object' ? a.ai : null)
				if (v.ok) out.ai = v.proposal
			}
			return out
		}
		case 'well.ward':
		case 'grindstone.take':
		case 'shrine.take':
			return withPage(a, {type})
		case 'lectern.leave':
		case 'marcus.talk':
			return {type}
		default: {
			const out = {type}
			let n = 0
			for (const [k, v] of Object.entries(a)) {
				if (k === 'type') continue
				if (++n > 4 || !/^[a-zA-Z]{1,16}$/.test(k)) return null
				if (typeof v === 'string' ? v.length <= 64 : typeof v === 'boolean' || Number.isFinite(v)) out[k] = v
				else return null
			}
			return out
		}
	}
}

/**
 * Second-level check of a decoded frame. Returns the fields the room uses, rebuilt.
 * @returns {{ok: true, msg: any} | {ok: false, error: 'bad_msg'}}
 */
export function cleanClientMsg(m) {
	const bad = {ok: /** @type {false} */ (false), error: /** @type {'bad_msg'} */ ('bad_msg')}
	const ref = Number.isInteger(m.ref) && m.ref >= 0 && m.ref < 2 ** 31 ? m.ref : undefined
	switch (m.t) {
		case MSG.HELLO: {
			const tok = typeof m.seatToken === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(m.seatToken) ? m.seatToken : undefined
			return {ok: true, msg: {t: m.t, name: String(m.name ?? ''), seatToken: tok, booksWritten: m.booksWritten ?? 0}}
		}
		case MSG.MOVE: {
			const [x, z, yaw] = m.p
			if (Math.abs(x) > 1e4 || Math.abs(z) > 1e4 || Math.abs(yaw) > 1e3) return bad
			return {ok: true, msg: {t: m.t, x, z, yaw: wrapAngle(yaw), w: m.w ? 1 : 0}}
		}
		case MSG.ACT: {
			const a = cleanBookAction(m.a)
			return a ? {ok: true, msg: {t: m.t, ref, a}} : bad
		}
		case MSG.GATE:
			return {ok: true, msg: {t: m.t, ready: m.ready}}
		case MSG.PLAY: {
			if (!/^[A-Za-z0-9_-]{1,64}$/.test(m.cardId)) return bad
			if (m.target !== undefined && !/^(enemy\d|player)$/.test(m.target)) return bad
			return {ok: true, msg: {t: m.t, ref, cardId: m.cardId, target: m.target}}
		}
		case MSG.END:
			return {ok: true, msg: {t: m.t, ref}}
		case MSG.VOTE:
			return {ok: true, msg: {t: m.t, newBook: m.newBook}}
		case MSG.PING:
			return {ok: true, msg: {t: m.t, ts: Number.isFinite(m.ts) ? m.ts : 0}}
		case MSG.BYE:
			return {ok: true, msg: {t: m.t}}
	}
	return bad
}

/** Wrap an angle to (-PI, PI]. */
export function wrapAngle(a) {
	if (!Number.isFinite(a)) return 0
	let r = a % (2 * Math.PI)
	if (r > Math.PI) r -= 2 * Math.PI
	if (r <= -Math.PI) r += 2 * Math.PI
	return r
}

/**
 * Server-side movement check (TECH 6.4 rule 1): clamp to the map, and never let a seat
 * move faster than WALK_SPEED x MOVE_SLACK. Banked budget absorbs network bursts.
 * @param {{pos: [number, number, number], moveBudget: number, lastMoveAt: number}} s
 * @returns {{pos: [number, number, number], moveBudget: number, lastMoveAt: number, clamped: boolean}}
 */
export function checkMove(s, x, z, yaw, now) {
	const dt = Math.max(0, Math.min(MOVE_BANK_S, (now - s.lastMoveAt) / 1000))
	const cap = WALK_SPEED * MOVE_SLACK * MOVE_BANK_S
	let budget = Math.min(cap, s.moveBudget + dt * WALK_SPEED * MOVE_SLACK)
	const tx = clamp(x, -MAP_HALF, MAP_HALF)
	const tz = clamp(z, -MAP_HALF, MAP_HALF)
	const dx = tx - s.pos[0]
	const dz = tz - s.pos[1]
	const d = Math.hypot(dx, dz)
	let nx = tx
	let nz = tz
	let clamped = tx !== x || tz !== z
	if (d > budget + MOVE_GRACE) {
		const k = budget / d
		nx = s.pos[0] + dx * k
		nz = s.pos[1] + dz * k
		budget = 0
		clamped = true
	} else budget = Math.max(0, budget - d)
	return {pos: [nx, nz, wrapAngle(yaw)], moveBudget: budget, lastMoveAt: now, clamped}
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

/**
 * Token bucket. take() -> true if the frame may be processed.
 */
export function createBucket(now, {burst = RATE.burst, perSec = RATE.perSec} = {}) {
	let tokens = burst
	let at = now
	return {
		take(t) {
			tokens = Math.min(burst, tokens + ((t - at) / 1000) * perSec)
			at = t
			if (tokens < 1) return false
			tokens -= 1
			return true
		},
		get tokens() {
			return tokens
		},
	}
}
