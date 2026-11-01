// EVER platform: the world/ data schema (major changes, GDD_V2 14). One module, three hosts:
// the browser (loader), the bot Worker (proposal re-validation) and CI (check-world.mjs).
// Every world file is plain JSON; every text field is sanitized here; every card or item
// goes through the mechanics validator (validateContent) with the stricter "global" band.
// PURE: no DOM, no network, no storage, no timers.
//
// Copyright (C) 2026 the EVER contributors.
// SPDX-License-Identifier: AGPL-3.0-or-later

import {ART_PROPS, ART_TINTS, ITEM_SLOTS, THEMES, canonicalJson, cleanFlavor, cleanName, rulesText, validateContent} from '../mechanics/index.js'
import {checkBlockSource} from '../mechanics/sandbox/check.js'

export const WORLD_SCHEMA_VERSION = 1

/** World entry types -> folder under world/. `block` is code and lives in game/src/mechanics/blocks/. */
export const WORLD_TYPES = Object.freeze({
	card: 'cards',
	item: 'items',
	line: 'lines',
	npc: 'npcs',
	place: 'places',
	path: 'paths',
	preset: 'presets',
})
/** Kinds a winning run may propose (GDD_V2 14.2). Presets are studio-authored only. */
export const PROPOSAL_KINDS = Object.freeze(['card', 'item', 'line', 'npc', 'place', 'path', 'block'])

/** GDD_V2 14.2: marked anchors for place props (the world engineer places them in nav.js). */
export const ANCHORS = Object.freeze(['well', 'forgeDoor', 'lecternTree', 'roadFire', 'cart', 'keeperBench', 'gatePillarWest', 'gatePillarEast', 'shrinePath', 'southSignpost', 'eastMeadow', 'westWoodEdge'])
export const ANCHOR_LABELS = Object.freeze({
	well: 'the well', forgeDoor: 'the forge door', lecternTree: 'the lectern tree', roadFire: 'the road fire', cart: 'the cart',
	keeperBench: "the keeper's bench", gatePillarWest: 'the west gate pillar', gatePillarEast: 'the east gate pillar',
	shrinePath: 'the shrine path', southSignpost: 'the south signpost', eastMeadow: 'the east meadow', westWoodEdge: 'the west wood edge',
})
/** GDD_V2 14.2 kind 4: the closed list of place props. */
export const PLACE_PROPS = Object.freeze(['cairn', 'lantern', 'briar', 'carvedStone', 'signpost', 'bench', 'wildflowers'])
export const PLACE_LABELS = Object.freeze({cairn: 'A cairn', lantern: 'A lit lantern', briar: 'A briar patch', carvedStone: 'A carved stone', signpost: 'A signpost arrow', bench: 'A bench', wildflowers: 'Wildflowers'})
/** NPCs a line can belong to; world npcs are addressed as `npc:<id>`. */
export const LINE_NPCS = Object.freeze(['marcus', 'keeper', 'wayfarer'])
export const ARCHETYPES = Object.freeze(['wayfarer', 'keeper'])
/** MVP trust words (GDD 2.2). */
export const TRUST_WORDS = Object.freeze(['cold', 'wary', 'guarded', 'warm', 'trusting'])
export const OFFER_BIAS = Object.freeze(['card', 'item', 'token', 'handItem', 'bodyItem', 'charmItem'])

export const LIMITS = Object.freeze({
	fileBytes: 4096, // one world file, as stored
	lineChars: 140,
	lineSentences: 3,
	inscriptionChars: 40,
	titleCount: 6,
	openings: 8,
	proposalBytes: 12288, // raw proposal JSON, before parsing
	blockLines: 120,
	prFiles: 3,
	prDataBytes: 8192,
})

const ID_RE = /^[a-z][a-z0-9-]{1,31}$/
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x)
const byteLength = (s) => new TextEncoder().encode(s).length

// ---------------------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------------------

/**
 * A spoken line or an inscription: 1..`sentences` sentences, each passing the mechanics
 * flavor rules (no digits, links, markup, "!", blocked words), at most `max` characters.
 * @returns {{ok: true, value: string} | {ok: false, reason: string}}
 */
export function cleanLine(raw, {max = LIMITS.lineChars, sentences = LIMITS.lineSentences, blocklist = []} = {}) {
	if (typeof raw !== 'string' || !raw.trim()) return {ok: false, reason: 'text is required'}
	if (raw.length > max * 2) return {ok: false, reason: `text must be at most ${max} characters`}
	const parts = raw.replace(/\s+/g, ' ').trim().match(/[^.?]+[.?]*/g) ?? []
	if (parts.length > sentences) return {ok: false, reason: `at most ${sentences} sentences`}
	const out = []
	for (const p of parts) {
		const c = cleanFlavor(p.trim(), {blocklist})
		if (!c.ok) return {ok: false, reason: c.reason.replace('flavor', 'text')}
		if (c.value) out.push(c.value)
	}
	const value = out.join(' ')
	if (!value) return {ok: false, reason: 'text is required'}
	if (value.length > max) return {ok: false, reason: `text must be at most ${max} characters`}
	return {ok: true, value}
}

// ---------------------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------------------

/**
 * @typedef {{book?: number, edition?: number, seed?: string, src: 'ai'|'preset'|'studio', preset?: string, at?: string}} Origin
 * @typedef {{code: string, path: string, msg: string}} Issue
 * @typedef {object} EntryContext
 * @prop {string[]} [names]      names already in the world (cards, items, npcs)
 * @prop {string[]} [blocklist]  Creative Director's blocklist
 * @prop {false|object} [sim]    balance check options for cards/items (false = skip)
 * @prop {boolean} [bot]         the entry comes from a run (not studio): no keepsake/special, src must not be studio
 */

function cleanOrigin(o, errors, {bot}) {
	if (!isObj(o)) {
		errors.push({code: 'field', path: 'origin', msg: 'origin is required'})
		return null
	}
	const src = ['ai', 'preset', 'studio'].includes(o.src) ? o.src : null
	if (!src) errors.push({code: 'enum', path: 'origin.src', msg: 'origin.src must be ai, preset or studio'})
	if (bot && src === 'studio') errors.push({code: 'origin', path: 'origin.src', msg: 'a run cannot make studio content'})
	const out = {src}
	if (o.book !== undefined) {
		if (!Number.isInteger(o.book) || o.book < 1 || o.book > 1e6) errors.push({code: 'param', path: 'origin.book', msg: 'book must be a positive integer'})
		else out.book = o.book
	}
	if (o.edition !== undefined) {
		if (!Number.isInteger(o.edition) || o.edition < 0 || o.edition > 1e7) errors.push({code: 'param', path: 'origin.edition', msg: 'edition must be an integer'})
		else out.edition = o.edition
	}
	if (o.seed !== undefined) {
		if (typeof o.seed !== 'string' || !/^[A-Z0-9-]{4,16}$/.test(o.seed)) errors.push({code: 'param', path: 'origin.seed', msg: 'seed must be 4-16 of A-Z, 0-9, -'})
		else out.seed = o.seed
	}
	if (o.preset !== undefined) {
		if (typeof o.preset !== 'string' || !ID_RE.test(o.preset)) errors.push({code: 'param', path: 'origin.preset', msg: 'preset id looks wrong'})
		else out.preset = o.preset
	}
	if (o.at !== undefined) {
		if (typeof o.at !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.at)) errors.push({code: 'param', path: 'origin.at', msg: 'at must be YYYY-MM-DD'})
		else out.at = o.at
	}
	return out
}

function oneOf(v, list, path, errors, {optional = false} = {}) {
	if (v === undefined && optional) return undefined
	if (!list.includes(v)) errors.push({code: 'enum', path, msg: `${path} must be one of ${list.join(', ')}`})
	return v
}

/** Body of each entry type (everything but v/type/origin). Returns the clean body. */
const BODY = {
	card: (e, errors, ctx) => mechBody(e, errors, ctx, 'card'),
	item: (e, errors, ctx) => mechBody(e, errors, ctx, 'item'),
	line(e, errors, ctx) {
		const npc = typeof e.npc === 'string' && (LINE_NPCS.includes(e.npc) || /^npc:[a-z][a-z0-9-]{1,31}$/.test(e.npc)) ? e.npc : null
		if (!npc) errors.push({code: 'enum', path: 'npc', msg: `npc must be ${LINE_NPCS.join(', ')} or npc:<id>`})
		const when = {}
		if (e.when !== undefined) {
			if (!isObj(e.when)) errors.push({code: 'field', path: 'when', msg: 'when must be an object'})
			else {
				if (e.when.theme !== undefined) when.theme = oneOf(e.when.theme, THEMES, 'when.theme', errors)
				if (e.when.trust !== undefined) when.trust = oneOf(e.when.trust, TRUST_WORDS, 'when.trust', errors)
				if (e.when.echo !== undefined) {
					if (typeof e.when.echo !== 'boolean') errors.push({code: 'param', path: 'when.echo', msg: 'echo must be true or false'})
					else when.echo = e.when.echo
				}
				for (const k of Object.keys(e.when)) if (!['theme', 'trust', 'echo'].includes(k)) errors.push({code: 'field', path: `when.${k}`, msg: `unknown condition ${k}`})
			}
		}
		const text = cleanLine(e.text, {blocklist: ctx.blocklist})
		if (!text.ok) errors.push({code: 'text', path: 'text', msg: text.reason})
		return {npc, when, text: text.ok ? text.value : null}
	},
	npc(e, errors, ctx) {
		const id = typeof e.id === 'string' && ID_RE.test(e.id) ? e.id : null
		if (!id) errors.push({code: 'param', path: 'id', msg: 'id must be 2-32 of a-z, 0-9, - (starting with a letter)'})
		const name = cleanName(e.name, {existing: ctx.names ?? [], blocklist: ctx.blocklist})
		if (!name.ok) errors.push({code: 'text', path: 'name', msg: name.reason})
		const archetype = oneOf(e.archetype, ARCHETYPES, 'archetype', errors)
		const look = {}
		if (!isObj(e.look)) errors.push({code: 'field', path: 'look', msg: 'look is required'})
		else {
			look.cloak = oneOf(e.look.cloak, ART_TINTS, 'look.cloak', errors)
			look.accent = oneOf(e.look.accent, ART_TINTS, 'look.accent', errors)
			look.prop = oneOf(e.look.prop, ART_PROPS, 'look.prop', errors)
		}
		const bias = oneOf(e.bias, OFFER_BIAS, 'bias', errors)
		const openings = {}
		if (!isObj(e.openings) || !Object.keys(e.openings).length) errors.push({code: 'field', path: 'openings', msg: 'at least one opening line is required'})
		else {
			const keys = Object.keys(e.openings)
			if (keys.length > LIMITS.openings) errors.push({code: 'too_many', path: 'openings', msg: `at most ${LIMITS.openings} openings`})
			for (const k of keys.slice(0, LIMITS.openings)) {
				if (!THEMES.includes(k)) {
					errors.push({code: 'enum', path: `openings.${k}`, msg: `unknown theme ${k}`})
					continue
				}
				const l = cleanLine(e.openings[k], {blocklist: ctx.blocklist})
				if (!l.ok) errors.push({code: 'text', path: `openings.${k}`, msg: l.reason})
				else openings[k] = l.value
			}
		}
		return {id, name: name.ok ? name.value : null, archetype, look, bias, openings}
	},
	place(e, errors, ctx) {
		const anchor = oneOf(e.anchor, ANCHORS, 'anchor', errors)
		const prop = oneOf(e.prop, PLACE_PROPS, 'prop', errors)
		const out = {anchor, prop}
		if (e.inscription !== undefined && e.inscription !== '') {
			if (prop !== 'carvedStone' && prop !== 'cairn' && prop !== 'signpost') errors.push({code: 'field', path: 'inscription', msg: 'only a carved stone, a cairn or a signpost carries an inscription'})
			const l = cleanLine(e.inscription, {max: LIMITS.inscriptionChars, sentences: 1, blocklist: ctx.blocklist})
			if (!l.ok) errors.push({code: 'text', path: 'inscription', msg: l.reason})
			else out.inscription = l.value
		}
		return out
	},
	path(e, errors, ctx) {
		const theme = oneOf(e.theme, THEMES, 'theme', errors)
		const titles = []
		if (!Array.isArray(e.titles) || e.titles.length < 2 || e.titles.length > LIMITS.titleCount) errors.push({code: 'too_few', path: 'titles', msg: `2-${LIMITS.titleCount} page titles`})
		else
			e.titles.forEach((t, i) => {
				const n = cleanName(t, {blocklist: ctx.blocklist})
				if (!n.ok) errors.push({code: 'text', path: `titles[${i}]`, msg: n.reason})
				else titles.push(n.value)
			})
		if (new Set(titles.map((t) => t.toLowerCase())).size !== titles.length) errors.push({code: 'text', path: 'titles', msg: 'titles repeat'})
		return {theme, titles}
	},
	preset(e, errors, ctx) {
		if (ctx.bot) errors.push({code: 'origin', path: 'type', msg: 'presets are studio content'})
		const id = typeof e.id === 'string' && ID_RE.test(e.id) ? e.id : null
		if (!id) errors.push({code: 'param', path: 'id', msg: 'preset id must be 2-32 of a-z, 0-9, -'})
		const themes = Array.isArray(e.themes) ? e.themes.filter((t) => THEMES.includes(t)) : []
		if (!themes.length || themes.length !== e.themes.length) errors.push({code: 'enum', path: 'themes', msg: 'themes must be a non-empty list of theme ids'})
		let proposal = null
		let sim = null
		if (!isObj(e.proposal) || e.proposal.kind === 'block' || !PROPOSAL_KINDS.includes(e.proposal.kind)) errors.push({code: 'kind', path: 'proposal.kind', msg: 'presets make card, item, line, npc, place or path changes (never code)'})
		else {
			const sub = []
			const body = BODY[e.proposal.kind](e.proposal.data ?? {}, sub, {...ctx, bot: false})
			for (const s of sub) errors.push({...s, path: `proposal.data.${s.path}`})
			sim = body._sim
			delete body._sim
			proposal = {kind: e.proposal.kind, data: body}
		}
		return {id, themes, proposal, ...(sim ? {_sim: sim} : {})}
	},
}

function mechBody(e, errors, ctx, kind) {
	const v = validateContent(e.def, {
		kind,
		offer: 'global',
		authored: !ctx.bot,
		existingNames: ctx.names ?? [],
		blocklist: ctx.blocklist ?? [],
		sim: ctx.sim ?? false,
	})
	for (const x of v.errors) errors.push({code: x.code, path: `def${x.path ? '.' + x.path : ''}`, msg: x.msg})
	return {def: v.ok ? v.def : null, ...(v.sim ? {_sim: v.sim} : {})}
}

/**
 * Validate one world file (parsed JSON). Returns a canonical entry (unknown fields dropped).
 * @param {unknown} raw
 * @param {EntryContext} [ctx]
 * @returns {{ok: boolean, entry: object|null, errors: Issue[], sim?: object}}
 */
export function validateWorldEntry(raw, ctx = {}) {
	const errors = []
	if (!isObj(raw)) return {ok: false, entry: null, errors: [{code: 'not_object', path: '', msg: 'a world file is one JSON object'}]}
	if (raw.v !== WORLD_SCHEMA_VERSION) errors.push({code: 'version', path: 'v', msg: `v must be ${WORLD_SCHEMA_VERSION}`})
	const type = Object.hasOwn(WORLD_TYPES, raw.type) ? raw.type : null
	if (!type) return {ok: false, entry: null, errors: [...errors, {code: 'kind', path: 'type', msg: `type must be one of ${Object.keys(WORLD_TYPES).join(', ')}`}]}
	const origin = cleanOrigin(raw.origin, errors, ctx)
	const body = BODY[type](raw, errors, ctx)
	const sim = body._sim
	delete body._sim
	const entry = {v: WORLD_SCHEMA_VERSION, type, origin, ...body}
	if (!errors.length && byteLength(serializeEntry(entry)) > LIMITS.fileBytes) errors.push({code: 'size', path: '', msg: `a world file is at most ${LIMITS.fileBytes} bytes`})
	return {ok: errors.length === 0, entry: errors.length ? null : entry, errors, ...(sim ? {sim} : {})}
}

/** The exact bytes a world file is stored with (the manifest hashes these). */
export const serializeEntry = (entry) => JSON.stringify(entry, null, '\t') + '\n'

/** Content key: the entry without its origin (two runs proposing the same thing collide). */
export function entryKey(entry) {
	const {origin: _o, ...rest} = entry
	return canonicalJson(rest)
}

const slug = (s) =>
	String(s ?? '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 32) || 'entry'

/** Display name of an entry (cards, items, npcs) or null. */
export function entryName(entry) {
	if (entry.type === 'card' || entry.type === 'item') return entry.def?.name ?? null
	if (entry.type === 'npc') return entry.name
	return null
}

/** Ledger title, rendered by the game from data (never model text beyond sanitized names). */
export function entryTitle(entry) {
	switch (entry.type) {
		case 'card':
			return `${entry.def.name} joins the stone`
		case 'item':
			return `${entry.def.name} for every book`
		case 'line':
			return `${entry.npc.startsWith('npc:') ? 'A new face' : entry.npc[0].toUpperCase() + entry.npc.slice(1)} learns a line`
		case 'npc':
			return `A new ${entry.archetype}: ${entry.name}`
		case 'place':
			return `${PLACE_LABELS[entry.prop]} by ${ANCHOR_LABELS[entry.anchor]}`
		case 'path':
			return `New page titles for ${entry.theme} books`
		case 'preset':
			return `Preset ${entry.id}`
		default:
			return 'A change'
	}
}

/** One-line summary for PR bodies and previews: rules text for cards/items. */
export function entrySummary(entry) {
	if (entry.type === 'card' || entry.type === 'item') return rulesText(entry.def)
	if (entry.type === 'line') return entry.text
	if (entry.type === 'npc') return Object.values(entry.openings)[0] ?? ''
	if (entry.type === 'place') return entry.inscription ?? ''
	if (entry.type === 'path') return entry.titles.join(' / ')
	return ''
}

/**
 * The repo path for an entry: world/<folder>/<slug>-<key8>.json. The key suffix makes
 * dedupe a path lookup. Async (SHA-256 through WebCrypto, available in browsers, Workers, Node 20+).
 */
export async function entryPath(entry) {
	const key = (await sha256Hex(entryKey(entry))).slice(0, 8)
	const base = entry.type === 'preset' ? entry.id : entryName(entry) ?? (entry.type === 'line' ? `${entry.npc.replace('npc:', '')}-${entry.when?.theme ?? 'any'}` : entry.type === 'place' ? `${entry.anchor}-${entry.prop}` : `${entry.theme ?? 'x'}`)
	return {path: `${WORLD_TYPES[entry.type]}/${slug(base)}-${key}.json`, key}
}

export async function sha256Hex(text) {
	const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
	return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ---------------------------------------------------------------------------------------
// Proposals (what a finished winning run sends to the bot endpoint)
// ---------------------------------------------------------------------------------------

/**
 * Proposal (client or room -> bot endpoint):
 *   {v: 1, kind, data, preset?, run: {seed, edition, engine, bookNo, pages, themes, won: true, room?, winId?, log?}}
 * `data` is the entry body for that kind (card/item: {def}; line: {npc, when, text}; ...).
 * For `block`: {file: 'kebab-name.js', source: '...'}.
 */
export function validateRun(run, errors) {
	if (!isObj(run)) {
		errors.push({code: 'field', path: 'run', msg: 'run is required'})
		return null
	}
	const out = {}
	if (run.won !== true) errors.push({code: 'run', path: 'run.won', msg: 'only a won book can change the world'})
	if (typeof run.seed !== 'string' || !/^[A-Z0-9-]{4,16}$/.test(run.seed)) errors.push({code: 'run', path: 'run.seed', msg: 'seed missing'})
	else out.seed = run.seed
	if (!Number.isInteger(run.edition) || run.edition < 0) errors.push({code: 'run', path: 'run.edition', msg: 'edition missing'})
	else out.edition = run.edition
	if (typeof run.engine !== 'string' || !/^[0-9A-Za-z.+-]{1,40}$/.test(run.engine)) errors.push({code: 'run', path: 'run.engine', msg: 'engine version missing'})
	else out.engine = run.engine
	if (!Number.isInteger(run.bookNo) || run.bookNo < 1 || run.bookNo > 1e6) errors.push({code: 'run', path: 'run.bookNo', msg: 'bookNo missing'})
	else out.bookNo = run.bookNo
	if (run.pages !== undefined) out.pages = Number.isInteger(run.pages) && run.pages >= 1 && run.pages <= 20 ? run.pages : 9
	out.themes = Array.isArray(run.themes) ? run.themes.filter((t) => THEMES.includes(t)).slice(0, 3) : []
	if (run.room !== undefined) {
		if (typeof run.room !== 'string' || !/^[A-Z0-9]{5}$/.test(run.room)) errors.push({code: 'run', path: 'run.room', msg: 'room code looks wrong'})
		else out.room = run.room
	}
	if (run.winId !== undefined) {
		if (typeof run.winId !== 'string' || !/^[A-Za-z0-9_-]{4,40}$/.test(run.winId)) errors.push({code: 'run', path: 'run.winId', msg: 'winId looks wrong'})
		else out.winId = run.winId
	}
	if (run.log !== undefined) out.log = run.log // replay proof; checked by the endpoint's verifier, never stored in the world
	return out
}

/**
 * Validate a world-change proposal into a world entry (or a code-block change).
 * @param {unknown} raw  JSON text or object
 * @param {EntryContext & {today?: string, blockIds?: string[], blockFiles?: string[]}} ctx
 * @returns {{ok: boolean, errors: Issue[], kind?: string, run?: object, entry?: object, block?: {file: string, source: string, id: string}, title?: string, summary?: string}}
 */
export function validateProposal(raw, ctx = {}) {
	const errors = []
	let obj = raw
	if (typeof raw === 'string') {
		if (byteLength(raw) > LIMITS.proposalBytes) return {ok: false, errors: [{code: 'size', path: '', msg: 'proposal is too large'}]}
		try {
			obj = JSON.parse(raw)
		} catch {
			return {ok: false, errors: [{code: 'not_object', path: '', msg: 'proposal is not JSON'}]}
		}
	} else {
		let text
		try {
			text = JSON.stringify(raw)
		} catch {
			return {ok: false, errors: [{code: 'not_object', path: '', msg: 'not serializable'}]}
		}
		if (typeof text !== 'string' || byteLength(text) > LIMITS.proposalBytes) return {ok: false, errors: [{code: 'size', path: '', msg: 'proposal is too large'}]}
	}
	if (!isObj(obj)) return {ok: false, errors: [{code: 'not_object', path: '', msg: 'a proposal is one JSON object'}]}
	if (obj.v !== 1) errors.push({code: 'version', path: 'v', msg: 'v must be 1'})
	const kind = PROPOSAL_KINDS.includes(obj.kind) ? obj.kind : null
	if (!kind) return {ok: false, errors: [...errors, {code: 'kind', path: 'kind', msg: `kind must be one of ${PROPOSAL_KINDS.join(', ')}`}]}
	const run = validateRun(obj.run, errors)
	if (!isObj(obj.data)) errors.push({code: 'field', path: 'data', msg: 'data is required'})
	if (errors.length) return {ok: false, errors}

	const preset = obj.preset === undefined ? undefined : typeof obj.preset === 'string' && ID_RE.test(obj.preset) ? obj.preset : null
	if (preset === null) return {ok: false, errors: [{code: 'param', path: 'preset', msg: 'preset id looks wrong'}]}

	if (kind === 'block') {
		if (preset) return {ok: false, errors: [{code: 'kind', path: 'kind', msg: 'presets never make code'}]}
		return validateBlockProposal(obj.data, run, ctx)
	}

	const origin = {src: preset ? 'preset' : 'ai', book: run.bookNo, edition: run.edition, seed: run.seed, ...(preset ? {preset} : {}), ...(ctx.today ? {at: ctx.today} : {})}
	const r = validateWorldEntry({v: 1, type: kind, origin, ...obj.data}, {...ctx, bot: true})
	if (!r.ok) return {ok: false, errors: r.errors.map((e) => ({...e, path: e.path.startsWith('origin') ? e.path : `data.${e.path}`}))}
	return {ok: true, errors: [], kind, run, entry: r.entry, title: entryTitle(r.entry), summary: entrySummary(r.entry), ...(r.sim ? {sim: r.sim} : {})}
}

function validateBlockProposal(data, run, ctx) {
	const errors = []
	const file = typeof data.file === 'string' && /^[a-z][a-z0-9-]{2,40}\.js$/.test(data.file) && data.file !== 'index.js' ? data.file : null
	if (!file) errors.push({code: 'param', path: 'data.file', msg: 'file must be kebab-case.js'})
	if (typeof data.source !== 'string' || !data.source.trim()) errors.push({code: 'field', path: 'data.source', msg: 'source is required'})
	if (errors.length) return {ok: false, errors}
	if ((ctx.blockFiles ?? []).includes(file)) return {ok: false, errors: [{code: 'duplicate', path: 'data.file', msg: 'that block file exists'}]}
	const source = data.source.replace(/\r\n?/g, '\n').replace(/\n*$/, '\n')
	const lines = source.split('\n').length - 1
	if (lines > LIMITS.blockLines) return {ok: false, errors: [{code: 'size', path: 'data.source', msg: `a block is at most ${LIMITS.blockLines} lines`}]}
	if (!/^\/\/ .*\n(\/\/.*\n)*/.test(source) || !source.includes('SPDX-License-Identifier: AGPL-3.0-or-later')) errors.push({code: 'license', path: 'data.source', msg: 'a block starts with a comment header carrying SPDX-License-Identifier: AGPL-3.0-or-later'})
	const chk = checkBlockSource(source, {file})
	for (const e of chk.errors) errors.push({code: 'sandbox', path: 'data.source', msg: e.msg})
	const id = /\bid:\s*'([a-z][A-Za-z0-9]{2,23})'/.exec(source)?.[1]
	if (!id) errors.push({code: 'param', path: 'data.source', msg: "block needs id: '<camelCase>'"})
	else if ((ctx.blockIds ?? []).includes(id)) errors.push({code: 'duplicate', path: 'data.source', msg: `block id ${id} exists`})
	if (errors.length) return {ok: false, errors}
	return {ok: true, errors: [], kind: 'block', run, block: {file, source, id}, title: `A new rule: ${id}`, summary: `New building block ${id} (${lines} lines)`}
}

/** Import name for blocks/index.js from a kebab file name. */
export const blockImportName = (file) => file.replace(/\.js$/, '').replace(/-([a-z0-9])/g, (_m, c) => c.toUpperCase())

/**
 * Add a block file to blocks/index.js (fixed format, see mechanics sandbox/check.js).
 * @returns {string|null} the new index source, or null if the format is not recognised
 */
export function addBlockToIndex(indexSrc, file) {
	const name = blockImportName(file)
	const lines = indexSrc.replace(/\n*$/, '').split('\n')
	const at = lines.findIndex((l) => /^export const CODE_BLOCKS = \[/.test(l))
	if (at < 0) return null
	const m = /^export const CODE_BLOCKS = \[([A-Za-z0-9, ]*)\]$/.exec(lines[at])
	if (!m) return null
	const list = m[1].split(',').map((s) => s.trim()).filter(Boolean)
	if (list.includes(name)) return null
	let lastImport = -1
	lines.forEach((l, i) => {
		if (l.startsWith('import * as ')) lastImport = i
	})
	const importLine = `import * as ${name} from './${file}'`
	const out = [...lines]
	out[at] = `export const CODE_BLOCKS = [${[...list, name].join(', ')}]`
	out.splice(lastImport >= 0 ? lastImport + 1 : at, 0, importLine)
	return out.join('\n') + '\n'
}
