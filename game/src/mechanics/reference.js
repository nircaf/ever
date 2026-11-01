// EVER mechanics: reference content for the balance simulator and tests.
//   - KEEPSAKES: the 16 GDD_V2 section 4 keepsakes written as block data (proof that the
//     schema expresses the authored set; the Creative Director's world/ copy is the truth).
//   - SIM_ENEMIES: GDD_V2 7 / 13 numbers (Combat owns the real enemies; pass yours in).
//   - REFERENCE_DECKS: early / mid / late decks per GDD_V2 8.3 until the Creative
//     Director delivers the real ones to world/ (pass them in via balanceCheck({decks})).
// PURE.
//
// Copyright (C) 2026 the EVER contributors.
// SPDX-License-Identifier: AGPL-3.0-or-later

const ks = (theme, name, type, effects, upgrade, art) => ({kind: 'card', theme, name, type, rarity: 'keepsake', energy: 1, target: type === 'attack' ? 'enemy' : 'self', effects, upgrade, art})
const dmg = (n, extra = {}) => ({do: 'damage', n, ...extra})
const blk = (n, extra = {}) => ({do: 'block', n, ...extra})

/** GDD_V2 section 4, base / upgraded. */
export const KEEPSAKES = Object.freeze([
	ks('forge', "Tobin's Hammer", 'attack', [dmg(7), blk(3)], {effects: [dmg(10), blk(4)]}, {prop: 'hammer', tint: 'iron'}),
	ks('forge', 'Banked Coal', 'attack', [dmg(5), {do: 'power', kind: 'strength', n: 1, target: 'self', fight: true}], {effects: [dmg(6), {do: 'power', kind: 'strength', n: 1, target: 'self', fight: true}, blk(2)]}, {prop: 'coal', tint: 'ember'}),
	ks('well', 'Well Rope', 'skill', [blk(6), dmg(4)], {effects: [blk(8), dmg(6)]}, {prop: 'rope', tint: 'wood'}),
	ks('well', 'Cold Water', 'attack', [dmg(5), blk(3), {do: 'draw', n: 1}], {effects: [dmg(7), blk(4), {do: 'draw', n: 1}]}, {prop: 'drop', tint: 'ward'}),
	ks('briar', 'Thorn Sprig', 'attack', [dmg(3), {do: 'power', kind: 'poison', n: 3}], {effects: [dmg(4), {do: 'power', kind: 'poison', n: 4}]}, {prop: 'thorn', tint: 'pine', accent: 'moss'}),
	ks('briar', 'Bramble Coat', 'attack', [dmg(5), {do: 'power', kind: 'regen', n: 2, target: 'self'}], {effects: [dmg(7), {do: 'power', kind: 'regen', n: 3, target: 'self'}]}, {prop: 'leaf', tint: 'moss'}),
	ks('ash', 'Mourning Cut', 'attack', [{do: 'loseHp', n: 1}, dmg(11)], {effects: [{do: 'loseHp', n: 1}, dmg(15)]}, {prop: 'sword', tint: 'ash'}),
	ks('ash', 'Grave Dust', 'attack', [dmg(6), {do: 'power', kind: 'weak', n: 1}], {effects: [dmg(8), {do: 'power', kind: 'weak', n: 2}]}, {prop: 'cloud', tint: 'ash', accent: 'haze'}),
	ks('lantern', 'Guiding Light', 'attack', [dmg(5), blk(4), {do: 'draw', n: 1}], {effects: [dmg(6), blk(5), {do: 'draw', n: 1}]}, {prop: 'lantern', tint: 'window'}),
	ks('lantern', 'Spark of Hope', 'skill', [blk(5), dmg(5), {do: 'draw', n: 1, when: 'nextTurn'}], {effects: [blk(7), dmg(6), {do: 'draw', n: 1, when: 'nextTurn'}]}, {prop: 'spark', tint: 'gold'}),
	ks('crow', "Crow's Beak", 'attack', [dmg(6), {do: 'power', kind: 'vulnerable', n: 1}], {effects: [dmg(8), {do: 'power', kind: 'vulnerable', n: 2}]}, {prop: 'beak', tint: 'ink'}),
	ks('crow', 'Black Feather', 'attack', [dmg(4), {do: 'power', kind: 'weak', n: 1}, {do: 'power', kind: 'vulnerable', n: 1}], {effects: [dmg(6), {do: 'power', kind: 'weak', n: 1}, {do: 'power', kind: 'vulnerable', n: 2}]}, {prop: 'feather', tint: 'ink'}),
	ks('oath', 'Sworn Blade', 'attack', [dmg(5), blk(5), blk(3, {if: {is: 'notDamagedThisFight'}})], {effects: [dmg(7), blk(6), blk(3, {if: {is: 'notDamagedThisFight'}})]}, {prop: 'sword', tint: 'slate', accent: 'gold'}),
	ks('oath', 'Bell of Vows', 'skill', [blk(8), dmg(3)], {effects: [blk(10), dmg(5)]}, {prop: 'bell', tint: 'slate'}),
	ks('bargain', 'Crooked Coin', 'attack', [dmg(9), {do: 'loseHp', n: 1}], {effects: [dmg(12), {do: 'loseHp', n: 1}]}, {prop: 'coin', tint: 'gold'}),
	ks('bargain', 'Pawned Ring', 'attack', [dmg(6), blk(3), dmg(0, {scale: {per: 'curseInDeck', each: 3, cap: 3}})], {effects: [dmg(8), blk(4), dmg(0, {scale: {per: 'curseInDeck', each: 3, cap: 3}})]}, {prop: 'ring', tint: 'gold'}),
])

/** Enemies for the sim (GDD_V2 7 and 13). Intent fields follow the engine: damage, block, weak, vulnerable. */
export const SIM_ENEMIES = Object.freeze({
	motes: Object.freeze({name: 'Ash Motes', hp: 16, intents: [{damage: 4}, {damage: 6}, {damage: 3, weak: 1}]}),
	hound: Object.freeze({name: 'Cinder Hound', hp: 32, intents: [{damage: 7}, {damage: 5, vulnerable: 1}, {damage: 10}]}),
	husk: Object.freeze({name: 'Iron Husk', hp: 52, intents: [{damage: 7, block: 8}, {damage: 13}, {damage: 6, weak: 1, vulnerable: 1}, {damage: 16}]}),
	wardenV2: Object.freeze({name: 'The Ash Warden', hp: 120, intents: [{damage: 14}, {damage: 9, block: 12}, {damage: 7, weak: 1}, {damage: 23}]}),
	ashWarden: Object.freeze({name: 'The Ash Warden', hp: 82, intents: [{damage: 12}, {damage: 8, block: 10}, {damage: 6, weak: 1}, {damage: 20}]}),
})

/** Warden v2 HP for a path length (GDD_V2 13: 120 at 9 pages, +-8 per page). */
export const wardenHpForPages = (pages = 9) => 120 + 8 * (pages - 9)

const k = (name) => ({def: KEEPSAKES.find((x) => x.name === name)})
const e = (id, upgraded = false) => ({id, upgraded})

/** Stage of a page (GDD_V2 9.3 rarity bands use the same split). */
export const stageOf = (page) => (page <= 3 ? 'early' : page <= 6 ? 'mid' : 'late')

/**
 * Three decks per stage (three keepsake flavours), the stage's enemy and starting HP.
 * Deck entries are book-style: {id, upgraded} engine names, or {def} inline keepsakes.
 * Items are canonical item defs.
 */
export const REFERENCE_DECKS = Object.freeze({
	early: {
		enemy: 'motes',
		hp: 50,
		decks: [
			{name: 'forge-early', cards: [k("Tobin's Hammer"), e('Strike')]},
			{name: 'briar-early', cards: [k('Thorn Sprig'), e('Defend')]},
			{name: 'crow-early', cards: [k("Crow's Beak"), e('Strike'), e('Defend')]},
		],
	},
	mid: {
		enemy: 'husk',
		hp: 45,
		decks: [
			{name: 'forge-mid', cards: [k("Tobin's Hammer"), e('Strike'), e('Defend'), e('Iron Wave'), e('Sucker Punch')]},
			{name: 'well-mid', cards: [k('Cold Water'), e('Defend'), e('Defend'), e('Strike'), e('Thunderclap')]},
			{name: 'ash-mid', cards: [k('Grave Dust'), e('Strike'), e('Bash'), e('Defend'), e('Iron Wave')]},
		],
	},
	late: {
		enemy: 'wardenV2',
		hp: 40,
		decks: [
			{name: 'forge-late', cards: [{...k("Tobin's Hammer"), upgraded: true}, e('Strike'), e('Defend'), e('Iron Wave', true), e('Sucker Punch'), e('Thunderclap'), e('Defend'), e('Bash')], items: ['apron']},
			{name: 'crow-late', cards: [{...k('Black Feather'), upgraded: true}, e('Strike'), e('Defend'), e('Defend'), e('Iron Wave'), e('Bash', true), e('Thunderclap'), e('Sucker Punch')], items: ['lantern']},
			{name: 'oath-late', cards: [k('Sworn Blade'), e('Defend', true), e('Strike'), e('Iron Wave'), e('Iron Wave'), e('Thunderclap'), e('Defend'), e('Sucker Punch')], items: ['apron']},
		],
	},
})

/** GDD_V2 18.2 items used by the reference decks. */
export const REFERENCE_ITEMS = Object.freeze({
	apron: {kind: 'item', name: "Tobin's Apron", slot: 'body', rarity: 'common', triggers: [{on: 'fightStart', effects: [{do: 'block', n: 8}]}], art: {prop: 'apron', tint: 'apron'}},
	lantern: {kind: 'item', name: "Wayfarer's Lantern", slot: 'charm', rarity: 'common', triggers: [{on: 'fightStart', effects: [{do: 'draw', n: 2}]}], art: {prop: 'lantern', tint: 'gold'}},
})
