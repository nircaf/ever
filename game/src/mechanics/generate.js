// EVER mechanics: a small seeded procedural generator built on the same blocks. It is the
// floor of the offline path (GDD_V2 10.6) and the fuzz source for the tests: same seed +
// label => same definition. The Systems engineer's themed generator (templates, lexicons,
// requests) can replace the templates here; the output contract is the same:
// a VALIDATED canonical def.
// PURE.
//
// Copyright (C) 2026 the EVER contributors.
// SPDX-License-Identifier: AGPL-3.0-or-later

import {CARD_BUDGET, ITEM_BUDGET} from './library.js'
import {pick, pickWeighted, rng} from './prng.js'
import {validateContent} from './validate.js'

/** Small per-theme lexicon (the Creative Director's 20 x 20 lists replace it in world/). */
export const LEXICON = Object.freeze({
	forge: {adj: ['Banked', 'Quenched', 'Ringing', 'Tempered', 'Hot'], noun: ['Edge', 'Coal', 'Anvil', 'Tongs', 'Rivet'], art: {prop: 'hammer', tint: 'ember'}},
	well: {adj: ['Cold', 'Deep', 'Still', 'Drawn', 'Quiet'], noun: ['Bucket', 'Rope', 'Water', 'Stone', 'Echo'], art: {prop: 'drop', tint: 'ward'}},
	briar: {adj: ['Creeping', 'Green', 'Patient', 'Thorned', 'Wild'], noun: ['Sprig', 'Knot', 'Bramble', 'Root', 'Leaf'], art: {prop: 'thorn', tint: 'moss'}},
	ash: {adj: ['Grey', 'Burnt', 'Mourning', 'Last', 'Hollow'], noun: ['Dust', 'Cinder', 'Vigil', 'Pyre', 'Ember'], art: {prop: 'cloud', tint: 'ash'}},
	lantern: {adj: ['Bright', 'Guiding', 'Warm', 'Lit', 'Golden'], noun: ['Wick', 'Glow', 'Window', 'Spark', 'Beacon'], art: {prop: 'lantern', tint: 'gold'}},
	crow: {adj: ['Black', 'Watching', 'Ill', 'Sharp', 'Ink'], noun: ['Feather', 'Omen', 'Beak', 'Ledger', 'Wing'], art: {prop: 'feather', tint: 'ink'}},
	oath: {adj: ['Sworn', 'Kept', 'Honest', 'Bound', 'True'], noun: ['Vow', 'Bell', 'Word', 'Promise', 'Seal'], art: {prop: 'bell', tint: 'slate'}},
	bargain: {adj: ['Crooked', 'Fair', 'Pawned', 'Lucky', 'Sealed'], noun: ['Coin', 'Ring', 'Deal', 'Debt', 'Price'], art: {prop: 'coin', tint: 'gold'}},
})
const THEME_IDS = Object.keys(LEXICON)

// Card templates: [type, target, effect skeletons]; numbers are budget shares.
const CARD_TEMPLATES = [
	['attack', 'enemy', [{do: 'damage', share: 1}]],
	['attack', 'enemy', [{do: 'damage', share: 0.6}, {do: 'block', share: 0.4}]],
	['attack', 'enemy', [{do: 'damage', share: 0.6}, {do: 'power', kind: 'weak', share: 0.4}]],
	['attack', 'enemy', [{do: 'damage', share: 0.6}, {do: 'power', kind: 'vulnerable', share: 0.4}]],
	['attack', 'enemy', [{do: 'damage', share: 0.65}, {do: 'draw', n: 1}]],
	['attack', 'enemy', [{do: 'damage', share: 0.7}, {do: 'power', kind: 'poison', share: 0.3}]],
	['skill', 'self', [{do: 'block', share: 1}]],
	['skill', 'self', [{do: 'block', share: 0.65}, {do: 'draw', n: 1}]],
	['skill', 'self', [{do: 'block', share: 0.6}, {do: 'power', kind: 'strength', target: 'self', share: 0.4}]],
	['skill', 'enemy', [{do: 'power', kind: 'weak', share: 0.5}, {do: 'power', kind: 'vulnerable', share: 0.5}]],
	['skill', 'self', [{do: 'block', share: 0.7}, {do: 'heal', share: 0.3}]],
]
const ITEM_TEMPLATES = [
	['body', [{on: 'fightStart', effects: [{do: 'block', share: 1}]}]],
	['charm', [{on: 'fightStart', effects: [{do: 'draw', n: 2}]}]],
	['charm', [{on: 'fightStart', effects: [{do: 'power', kind: 'vulnerable', share: 1}]}]],
	['hand', [{on: 'firstCardEachTurn', effects: [{do: 'block', share: 1}]}]],
	['hand', [{on: 'onPlay', type: 'attack', effects: [{do: 'power', kind: 'poison', n: 1}]}]],
	['body', [{on: 'onHpLoss', effects: [{do: 'block', share: 1}]}]],
]
const CURSE_TEMPLATES = [
	{energy: null, triggers: [{on: 'turnEnd', effects: [{do: 'loseHp', n: 1}]}]},
	{energy: null, triggers: [{on: 'onDraw', effects: [{do: 'discard', n: 1}]}]},
	{energy: null, triggers: [{on: 'onDraw', effects: [{do: 'loseEnergy', n: 1}]}]},
	{energy: null, triggers: [{on: 'fightStart', effects: [{do: 'power', kind: 'vulnerable', n: 1, target: 'self'}]}, {on: 'turnEnd', effects: [{do: 'loseHp', n: 1}]}]},
	{energy: 1, exhaust: true, effects: [], triggers: [{on: 'turnEnd', effects: [{do: 'loseHp', n: 1}]}]},
]
const TOKEN_TEMPLATES = [
	[{do: 'block', share: 1}],
	[{do: 'energy', n: 1}, {do: 'block', share: 1}],
	[{do: 'power', kind: 'strength', target: 'self', fight: true, n: 1}, {do: 'block', share: 1}],
	[{do: 'draw', n: 2}, {do: 'block', share: 1}],
]

/** PP per point for each shareable block (keep in step with library.js). */
const UNIT = {damage: 1, block: 1, heal: 1.5, power: {weak: 3, vulnerable: 3, strength: 3, poison: 2.4, regen: 2}}
const unitOf = (e) => (e.do === 'power' ? UNIT.power[e.kind] : UNIT[e.do]) ?? 1
const MAX = {damage: 30, block: 25, heal: 15, power: 3}

function solve(skeletons, budget) {
	const fixed = skeletons.filter((e) => e.share === undefined)
	const fixedPP = fixed.reduce((a, e) => a + (e.do === 'draw' ? 3 * e.n : e.do === 'energy' ? 5 * e.n : 0), 0)
	const left = Math.max(1, budget - fixedPP)
	return skeletons.map(({share, ...e}) => {
		if (share === undefined) return {...e}
		const n = Math.max(1, Math.min(MAX[e.do] ?? 3, Math.floor((left * share) / unitOf(e))))
		return {...e, n}
	})
}

function nameFor(rand, theme, taken) {
	const lx = LEXICON[theme]
	for (let i = 0; i < 12; i++) {
		const n = `${pick(rand, lx.adj)} ${pick(rand, lx.noun)}`
		if (!taken.has(n.toLowerCase())) return n
	}
	return `${pick(rand, lx.adj)} ${pick(rand, lx.noun)} ${pick(rand, ['Two', 'Again', 'Anew'])}`
}

/**
 * Generate one validated def from a seed stream.
 * @param {string|number} seed  the book seed
 * @param {string} label  stream label, e.g. "offer:3:1"
 * @param {{kind?: 'card'|'item'|'curse'|'token', rarity?: 'common'|'uncommon'|'rare', theme?: string, offer?: string, existingNames?: string[], sim?: false|true|object}} [o]
 *   sim: also require the balance check (validateContent's `sim` option) for each attempt;
 *   the plain fallback is returned even if it fails the sim (it is always within budget).
 * @returns {object} canonical def (always valid; falls back to a plain template)
 */
export function generateContent(seed, label, {kind = 'card', rarity = 'common', theme, offer, existingNames = [], sim = false} = {}) {
	const rand = rng(seed, `gen:${label}`)
	const th = THEME_IDS.includes(theme) ? theme : pick(rand, THEME_IDS)
	const taken = new Set(existingNames.map((n) => String(n).toLowerCase()))
	const off = offer ?? (kind === 'curse' ? 'curse' : 'gift')
	for (let attempt = 0; attempt < 10; attempt++) {
		let raw
		if (kind === 'card') {
			const [type, target, sk] = pick(rand, CARD_TEMPLATES)
			const energy = pickWeighted(rand, [[1, 6], [0, 1], [2, 2]])
			const budget = CARD_BUDGET[rarity](energy) - Math.floor(rand() * 2)
			const effects = solve(sk, budget)
			const draws = effects.some((e) => e.do === 'draw')
			raw = {kind, type, target, energy, rarity, effects, exhaust: draws && effects.some((e) => e.do === 'energy')}
		} else if (kind === 'item') {
			const [slot, trig] = pick(rand, ITEM_TEMPLATES)
			const budget = ITEM_BUDGET[rarity]
			raw = {kind, slot, rarity, triggers: trig.map((t) => ({...t, effects: solve(t.effects, budget / ({fightStart: 1, firstCardEachTurn: 5.4, onHpLoss: 4})[t.on] || 1)}))}
		} else if (kind === 'curse') {
			raw = {kind, ...pick(rand, CURSE_TEMPLATES)}
		} else {
			raw = {kind: 'token', effects: solve(pick(rand, TOKEN_TEMPLATES), 7 + Math.floor(rand() * 3))}
		}
		raw.name = nameFor(rand, th, taken)
		raw.theme = th
		raw.art = kind === 'curse' ? {prop: 'doubt', tint: 'doubt'} : LEXICON[th].art
		const v = validateContent(raw, {offer: off, rarity: kind === 'card' || kind === 'item' ? rarity : undefined, existingNames, sim})
		if (v.ok) return v.def
	}
	// Fallbacks that always pass.
	const fb = {
		card: {kind: 'card', type: 'attack', energy: 1, effects: [{do: 'damage', n: 6}]},
		item: {kind: 'item', slot: 'body', triggers: [{on: 'fightStart', effects: [{do: 'block', n: 6}]}]},
		curse: CURSE_TEMPLATES[0],
		token: {kind: 'token', effects: [{do: 'block', n: 8}]},
	}[kind]
	const v = validateContent({...fb, kind, name: nameFor(rand, th, taken), rarity, theme: th}, {offer: off, rarity: kind === 'card' || kind === 'item' ? rarity : undefined})
	return v.def
}
