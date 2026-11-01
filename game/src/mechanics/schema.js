// EVER mechanics: content schema (v1). Shapes raw, untrusted JSON into canonical content
// definitions built ONLY from library blocks, and builds the equivalent JSON Schema
// (draft 2020-12) for tools that are not JavaScript (the GitHub Action, world/ editors).
//
// normalizeContent(raw) never throws and never returns executable anything: unknown
// fields are dropped, numbers are rounded and clamped to the block's range (with a
// warning), unknown enum values / block ids are errors.
// PURE: no DOM. Imported by the browser and by server/.
//
// Copyright (C) 2026 the EVER contributors.
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
	ART_PROPS, ART_TINTS, CARD_RARITIES, CARD_TARGETS, CARD_TYPES, CONDITIONS, CONTENT_KINDS, HARD_CAPS,
	ITEM_SLOTS, RARITIES, SCALE_CAP, SCALINGS, THEMES, TRIGGERS, TRIGGER_ALIASES,
} from './library.js'
import {effectSpec, allEffectIds} from './blocks-registry.js'

/** Version of the content schema. Bump on any incompatible change; old books keep their own. */
export const MECH_SCHEMA_VERSION = 1

/** Prefix of a generated content id inside a book's deck (`{id: 'g:c-1k3x9a'}`). */
export const GEN_PREFIX = 'g:'
export const isGeneratedId = (id) => typeof id === 'string' && id.startsWith(GEN_PREFIX)
const ID_RE = /^g:[ciut]-[0-9a-z]{6}(?:-[0-9]{1,2})?$/
export const isValidGenId = (id) => typeof id === 'string' && ID_RE.test(id)

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x)

/**
 * @typedef {{code: string, path: string, msg: string}} Issue
 * @typedef {{do: string, [param: string]: any, if?: {is: string, [p: string]: any}, scale?: {per: string, each: number, cap: number}, when?: 'nextTurn'}} Effect
 * @typedef {{on: string, [param: string]: any, if?: {is: string}, effects: Effect[]}} Trigger
 * @typedef {object} ContentDef  canonical, see docs/MECHANICS.md section 2
 */

class Ctx {
	constructor() {
		/** @type {Issue[]} */ this.errors = []
		/** @type {Issue[]} */ this.warnings = []
	}
	err(code, path, msg) {
		this.errors.push({code, path, msg})
	}
	warn(code, path, msg) {
		this.warnings.push({code, path, msg})
	}
}

function readParam(spec, value, path, c, {allowRef} = {}) {
	if (spec.t === 'int') {
		if (value === undefined || value === null) return spec.def
		const num = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
		if (typeof num !== 'number' || !Number.isFinite(num)) {
			c.err('param', path, 'must be a number')
			return spec.def
		}
		const r = Math.round(num)
		const v = Math.max(spec.min, Math.min(spec.max, r))
		if (v !== num) c.warn('clamped', path, `${num} -> ${v} (range ${spec.min}..${spec.max})`)
		return v
	}
	if (spec.t === 'enum') {
		if (value === undefined || value === null) return spec.def
		if (!spec.of.includes(value)) {
			c.err('enum', path, `must be one of ${spec.of.join(', ')}`)
			return spec.def
		}
		return value
	}
	if (spec.t === 'bool') return value === undefined || value === null ? spec.def : value === true
	if (spec.t === 'ref') {
		if (typeof value !== 'string' || !value || value.length > 32) {
			c.err('param', path, 'must be a card reference')
			return ''
		}
		if (!allowRef(value)) c.err('ref', path, `unknown card "${value.slice(0, 32)}"`)
		return value
	}
	return undefined
}

function readParams(specs, src, path, c, opts) {
	const out = {}
	for (const [k, spec] of Object.entries(specs)) out[k] = readParam(spec, src?.[k], `${path}.${k}`, c, opts)
	return out
}

/** Accepts {is:'hpBelow', pct:50}, {hpBelow: 50}, {hpBelow: {pct: 50}}, {firstTimeThisFight: true}, or 'enemyIntendsAttack'. */
function readCondition(raw, path, c) {
	if (raw === undefined || raw === null) return undefined
	let id
	let params = {}
	if (typeof raw === 'string') id = raw
	else if (isObj(raw) && typeof raw.is === 'string') {
		id = raw.is
		params = raw
	} else if (isObj(raw)) {
		const keys = Object.keys(raw)
		if (keys.length !== 1) {
			c.err('condition', path, 'one condition per effect')
			return undefined
		}
		id = keys[0]
		const v = raw[id]
		const specKeys = Object.keys(CONDITIONS[id]?.params ?? {})
		if (isObj(v)) params = v
		else if (specKeys.length === 1) params = {[specKeys[0]]: v}
		else if (v !== true) {
			c.err('condition', path, `${id} must be true`)
			return undefined
		}
	} else {
		c.err('condition', path, 'bad condition')
		return undefined
	}
	const spec = CONDITIONS[id]
	if (!spec) {
		c.err('condition', path, `unknown condition "${String(id).slice(0, 32)}"`)
		return undefined
	}
	return {is: id, ...readParams(spec.params, params, path, c)}
}

function readScale(raw, path, c) {
	if (raw === undefined || raw === null) return undefined
	if (!isObj(raw) || !SCALINGS[raw.per]) {
		c.err('scale', path, `per must be one of ${Object.keys(SCALINGS).join(', ')}`)
		return undefined
	}
	const each = readParam({t: 'int', min: 1, max: 5, def: 1}, raw.each, `${path}.each`, c)
	const cap = readParam({t: 'int', min: 1, max: SCALE_CAP, def: 3}, raw.cap, `${path}.cap`, c)
	return {per: raw.per, each, cap}
}

/**
 * One effect. `where` = 'card' | 'trigger' | 'token' | 'fightWon'.
 * @returns {Effect|undefined}
 */
function readEffect(raw, path, c, where, refs) {
	if (!isObj(raw) || typeof raw.do !== 'string') {
		c.err('effect', path, 'each effect needs "do"')
		return undefined
	}
	const spec = effectSpec(raw.do)
	if (!spec) {
		c.err('effect', `${path}.do`, `unknown block "${raw.do.slice(0, 32)}"`)
		return undefined
	}
	if (where === 'fightWon' && !spec.outOfCombat) {
		c.err('effect', `${path}.do`, 'after a fight only out-of-combat blocks (healNow) are allowed')
		return undefined
	}
	if (where !== 'fightWon' && spec.outOfCombat) {
		c.err('effect', `${path}.do`, `${raw.do} only works in a fightWon trigger`)
		return undefined
	}
	const eff = {do: raw.do, ...readParams(spec.params, raw, path, c, {allowRef: refs})}
	const cond = readCondition(raw.if, `${path}.if`, c)
	if (cond) eff.if = cond
	if (raw.scale !== undefined) {
		if (!spec.scalable) c.err('scale', `${path}.scale`, `${raw.do} cannot scale`)
		else {
			const s = readScale(raw.scale, `${path}.scale`, c)
			if (s) eff.scale = s
		}
	}
	if (raw.when !== undefined && raw.when !== 'now') {
		if (raw.when !== 'nextTurn') c.err('field', `${path}.when`, 'must be "now" or "nextTurn"')
		else if (where === 'fightWon') c.err('field', `${path}.when`, 'not after a fight')
		else eff.when = 'nextTurn'
	}
	return eff
}

function readEffects(raw, path, c, where, refs, {min = 0} = {}) {
	if (raw === undefined || raw === null) raw = []
	if (!Array.isArray(raw)) {
		c.err('field', path, 'must be a list')
		return []
	}
	const max = where === 'card' || where === 'token' ? HARD_CAPS.effectsPerList : HARD_CAPS.effectsPerTrigger
	if (raw.length > max) c.err('too_many', path, `at most ${max} effects`)
	if (raw.length < min) c.err('too_few', path, `at least ${min} effect`)
	return raw
		.slice(0, max)
		.map((e, i) => readEffect(e, `${path}[${i}]`, c, where, refs))
		.filter(Boolean)
}

function readTrigger(raw, path, c, refs) {
	if (!isObj(raw)) {
		c.err('trigger', path, 'bad trigger')
		return undefined
	}
	const on = TRIGGER_ALIASES[raw.on] ?? raw.on
	const spec = TRIGGERS[on]
	if (!spec) {
		c.err('trigger', `${path}.on`, `unknown trigger "${String(raw.on).slice(0, 32)}"`)
		return undefined
	}
	const t = {on, ...readParams(spec.params, raw, path, c)}
	const cond = readCondition(raw.if, `${path}.if`, c)
	if (cond) t.if = cond
	t.effects = readEffects(raw.effects, `${path}.effects`, c, on === 'fightWon' ? 'fightWon' : 'trigger', refs, {min: 1})
	return t
}

function readTriggers(raw, path, c, refs) {
	if (raw === undefined || raw === null) return []
	if (!Array.isArray(raw)) {
		c.err('field', path, 'must be a list')
		return []
	}
	if (raw.length > HARD_CAPS.triggersPerThing) c.err('too_many', path, `at most ${HARD_CAPS.triggersPerThing} triggers`)
	return raw
		.slice(0, HARD_CAPS.triggersPerThing)
		.map((t, i) => readTrigger(t, `${path}[${i}]`, c, refs))
		.filter(Boolean)
}

function readArt(raw, kind) {
	const fallback = {card: 'sword', item: 'ring', curse: 'doubt', token: 'token'}[kind]
	const tintDef = kind === 'curse' ? 'doubt' : 'paper'
	const a = isObj(raw) ? raw : {}
	const art = {prop: ART_PROPS.includes(a.prop) ? a.prop : fallback, tint: ART_TINTS.includes(a.tint) ? a.tint : tintDef}
	if (ART_TINTS.includes(a.accent)) art.accent = a.accent
	if (kind === 'curse') art.tint = 'doubt' // GDD 12: curses are always doubt violet
	return art
}

/** Strings are kept raw here (bounded); text.js sanitizes them in validate. */
const rawText = (s, max) => (typeof s === 'string' ? s.slice(0, max * 4) : '')

/**
 * Shape raw (possibly hostile) JSON into a canonical ContentDef.
 * Accepts the flat form or the GDD 10.5 nested form ({kind:'card', name, card: {...}, art}).
 * @param {unknown} raw
 * @param {{refExists?: (ref: string) => boolean}} [opts]  which addCard references exist
 * @returns {{def: ContentDef|null, errors: Issue[], warnings: Issue[]}}
 */
export function normalizeContent(raw, {refExists} = {}) {
	const c = new Ctx()
	if (typeof raw === 'string') {
		try {
			raw = JSON.parse(raw)
		} catch {
			c.err('not_object', '', 'not JSON')
			return {def: null, errors: c.errors, warnings: c.warnings}
		}
	}
	if (!isObj(raw)) {
		c.err('not_object', '', 'content must be one JSON object')
		return {def: null, errors: c.errors, warnings: c.warnings}
	}
	if (raw.v !== undefined && raw.v !== MECH_SCHEMA_VERSION) {
		c.err('version', 'v', `schema v${MECH_SCHEMA_VERSION} only`)
		return {def: null, errors: c.errors, warnings: c.warnings}
	}
	const kind = raw.kind
	if (!CONTENT_KINDS.includes(kind)) {
		c.err('kind', 'kind', `must be one of ${CONTENT_KINDS.join(', ')}`)
		return {def: null, errors: c.errors, warnings: c.warnings}
	}
	// GDD 10.5 nests the mechanics under the kind's name; merge it over the top level.
	const src = isObj(raw[kind]) ? {...raw, ...raw[kind]} : raw
	const refs = (r) => Boolean(refExists?.(r)) || r in ({Strike: 1, Defend: 1, Doubt: 1})
	const def = {v: MECH_SCHEMA_VERSION, kind, name: rawText(src.name, 24), flavor: rawText(src.flavor, 90)}
	if (THEMES.includes(src.theme)) def.theme = src.theme

	if (kind === 'card') {
		def.type = readParam({t: 'enum', of: CARD_TYPES, def: 'attack'}, src.type, 'type', c)
		def.rarity = readParam({t: 'enum', of: CARD_RARITIES, def: 'common'}, src.rarity, 'rarity', c)
		def.energy = readParam({t: 'int', min: 0, max: 3, def: 1}, src.energy ?? src.cost, 'energy', c)
		const tgt = src.target === 'player' ? 'self' : src.target
		def.target = readParam({t: 'enum', of: CARD_TARGETS, def: def.type === 'attack' ? 'enemy' : 'self'}, tgt, 'target', c)
		def.exhaust = src.exhaust === true
		def.retain = src.retain === true
		def.effects = readEffects(src.effects, 'effects', c, 'card', refs, {min: def.type === 'power' ? 0 : 1})
		def.triggers = def.type === 'power' ? readTriggers(src.triggers, 'triggers', c, refs) : []
		if (def.type !== 'power' && Array.isArray(src.triggers) && src.triggers.length) c.err('field', 'triggers', 'only power cards have triggers')
		if (def.type === 'power' && !def.triggers.length && !def.effects.length) c.err('too_few', 'triggers', 'a power needs a trigger')
		if (isObj(src.upgrade)) {
			const up = {}
			if (src.upgrade.energy !== undefined) up.energy = readParam({t: 'int', min: 0, max: 3, def: def.energy}, src.upgrade.energy, 'upgrade.energy', c)
			if (src.upgrade.effects !== undefined) up.effects = readEffects(src.upgrade.effects, 'upgrade.effects', c, 'card', refs, {min: 1})
			if (src.upgrade.triggers !== undefined && def.type === 'power') up.triggers = readTriggers(src.upgrade.triggers, 'upgrade.triggers', c, refs)
			if (Object.keys(up).length) def.upgrade = up
		}
		if (!def.triggers.length) delete def.triggers
		if (def.type === 'attack') {
			leadDamageFirst(def)
			if (def.upgrade?.effects) leadDamageFirst(def.upgrade)
		}
	} else if (kind === 'item') {
		def.rarity = readParam({t: 'enum', of: RARITIES, def: 'common'}, src.rarity, 'rarity', c)
		def.slot = readParam({t: 'enum', of: ITEM_SLOTS, def: 'charm'}, src.slot, 'slot', c)
		def.bound = src.bound === true
		// GDD 10.5 shorthand: one trigger inline ({on, effects}).
		const trigs = Array.isArray(src.triggers) ? src.triggers : typeof src.on === 'string' ? [{on: src.on, effects: src.effects, if: src.if, type: src.type, n: src.n}] : []
		def.triggers = readTriggers(trigs, 'triggers', c, refs)
		if (isObj(src.stats) && src.stats.maxHp !== undefined) {
			const m = readParam({t: 'int', min: -HARD_CAPS.maxHpDelta, max: HARD_CAPS.maxHpDelta, def: 0}, src.stats.maxHp, 'stats.maxHp', c)
			if (m) def.stats = {maxHp: m}
		}
		if (!def.triggers.length && !def.stats) c.err('too_few', 'triggers', 'an item needs a trigger or a stat')
	} else if (kind === 'curse') {
		def.energy = src.energy === null || src.energy === undefined || src.unplayable === true ? null : readParam({t: 'int', min: 0, max: 3, def: 1}, src.energy, 'energy', c)
		def.exhaust = src.exhaust === true
		def.effects = def.energy === null ? [] : readEffects(src.effects, 'effects', c, 'card', refs)
		def.triggers = readTriggers(src.triggers, 'triggers', c, refs)
		if (def.energy === null && !def.triggers.length) c.err('too_few', 'triggers', 'an unplayable curse needs a trigger')
	} else if (kind === 'token') {
		def.effects = readEffects(src.effects, 'effects', c, 'token', refs, {min: 1})
	}
	def.art = readArt(src.art, kind)
	return {def: c.errors.length ? null : def, errors: c.errors, warnings: c.warnings}
}

/**
 * An attack resolves its first plain hit through the engine's own card damage (so the
 * engine applies Strength/Weak/Vulnerable exactly as for upstream cards). Canonical
 * order therefore puts that hit first. "Plain" = single target, no condition, no scale,
 * not delayed.
 */
export function leadDamageIndex(effects) {
	return effects.findIndex((e) => e.do === 'damage' && e.target === 'enemy' && !e.if && !e.scale && !e.when)
}
function leadDamageFirst(def) {
	const list = def.effects
	if (!list) return
	const i = leadDamageIndex(list)
	if (i > 0) list.unshift(list.splice(i, 1)[0])
}

// -------------------------------------------------------------------------------------
// JSON Schema (draft 2020-12), built from the same library. Structural only: budgets,
// caps, text rules and the sim are enforced by validate.js.
// -------------------------------------------------------------------------------------

function paramSchema(spec) {
	if (spec.t === 'int') return {type: 'integer', minimum: spec.min, maximum: spec.max}
	if (spec.t === 'enum') return {enum: [...spec.of]}
	if (spec.t === 'bool') return {type: 'boolean'}
	return {type: 'string', maxLength: 32}
}

/** @returns {object} JSON Schema for one ContentDef */
export function buildJsonSchema() {
	const conditionSchemas = Object.entries(CONDITIONS).map(([id, spec]) => ({
		type: 'object',
		required: ['is'],
		additionalProperties: false,
		properties: {is: {const: id}, ...Object.fromEntries(Object.entries(spec.params).map(([k, s]) => [k, paramSchema(s)]))},
	}))
	const effectSchemas = allEffectIds().map((id) => {
		const spec = effectSpec(id)
		return {
			type: 'object',
			required: ['do'],
			additionalProperties: false,
			properties: {
				do: {const: id},
				...Object.fromEntries(Object.entries(spec.params).map(([k, s]) => [k, paramSchema(s)])),
				if: {$ref: '#/$defs/condition'},
				...(spec.scalable ? {scale: {$ref: '#/$defs/scale'}} : {}),
				when: {enum: ['now', 'nextTurn']},
			},
		}
	})
	const triggerSchemas = Object.entries(TRIGGERS).map(([id, spec]) => ({
		type: 'object',
		required: ['on', 'effects'],
		additionalProperties: false,
		properties: {
			on: {const: id},
			...Object.fromEntries(Object.entries(spec.params).map(([k, s]) => [k, paramSchema(s)])),
			if: {$ref: '#/$defs/condition'},
			effects: {type: 'array', minItems: 1, maxItems: HARD_CAPS.effectsPerTrigger, items: {$ref: '#/$defs/effect'}},
		},
	}))
	const common = {
		v: {const: MECH_SCHEMA_VERSION},
		name: {type: 'string', minLength: 2, maxLength: 24},
		flavor: {type: 'string', maxLength: 90},
		theme: {enum: [...THEMES]},
		art: {
			type: 'object',
			additionalProperties: false,
			required: ['prop', 'tint'],
			properties: {prop: {enum: [...ART_PROPS]}, tint: {enum: [...ART_TINTS]}, accent: {enum: [...ART_TINTS]}},
		},
	}
	const effects = (min) => ({type: 'array', minItems: min, maxItems: HARD_CAPS.effectsPerList, items: {$ref: '#/$defs/effect'}})
	const triggers = {type: 'array', maxItems: HARD_CAPS.triggersPerThing, items: {$ref: '#/$defs/trigger'}}
	return {
		$schema: 'https://json-schema.org/draft/2020-12/schema',
		$id: `https://game.dreamz.rest/schema/mechanics-content.v${MECH_SCHEMA_VERSION}.json`,
		title: `EVER generated content v${MECH_SCHEMA_VERSION}`,
		oneOf: [{$ref: '#/$defs/card'}, {$ref: '#/$defs/item'}, {$ref: '#/$defs/curse'}, {$ref: '#/$defs/token'}],
		$defs: {
			condition: {oneOf: conditionSchemas},
			scale: {
				type: 'object',
				additionalProperties: false,
				required: ['per'],
				properties: {per: {enum: Object.keys(SCALINGS)}, each: {type: 'integer', minimum: 1, maximum: 5}, cap: {type: 'integer', minimum: 1, maximum: SCALE_CAP}},
			},
			effect: {oneOf: effectSchemas},
			trigger: {oneOf: triggerSchemas},
			card: {
				type: 'object',
				additionalProperties: false,
				required: ['kind', 'name', 'type', 'energy', 'effects'],
				properties: {
					...common,
					kind: {const: 'card'},
					type: {enum: [...CARD_TYPES]},
					rarity: {enum: [...CARD_RARITIES]},
					energy: {type: 'integer', minimum: 0, maximum: 3},
					target: {enum: [...CARD_TARGETS]},
					exhaust: {type: 'boolean'},
					retain: {type: 'boolean'},
					effects: effects(0),
					triggers,
					upgrade: {
						type: 'object',
						additionalProperties: false,
						properties: {energy: {type: 'integer', minimum: 0, maximum: 3}, effects: effects(1), triggers},
					},
				},
			},
			item: {
				type: 'object',
				additionalProperties: false,
				required: ['kind', 'name', 'slot'],
				properties: {
					...common,
					kind: {const: 'item'},
					rarity: {enum: [...RARITIES]},
					slot: {enum: [...ITEM_SLOTS]},
					bound: {type: 'boolean'},
					triggers,
					stats: {type: 'object', additionalProperties: false, properties: {maxHp: {type: 'integer', minimum: -HARD_CAPS.maxHpDelta, maximum: HARD_CAPS.maxHpDelta}}},
				},
			},
			curse: {
				type: 'object',
				additionalProperties: false,
				required: ['kind', 'name'],
				properties: {...common, kind: {const: 'curse'}, energy: {type: ['integer', 'null'], minimum: 0, maximum: 3}, exhaust: {type: 'boolean'}, effects: effects(0), triggers},
			},
			token: {
				type: 'object',
				additionalProperties: false,
				required: ['kind', 'name', 'effects'],
				properties: {...common, kind: {const: 'token'}, effects: effects(1)},
			},
		},
	}
}
