// EVER content-gen: preset world changes for the Last Page when the AI is off
// (GDD_V2 14.5): 3 per theme, 24 in all, in the platform's preset shape
// (game/src/platform/world-schema.js: {id, themes, proposal: {kind, data}}), so each one is
// a drop-in file for world/presets/ (presetEntries() writes the full entries).
// A preset already used (its id in `used`) is skipped; when a theme runs out, other themes'
// presets fill in. art.test.js validates every one with validateWorldEntry.
// PURE, data.
//
// Copyright (C) 2026 the EVER contributors.
// SPDX-License-Identifier: AGPL-3.0-or-later

import {rng, shuffle} from '../mechanics/index.js'

const card = (name, type, rarity, effects, flavor, art, extra = {}) => ({kind: 'card', name, type, rarity, energy: 1, target: type === 'attack' ? 'enemy' : 'self', effects, flavor, art, ...extra})
const item = (name, slot, rarity, triggers, flavor, art) => ({kind: 'item', name, slot, rarity, triggers, flavor, art})
const dmg = (n) => ({do: 'damage', n})
const blk = (n) => ({do: 'block', n})
const P = (id, themes, kind, data) => ({id, themes, proposal: {kind, data}})

/** @type {readonly {id: string, themes: string[], proposal: {kind: string, data: object}}[]} */
export const WORLD_PRESETS = Object.freeze([
	// Forge
	P('forge-quenched-edge', ['forge'], 'card', {def: card('Quenched Edge', 'attack', 'uncommon', [dmg(6), blk(3)], 'Quenched in the trough behind the forge.', {prop: 'sword', tint: 'iron', accent: 'ember'})}),
	P('forge-hammer-line', ['forge'], 'line', {npc: 'marcus', when: {theme: 'forge', trust: 'trusting'}, text: "A reader brought Tobin's hammer back once. It hangs over the door now."}),
	P('forge-door-lantern', ['forge', 'lantern'], 'place', {anchor: 'forgeDoor', prop: 'lantern'}),
	// Well
	P('well-bucket', ['well'], 'item', {def: item('Well Bucket', 'body', 'common', [{on: 'fightStart', effects: [blk(7)]}], 'The rope is older than the village.', {prop: 'bucket', tint: 'wood', accent: 'ward'})}),
	P('well-keeper-names', ['well'], 'line', {npc: 'keeper', when: {theme: 'well'}, text: 'Look into the water and say a name. It keeps them all.'}),
	P('well-side-flowers', ['well', 'briar'], 'place', {anchor: 'well', prop: 'wildflowers'}),
	// Briar
	P('briar-hawthorn-knot', ['briar'], 'card', {def: card('Hawthorn Knot', 'skill', 'uncommon', [{do: 'power', kind: 'poison', n: 4}], 'Patience is a thorn that grows inward.', {prop: 'thorn', tint: 'moss', accent: 'pine'}, {target: 'enemy'})}),
	P('briar-leaning-wood', ['briar'], 'path', {theme: 'briar', titles: ['The Wood Leans In', 'Roots Under the Road']}),
	P('briar-wood-edge', ['briar', 'ash'], 'place', {anchor: 'westWoodEdge', prop: 'briar'}),
	// Ash
	P('ash-grey-vigil', ['ash'], 'card', {def: card('Grey Vigil', 'attack', 'common', [dmg(4), {do: 'power', kind: 'weak', n: 1}], 'Light a candle for the ones at the gate.', {prop: 'cloud', tint: 'ash', accent: 'haze'})}),
	P('ash-marcus-coal', ['ash', 'forge'], 'line', {npc: 'marcus', when: {theme: 'ash', trust: 'warm'}, text: 'Grief is a coal. Bank it, and it keeps you warm.'}),
	P('ash-first-cairn', ['ash', 'oath'], 'place', {anchor: 'gatePillarWest', prop: 'cairn', inscription: 'For the ones who went first.'}),
	// Lantern
	P('lantern-window-lamp', ['lantern'], 'item', {def: item('Window Lamp', 'charm', 'common', [{on: 'fightStart', effects: [{do: 'draw', n: 2}]}], 'Light in a window means someone waits.', {prop: 'lantern', tint: 'window', accent: 'gold'})}),
	P('lantern-pell', ['lantern', 'forge', 'bargain'], 'npc', {id: 'pell', name: 'Pell', archetype: 'wayfarer', look: {cloak: 'haze', accent: 'ember', prop: 'hammer'}, bias: 'handItem', openings: {forge: 'Bent nails, straight nails. I sell both.', lantern: 'Keep your lamp high, friend. I will find you.'}}),
	P('lantern-fire-lamp', ['lantern'], 'place', {anchor: 'roadFire', prop: 'lantern'}),
	// Crow
	P('crow-ledger', ['crow'], 'item', {def: item("Crow's Ledger", 'charm', 'uncommon', [{on: 'fightStart', effects: [{do: 'power', kind: 'vulnerable', n: 1}, {do: 'power', kind: 'weak', n: 1}]}], 'The ledger has your name in it already.', {prop: 'book', tint: 'ink', accent: 'haze'})}),
	P('crow-keeper-riddle', ['crow'], 'line', {npc: 'keeper', when: {theme: 'crow', trust: 'warm'}, text: 'Seven crows on the gate tonight. Odd numbers are kind.'}),
	P('crow-counting-pages', ['crow'], 'path', {theme: 'crow', titles: ['Where the Crows Count', 'Feathers on the Road']}),
	// Oath
	P('oath-sworn-steel', ['oath'], 'card', {def: card('Sworn Steel', 'attack', 'uncommon', [dmg(6), blk(3)], 'Stand where you said you would stand.', {prop: 'sword', tint: 'slate', accent: 'gold'})}),
	P('oath-marcus-word', ['oath'], 'line', {npc: 'marcus', when: {theme: 'oath', trust: 'trusting'}, text: 'You kept your word. Not many do, these days.'}),
	P('oath-keeper-bench', ['oath', 'well'], 'place', {anchor: 'keeperBench', prop: 'bench'}),
	// Bargain
	P('bargain-lucky-coin', ['bargain'], 'item', {def: item('Lucky Coin', 'charm', 'uncommon', [{on: 'fightStart', effects: [{do: 'energy', n: 1}, blk(4)]}], 'Borrowed luck still counts.', {prop: 'coin', tint: 'gold', accent: 'dusk'})}),
	P('bargain-wayfarer-price', ['bargain'], 'line', {npc: 'wayfarer', when: {theme: 'bargain'}, text: 'Every price is small until you pay it twice.'}),
	P('bargain-north-sign', ['bargain', 'crow'], 'place', {anchor: 'southSignpost', prop: 'signpost', inscription: 'North, if you dare.'}),
])

/**
 * Full world/presets entries (for the Technical Director's world/ folder or tests).
 * @param {string} [at] YYYY-MM-DD
 */
export const presetEntries = (at = '2026-10-31') => WORLD_PRESETS.map((p) => ({v: 1, type: 'preset', origin: {src: 'studio', at}, id: p.id, themes: [...p.themes], proposal: p.proposal}))

/**
 * Three presets for a won book: the book's themes first (primary, secondary, shadow), then
 * any other theme, skipping used ones. Order inside a theme comes from the seed.
 * @param {{themes: {primary?: string, secondary?: string, shadow?: string}, used?: string[], seed?: string|number,
 *   list?: readonly {id: string, themes: string[], proposal: object}[]}} o  list: the loaded world's presets (default: these)
 * @returns {{id: string, themes: string[], proposal: {kind: string, data: object}}[]}
 */
export function presetWorldChanges({themes = {}, used = [], seed = 0, list = WORLD_PRESETS} = {}) {
	const usedSet = new Set(used)
	const free = list.filter((p) => !usedSet.has(p.id))
	const order = [themes.primary, themes.secondary, themes.shadow].filter(Boolean)
	const rand = rng(seed, 'presets')
	const picked = []
	for (const th of order) {
		const cands = shuffle(free.filter((p) => p.themes.includes(th) && !picked.includes(p)), rand)
		if (cands.length) picked.push(cands[0])
		if (picked.length === 3) return picked
	}
	for (const p of shuffle(free, rand)) {
		if (picked.length === 3) break
		if (!picked.includes(p)) picked.push(p)
	}
	return picked
}
