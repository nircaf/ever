// EVER content-gen: block templates for the offline generator (GDD_V2 10.6).
// A template is a skeleton of library blocks. Effects with a `share` have their `n` solved
// to the slot's power budget by generate.js (the mechanics budget is the judge); effects with
// a fixed `n` stay as written. `themes` weights how often a theme draws the template, `tags`
// are the mechanic families a typed request can ask for (lexicon.js REQUEST_KEYWORDS).
// Data only, PURE.
//
// Copyright (C) 2026 the EVER contributors.
// SPDX-License-Identifier: AGPL-3.0-or-later

const D = (share, extra = {}) => ({do: 'damage', share, ...extra})
const B = (share, extra = {}) => ({do: 'block', share, ...extra})
const P = (kind, share, target = 'enemy', extra = {}) => ({do: 'power', kind, share, target, ...extra})

/**
 * @typedef {object} CardTemplate
 * @prop {string} id
 * @prop {'attack'|'skill'|'power'} type
 * @prop {'enemy'|'self'} target
 * @prop {Record<string, number>} themes   theme -> weight (missing = 0.4)
 * @prop {string[]} tags
 * @prop {object[]} effects
 * @prop {object[]} [triggers]            power cards only
 * @prop {boolean} [exhaust]
 * @prop {Array<[number, number]>} [energies]  [energy, weight]
 * @prop {string[]} [rarities]            rarities this template may fill (default all)
 * @prop {string} [prop]                  preferred icon prop
 */

/** @type {readonly CardTemplate[]} */
export const CARD_TEMPLATES = Object.freeze([
	{id: 'strike', type: 'attack', target: 'enemy', themes: {forge: 3, ash: 2, bargain: 2}, tags: ['damage'], effects: [D(1)], prop: 'sword'},
	{id: 'strikeBlock', type: 'attack', target: 'enemy', themes: {forge: 3, oath: 3, well: 2}, tags: ['damage', 'block'], effects: [D(0.6), B(0.4)], prop: 'hammer'},
	{id: 'strikeWeak', type: 'attack', target: 'enemy', themes: {ash: 3, crow: 3}, tags: ['damage', 'weak'], effects: [D(0.6), P('weak', 0.4)], prop: 'cloud'},
	{id: 'strikeVuln', type: 'attack', target: 'enemy', themes: {crow: 3, forge: 2}, tags: ['damage', 'vulnerable'], effects: [D(0.6), P('vulnerable', 0.4)], prop: 'beak'},
	{id: 'strikeDraw', type: 'attack', target: 'enemy', themes: {lantern: 3, well: 2}, tags: ['damage', 'draw'], effects: [D(1), {do: 'draw', n: 1}], prop: 'book'},
	{id: 'strikePoison', type: 'attack', target: 'enemy', themes: {briar: 4}, tags: ['damage', 'poison'], effects: [D(0.5), P('poison', 0.5)], prop: 'thorn'},
	{id: 'twinStrike', type: 'attack', target: 'enemy', themes: {crow: 2, forge: 2}, tags: ['damage'], effects: [D(1, {hits: 2})], prop: 'feather'},
	{id: 'bloodStrike', type: 'attack', target: 'enemy', themes: {ash: 4, bargain: 2}, tags: ['damage', 'sacrifice'], effects: [D(1), {do: 'loseHp', n: 2}], prop: 'sword'},
	{id: 'temperStrike', type: 'attack', target: 'enemy', themes: {forge: 4}, tags: ['damage', 'strength'], effects: [D(0.6), P('strength', 0.4, 'self', {if: {is: 'firstTimeThisFight'}})], rarities: ['uncommon', 'rare'], prop: 'coal'},
	{id: 'curseStrike', type: 'attack', target: 'enemy', themes: {bargain: 4, ash: 1}, tags: ['damage', 'bargain'], effects: [D(0.7), D(0, {scale: {per: 'curseInDeck', each: 2, cap: 3}})], prop: 'coin'},
	{id: 'guardedStrike', type: 'attack', target: 'enemy', themes: {oath: 3, well: 2}, tags: ['damage', 'block', 'condition'], effects: [D(0.6), B(0.4, {if: {is: 'enemyIntendsAttack'}})], prop: 'shield'},
	{id: 'vowStrike', type: 'attack', target: 'enemy', themes: {oath: 4}, tags: ['damage', 'condition'], effects: [D(0.6), D(0.4, {if: {is: 'notDamagedThisFight'}})], prop: 'bell'},
	{id: 'despairStrike', type: 'attack', target: 'enemy', themes: {ash: 3}, tags: ['damage', 'sacrifice', 'condition'], effects: [D(0.6), D(0.4, {if: {is: 'hpBelow', pct: 50}})], prop: 'ember'},
	{id: 'omenStrike', type: 'attack', target: 'enemy', themes: {crow: 3}, tags: ['damage', 'weak', 'vulnerable'], effects: [D(0.6), D(0, {scale: {per: 'enemyDebuff', each: 2, cap: 3}})], rarities: ['uncommon', 'rare'], prop: 'beak'},
	{id: 'guard', type: 'skill', target: 'self', themes: {well: 3, oath: 3}, tags: ['block'], effects: [B(1)], prop: 'shield'},
	{id: 'guardDraw', type: 'skill', target: 'self', themes: {well: 3, lantern: 3}, tags: ['block', 'draw'], effects: [B(1), {do: 'draw', n: 1}], prop: 'bucket'},
	{id: 'guardRegen', type: 'skill', target: 'self', themes: {briar: 4}, tags: ['block', 'regen'], effects: [B(0.6), P('regen', 0.4, 'self')], prop: 'leaf'},
	{id: 'guardThorns', type: 'skill', target: 'self', themes: {briar: 3, oath: 1}, tags: ['block', 'poison'], effects: [B(0.6), P('thorns', 0.4, 'self')], prop: 'thorn'},
	{id: 'venom', type: 'skill', target: 'enemy', themes: {briar: 4}, tags: ['poison'], effects: [P('poison', 1)], prop: 'thorn'},
	{id: 'hex', type: 'skill', target: 'enemy', themes: {crow: 4, ash: 1}, tags: ['weak', 'vulnerable'], effects: [P('weak', 0.5), P('vulnerable', 0.5)], prop: 'feather'},
	{id: 'spark', type: 'skill', target: 'self', themes: {lantern: 4}, tags: ['energy', 'draw'], effects: [{do: 'energy', n: 1}, {do: 'draw', n: 1}], exhaust: true, energies: [[0, 1]], rarities: ['uncommon', 'rare'], prop: 'spark'},
	{id: 'mend', type: 'skill', target: 'self', themes: {briar: 3, well: 2}, tags: ['block', 'regen'], effects: [B(0.7), {do: 'heal', share: 0.3}], prop: 'apple'},
	{id: 'bracing', type: 'skill', target: 'self', themes: {oath: 3, well: 2}, tags: ['block'], effects: [B(0.5), B(0.5, {when: 'nextTurn'})], prop: 'shield'},
	{id: 'cleanse', type: 'skill', target: 'self', themes: {lantern: 3, well: 2}, tags: ['block'], effects: [{do: 'removePower', kind: 'debuffs', target: 'self'}, B(1)], prop: 'lantern'},
	{id: 'steel', type: 'skill', target: 'self', themes: {forge: 3}, tags: ['strength', 'block'], effects: [B(0.6), P('strength', 0.4, 'self')], prop: 'whetstone'},
	{id: 'watch', type: 'power', target: 'self', themes: {oath: 3, well: 2}, tags: ['block'], effects: [], triggers: [{on: 'turnStart', effects: [B(1)]}], energies: [[1, 3], [2, 1]], rarities: ['uncommon', 'rare'], prop: 'bell'},
	{id: 'thornAura', type: 'power', target: 'self', themes: {briar: 4}, tags: ['poison'], effects: [], triggers: [{on: 'onPlay', type: 'attack', effects: [P('poison', 1)]}], energies: [[1, 1]], rarities: ['uncommon', 'rare'], prop: 'thorn'},
	{id: 'kindling', type: 'power', target: 'self', themes: {forge: 3, lantern: 2}, tags: ['strength', 'damage'], effects: [], triggers: [{on: 'everyNthTurn', n: 2, effects: [P('strength', 1, 'self')]}], energies: [[1, 2], [2, 1]], rarities: ['rare'], prop: 'ember'},
])

/**
 * @typedef {object} ItemTemplate
 * @prop {string} id
 * @prop {'hand'|'body'|'charm'} slot
 * @prop {Record<string, number>} themes
 * @prop {string[]} tags
 * @prop {object[]} triggers
 * @prop {number} [maxHp]                 fixed stats.maxHp
 * @prop {string} [prop]
 */

/** @type {readonly ItemTemplate[]} */
export const ITEM_TEMPLATES = Object.freeze([
	{id: 'apron', slot: 'body', themes: {forge: 3, oath: 2, well: 2}, tags: ['block'], triggers: [{on: 'fightStart', effects: [B(1)]}], prop: 'apron'},
	{id: 'readingLamp', slot: 'charm', themes: {lantern: 4, crow: 1}, tags: ['draw'], triggers: [{on: 'fightStart', effects: [{do: 'draw', n: 2}]}], prop: 'lantern'},
	{id: 'evilEye', slot: 'charm', themes: {crow: 4}, tags: ['vulnerable'], triggers: [{on: 'fightStart', effects: [P('vulnerable', 1)]}], prop: 'feather'},
	{id: 'gauntlet', slot: 'hand', themes: {oath: 3, forge: 2}, tags: ['block'], triggers: [{on: 'firstCardEachTurn', effects: [B(1)]}], prop: 'shield'},
	{id: 'briarGloves', slot: 'hand', themes: {briar: 4}, tags: ['poison'], triggers: [{on: 'firstCardEachTurn', effects: [P('poison', 1)]}], prop: 'thorn'},
	{id: 'scarCloak', slot: 'body', themes: {ash: 3, well: 2}, tags: ['block', 'sacrifice'], triggers: [{on: 'onHpLoss', effects: [B(1)]}], prop: 'cloud'},
	{id: 'whetstone', slot: 'hand', themes: {forge: 4}, tags: ['strength', 'damage'], triggers: [{on: 'fightStart', effects: [P('strength', 1, 'self')]}], prop: 'whetstone'},
	{id: 'bellCharm', slot: 'charm', themes: {oath: 3, well: 1}, tags: ['block'], triggers: [{on: 'everyNthTurn', n: 2, effects: [B(1)]}], prop: 'bell'},
	{id: 'heartyCoat', slot: 'body', themes: {briar: 2, oath: 2, well: 1}, tags: ['regen'], triggers: [{on: 'fightWon', effects: [{do: 'healNow', share: 1}]}], prop: 'apple'},
	{id: 'thornMail', slot: 'body', themes: {briar: 3}, tags: ['poison', 'block'], triggers: [{on: 'fightStart', effects: [P('thorns', 1, 'self')]}], prop: 'thorn'},
	{id: 'luckyCoin', slot: 'charm', themes: {bargain: 4, lantern: 1}, tags: ['energy', 'bargain'], triggers: [{on: 'fightStart', effects: [{do: 'energy', n: 1}, B(1)]}], prop: 'coin'},
	{id: 'crowsLedger', slot: 'charm', themes: {crow: 3, ash: 1}, tags: ['weak'], triggers: [{on: 'fightStart', effects: [P('weak', 1)]}], prop: 'book'},
])

/** Token templates ("next fight, one shot"). */
export const TOKEN_TEMPLATES = Object.freeze([
	{id: 'ward', themes: {well: 3, oath: 2}, tags: ['block'], effects: [B(1)], prop: 'ward'},
	{id: 'ember', themes: {forge: 3, lantern: 2}, tags: ['energy'], effects: [{do: 'energy', n: 1}, B(1)], prop: 'ember'},
	{id: 'whet', themes: {forge: 3, crow: 1}, tags: ['strength'], effects: [P('strength', 1, 'self', {fight: true}), B(1)], prop: 'whetstone'},
	{id: 'insight', themes: {lantern: 3, crow: 2}, tags: ['draw'], effects: [{do: 'draw', n: 2}, B(1)], prop: 'book'},
	{id: 'venomVial', themes: {briar: 4}, tags: ['poison'], effects: [P('poison', 1)], prop: 'drop'},
	{id: 'omen', themes: {crow: 4, ash: 1}, tags: ['vulnerable', 'weak'], effects: [P('vulnerable', 1), P('weak', 0.5)], prop: 'feather'},
])

/** Costs a bargain may carry (GDD_V2 8.2: the cost must take back half the excess). */
export const BARGAIN_COSTS = Object.freeze([
	{id: 'blood', pp: (k) => k, make: (k) => ({do: 'loseHp', n: Math.min(10, k)}), max: 10},
	{id: 'doubt', pp: () => 6, make: () => ({do: 'addCard', card: 'Doubt', pile: 'discard', n: 1}), max: 6},
])
