// EVER mechanics: the run content registry. One per book: the engine version and world
// edition the book is pinned to, its seed, and every generated definition it holds, with
// deterministic ids. Plain JSON, a few KB, saved with the book and (in co-op) kept by the
// room. A book's deck refers to generated cards as {uid, id: 'g:c-xxxxxx', upgraded}.
// PURE. Never mutates its input.
//
// Copyright (C) 2026 the EVER contributors.
// SPDX-License-Identifier: AGPL-3.0-or-later

import {SIZE_LIMITS} from './library.js'
import {GEN_PREFIX, MECH_SCHEMA_VERSION, isValidGenId} from './schema.js'
import {canonicalJson, hashId} from './prng.js'
import {validateContent} from './validate.js'

export const RUN_CONTENT_VERSION = 1
const KIND_LETTER = Object.freeze({card: 'c', curse: 'u', item: 'i', token: 't'})

/**
 * @typedef {object} RunContent
 * @prop {number} v           RUN_CONTENT_VERSION
 * @prop {number} schema      MECH_SCHEMA_VERSION the defs were validated with
 * @prop {string} engine      engine (game build) version the book started on
 * @prop {number|string} world  world content edition the book started on
 * @prop {string} seed        the book's seed code
 * @prop {Record<string, object>} defs  id -> canonical def
 * @prop {Record<string, {offer: string, src: string, page: number}>} meta  how each def entered
 * @prop {string[]} order     ids in the order they were added
 */

/** @returns {RunContent} */
export function createRunContent({engine = '0', world = 0, seed = ''} = {}) {
	return {v: RUN_CONTENT_VERSION, schema: MECH_SCHEMA_VERSION, engine: String(engine), world, seed: String(seed), defs: {}, meta: {}, order: []}
}

/** Deterministic id of a def: kind letter + 6 base-36 chars of the hash of its canonical JSON. */
export function contentId(def) {
	const letter = KIND_LETTER[def?.kind]
	if (!letter) throw new TypeError('contentId: unknown kind')
	return `${GEN_PREFIX}${letter}-${hashId(canonicalJson(def))}`
}

/**
 * Add a VALIDATED canonical def. Same def twice -> same id, no duplicate. A different def
 * whose hash collides gets "-2", "-3"... Pure: returns a new RunContent.
 * @param {RunContent} rc
 * @param {object} def  output of validateContent(...).def
 * @param {{offer?: string, src?: 'ai'|'offline'|'world'|'echo', page?: number}} [meta]
 * @returns {{rc: RunContent, id: string, added: boolean}}
 */
export function addContent(rc, def, {offer = 'gift', src = 'offline', page = 0} = {}) {
	const base = contentId(def)
	const json = canonicalJson(def)
	let id = base
	for (let k = 2; rc.defs[id]; k++) {
		if (canonicalJson(rc.defs[id]) === json) return {rc, id, added: false}
		id = `${base}-${k}`
		if (k > 99) throw new RangeError('addContent: too many collisions')
	}
	if (rc.order.length >= SIZE_LIMITS.registryDefs) throw new RangeError(`addContent: a book holds at most ${SIZE_LIMITS.registryDefs} generated things`)
	const next = {...rc, defs: {...rc.defs, [id]: def}, meta: {...rc.meta, [id]: {offer, src, page}}, order: [...rc.order, id]}
	if (serializedBytes(next) > SIZE_LIMITS.registryBytes) throw new RangeError(`addContent: run content over ${SIZE_LIMITS.registryBytes} bytes`)
	return {rc: next, id, added: true}
}

/** Remove a def (e.g. a card burned at the Hearth and no longer referenced). */
export function removeContent(rc, id) {
	if (!rc.defs[id]) return rc
	const defs = {...rc.defs}
	const meta = {...rc.meta}
	delete defs[id]
	delete meta[id]
	return {...rc, defs, meta, order: rc.order.filter((x) => x !== id)}
}

export const getDef = (rc, id) => rc?.defs?.[id] ?? null

/** Compact canonical JSON (stable: same content => same bytes). */
export const serializeRunContent = (rc) => canonicalJson(rc)
const serializedBytes = (rc) => new TextEncoder().encode(serializeRunContent(rc)).length

/**
 * Parse saved/received run content and RE-VALIDATE every def (schema, text, caps, budget;
 * not the sim, which ran when the def was first accepted). Invalid defs are dropped and
 * reported; ids must match their content (no smuggled edits).
 * @param {string|object} input
 * @param {{blocklist?: string[]}} [opts]
 * @returns {{ok: boolean, rc: RunContent|null, dropped: {id: string, reason: string}[], error?: string}}
 */
export function parseRunContent(input, {blocklist = []} = {}) {
	let o = input
	if (typeof input === 'string') {
		if (input.length > SIZE_LIMITS.registryBytes * 2) return {ok: false, rc: null, dropped: [], error: 'too_big'}
		try {
			o = JSON.parse(input)
		} catch {
			return {ok: false, rc: null, dropped: [], error: 'not_json'}
		}
	}
	if (!o || typeof o !== 'object' || o.v !== RUN_CONTENT_VERSION) return {ok: false, rc: null, dropped: [], error: 'version'}
	if (o.schema !== MECH_SCHEMA_VERSION) return {ok: false, rc: null, dropped: [], error: 'schema'}
	let rc = createRunContent({engine: o.engine, world: o.world, seed: o.seed})
	const dropped = []
	const order = Array.isArray(o.order) ? o.order.slice(0, SIZE_LIMITS.registryDefs) : []
	for (const id of order) {
		const def = o.defs?.[id]
		const meta = o.meta?.[id] ?? {}
		if (!isValidGenId(id) || !def) {
			dropped.push({id: String(id).slice(0, 24), reason: 'bad id'})
			continue
		}
		const offer = ['gift', 'bargain', 'curse', 'sealed', 'global'].includes(meta.offer) ? meta.offer : 'gift'
		const authored = meta.src === 'world'
		const v = validateContent(def, {offer, authored, blocklist, content: rc})
		if (!v.ok) {
			dropped.push({id, reason: v.errors[0]?.msg ?? 'invalid'})
			continue
		}
		if (id.replace(/-\d+$/, '') !== contentId(v.def)) {
			dropped.push({id, reason: 'id does not match content'})
			continue
		}
		rc = {...rc, defs: {...rc.defs, [id]: v.def}, meta: {...rc.meta, [id]: {offer, src: String(meta.src ?? 'offline').slice(0, 8), page: Number(meta.page) | 0}}, order: [...rc.order, id]}
	}
	return {ok: true, rc, dropped}
}
