// EVER mechanics: the validator. One call takes untrusted JSON (an AI offer, an offline
// generator output, a co-op client's claim, a world/ file) to a canonical, budget-checked,
// sim-checked definition, or to a list of clear rejection reasons.
//
// Order (GDD_V2 9.5): size -> shape (schema) -> text -> hard caps -> budget -> fairness ->
// balance sim (optional, deterministic). The room server runs the same function with the
// same sim seed, so solo and co-op agree.
// PURE.
//
// Copyright (C) 2026 the EVER contributors.
// SPDX-License-Identifier: AGPL-3.0-or-later

import {SIZE_LIMITS} from './library.js'
import {MECH_SCHEMA_VERSION, normalizeContent} from './schema.js'
import {checkBudget, checkCaps, scoreContent} from './budget.js'
import {cleanFlavor, cleanName} from './text.js'
import {upgradedCard} from './upgrade.js'
import {balanceCheck} from './sim.js'
import {canonicalJson} from './prng.js'

/** Max raw input size before parsing (bytes of JSON text). */
export const RAW_MAX_BYTES = 8192
/** Offer kinds (GDD_V2 9.4 / 10.1). Only these may carry a net-negative change. */
export const OFFER_KINDS = Object.freeze(['gift', 'bargain', 'curse', 'sealed', 'global'])
const BAD_OK = new Set(['bargain', 'curse', 'sealed'])

const byteLength = (s) => {
	let n = 0
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i)
		n += c < 0x80 ? 1 : c < 0x800 ? 2 : c >= 0xd800 && c <= 0xdbff ? (i++, 4) : 3
	}
	return n
}

/**
 * @typedef {{code: string, path: string, msg: string}} Issue
 * @typedef {object} ValidateOptions
 * @prop {'gift'|'bargain'|'curse'|'sealed'|'global'} [offer]  what kind of offer this is (default gift)
 * @prop {'card'|'item'|'curse'|'token'} [kind]  expected kind
 * @prop {'common'|'uncommon'|'rare'} [rarity]  the GAME's rarity for this slot; overrides any proposed rarity
 * @prop {boolean} [authored]  world/ content: keepsake/special rarities allowed, names may repeat reserved ones
 * @prop {string[]} [existingNames]  names already in the book and the world pool
 * @prop {string[]} [blocklist]  extra blocked words (the Creative Director's list)
 * @prop {{defs: Record<string, any>}} [content]  the run's content (addCard references)
 * @prop {false|object} [sim]  false to skip, or balanceCheck options ({enemy, pages, seed, fights, decks})
 */

/**
 * Validate one content definition.
 * @param {unknown} raw  JSON text or object
 * @param {ValidateOptions} [opts]
 * @returns {{ok: boolean, def: object|null, score: object|null, errors: Issue[], warnings: Issue[], sim: object|null}}
 */
export function validateContent(raw, opts = {}) {
	const {offer = 'gift', kind, rarity, authored = false, existingNames = [], blocklist = [], content, sim = false} = opts
	const ctx = {} // fixed planning numbers (library SCALINGS), so a re-validation scores the same
	const out = {ok: false, def: null, score: null, errors: [], warnings: [], sim: null}
	const fail = (code, path, msg) => {
		out.errors.push({code, path, msg})
		return out
	}
	if (!OFFER_KINDS.includes(offer)) return fail('offer', '', `unknown offer kind ${offer}`)
	// 1. Size, before parsing anything.
	let text = raw
	if (typeof raw !== 'string') {
		try {
			text = JSON.stringify(raw)
		} catch {
			return fail('not_object', '', 'not serializable')
		}
	}
	if (typeof text !== 'string' || byteLength(text) > RAW_MAX_BYTES) return fail('size', '', `input over ${RAW_MAX_BYTES} bytes`)

	// 2. Shape.
	const refExists = (ref) => Boolean(content?.defs?.[ref])
	const norm = normalizeContent(text, {refExists})
	out.warnings.push(...norm.warnings)
	if (!norm.def) {
		out.errors.push(...norm.errors)
		return out
	}
	const def = norm.def
	if (kind && def.kind !== kind) return fail('kind', 'kind', `expected a ${kind}`)
	if ((def.rarity === 'keepsake' || def.rarity === 'special') && !authored) return fail('rarity', 'rarity', `${def.rarity} is authored content only`)
	if (rarity && (def.kind === 'card' || def.kind === 'item')) {
		if (def.rarity !== rarity) out.warnings.push({code: 'rarity', path: 'rarity', msg: `set to ${rarity} by the game`})
		def.rarity = rarity
	}

	// 3. Text: names and flavor (rules text is rendered from data, never taken from input).
	const name = cleanName(def.name, {existing: existingNames, blocklist})
	if (!name.ok) out.errors.push({code: 'text', path: 'name', msg: name.reason})
	else def.name = name.value
	const flavor = cleanFlavor(def.flavor, {blocklist})
	if (!flavor.ok) out.errors.push({code: 'text', path: 'flavor', msg: flavor.reason})
	else def.flavor = flavor.value

	// 4. Hard caps.
	out.errors.push(...checkCaps(def))

	// 5. Budget (the game computes PP; any claimed PP is ignored).
	const score = scoreContent(def, ctx)
	if (def.kind === 'card') {
		const up = upgradedCard(def)
		// GDD 8.2: an upgrade is "+3 PP, or energy -1". An energy-only upgrade is always in budget.
		const energyOnly = up && up.energy === def.energy - 1 && canonicalJson(up.effects) === canonicalJson(def.effects) && canonicalJson(up.triggers ?? []) === canonicalJson(def.triggers ?? [])
		if (up && !energyOnly) score.upgradePP = Math.round((scoreContent(up, ctx).pp + 6 * (def.energy - up.energy)) * 10) / 10
	}
	out.score = score
	if (!authored || def.rarity !== 'keepsake') out.errors.push(...checkBudget(def, score, {offer}))
	else if (score.pp > score.budget + 0.5) out.errors.push({code: 'budget', path: '', msg: `keepsake ${score.pp} PP is over ${score.budget}`})

	// 6. Fairness (GDD_V2 9.4): no unearned pure-bad change.
	const bad = def.kind === 'curse' || score.pp < 0 || (def.kind === 'item' && def.bound && score.neg < 0)
	if (bad && !BAD_OK.has(offer)) out.errors.push({code: 'unearned', path: '', msg: 'a bad change must be a bargain, a curse offer or a sealed offer'})
	if (offer === 'curse' && def.kind !== 'curse' && !(def.kind === 'item' && def.bound)) out.errors.push({code: 'kind', path: 'kind', msg: 'a curse offer must be a curse or a bound item'})
	if (def.kind === 'curse' && offer !== 'curse' && offer !== 'sealed' && offer !== 'bargain') out.errors.push({code: 'unearned', path: 'kind', msg: 'curses are never gifts'})

	// 7. Canonical size.
	const bytes = byteLength(canonicalJson(def))
	if (bytes > SIZE_LIMITS.defBytes) out.errors.push({code: 'size', path: '', msg: `definition is ${bytes} bytes (max ${SIZE_LIMITS.defBytes})`})

	if (out.errors.length) return out

	// 8. Balance sim (deterministic with its seed).
	if (sim) {
		const report = balanceCheck(def, {offer, content, ...(sim === true ? {} : sim)})
		out.sim = report
		if (!report.ok) for (const r of report.reasons) out.errors.push({code: 'sim', path: '', msg: r})
	}
	if (out.errors.length) return out
	def.v = MECH_SCHEMA_VERSION
	out.def = def
	out.ok = true
	return out
}
