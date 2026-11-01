// EVER mechanics: fast, headless, deterministic balance simulator (GDD_V2 8.3).
//
// Why not run combat/rules directly: one real-engine fight costs milliseconds (immer +
// structuredClone per step); the quick check needs ~150 fights in well under 200 ms.
// So this file replays the engine's arithmetic on plain mutable objects (playCard,
// removeHealth, takeMonsterTurn, drawCards, power decay) and reuses the SAME mechanics
// interpreter and hooks as the real fight (runtime.js + engine.js). sim.test.js checks
// single plays against the real engine so the two cannot drift silently.
//
// A careful greedy bot plays each turn: it tries every playable card on a copy of the
// state and keeps the best by a simple value function (damage, useful Block, HP,
// statuses, follow-up plays). Same seed => same results.
// PURE: no DOM, no timers, no Math.random.
//
// Copyright (C) 2026 the EVER contributors.
// SPDX-License-Identifier: AGPL-3.0-or-later

import {mechAfterEnemyHit, mechAfterPlay, mechDiscardHand, mechEnemyTurnStart, mechRoundEnd, mechSetup, mechTurnEnd, mechTurnStart} from './engine.js'
import {cardTemplate, compileDeckCard} from './compile.js'
import {drawCards, hitEnemy, heal, resolveEffects} from './runtime.js'
import {canonicalJson, hash32, hashId} from './prng.js'
import {normalizeContent} from './schema.js'
import {REFERENCE_DECKS, REFERENCE_ITEMS, SIM_ENEMIES, wardenHpForPages} from './reference.js'

export const SIM_VERSION = 1
const DOUBT_TICK = 2 // combat/rules DOUBT_TICK (GDD 3.3)
const HAND_SIZE = 5
const MAX_ENERGY = 3
const MAX_ROUNDS = 30
const MAX_PLAYS_PER_TURN = 12

/**
 * Bands per offer kind. `win` = GDD_V2 8.3 win-rate bands (points). `power` = bands on the
 * power score (100 x average fight margin: +HP left / 50 on a win, -enemy HP left share on
 * a loss), which keeps moving when the win rate saturates at 0 or 100%.
 * A candidate fails when its power delta leaves the power band, or its win delta goes
 * above the win band's top (+ noise) / below its floor (- noise).
 */
// The gift floors are -4, not GDD 0: in the 8-card late decks even a fair common dilutes
// the deck slightly (measured -5 to -8 points for a 1-energy "Deal 7 damage"), and a
// gift that is merely average must not be rejected. Traps still fail (-12 with noise).
export const SIM_BANDS = Object.freeze({
	common: {win: [-4, 5], power: [-15, 10]},
	uncommon: {win: [-4, 8], power: [-15, 14]},
	rare: {win: [-4, 12], power: [-15, 18]},
	special: {win: [-4, 12], power: [-15, 18]},
	keepsake: {win: [-100, 100], power: [-100, 100]},
	item: {win: [0, 12], power: [-15, 18]},
	token: {win: [0, 12], power: [-15, 18]},
	bargain: {win: [-5, 12], power: [-20, 18]},
	curse: {win: [-20, -3], power: [-40, -2]},
	global: {win: [0, 6], power: [-12, 8]},
})
/** Points of win-rate slack on both ends of a win band (shuffle and dilution noise). */
export const SIM_NOISE = 8
/** Default fights per deck and arm for the quick check (3 decks x 2 arms x 16 = 96 fights). */
export const QUICK_FIGHTS = 16

/**
 * Fast copy of a fighter state for the bot's look-ahead. Card objects are shared: nothing
 * in the sim or the interpreter mutates a card (new cards are fresh objects).
 */
function cloneS(s) {
	const m = s.mech
	return {
		turn: s.turn,
		drawPile: s.drawPile.slice(),
		hand: s.hand.slice(),
		discardPile: s.discardPile.slice(),
		exhaustPile: s.exhaustPile.slice(),
		player: {...s.player, powers: {...s.player.powers}},
		mech: m && {
			...m,
			active: m.active.slice(),
			perm: {...m.perm},
			permE: {...m.permE},
			delayed: m.delayed.slice(),
			played: m.played.slice(),
			fired: {...m.fired},
			t: {...m.t},
			pend: m.pend.slice(),
			ev: [],
			kept: m.kept?.slice(),
		},
	}
}
const cloneW = (w) => ({...w, powers: {...w.powers}})

// -------------------------------------------------------------------------------------
// Engine arithmetic (mirrors vendor/slaytheweb/src/game/actions.js)
// -------------------------------------------------------------------------------------

/** removeHealth on the player: Vulnerable x1.5 then Block. */
function hurtPlayer(p, amount) {
	if (p.powers.vulnerable) amount = Math.floor(amount * 1.5)
	const left = p.block - amount
	if (left < 0) {
		p.block = 0
		p.currentHealth += left
	} else p.block = left
}

/** removeHealth on the enemy without Strength/Weak (dealDamageEqualToBlock). */
function hurtEnemyRaw(w, amount) {
	if (w.hp < 1) return
	if (w.powers.vulnerable) amount = Math.floor(amount * 1.5)
	const left = w.block - amount
	if (left < 0) {
		w.block = 0
		w.hp += left
	} else w.block = left
}

const isUnplayable = (c) => Boolean(c.conditions?.some((x) => x.type === 'unplayable'))

function conditionOk(s, cond) {
	const pct = (s.player.currentHealth / s.player.maxHealth) * 100
	switch (cond.type) {
		case 'unplayable':
			return false
		case 'healthPercentageBelow':
			return pct < cond.percentage
		case 'healthPercentageAbove':
			return pct > cond.percentage
		case 'onlyType':
			return s.hand.every((c) => c.type === cond.cardType)
		default:
			return false
	}
}
const canPlay = (s, c) => s.player.currentEnergy >= c.energy && !(c.conditions ?? []).some((x) => !conditionOk(s, x))

/** The engine's playCard + the mechanics after-play hook, on mutable state. */
export function simPlay(pc, f, card) {
	const s = f.s
	const p = s.player
	const w = pc.warden
	const H = {s, enemy: w, mech: s.mech, seat: f.seat}
	s.hand.splice(s.hand.findIndex((c) => c.id === card.id), 1)
	;(card.exhaust ? s.exhaustPile : s.discardPile).push(card)
	p.currentEnergy -= card.energy
	if (card.block) p.block += card.block
	if (card.type === 'attack' || card.damage) hitEnemy(H, card.damage || 0)
	if (card.powers) {
		for (const [name, stacks] of Object.entries(card.powers)) {
			if (card.target === 'player') p.powers[name] = (p.powers[name] || 0) + stacks
			else if (w.hp >= 1) w.powers[name] = (w.powers[name] || 0) + stacks
		}
	}
	for (const a of card.actions ?? []) {
		if (a.conditions && a.conditions.some((x) => !conditionOk(s, x))) continue
		const prm = a.parameter ?? {}
		switch (a.type) {
			case 'everOps':
				resolveEffects(H, prm.ops, card.id)
				break
			case 'drawCards':
				drawCards(H, prm.amount ?? 5)
				break
			case 'addEnergyToPlayer':
				p.currentEnergy += prm.amount || 1
				break
			case 'dealDamageEqualToBlock':
				if (p.block) hurtEnemyRaw(w, p.block)
				break
			case 'removePlayerDebuffs':
				p.powers.weak = 0
				p.powers.vulnerable = 0
				break
			case 'addHealth':
				heal(H, prm.amount || 0)
				break
			case 'setPower':
				if (prm.target === 'player') p.powers[prm.power] = prm.amount
				else w.powers[prm.power] = prm.amount
				break
			case 'dealDamageEqualToVulnerable':
				if (w.powers.vulnerable) w.hp -= w.powers.vulnerable
				break
			case 'dealDamageEqualToWeak':
				if (w.powers.weak) w.hp -= w.powers.weak
				break
			case 'addRegenEqualToAllDamage':
				p.powers.regen = (p.powers.regen || 0) + (card.damage || 0)
				break
			default:
				throw new RangeError(`sim: unsupported engine action ${a.type}`)
		}
	}
	mechAfterPlay(pc, f, card)
}

const decrease = (powers) => {
	for (const k of Object.keys(powers)) if (powers[k] > 0) powers[k]--
}
const cleanPowers = (powers) => {
	for (const k of Object.keys(powers)) if (!(powers[k] > 0)) delete powers[k]
}

/** The engine's takeMonsterTurn for one intent against the solo fighter. */
function enemyAct(pc, f, intent) {
	const w = pc.warden
	const p = f.s.player
	w.block = 0
	if (w.hp < 1) return
	if (intent.block) w.block += intent.block
	if (intent.damage) {
		let amount = intent.damage
		if (w.powers.weak) amount = Math.floor(amount * 0.75)
		hurtPlayer(p, amount)
	}
	if (intent.vulnerable) p.powers.vulnerable = (p.powers.vulnerable || 0) + intent.vulnerable + 1
	if (intent.weak) p.powers.weak = (p.powers.weak || 0) + intent.weak + 1
}

// -------------------------------------------------------------------------------------
// The bot
// -------------------------------------------------------------------------------------

function incoming(pc, f, intent) {
	let d = intent?.damage || 0
	if (pc.warden.powers.weak) d = Math.floor(d * 0.75)
	if (f.s.player.powers.vulnerable) d = Math.floor(d * 1.5)
	return d
}

/**
 * Value of a state for the bot. Higher is better. withFollow adds what the rest of the
 * turn could still play (used to rank candidate plays, never for "end the turn now").
 */
function value(pc, f, intent, withFollow = true) {
	const w = pc.warden
	const s = f.s
	const p = s.player
	if (w.hp < 1) return 1e6 + p.currentHealth
	if (p.currentHealth < 1) return -1e6
	const inc = incoming(pc, f, intent)
	let v = -w.hp * 1.0 + Math.min(p.block, inc) * 1.3 + p.currentHealth * 1.3
	v += (w.powers.vulnerable || 0) * 2 + (w.powers.weak || 0) * 1.5 + (w.powers.poison || 0) * 1.6
	v += (p.powers.strength || 0) * 3 + (p.powers.regen || 0) * 1 + (p.powers.thorns || 0) * 1
	v -= (p.powers.weak || 0) * 2 + (p.powers.vulnerable || 0) * 2 + (p.powers.poison || 0) * 1.5
	for (const c of s.hand) if (c.name === 'Doubt') v -= DOUBT_TICK
	if (!withFollow) return v
	// What the rest of this turn can still add: best cards by value per Energy.
	let e = p.currentEnergy
	const options = []
	for (const c of s.hand) if (!isUnplayable(c) && c.energy <= e) options.push(c)
	options.sort((a, b) => estimate(b) / Math.max(0.5, b.energy) - estimate(a) / Math.max(0.5, a.energy))
	for (const c of options) {
		if (c.energy > e) continue
		e -= c.energy
		v += 0.9 * estimate(c)
	}
	return v
}

const estimates = new WeakMap()
/** Rough worth of playing a card now (PP-like), cached per card object. */
function estimate(c) {
	if (c.everPP !== undefined) return c.everPP
	const hit = estimates.get(c)
	if (hit !== undefined) return hit
	let x = (c.damage || 0) + (c.block || 0)
	for (const [k, n] of Object.entries(c.powers ?? {})) x += (k === 'vulnerable' ? 2.5 : 2) * n
	for (const a of c.actions ?? []) {
		if (a.type === 'drawCards') x += 2 * (a.parameter?.amount ?? 1)
		else if (a.type === 'addEnergyToPlayer') x += 3 * (a.parameter?.amount ?? 1)
		else x += 3
	}
	estimates.set(c, x)
	return x
}

function botTurn(pc, f, intent) {
	for (let plays = 0; plays < MAX_PLAYS_PER_TURN; plays++) {
		if (pc.warden.hp < 1 || f.s.player.currentHealth < 1) return
		const seen = new Set()
		let best = null
		let bestV = -Infinity
		const stop = value(pc, f, intent, false)
		for (const c of f.s.hand) {
			if (isUnplayable(c) || !canPlay(f.s, c)) continue
			const key = `${c.name}|${c.energy}`
			if (seen.has(key)) continue
			seen.add(key)
			const pc2 = {warden: cloneW(pc.warden), fighters: []}
			const f2 = {seat: f.seat, s: cloneS(f.s)}
			pc2.fighters.push(f2)
			simPlay(pc2, f2, f2.s.hand.find((x) => x.id === c.id))
			const v = value(pc2, f2, intent)
			if (v > bestV + 0.01) {
				bestV = v
				best = {pc2, f2}
			}
		}
		if (!best || value(best.pc2, best.f2, intent, true) <= stop) return
		pc.warden = best.pc2.warden
		f.s = best.f2.s
		pc.fighters[0] = f
	}
}

// -------------------------------------------------------------------------------------
// One fight
// -------------------------------------------------------------------------------------

/**
 * Simulate one solo fight.
 * @param {{cards: any[], items?: any[], tokens?: string[], content?: any, enemy: {name?: string, hp: number, intents: any[]}, hp?: number, maxHp?: number, seed?: string|number}} o
 *   cards: engine card objects (with ids); items: [{id, def}] or ids in content
 * @returns {{won: boolean, rounds: number, hpLeft: number, enemyHpLeft: number, firstTurnKill: boolean}}
 */
export function simulateFight({cards, items = [], tokens = [], content, enemy, hp = 50, maxHp = 50, seed = 1}) {
	const pc = {warden: {name: enemy.name ?? 'Enemy', hp: enemy.hp, maxHp: enemy.hp, block: 0, powers: {...(enemy.powers ?? {})}}, fighters: []}
	// Keyed shuffle (see runtime drawCards): the same card id lands in the same place
	// whether or not the candidate is in the deck.
	const deck = cards.map((c) => [hash32(`${seed}|0|${c.id}`), c]).sort((a, b) => a[0] - b[0]).map((x) => x[1])
	const s = {
		turn: 1,
		drawPile: deck,
		hand: [],
		discardPile: [],
		exhaustPile: [],
		player: {maxEnergy: MAX_ENERGY, currentEnergy: MAX_ENERGY, maxHealth: maxHp, currentHealth: Math.max(1, Math.min(hp, maxHp)), block: 0, powers: {}},
	}
	const f = {seat: 0, s}
	pc.fighters.push(f)
	s.hand = s.drawPile.splice(0, HAND_SIZE)
	mechSetup(pc, f, {content, items, tokens, seed: typeof seed === 'number' ? seed : 0})
	f.s.mech.ks = String(seed)
	const intents = enemy.intents
	let round = 1
	let firstTurnKill = false
	const dead = () => f.s.player.currentHealth < 1
	for (; round <= MAX_ROUNDS; round++) {
		const intent = intents[(round - 1) % intents.length]
		if (round > 1) {
			const H = {s: f.s, enemy: pc.warden, mech: f.s.mech, seat: 0}
			drawCards(H, HAND_SIZE)
			// The engine's newTurn draw queues nothing; mechTurnStart fires onDraw for the hand.
			f.s.mech.pend = f.s.mech.pend.filter((x) => !x.startsWith('draw:'))
			f.s.turn++
			f.s.player.currentEnergy = MAX_ENERGY
			f.s.player.block = 0
		}
		mechTurnStart(pc, f, intent)
		if (dead()) break
		if (pc.warden.hp < 1) break
		botTurn(pc, f, intent)
		if (pc.warden.hp < 1) {
			if (round === 1 && pc.warden.hp < 1) firstTurnKill = true
			break
		}
		if (dead()) break
		// End of turn: mechanics, Doubt tick, discard (keeping Retain).
		mechTurnEnd(pc, f)
		const doubts = f.s.hand.filter((c) => c.name === 'Doubt').length
		if (doubts) f.s.player.currentHealth -= doubts * DOUBT_TICK
		f.s = mechDiscardHand(f.s, (st) => ({...st, discardPile: [...st.discardPile, ...st.hand], hand: []}), {copy: false})
		pc.fighters[0] = f
		if (dead()) break
		// Enemy turn.
		mechEnemyTurnStart(pc)
		if (pc.warden.hp < 1) break
		const before = {hp: f.s.player.currentHealth, block: f.s.player.block}
		enemyAct(pc, f, intent)
		mechAfterEnemyHit(pc, f, before, intent)
		if (dead() || pc.warden.hp < 1) break
		decrease(f.s.player.powers)
		decrease(pc.warden.powers)
		cleanPowers(pc.warden.powers)
		mechRoundEnd(pc)
	}
	const won = pc.warden.hp < 1 && !dead()
	return {won, rounds: Math.min(round, MAX_ROUNDS), hpLeft: Math.max(0, f.s.player.currentHealth), enemyHpLeft: Math.max(0, pc.warden.hp), firstTurnKill}
}

// -------------------------------------------------------------------------------------
// Decks and the balance check
// -------------------------------------------------------------------------------------

const normDef = (def) => (def && def.v ? def : normalizeContent(def).def)

/** Engine cards for book-style entries ({id, upgraded} engine names, {def}, or generated ids in content). */
export function deckCards(entries, content) {
	return entries.map((en, i) => {
		const uid = `c${i}`
		const def = en.def ? normDef(en.def) : null
		const gen = compileDeckCard({uid, id: en.id, upgraded: Boolean(en.upgraded), def}, content)
		if (gen) return gen
		const tpl = cardTemplate(en.id, {content, upgraded: Boolean(en.upgraded)})
		if (!tpl) throw new RangeError(`sim: unknown card ${en.id}`)
		return {...tpl, id: uid}
	})
}

function runDeck({entries, items, tokens, content, enemy, hp, fights, seed}) {
	const cards = deckCards(entries, content)
	let wins = 0
	let margin = 0
	let rounds = 0
	let hpLeft = 0
	let minRounds = Infinity
	let firstTurnKills = 0
	for (let i = 0; i < fights; i++) {
		const r = simulateFight({cards, items, tokens, content, enemy, hp, maxHp: 50, seed: `${seed}|${i}`})
		if (r.won) {
			wins++
			hpLeft += r.hpLeft
		}
		margin += r.won ? r.hpLeft / 50 : -r.enemyHpLeft / enemy.hp
		rounds += r.rounds
		minRounds = Math.min(minRounds, r.rounds)
		if (r.firstTurnKill) firstTurnKills++
	}
	return {win: (100 * wins) / fights, power: (100 * margin) / fights, avgRounds: rounds / fights, minRounds, hpLeft: wins ? hpLeft / wins : 0, firstTurnKills}
}

const round1 = (x) => Math.round(x * 10) / 10

/**
 * Baseline ("without") results are the same for every candidate checked against the same
 * deck, enemy, HP, fights and seed, so they are memoized (bounded). Halves the quick check.
 */
const BASE_CACHE = new Map()
const BASE_CACHE_MAX = 48
function cachedBase(args) {
	const key = canonicalJson({d: args.entries, i: args.items, e: args.enemy, h: args.hp, f: args.fights, s: args.seed, c: args.contentKey})
	const hit = BASE_CACHE.get(key)
	if (hit) return hit
	const r = runDeck(args)
	if (BASE_CACHE.size >= BASE_CACHE_MAX) BASE_CACHE.delete(BASE_CACHE.keys().next().value)
	BASE_CACHE.set(key, r)
	return r
}

/**
 * Balance check for one candidate (GDD_V2 8.3 + the CEO brief: "against the run's final
 * enemy"). Adds the candidate to each reference deck (cards and curses into the deck,
 * items as equipment, tokens for the fight), plays `fights` seeded fights per deck with and
 * without it against the final enemy, and compares. Deterministic for the same inputs.
 * @param {object} def  canonical (validated) content def
 * @param {{offer?: string, bands?: {win: number[], power: number[]}, decks?: {enemy?: any, hp?: number, decks: any[]}, enemy?: string|{name?: string, hp: number, intents: any[]}, pages?: number, stage?: 'early'|'mid'|'late', fights?: number, seed?: string, content?: any}} [o]
 *   enemy: the run's final enemy (default Warden v2 with HP for `pages`); stage: use the
 *   GDD 8.3 per-page decks and enemy instead (diagnostics).
 * @returns {{ok: boolean, bands: {win: number[], power: number[]}, deltaWin: number, deltaPower: number, perDeck: any[], reasons: string[], ms: number, fights: number}}
 */
export function balanceCheck(def, {offer, bands, decks, enemy, pages = 9, stage, fights = QUICK_FIGHTS, seed = 'ever-sim', content} = {}) {
	const t0 = typeof performance !== 'undefined' ? performance.now() : 0
	const set = decks ?? REFERENCE_DECKS[stage ?? 'late']
	let foe = enemy ?? set.enemy
	if (typeof foe === 'string') foe = SIM_ENEMIES[foe]
	if (!enemy && !decks && !stage) foe = {...SIM_ENEMIES.wardenV2, hp: wardenHpForPages(pages)}
	const simId = {card: 'g:c-sim000', curse: 'g:u-sim000', item: 'g:i-sim000', token: 'g:t-sim000'}[def.kind]
	const withContent = {defs: {...(content?.defs ?? {}), [simId]: def}}
	const bandKey = offer === 'bargain' || offer === 'curse' || offer === 'global' ? offer : def.kind === 'card' ? def.rarity : def.kind
	const b = bands ?? SIM_BANDS[bandKey] ?? SIM_BANDS.rare
	const perDeck = []
	const reasons = []
	const contentKey = content?.defs ? hashId(canonicalJson(content.defs), 8) : ''
	const itemsOf = (d) => (d.items ?? []).map((k) => (typeof k === 'string' && REFERENCE_ITEMS[k] ? {id: `ref:${k}`, def: normDef(REFERENCE_ITEMS[k])} : k))
	for (const d of set.decks) {
		const common = {content: withContent, enemy: foe, hp: set.hp ?? 40, fights, seed: `${seed}|${d.name}`}
		const entries = [...d.cards]
		const items = itemsOf(d)
		const tokens = []
		if (def.kind === 'card' || def.kind === 'curse') entries.push({id: simId})
		else if (def.kind === 'item') items.push({id: simId, def})
		else if (def.kind === 'token') tokens.push(simId)
		const base = cachedBase({...common, entries: d.cards, items: itemsOf(d), tokens: [], contentKey})
		const withIt = runDeck({...common, entries, items, tokens})
		perDeck.push({deck: d.name, base, with: withIt, deltaWin: round1(withIt.win - base.win), deltaPower: round1(withIt.power - base.power)})
		if (withIt.firstTurnKills > 0 && foe.hp >= 100) reasons.push(`${d.name}: kills the ${foe.name ?? 'enemy'} in one turn`)
		if (withIt.avgRounds < 3 && foe.hp >= 50) reasons.push(`${d.name}: fights end in ${round1(withIt.avgRounds)} turns on average (must be 3 or more)`)
	}
	const avg = (k) => round1(perDeck.reduce((a, p) => a + p[k], 0) / perDeck.length)
	const deltaWin = avg('deltaWin')
	const deltaPower = avg('deltaPower')
	if (deltaPower < b.power[0]) reasons.push(`power moves ${deltaPower} (band ${b.power[0]} to ${b.power[1]})`)
	if (deltaPower > b.power[1]) reasons.push(`power moves +${deltaPower} (band ${b.power[0]} to ${b.power[1]})`)
	if (deltaWin < b.win[0] - SIM_NOISE) reasons.push(`win rate moves ${deltaWin} points (band ${b.win[0]} to ${b.win[1]})`)
	if (deltaWin > b.win[1] + SIM_NOISE) reasons.push(`win rate moves +${deltaWin} points (band ${b.win[0]} to ${b.win[1]})`)
	const ms = typeof performance !== 'undefined' ? round1(performance.now() - t0) : 0
	return {ok: reasons.length === 0, bands: b, deltaWin, deltaPower, perDeck, reasons, ms, fights}
}
