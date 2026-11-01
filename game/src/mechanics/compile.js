// EVER mechanics: compiler from canonical content defs to Slay the Web engine data.
//   card  -> an engine card object (plain JSON). The first plain hit of an attack becomes
//            the engine's own `damage` field; everything else runs through ONE registered
//            engine action, `everOps` (installed by engine.js), which calls runtime.js.
//   curse -> an engine card of type 'curse' (unplayable via the MVP 'unplayable' condition)
//            carrying its triggers (`everTriggers`).
//   item  -> {id, name, triggers} for the fighter's mechanics state.
//   token -> {id, name, effects} resolved once at fight start.
// Never produces code: the output is data the interpreter reads.
// PURE (reads the vendored engine's card table for engine card names).
//
// Copyright (C) 2026 the EVER contributors.
// SPDX-License-Identifier: AGPL-3.0-or-later

import {createCard} from '../../../vendor/slaytheweb/src/game/cards.js'
import doubt from '../combat/rules/content/doubt.js'
import {ENGINE_CARD_REFS} from './library.js'
import {MECH_SCHEMA_VERSION, isGeneratedId, leadDamageIndex, normalizeContent} from './schema.js'
import {rulesText} from './text.js'
import {scoreContent} from './budget.js'
import {upgradedCard} from './upgrade.js'

/** Name of the engine action every generated card runs. */
export const EVER_OPS = 'everOps'

const plain = (x) => JSON.parse(JSON.stringify(x))

/** Look a generated def up in a run's content ({defs: {id: def}}), or accept an inline def. */
export function lookupDef(content, id) {
	if (!isGeneratedId(id)) return null
	return content?.defs?.[id] ?? null
}

/** Card name for rules text ("Add a Doubt", "Add a Banked Hammer"). */
export const refNameFor = (content) => (ref) => lookupDef(content, ref)?.name ?? ref

/**
 * Engine card object for a canonical card or curse def (no instance id yet).
 * @param {object} def
 * @param {{upgraded?: boolean, genId?: string, content?: object}} [opts]
 */
export function compileCard(def, {upgraded = false, genId, content} = {}) {
	const ctx = {refName: refNameFor(content)}
	if (def.kind === 'curse') {
		const card = {
			name: def.name,
			type: 'curse',
			energy: def.energy ?? 0,
			target: 'player',
			damage: 0,
			block: 0,
			description: rulesText(def, ctx),
			upgraded: false,
			exhaust: Boolean(def.exhaust),
			everCurse: true,
			everArt: def.art,
		}
		if (def.energy === null) card.conditions = [{type: 'unplayable'}]
		if (def.effects?.length) card.actions = [{type: EVER_OPS, parameter: {ops: plain(def.effects)}}]
		if (def.triggers?.length) card.everTriggers = plain(def.triggers)
		if (genId) card.everGen = genId
		return card
	}
	if (def.kind !== 'card') throw new TypeError(`compileCard: not a card (${def.kind})`)
	const d = upgraded ? upgradedCard(def) : def
	const ops = plain(d.effects)
	let damage = 0
	if (d.type === 'attack') {
		const i = leadDamageIndex(ops)
		if (i >= 0) {
			const lead = ops[i]
			damage = lead.n
			if (lead.hits > 1) ops[i] = {...lead, hits: lead.hits - 1}
			else ops.splice(i, 1)
		}
	}
	const card = {
		name: upgraded ? `${d.name}+` : d.name,
		type: d.type,
		energy: d.energy,
		target: d.target === 'self' ? 'player' : d.target,
		damage,
		block: 0,
		description: rulesText(d, ctx),
		upgraded,
		exhaust: Boolean(d.exhaust),
		everArt: d.art,
	}
	if (ops.length) card.actions = [{type: EVER_OPS, parameter: {ops}}]
	if (d.retain) card.everRetain = true
	if (d.type === 'power' && d.triggers?.length) card.everPower = plain(d.triggers)
	if (genId) card.everGen = genId
	if (d.rarity) card.everRarity = d.rarity
	card.everPP = Math.max(0, scoreContent(d).pp) // a hint for the simulator's bot only
	return card
}

/** Engine card template for a reference: an engine card name, or a generated id in `content`. */
export function cardTemplate(ref, {content, upgraded = false} = {}) {
	const def = lookupDef(content, ref)
	if (def) return def.kind === 'card' || def.kind === 'curse' ? compileCard(def, {upgraded, genId: ref, content}) : null
	if (ref === doubt.name) return plain(doubt) // registered into the engine by combat/rules; data file is pure
	try {
		const c = plain(createCard(ref, upgraded))
		delete c.image
		delete c.id
		return c
	} catch {
		return null
	}
}

/**
 * Engine card for a book deck entry. Handles generated ids (`g:...`) and inline defs
 * (`{uid, id, upgraded, def}`); returns null for an engine name (the caller uses the
 * engine's createCard as before).
 */
export function compileDeckCard(deckCard, content) {
	let def = deckCard?.def ?? lookupDef(content, deckCard?.id)
	if (!def) return null
	if (def.v !== MECH_SCHEMA_VERSION) {
		const n = normalizeContent(def)
		if (!n.def) throw new RangeError(`invalid inline card: ${n.errors[0]?.msg}`)
		def = n.def
	}
	const card = compileCard(def, {upgraded: Boolean(deckCard.upgraded), genId: isGeneratedId(deckCard.id) ? deckCard.id : undefined, content})
	if (deckCard.uid) card.id = deckCard.uid
	return card
}

export const compileItem = (def, id) => ({id, name: def.name, triggers: plain(def.triggers ?? [])})
export const compileToken = (def, id) => ({id, name: def.name, effects: plain(def.effects ?? [])})

/** Every addCard reference inside a def (so the fight can pre-build its templates). */
export function refsOf(def) {
	const out = new Set()
	const scan = (effects) => {
		for (const e of effects ?? []) if (e.do === 'addCard' && e.card) out.add(e.card)
	}
	scan(def?.effects)
	scan(def?.upgrade?.effects)
	for (const t of def?.triggers ?? []) scan(t.effects)
	for (const t of def?.upgrade?.triggers ?? []) scan(t.effects)
	return [...out]
}

/** Template library for a set of refs, closed over refs-of-refs (depth-limited). */
export function buildLib(refs, content) {
	const lib = {}
	const queue = [...refs]
	for (let guard = 0; queue.length && guard < 32; guard++) {
		const ref = queue.shift()
		if (lib[ref] || !(ref in ENGINE_CARD_REFS || isGeneratedId(ref))) continue
		const tpl = cardTemplate(ref, {content})
		if (!tpl) continue
		lib[ref] = tpl
		const def = lookupDef(content, ref)
		if (def) queue.push(...refsOf(def))
	}
	return lib
}
