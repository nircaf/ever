// EVER mechanics: the engine side. Two documented extension points, nothing else:
//   1. installEngineExtensions(): registers ONE engine action, `everOps`, on the vendored
//      engine's action table (the same way combat/rules already wraps an upstream action).
//      Generated cards carry `actions: [{type: 'everOps', parameter: {ops}}]`, so the
//      engine's own playCard -> useCardActions runs them.
//   2. Combat hooks, called by game/src/combat/rules/index.js at fixed points of a party
//      fight (setup, turn start, after a play, turn end, discard, Warden turn, round end,
//      kill). They mutate the (already cloned) PartyCombat they are given and return
//      display events {k: 'mech', seat, text}.
// The fighter's per-fight mechanics state lives at fighter.s.mech (plain JSON), so it is
// stored with the PartyCombat and travels through the engine with the fighter's state.
// PURE: no DOM. Imported by the browser (solo) and by the room server.
//
// Copyright (C) 2026 the EVER contributors.
// SPDX-License-Identifier: AGPL-3.0-or-later

import actions from '../../../vendor/slaytheweb/src/game/actions.js'
import {produce} from 'immer'
import {EVER_OPS, buildLib, compileItem, compileToken, lookupDef, refsOf} from './compile.js'
import {hash32} from './prng.js'
import {drain, fire, heal, isCurseCard, loseHp, newMech, resolveEffects} from './runtime.js'

let installed = false
/** Idempotent. Adds the `everOps` action to the engine's action table. */
export function installEngineExtensions() {
	if (installed && actions[EVER_OPS]) return
	installed = true
	actions[EVER_OPS] = everOps
}

/** Engine action: run generated ops on an engine state (inside immer). */
function everOps(state, {ops, card}) {
	if (!Array.isArray(ops) || !ops.length) return state
	return produce(state, (d) => {
		if (!d.mech) d.mech = newMech({seed: hash32(String(card?.id ?? 'x'))})
		const room = d.dungeon.graph[d.dungeon.y][d.dungeon.x].room
		const m = room.monsters[0]
		const enemy = {
			get hp() {
				return m.currentHealth
			},
			set hp(v) {
				m.currentHealth = v
			},
			get maxHp() {
				return m.maxHealth
			},
			get block() {
				return m.block
			},
			set block(v) {
				m.block = v
			},
			get powers() {
				return m.powers
			},
		}
		resolveEffects({s: d, enemy, mech: d.mech, seat: d.mech.seat}, ops, card?.id)
	})
}

const hostOf = (pc, f) => ({s: f.s, enemy: pc.warden, mech: f.s.mech, seat: f.seat})
const takeEvents = (f) => (f.s.mech ? f.s.mech.ev.splice(0).map((e) => ({...e, seat: f.seat})) : [])
const allCards = (s) => [...s.hand, ...s.drawPile, ...s.discardPile]

/**
 * Set up a fighter's mechanics for a fight and run fight-start triggers and tokens.
 * Call after the fighter's engine state exists (cards drawn) and MVP tokens applied.
 * @param {any} pc
 * @param {any} f  pc fighter ({seat, s})
 * @param {{content?: {defs: Record<string, any>}, items?: (string|{id: string, def?: any})[], tokens?: string[], seed?: number}} [o]
 * @returns {any[]} events
 */
export function mechSetup(pc, f, {content, items = [], tokens = [], seed = 0} = {}) {
	const cards = allCards(f.s)
	const itemDefs = []
	for (const it of items ?? []) {
		const id = typeof it === 'string' ? it : it?.id
		const def = (typeof it === 'object' && it?.def) || lookupDef(content, id)
		if (def?.kind === 'item') itemDefs.push([id, def])
	}
	const tokenDefs = []
	for (const t of tokens ?? []) {
		const def = lookupDef(content, t)
		if (def?.kind === 'token') tokenDefs.push([t, def])
	}
	const refs = new Set()
	for (const c of cards) if (c.everGen) for (const r of refsOf(lookupDef(content, c.everGen))) refs.add(r)
	for (const [, d] of [...itemDefs, ...tokenDefs]) for (const r of refsOf(d)) refs.add(r)
	f.s.mech = newMech({
		seed: hash32(`${seed}|mech|${f.seat}`),
		items: itemDefs.map(([id, d]) => compileItem(d, id)),
		tokens: tokenDefs.map(([id, d]) => compileToken(d, id)),
		lib: buildLib([...refs], content),
		deckSize: cards.length,
		curses: cards.filter(isCurseCard).length,
	})
	f.s.mech.seat = f.seat
	f.s.mech.cardTriggers = cards.some((c) => c.everTriggers) || Object.values(f.s.mech.lib).some((c) => c.everTriggers)
	const H = hostOf(pc, f)
	fire(H, 'fightStart')
	for (const t of f.s.mech.tokens) {
		resolveEffects(H, t.effects, `t:${t.id}`)
		H.mech.ev.push({k: 'mech', text: `${t.name}.`, src: t.name})
	}
	// The opening hand's onDraw triggers fire in the first mechTurnStart (callers always run
	// it right after setup), like every later hand.
	drain(H)
	return takeEvents(f)
}

/**
 * Start of a fighter's turn (after the engine's draw, energy and block reset).
 * @param {{damage?: number, block?: number, weak?: number}|null} intent  the Warden's intent against this fighter
 */
export function mechTurnStart(pc, f, intent = null) {
	const mech = f.s.mech
	if (!mech) return []
	const H = hostOf(pc, f)
	mech.t = {played: 0, attack: 0, skill: 0, power: 0}
	mech.intent = intent ? {damage: intent.damage || 0, block: intent.block || 0, weak: intent.weak || 0} : null
	const p = f.s.player
	if (p.powers.poison > 0) {
		loseHp(H, p.powers.poison)
		mech.ev.push({k: 'mech', text: `Poison: -${p.powers.poison} HP.`})
	}
	const due = mech.delayed.filter((x) => x.at <= f.s.turn)
	mech.delayed = mech.delayed.filter((x) => x.at > f.s.turn)
	for (const x of due) resolveEffects(H, x.effects, x.key)
	fire(H, 'turnStart')
	fire(H, 'everyNthTurn')
	const kept = new Set(mech.kept ?? [])
	for (const c of f.s.hand) if (!kept.has(c.id) && c.everTriggers?.some((t) => t.on === 'onDraw')) mech.pend.push(`draw:${c.id}`)
	mech.kept = []
	drain(H)
	return takeEvents(f)
}

/** After the engine played `card` (already discarded/exhausted) for fighter f. */
export function mechAfterPlay(pc, f, card) {
	const mech = f.s.mech
	if (!mech) return []
	const H = hostOf(pc, f)
	if (!mech.played.includes(card.id)) mech.played.push(card.id)
	if (card.everPower) mech.active.push({key: card.id, name: String(card.name).replace(/\+$/, ''), triggers: card.everPower})
	const thorns = pc.warden.powers.thorns || 0
	if (card.type === 'attack' && thorns > 0 && pc.warden.hp > 0) {
		loseHp(H, thorns)
		mech.ev.push({k: 'mech', text: `Thorns: -${thorns} HP.`})
	}
	fire(H, 'onPlay', {type: card.type})
	if (mech.t.played === 0) fire(H, 'firstCardEachTurn')
	mech.t.played++
	if (card.type in mech.t) mech.t[card.type]++
	drain(H)
	return takeEvents(f)
}

/** End of a fighter's real turn, before the Doubt tick and the discard. */
export function mechTurnEnd(pc, f) {
	const mech = f.s.mech
	if (!mech) return []
	const H = hostOf(pc, f)
	fire(H, 'turnEnd')
	const regen = f.s.player.powers.regen || 0
	if (regen > 0) heal(H, regen)
	drain(H)
	return takeEvents(f)
}

/**
 * Discard the hand, keeping Retain cards. `discardHand` is the engine action.
 * copy=false skips the plain-JSON copy (the simulator's own discard returns mutable data).
 * @returns {any} new slim state (plain)
 */
export function mechDiscardHand(s, discardHand, {copy = true} = {}) {
	const kept = s.hand.filter((c) => c.everRetain)
	const out = discardHand(kept.length ? {...s, hand: s.hand.filter((c) => !c.everRetain)} : s)
	const next = copy ? JSON.parse(JSON.stringify(out)) : out
	if (kept.length) {
		next.hand = copy ? JSON.parse(JSON.stringify(kept)) : kept
		if (next.mech) next.mech.kept = kept.map((c) => c.id)
	}
	return next
}

/** Start of the Warden's turn: its Poison and Regen tick. Returns events; check warden.hp after. */
export function mechEnemyTurnStart(pc) {
	const w = pc.warden
	const events = []
	if (w.powers.poison > 0 && w.hp > 0) {
		w.hp -= w.powers.poison
		events.push({k: 'mech', seat: -1, text: `Poison: -${w.powers.poison} HP.`})
	}
	if (w.powers.regen > 0 && w.hp > 0) w.hp = Math.min(w.maxHp, w.hp + w.powers.regen)
	return events
}

/** After the Warden's intent hit fighter f. before = {hp} of the fighter before the hit. */
export function mechAfterEnemyHit(pc, f, before, intent = null) {
	const mech = f.s.mech
	if (!mech) return []
	const H = hostOf(pc, f)
	if (f.s.player.currentHealth < before.hp) {
		mech.hpLost = true
		mech.pend.push('hpLoss')
	}
	const thorns = f.s.player.powers.thorns || 0
	if (thorns > 0 && (intent?.damage || 0) > 0 && pc.warden.hp > 0) {
		pc.warden.hp -= thorns
		mech.ev.push({k: 'mech', text: `Thorns: ${thorns} damage back.`})
	}
	drain(H)
	return takeEvents(f)
}

/** After powers ticked down for the round: "for the rest of the fight" powers stay. */
export function mechRoundEnd(pc) {
	for (const f of pc.fighters) {
		const mech = f.s?.mech
		if (!mech || f.dead || f.removed) continue
		for (const [k, n] of Object.entries(mech.perm)) f.s.player.powers[k] = Math.max(f.s.player.powers[k] || 0, n)
		for (const [k, n] of Object.entries(mech.permE)) pc.warden.powers[k] = Math.max(pc.warden.powers[k] || 0, n)
	}
}

/** The enemy died from fighter f's play. */
export function mechOnKill(pc, f) {
	if (!f.s.mech) return []
	const H = hostOf(pc, f)
	fire(H, 'onKill')
	drain(H)
	return takeEvents(f)
}

/**
 * Out-of-combat results of a fight for the BOOK (Systems applies them): healNow from
 * `fightWon` triggers on items and on cards/curses in the deck.
 * @param {{deckDefs?: any[], itemDefs?: any[], won: boolean}} o
 * @returns {{heal: number}}
 */
export function afterFight({deckDefs = [], itemDefs = [], won}) {
	let healN = 0
	if (!won) return {heal: 0}
	for (const def of [...itemDefs, ...deckDefs]) for (const t of def?.triggers ?? []) if (t.on === 'fightWon') for (const e of t.effects) if (e.do === 'healNow') healN += e.n
	return {heal: healN}
}
