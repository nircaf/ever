// EVER mechanics: the block interpreter. Runs canonical effect lists and triggers against
// a "host": {s, enemy, mech} where
//   s      = a fighter's Slay the Web state (hand, drawPile, discardPile, exhaustPile, turn, player)
//   enemy  = {hp, maxHp, block, powers} (the shared Warden, or an adapter over an engine Monster)
//   mech   = the fighter's per-fight mechanics state (s.mech, plain JSON, see newMech)
// The SAME interpreter runs inside the engine (engine.js, solo + room server) and inside the
// fast balance simulator (sim.js), which is what keeps the two in step.
// Data only: effects are looked up by id in the block library; code blocks get a frozen API.
// PURE. Deterministic: randomness comes from mech.r (a uint32 stream stored in the state).
//
// Copyright (C) 2026 the EVER contributors.
// SPDX-License-Identifier: AGPL-3.0-or-later

import {hash32, stepState} from './prng.js'
import {codeBlockRun} from './blocks-registry.js'
import {POWERS, SCALE_CAP} from './library.js'

export const MECH_STATE_VERSION = 1
/** Max nested trigger depth and max trigger firings per drain (no runaway loops). */
export const MAX_DEPTH = 3
export const MAX_FIRINGS = 24
/** Max API calls one code-block run may make. */
export const CODE_OP_BUDGET = 40

/**
 * Fresh per-fight mechanics state for one fighter.
 * @param {{seed?: number, items?: {id: string, name: string, triggers: any[]}[], tokens?: {id: string, name: string, effects: any[]}[], lib?: Record<string, any>, deckSize?: number, curses?: number}} o
 */
export function newMech({seed = 1, items = [], tokens = [], lib = {}, deckSize = 0, curses = 0} = {}) {
	return {
		v: MECH_STATE_VERSION,
		r: seed >>> 0,
		items,
		tokens,
		active: [],
		perm: {},
		permE: {},
		delayed: [],
		played: [],
		fired: {},
		hpLost: false,
		t: {played: 0, attack: 0, skill: 0, power: 0},
		deckSize,
		curses,
		cardTriggers: false, // true once any card in the fight carries triggers (fast path in fire)
		intent: null,
		lib,
		seq: 0,
		pend: [],
		ev: [],
	}
}

export const rand = (H) => {
	const [v, next] = stepState(H.mech.r)
	H.mech.r = next
	return v
}
const emit = (H, text, extra) => H.mech.ev.push({k: 'mech', text, ...extra})

export const isCurseCard = (c) => Boolean(c?.everCurse) || c?.type === 'curse' || c?.name === 'Doubt'

// -------------------------------------------------------------------------------------
// Primitive operations (engine-exact numbers)
// -------------------------------------------------------------------------------------

/** One hit on the enemy, exactly as the engine's playCard + removeHealth compute it. */
export function hitEnemy(H, base) {
	const p = H.s.player
	const e = H.enemy
	if (e.hp < 1) return 0
	let amount = base
	if (p.powers.strength) amount += p.powers.strength
	if (p.powers.weak) amount = Math.floor(amount * 0.75)
	if (e.powers.vulnerable) amount = Math.floor(amount * 1.5)
	const left = e.block - amount
	const before = e.hp
	if (left < 0) {
		e.block = 0
		e.hp += left
	} else e.block = left
	return before - e.hp
}

export function gainBlock(H, n) {
	H.s.player.block += n
}

/** Lose HP, ignoring Block (like the Doubt tick). Queues onHpLoss. */
export function loseHp(H, n) {
	if (n <= 0) return
	H.s.player.currentHealth -= n
	H.mech.hpLost = true
	H.mech.pend.push('hpLoss')
}

export function heal(H, n) {
	const p = H.s.player
	p.currentHealth = Math.max(p.currentHealth, Math.min(p.maxHealth, p.currentHealth + n))
}

/** Engine drawCards semantics: if the draw pile is short, draw+discard are shuffled together. */
export function drawCards(H, n) {
	const s = H.s
	if (s.drawPile.length < n) {
		const all = s.drawPile.concat(s.discardPile)
		if (H.mech.ks !== undefined) {
			// Simulator only: order by a per-card key, so adding one card to a deck does not
			// reorder every other card (common random numbers between "with" and "without").
			const tag = `${H.mech.ks}|${(H.mech.shuf = (H.mech.shuf || 0) + 1)}|`
			const keyed = all.map((c) => [hash32(tag + c.id), c])
			keyed.sort((a, b) => a[0] - b[0])
			for (let i = 0; i < all.length; i++) all[i] = keyed[i][1]
		} else
			for (let m = all.length; m; ) {
				const i = Math.floor(rand(H) * m--)
				const t = all[m]
				all[m] = all[i]
				all[i] = t
			}
		s.drawPile = all
		s.discardPile = []
	}
	const got = s.drawPile.splice(0, n)
	s.hand.push(...got)
	for (const c of got) if (c.everTriggers?.some((t) => t.on === 'onDraw')) H.mech.pend.push(`draw:${c.id}`)
	return got.length
}

export function applyPower(H, kind, n, target, fight) {
	if (!POWERS[kind] || n <= 0) return
	if (target === 'self') {
		const pw = H.s.player.powers
		pw[kind] = (pw[kind] || 0) + n
		if (fight) H.mech.perm[kind] = (H.mech.perm[kind] || 0) + n
	} else {
		if (H.enemy.hp < 1) return
		H.enemy.powers[kind] = (H.enemy.powers[kind] || 0) + n
		if (fight) H.mech.permE[kind] = (H.mech.permE[kind] || 0) + n
	}
}

function removePower(H, kind, target) {
	const pw = target === 'self' ? H.s.player.powers : H.enemy.powers
	const perm = target === 'self' ? H.mech.perm : H.mech.permE
	const kinds = kind === 'debuffs' ? Object.keys(POWERS).filter((k) => POWERS[k].debuff) : kind === 'buffs' ? Object.keys(POWERS).filter((k) => !POWERS[k].debuff) : [kind]
	for (const k of kinds) {
		if (pw[k]) pw[k] = 0
		delete perm[k]
	}
}

function takeFromHand(H, n, pick) {
	const hand = H.s.hand
	const out = []
	for (let i = 0; i < n; i++) {
		const pool = pick === 'curse' ? hand.filter(isCurseCard) : hand
		if (!pool.length) break
		const c = pool[Math.floor(rand(H) * pool.length)]
		hand.splice(hand.indexOf(c), 1)
		out.push(c)
	}
	return out
}

/** A fresh card instance for a reference (engine name or generated id) from mech.lib. */
export function makeCard(H, ref) {
	const tpl = H.mech.lib?.[ref]
	if (!tpl) return null
	const c = JSON.parse(JSON.stringify(tpl))
	c.id = `m${H.seat ?? 0}x${H.mech.seq++}`
	if (c.everTriggers) H.mech.cardTriggers = true
	return c
}

function addCards(H, ref, pile, n) {
	for (let i = 0; i < n; i++) {
		const c = makeCard(H, ref)
		if (!c) return
		if (pile === 'hand') {
			H.s.hand.push(c)
		} else if (pile === 'draw') {
			const at = Math.floor(rand(H) * (H.s.drawPile.length + 1))
			H.s.drawPile.splice(at, 0, c)
		} else H.s.discardPile.push(c)
	}
}

// -------------------------------------------------------------------------------------
// Conditions and scaling
// -------------------------------------------------------------------------------------

const debuffStacks = (powers) => (powers.weak || 0) + (powers.vulnerable || 0) + (powers.poison || 0)

export function scaleCount(H, per) {
	const p = H.s.player
	switch (per) {
		case 'cardInHand':
			return H.s.hand.length
		case 'curseInDeck':
			return H.mech.curses
		case 'turn':
			return H.s.turn
		case 'cardPlayedThisTurn':
			return H.mech.t.played
		case 'missingHp10':
			return Math.floor(Math.max(0, p.maxHealth - p.currentHealth) / 10)
		case 'enemyDebuff':
			return debuffStacks(H.enemy.powers)
		case 'item':
			return H.mech.items.length
		default:
			return 0
	}
}

/**
 * @param {object} H host
 * @param {{is: string}} c condition
 * @param {string} key  "first time" key: the card instance id, or the trigger's source key
 */
export function testCondition(H, c, key) {
	const p = H.s.player
	switch (c.is) {
		case 'hpBelow':
			return (p.currentHealth / p.maxHealth) * 100 < c.pct
		case 'handSizeAtLeast':
			return H.s.hand.length >= c.n
		case 'handSizeAtMost':
			return H.s.hand.length <= c.n
		case 'enemyIntendsAttack':
			return (H.mech.intent?.damage || 0) > 0
		case 'enemyHas':
			return (H.enemy.powers[c.kind] || 0) > 0
		case 'handHasCurse':
			return H.s.hand.some(isCurseCard)
		case 'cardsPlayedAtLeast':
			return H.mech.t.played >= c.n
		case 'turnAtLeast':
			return H.s.turn >= c.n
		case 'turnIs':
			return H.s.turn === c.n
		case 'energyLeftAtLeast':
			return p.currentEnergy >= c.n
		case 'noAttackThisTurn':
			return H.mech.t.attack === 0
		case 'notDamagedThisFight':
			return !H.mech.hpLost
		case 'firstTimeThisFight':
			return !H.mech.played.includes(key) && !H.mech.fired[key]
		case 'deckSizeAtMost':
			return H.mech.deckSize <= c.n
		default:
			return false
	}
}

// -------------------------------------------------------------------------------------
// Code-block API (frozen; primitives in, primitives out)
// -------------------------------------------------------------------------------------

const clampInt = (v, lo, hi) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.trunc(v))) : lo)

function makeApi(H, key) {
	let budget = CODE_OP_BUDGET
	const tick = () => {
		if (--budget < 0) throw new RangeError('code block op budget exceeded')
	}
	const api = {
		damage: (n, hits = 1) => {
			tick()
			let dealt = 0
			for (let i = 0; i < clampInt(hits, 1, 3); i++) dealt += hitEnemy(H, clampInt(n, 0, 30))
			return dealt
		},
		block: (n) => (tick(), gainBlock(H, clampInt(n, 0, 25))),
		draw: (n) => (tick(), drawCards(H, clampInt(n, 0, 3))),
		energy: (n) => (tick(), void (H.s.player.currentEnergy += clampInt(n, 0, 2))),
		heal: (n) => (tick(), heal(H, clampInt(n, 0, 15))),
		loseHp: (n) => (tick(), loseHp(H, clampInt(n, 0, 10))),
		power: (kind, n, target = 'enemy') => (tick(), applyPower(H, String(kind), clampInt(n, 0, 3), target === 'self' ? 'self' : 'enemy', false)),
		count: (per) => (tick(), Math.min(SCALE_CAP, scaleCount(H, String(per)))),
		test: (is, params = {}) => (tick(), testCondition(H, {...params, is: String(is)}, key)),
		hp: () => H.s.player.currentHealth,
		currentBlock: () => H.s.player.block,
		maxHp: () => H.s.player.maxHealth,
		enemyHp: () => H.enemy.hp,
		enemyMaxHp: () => H.enemy.maxHp,
		energyLeft: () => H.s.player.currentEnergy,
		handSize: () => H.s.hand.length,
		turn: () => H.s.turn,
		random: () => (tick(), rand(H)),
		repeat: (n, fn) => {
			for (let i = 0; i < clampInt(n, 0, 10); i++) {
				tick()
				fn(i)
			}
		},
	}
	return Object.freeze(api)
}

// -------------------------------------------------------------------------------------
// Effects
// -------------------------------------------------------------------------------------

function applyEffect(H, e, amt, key) {
	switch (e.do) {
		case 'damage':
			if (amt <= 0) return // a scaled hit at 0 does nothing (no bare Strength hit)
			for (let i = 0; i < e.hits; i++) hitEnemy(H, amt)
			return
		case 'block':
			return gainBlock(H, amt)
		case 'draw':
			return void drawCards(H, amt)
		case 'energy':
			H.s.player.currentEnergy += amt
			return
		case 'loseEnergy':
			H.s.player.currentEnergy = Math.max(0, H.s.player.currentEnergy - amt)
			return
		case 'heal':
			return heal(H, amt)
		case 'loseHp':
			return loseHp(H, amt)
		case 'power':
			return applyPower(H, e.kind, amt, e.target === 'self' ? 'self' : 'enemy', e.fight)
		case 'removePower':
			return removePower(H, e.kind, e.target)
		case 'exhaust':
			H.s.exhaustPile.push(...takeFromHand(H, amt, e.pick))
			return
		case 'discard':
			H.s.discardPile.push(...takeFromHand(H, amt, 'random'))
			return
		case 'addCard':
			return addCards(H, e.card, e.pile, amt)
		case 'healNow':
			return // out of combat: handled by the book (afterFight in engine.js)
		default: {
			const run = codeBlockRun(e.do)
			if (!run) return
			try {
				const {do: _id, if: _if, when: _w, scale: _s, ...params} = e
				run(makeApi(H, key), Object.freeze({...params, n: amt}))
			} catch {
				emit(H, `A strange block fizzled (${e.do}).`)
			}
		}
	}
}

/**
 * Resolve a list of canonical effects.
 * @param {object} H host
 * @param {any[]} effects
 * @param {string} key  card instance id or trigger source key (for firstTimeThisFight)
 */
export function resolveEffects(H, effects, key) {
	for (const e of effects ?? []) {
		if (e.when === 'nextTurn') {
			const {when: _w, ...now} = e
			H.mech.delayed.push({at: H.s.turn + 1, effects: [now], key})
			continue
		}
		if (e.if && !testCondition(H, e.if, key)) continue
		const amt = e.scale ? e.n + e.scale.each * Math.min(scaleCount(H, e.scale.per), e.scale.cap) : e.n
		applyEffect(H, e, amt, key)
	}
}

// -------------------------------------------------------------------------------------
// Triggers
// -------------------------------------------------------------------------------------

function matches(H, t, on, info) {
	if (t.on !== on) return false
	if (on === 'onPlay' && t.type !== 'any' && t.type !== info.type) return false
	if (on === 'everyNthTurn' && H.s.turn % t.n !== 0) return false
	return true
}

/** Cards whose triggers are live for an event: zone 'hand' = hand, 'deck' = every pile but exhaust, 'self' = info.card. */
function cardSources(H, on, info) {
	const out = []
	const add = (c) => {
		if (c?.everTriggers) for (const t of c.everTriggers) out.push({t, key: c.id, name: c.name})
	}
	if (on === 'onDraw') add(info.card)
	else if (on === 'turnEnd' || on === 'onPlay' || on === 'firstCardEachTurn') H.s.hand.forEach(add)
	else for (const pile of [H.s.hand, H.s.drawPile, H.s.discardPile]) pile.forEach(add)
	return out
}

/**
 * Fire one trigger event for a fighter: items, active power-card triggers, card triggers
 * (curses), in that order. info: {type?: card type for onPlay, card?: drawn card for onDraw}.
 */
export function fire(H, on, info = {}) {
	H.depth = (H.depth || 0) + 1
	try {
		if (H.depth > MAX_DEPTH) return
		const list = []
		const m = H.mech
		if (!m.items.length && !m.active.length && !m.cardTriggers) return
		for (const it of H.mech.items) for (const [i, t] of it.triggers.entries()) list.push({t, key: `i:${it.id}:${i}`, name: it.name})
		for (const a of H.mech.active) for (const [i, t] of a.triggers.entries()) list.push({t, key: `p:${a.key}:${i}`, name: a.name})
		list.push(...cardSources(H, on, info))
		for (const {t, key, name} of list) {
			if (!matches(H, t, on, info)) continue
			if ((H.firings = (H.firings || 0) + 1) > MAX_FIRINGS) return
			if (t.if && !testCondition(H, t.if, key)) continue
			resolveEffects(H, t.effects, key)
			H.mech.fired[key] = true
			if (name) emit(H, `${name}.`, {src: name})
		}
	} finally {
		H.depth--
	}
}

/** Process queued hpLoss / draw events (from effects run inside the engine or here). */
export function drain(H) {
	for (let guard = 0; guard < 8 && H.mech.pend.length; guard++) {
		const pend = H.mech.pend.splice(0)
		for (const p of pend) {
			if (p === 'hpLoss') fire(H, 'onHpLoss')
			else if (p.startsWith('draw:')) {
				const id = p.slice(5)
				const card = H.s.hand.find((c) => c.id === id)
				if (card) fire(H, 'onDraw', {card})
			}
		}
	}
	H.mech.pend.length = 0
}
