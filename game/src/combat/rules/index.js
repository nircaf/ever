// EVER combat rules: pure adapter around the vendored Slay the Web engine.
// OWNER: combat engineer. Imported by the browser (solo) AND by the room server
// (server/src/room.js), so: no DOM, no 'three', no window/document/localStorage.
// Contract: game/src/core/contracts.js section 6, docs/TECH.md section 5.
//
// Engine changes the GDD asks for are made HERE, at runtime, so vendor/slaytheweb stays
// byte-identical to upstream a108c3e (see vendor/slaytheweb/NOTICE.md):
//   (a) Doubt card  -> pushed into the engine's exported `cards` / `cardUpgrades`
//   (b) 'unplayable' condition -> added to the engine's exported `allConditions`
//   (c) Doubt tick before discardHand, (d) death at HP < 1, (f) tokens after state
//       creation -> done by this adapter's own end-turn / createPartyCombat wrappers
//   (e) maxHealth 50 + one-node dungeon -> built here per fight
// Plus three runtime fixes for upstream quirks that would otherwise bite EVER:
//   - Pommel Strike's and Intimidate's upgrade functions mutate the BASE card (and the
//     engine calls every upgrade once at import), so the base cards silently became
//     "Draw 2" / "2 Weak". ensureEngine() restores the bases and wraps every upgrade
//     function to work on a deep copy.
//   - dealDamageEqualToBlock (Body Slam) returns undefined with 0 Block, which would
//     crash playCard. Wrapped to return the state unchanged.
//   - Card objects in our states are plain JSON (immer freezes them), and playCard
//     writes to card.actions[].parameter, so every play hands the engine a fresh copy.
//
// How a party fight works (GDD 7.3; solo is a party of one):
//   - Each fighter owns one Slay the Web state (piles, hand, player: energy/block/HP/powers).
//   - There is ONE shared Warden (hp, block, powers) kept on the PartyCombat. Before an
//     engine action runs for a fighter, the shared Warden is put into that fighter's
//     one-node dungeon; afterwards it is read back. So card effects (damage, block,
//     Vulnerable, Weak, draw, exhaust) are the engine's own playCard / useCardActions.
//   - The Warden's turn runs the engine's takeMonsterTurn once per living, connected
//     fighter with that fighter's intent step, and sums Brace block into the shared block.
//
// Copyright (C) 2026 the EVER contributors. Slay the Web (C) Oskar Rough and contributors.
// SPDX-License-Identifier: AGPL-3.0-or-later

import {cards, cardUpgrades} from '../../../../vendor/slaytheweb/src/content/cards.js'
import allConditions, {canPlay} from '../../../../vendor/slaytheweb/src/game/conditions.js'
import {createCard} from '../../../../vendor/slaytheweb/src/game/cards.js'
import actions from '../../../../vendor/slaytheweb/src/game/actions.js'
import {Monster} from '../../../../vendor/slaytheweb/src/game/monster.js'
import {MonsterRoom, StartRoom} from '../../../../vendor/slaytheweb/src/game/rooms.js'
import {produce} from 'immer'
import doubt, {upgrade as doubtUpgrade} from './content/doubt.js'
import {WARDEN_HP_BY_PARTY, TURN_TIMER_MS, CURSE_ID, seededRandom} from '../../core/contracts.js'
// Generated content (cards, items, curses, tokens) from the mechanics engine. The hooks
// below are its ONLY entry points into combat; see docs/MECHANICS.md section 5.
import {compileDeckCard} from '../../mechanics/compile.js'
import {isGeneratedId} from '../../mechanics/schema.js'
import * as mech from '../../mechanics/engine.js'

/** Bump when the PartyCombat shape changes (the room may persist it). */
export const COMBAT_VERSION = 1
/** GDD 3.3: Doubt tick, per Doubt in hand at end of turn. Ignores block. */
export const DOUBT_TICK = 2
/** GDD 3.4 */
export const WARD_BLOCK = 8
export const WHETSTONE_VULNERABLE = 2
export const HAND_SIZE = 5
export const MAX_ENERGY = 3

const plain = (x) => JSON.parse(JSON.stringify(x))

let registered = false
/** Idempotent: registers EVER content into the engine's shared tables. */
export function ensureEngine() {
	if (registered) return
	registered = true
	if (!cards.some((c) => c.name === doubt.name)) {
		cards.push(doubt)
		cardUpgrades[doubt.name] = doubtUpgrade
	}
	allConditions.unplayable = () => false
	mech.installEngineExtensions() // registers the 'everOps' engine action (generated cards)

	// Upstream quirk: upgrade fns that mutate their input. Restore the bases ...
	const pommel = cards.find((c) => c.name === 'Pommel Strike')
	if (pommel) pommel.actions = [{type: 'drawCards', parameter: {amount: 1}}]
	const intimidate = cards.find((c) => c.name === 'Intimidate')
	if (intimidate) intimidate.powers = {weak: 1}
	// ... and make every upgrade work on a deep copy from now on.
	for (const name of Object.keys(cardUpgrades)) {
		const fn = cardUpgrades[name]
		if (typeof fn !== 'function' || fn.__everSafe) continue
		const safe = (card) => fn(structuredClone(card))
		safe.__everSafe = true
		cardUpgrades[name] = safe
	}
	// Upstream quirk: Body Slam with 0 Block returns undefined.
	const dealBlock = actions.dealDamageEqualToBlock
	if (!dealBlock.__everSafe) {
		const safe = (state, props) => dealBlock(state, props) ?? state
		safe.__everSafe = true
		actions.dealDamageEqualToBlock = safe
	}
}
ensureEngine()

/** GDD 4. Intent steps 1..4 in engine form, plus the UI names (GDD 6 copy). */
export const ENEMIES = Object.freeze({
	ashWarden: Object.freeze({
		name: 'The Ash Warden',
		hpByParty: WARDEN_HP_BY_PARTY,
		intents: Object.freeze([
			Object.freeze({damage: 12}), // 1 Cleave 12
			Object.freeze({damage: 8, block: 10}), // 2 Brace 8 + Block 10
			Object.freeze({damage: 6, weak: 1}), // 3 Smother 6 + Weak
			Object.freeze({damage: 20}), // 4 Ember Slam 20
		]),
		intentNames: Object.freeze(['Cleave', 'Brace', 'Smother', 'Ember Slam']),
	}),
	// v2 path enemies (GDD_V2 7, 13; party HP x1 / x2.2 / x3.3 / x4.4, Warden 17.6). Added by
	// the world + systems engineer so seeded books can be played end to end; Combat owns
	// tuning, the Warden aspects/twists and Marks (docs/TECH.md 10).
	ashMotes: Object.freeze({
		name: 'Ash Motes',
		hpByParty: Object.freeze([16, 35, 53, 70]),
		intents: Object.freeze([Object.freeze({damage: 4}), Object.freeze({damage: 6}), Object.freeze({damage: 3, weak: 1})]),
		intentNames: Object.freeze(['Flick', 'Flick', 'Smoulder']),
	}),
	cinderHound: Object.freeze({
		name: 'Cinder Hound',
		hpByParty: Object.freeze([32, 70, 106, 141]),
		intents: Object.freeze([Object.freeze({damage: 7}), Object.freeze({damage: 5, vulnerable: 1}), Object.freeze({damage: 10})]),
		intentNames: Object.freeze(['Bite', 'Snarl', 'Lunge']),
	}),
	ironHusk: Object.freeze({
		name: 'The Iron Husk',
		hpByParty: Object.freeze([52, 114, 172, 229]),
		intents: Object.freeze([Object.freeze({damage: 7, block: 8}), Object.freeze({damage: 13}), Object.freeze({damage: 6, weak: 1, vulnerable: 1}), Object.freeze({damage: 16})]),
		intentNames: Object.freeze(['Guard', 'Rake', 'Rust', 'Crush']),
	}),
	wardenV2: Object.freeze({
		name: 'The Ash Warden',
		hpByParty: Object.freeze([120, 270, 410, 545]),
		intents: Object.freeze([Object.freeze({damage: 14}), Object.freeze({damage: 9, block: 12}), Object.freeze({damage: 7, weak: 1}), Object.freeze({damage: 23})]),
		intentNames: Object.freeze(['Cleave', 'Brace', 'Smother', 'Ember Slam']),
	}),
})

/** Number of intents in an enemy's fixed cycle (4 for the Warden). */
const cycleOf = (enemyId) => ENEMIES[enemyId]?.intents.length ?? 4

/** Intent step (1..4) for fighter k (0-based, seat order) in a round (1-based). GDD 7.3. */
export const intentStep = (round, k, cycle = 4) => ((round - 1 + k) % cycle) + 1

/**
 * GDD 6 intent label: "Cleave 12" / "Brace 8, Block 10" / "Smother 6, Weak" / "Ember Slam 20".
 * @param {{step: number, damage?: number, block?: number, weak?: number}} intent
 * @param {string} [enemyId]
 */
export function intentLabel(intent, enemyId = 'ashWarden') {
	const e = ENEMIES[enemyId] ?? ENEMIES.ashWarden
	const name = e.intentNames[intent.step - 1]
	if (enemyId === 'ashWarden') {
		if (intent.step === 2) return `${name} ${intent.damage}, Block ${intent.block}`
		if (intent.step === 3) return `${name} ${intent.damage}, Weak`
		return `${name} ${intent.damage}`
	}
	// v2 enemies: built from the intent's own fields (same wording as the Warden's).
	const parts = [`${name} ${intent.damage}`]
	if (intent.block) parts.push(`Block ${intent.block}`)
	if (intent.weak) parts.push('Weak')
	if (intent.vulnerable) parts.push('Vulnerable')
	return parts.join(', ')
}

/**
 * Engine card for a book DeckCard ({uid, id, upgraded}); its instance id is the book uid.
 * Generated cards (`id: 'g:...'`, or an inline `def`) are compiled from `content`.
 */
export function engineCard(deckCard, content) {
	const gen = compileDeckCard(deckCard, content)
	if (gen) return gen
	const c = plain(createCard(deckCard.id, deckCard.upgraded))
	delete c.image
	if (deckCard.uid) c.id = deckCard.uid
	return c
}

/** Engine Monster for an enemy id and party size. */
export function createEnemy(enemyId, partySize = 1) {
	const e = ENEMIES[enemyId]
	if (!e) throw new RangeError(`unknown enemy ${enemyId}`)
	return Monster({name: e.name, hp: e.hpByParty[Math.max(0, Math.min(3, partySize - 1))], intents: e.intents.map((i) => ({...i}))})
}

/** A minimal one-node dungeon (start -> monster), same shape the engine reads. */
function oneNodeDungeon(monster) {
	return {
		id: 'ever-ash-gate',
		graph: [
			[{id: 'n0', type: 'start', room: StartRoom(), edges: ['n1'], didVisit: true}],
			[{id: 'n1', type: 'M', room: MonsterRoom(monster), edges: [], didVisit: true}],
		],
		paths: [],
		x: 0,
		y: 1,
		pathTaken: [[0, 0], [0, 1]],
	}
}

function shuffleWith(arr, rand) {
	const a = arr.slice()
	for (let m = a.length; m; ) {
		const i = Math.floor(rand() * m--)
		;[a[m], a[i]] = [a[i], a[m]]
	}
	return a
}

/**
 * One full Slay the Web state for one fighter, with a one-node dungeon holding `monster`,
 * 50 max HP from the book and 5 cards drawn. (Kept for tests/tools; party combat stores
 * a slimmer state and attaches the shared Warden only while the engine runs.)
 */
export function createFighterState(book, monster, rand, content) {
	let state = actions.createNewState()
	const deck = book.deck.map((c) => engineCard(c, content))
	state = produce(state, (d) => {
		d.dungeon = oneNodeDungeon(monster)
		d.deck = deck
		d.drawPile = rand ? shuffleWith(deck, rand) : shuffleWith(deck, Math.random)
		d.player.maxHealth = book.maxHp
		d.player.currentHealth = Math.max(1, Math.min(book.hp, book.maxHp))
		d.createdAt = 0
	})
	return actions.drawCards(state, {amount: HAND_SIZE})
}

// -------------------------------------------------------------------------------------
// Party combat (GDD 7.3). PartyCombat is plain JSON.
// -------------------------------------------------------------------------------------

/**
 * @typedef {object} PcFighter
 * @prop {number} seat
 * @prop {string} name
 * @prop {object} s            slim engine state: {turn, drawPile, hand, discardPile, exhaustPile, player}
 * @prop {boolean} ended       ended this round (or auto-ended)
 * @prop {boolean} dead        HP < 1: out of this fight, book closed
 * @prop {boolean} removed     seat expired (120 s) mid-fight: out, not dead
 * @prop {boolean} connected
 * @prop {boolean} tip         Marcus's Slam tip heard (GDD 2.3)
 * @prop {string[]} tokens     spent at the start of this fight
 * @prop {number} deckSize
 */

const ENGINE_KEYS = ['turn', 'drawPile', 'hand', 'discardPile', 'exhaustPile', 'player', 'mech']

/** Attach the shared Warden to a slim fighter state so engine actions can run on it. */
function withRoom(pc, s) {
	const w = pc.warden
	const m = Monster({name: w.name, hp: w.maxHp, intents: ENEMIES[pc.enemyId].intents.map((i) => ({...i}))})
	m.currentHealth = w.hp
	m.block = w.block
	m.powers = {...w.powers}
	return {...s, deck: [], dungeon: oneNodeDungeon(m), createdAt: 0, endedAt: undefined, won: false, didCheat: false}
}
/** Read the Warden back from an engine state into pc.warden and return the slim state. */
function fromRoom(pc, state) {
	const m = state.dungeon.graph[1][0].room.monsters[0]
	pc.warden.hp = m.currentHealth
	pc.warden.block = m.block
	pc.warden.powers = clean(m.powers)
	const slim = {}
	for (const k of ENGINE_KEYS) if (state[k] !== undefined) slim[k] = plain(state[k])
	return slim
}
const decreasePowers = (powers) => Object.fromEntries(Object.entries(powers || {}).map(([k, v]) => [k, v > 0 ? v - 1 : v]))
const clean = (powers) => Object.fromEntries(Object.entries(powers || {}).filter(([, v]) => v > 0))

const active = (f) => !f.dead && !f.removed
const fighterOf = (pc, seat) => pc.fighters.find((f) => f.seat === seat)

/**
 * Start a fight. Books are only READ. Tokens: pass `tokens` per fighter (the list that
 * spendTokensForCombat returned); if omitted, `book.tokens` is used.
 * Start-of-fight events (token lines) are in pc.startEvents.
 * @param {{fighters: {seat: number, book: any, name?: string, tokens?: string[]}[], enemyId?: string, seed?: number, now?: number}} opts
 * @returns {any} PartyCombat
 */
export function createPartyCombat({fighters, enemyId = 'ashWarden', seed, now = Date.now()}) {
	ensureEngine()
	const e = ENEMIES[enemyId]
	if (!e) throw new RangeError(`unknown enemy ${enemyId}`)
	if (!Array.isArray(fighters) || fighters.length < 1 || fighters.length > 4) throw new RangeError('1 to 4 fighters')
	const rand = seed === undefined ? Math.random : seededRandom(seed)
	const sorted = [...fighters].sort((a, b) => a.seat - b.seat)
	const monster = createEnemy(enemyId, sorted.length)
	const pc = {
		v: COMBAT_VERSION,
		enemyId,
		round: 1,
		startedAt: now,
		warden: {name: e.name, hp: monster.currentHealth, maxHp: monster.maxHealth, block: 0, powers: {}},
		fighters: [],
		intents: [],
		timerEndsAt: null,
		over: null,
		startEvents: [],
	}
	for (const f of sorted) {
		const book = f.book
		const tokens = [...(f.tokens ?? book.tokens ?? [])]
		const content = f.content ?? book.content
		const full = createFighterState(book, monster, rand, content)
		const slim = {}
		for (const k of ENGINE_KEYS) if (full[k] !== undefined) slim[k] = plain(full[k])
		let s = slim
		// GDD 3.4 tokens, applied after the state exists and cards are drawn.
		if (tokens.includes('ember')) {
			s = actions.addEnergyToPlayer(s, {amount: 1})
			pc.startEvents.push({k: 'token', seat: f.seat, text: 'Ember burns: +1 Energy.'})
		}
		if (tokens.includes('ward')) {
			s = produce(s, (d) => {
				d.player.block = WARD_BLOCK
			})
			pc.startEvents.push({k: 'token', seat: f.seat, text: 'Ward holds: 8 Block.'})
		}
		if (tokens.includes('whetstone')) {
			pc.warden.powers.vulnerable = Math.max(pc.warden.powers.vulnerable || 0, WHETSTONE_VULNERABLE)
			pc.startEvents.push({k: 'token', seat: f.seat, text: 'Whetstone: the Warden is Vulnerable.'})
		}
		const fighter = {
			seat: f.seat,
			name: String(f.name ?? `Reader ${f.seat + 1}`).slice(0, 24),
			s: plain(s),
			ended: false,
			dead: false,
			removed: false,
			connected: true,
			tip: Boolean(book.marcus?.flags?.tip),
			tokens,
			deckSize: book.deck.length,
		}
		pc.fighters.push(fighter)
		// Mechanics: items, generated tokens, fight-start triggers (docs/MECHANICS.md 5).
		const genTokens = tokens.filter(isGeneratedId)
		pc.startEvents.push(...mech.mechSetup(pc, fighter, {content, items: f.items ?? book.items, tokens: genTokens, seed: seed ?? 0}))
	}
	setIntents(pc)
	mechTurnStarts(pc, pc.startEvents)
	pc.startEvents.unshift({k: 'round', amount: 1})
	return pc
}

/** Base (unmodified) Warden intent against one fighter this round, for mechanics conditions. */
function baseIntentFor(pc, seat) {
	const i = pc.intents.find((x) => x.seat === seat)
	return i ? ENEMIES[pc.enemyId].intents[i.step - 1] : null
}

/** Mechanics turn-start hooks for every active, connected fighter, then death checks. */
function mechTurnStarts(pc, events) {
	for (const f of pc.fighters) {
		if (!active(f) || !f.connected || f.away) continue
		events.push(...mech.mechTurnStart(pc, f, baseIntentFor(pc, f.seat)))
		checkDeath(pc, f, events)
	}
	if (!pc.fighters.some(active)) finish(pc, false, events)
}

function setIntents(pc) {
	pc.intents = pc.fighters.filter(active).map((f, k) => ({seat: f.seat, step: intentStep(pc.round, k, cycleOf(pc.enemyId))}))
}

const err = (pc, error) => ({pc, events: [], error})

/**
 * One authoritative step. Never mutates `pc`; returns a new one.
 * @param {any} pc
 * @param {number} seat
 * @param {{type: 'play', cardId: string, target?: string}|{type: 'end'}|{type: 'disconnect'}|{type: 'reconnect'}|{type: 'remove'}} action
 * @param {number} [now]
 * @returns {{pc: any, events: any[], error?: string}}
 *   error: 'over' | 'not_in_fight' | 'not_your_turn' | 'no_card' | 'unplayable' | 'energy' | 'bad_target' | 'bad_action'
 */
export function combatStep(pc0, seat, action, now = Date.now()) {
	if (!pc0 || pc0.over) return err(pc0, 'over')
	const pc = structuredClone(pc0)
	const f = fighterOf(pc, seat)
	if (!f || !action || typeof action.type !== 'string') return err(pc0, f ? 'bad_action' : 'not_in_fight')
	const events = []
	switch (action.type) {
		case 'play': {
			if (!active(f)) return err(pc0, 'not_in_fight')
			if (f.ended || !f.connected) return err(pc0, 'not_your_turn')
			const card = f.s.hand.find((c) => c.id === action.cardId)
			if (!card) return err(pc0, 'no_card')
			const target = resolveTarget(card, action.target)
			if (!target) return err(pc0, 'bad_target')
			if (card.conditions?.some((c) => c.type === 'unplayable')) return err(pc0, 'unplayable')
			if (f.s.player.currentEnergy < card.energy) return err(pc0, 'energy')
			if (!canPlay(f.s, card)) return err(pc0, 'unplayable')
			const before = {hp: pc.warden.hp, block: pc.warden.block, pBlock: f.s.player.block, pHp: f.s.player.currentHealth}
			const state = actions.playCard(withRoom(pc, f.s), {card: liveCard(card), target})
			f.s = fromRoom(pc, state)
			events.push({k: 'play', seat, text: baseName(card.name), cardId: card.id})
			events.push(...mech.mechAfterPlay(pc, f, card))
			const dmg = before.hp - pc.warden.hp
			const blocked = Math.max(0, before.block - pc.warden.block)
			if (dmg > 0 || blocked > 0) events.push({k: 'damage', seat: -1, by: seat, amount: dmg, blocked})
			const gained = f.s.player.block - before.pBlock
			if (gained > 0) events.push({k: 'block', seat, amount: gained})
			if (pc.warden.hp < 1) {
				events.push(...mech.mechOnKill(pc, f))
				pc.warden.hp = 0
				finish(pc, true, events)
			} else {
				// Generated cards and triggers can cost HP mid-turn (Lose HP, Thorns).
				checkDeath(pc, f, events)
				if (f.dead) maybeResolveRound(pc, events)
			}
			break
		}
		case 'end': {
			if (!active(f)) return err(pc0, 'not_in_fight')
			if (f.ended) return err(pc0, 'not_your_turn')
			endFighter(pc, f, events, true)
			events.push({k: 'end', seat})
			if (!pc.timerEndsAt && pc.fighters.some((x) => active(x) && x.connected && !x.ended)) pc.timerEndsAt = now + TURN_TIMER_MS
			maybeResolveRound(pc, events)
			break
		}
		case 'disconnect': {
			if (!f.connected) return {pc: pc0, events: []}
			f.connected = false
			if (active(f) && !f.ended) {
				f.ended = true
				f.away = true // paused, not a real end: no Doubt tick, hand kept
			}
			events.push({k: 'away', seat})
			maybeResolveRound(pc, events)
			break
		}
		case 'reconnect': {
			if (f.connected) return {pc: pc0, events: []}
			f.connected = true
			if (active(f) && f.away) {
				f.ended = false
				f.away = false
			}
			events.push({k: 'back', seat})
			break
		}
		case 'remove': {
			if (f.removed || f.dead) return {pc: pc0, events: []}
			f.removed = true
			f.connected = false
			events.push({k: 'removed', seat})
			if (!pc.fighters.some(active)) finish(pc, false, events)
			else maybeResolveRound(pc, events)
			break
		}
		default:
			return err(pc0, 'bad_action')
	}
	return {pc, events}
}

/**
 * The engine's playCard writes into card.actions[].parameter, and immer would freeze a
 * plain-object card once it lands in the discard pile. Upstream cards are class
 * instances (which immer leaves alone), so hand the engine a fresh class instance.
 */
class LiveCard {}
const liveCard = (card) => Object.assign(new LiveCard(), structuredClone(card))

const baseName = (n) => String(n).replace(/\+$/, '')

/** STW target string for a card; validates an optional client-supplied target. */
function resolveTarget(card, requested) {
	const legal = card.target === 'player' ? ['player'] : card.target === 'allEnemies' ? ['allEnemies', 'enemy0'] : ['enemy0']
	if (requested === undefined || requested === null || requested === '') return legal[0]
	return legal.includes(requested) ? legal[0] === 'allEnemies' ? 'allEnemies' : requested : null
}

/** End one fighter's turn: Doubt tick (GDD 3.3, ignores block), then discard the hand. */
function endFighter(pc, f, events, real) {
	if (real) {
		events.push(...mech.mechTurnEnd(pc, f))
		const doubts = f.s.hand.filter((c) => c.name === CURSE_ID).length
		if (doubts > 0) {
			const amount = doubts * DOUBT_TICK
			f.s = plain(
				produce(f.s, (d) => {
					d.player.currentHealth -= amount
				}),
			)
			events.push({k: 'doubt', seat: f.seat, amount, text: 'Doubt gnaws at you. (-2 HP)'})
		}
		f.s = mech.mechDiscardHand(f.s, actions.discardHand) // keeps Retain cards
	}
	f.ended = true
	f.away = false
	checkDeath(pc, f, events)
}

function checkDeath(pc, f, events) {
	if (!f.dead && f.s.player.currentHealth < 1) {
		f.dead = true
		f.ended = true
		events.push({k: 'death', seat: f.seat})
	}
}

/** When every active fighter has ended (and someone is connected), the Warden acts. */
function maybeResolveRound(pc, events) {
	if (pc.over) return
	const live = pc.fighters.filter(active)
	if (live.length === 0) return finish(pc, false, events)
	if (live.some((f) => !f.ended)) return
	if (!live.some((f) => f.connected)) return // everyone away: wait for a reconnect or removal
	wardenTurn(pc, events)
}

function wardenTurn(pc, events) {
	// The engine resets monster block at the start of its action; Brace block from every
	// intent this round adds into the ONE shared block (GDD 7.3).
	let block = 0
	pc.warden.block = 0
	events.push(...mech.mechEnemyTurnStart(pc)) // Warden Poison/Regen tick
	if (pc.warden.hp < 1) {
		pc.warden.hp = 0
		return finish(pc, true, events)
	}
	for (const intent of pc.intents) {
		const f = fighterOf(pc, intent.seat)
		if (!f || !active(f) || !f.connected || f.away) continue // skipped
		const before = {hp: f.s.player.currentHealth, block: f.s.player.block}
		let state = withRoom(pc, f.s)
		state = produce(state, (d) => {
			d.dungeon.graph[1][0].room.monsters[0].nextIntent = intent.step - 1
		})
		state = actions.takeMonsterTurn(state, 0)
		const m = state.dungeon.graph[1][0].room.monsters[0]
		block += m.block
		f.s = fromRoom(pc, state)
		pc.warden.block = 0
		events.push({
			k: 'intent',
			seat: f.seat,
			step: intent.step,
			amount: before.hp - f.s.player.currentHealth,
			blocked: Math.max(0, before.block - f.s.player.block),
		})
		events.push(...mech.mechAfterEnemyHit(pc, f, before, ENEMIES[pc.enemyId].intents[intent.step - 1]))
		checkDeath(pc, f, events)
	}
	if (pc.warden.hp < 1) {
		pc.warden.hp = 0 // Thorns
		return finish(pc, true, events)
	}
	pc.warden.block = block
	if (block > 0) events.push({k: 'block', seat: -1, amount: block})
	// Powers tick down once per round: each fighter's, and the shared Warden's.
	// (Same rule as the engine's internal decreasePlayerPowerStacks/decreaseMonsterPowerStacks,
	// which endTurn uses but actions.js does not export.)
	for (const f of pc.fighters.filter(active)) f.s.player.powers = decreasePowers(f.s.player.powers)
	pc.warden.powers = clean(decreasePowers(pc.warden.powers))
	mech.mechRoundEnd(pc) // "for the rest of the fight" powers stay
	if (!pc.fighters.some(active)) return finish(pc, false, events)
	newRound(pc, events)
}

function newRound(pc, events) {
	pc.round++
	pc.timerEndsAt = null
	for (const f of pc.fighters.filter(active)) {
		const away = !f.connected
		// Engine newTurn: draw 5, energy 3, block 0. Away fighters keep their hand and
		// only draw up to 5, so they "get their hand back" when they reconnect.
		const n = away ? Math.max(0, HAND_SIZE - f.s.hand.length) : HAND_SIZE
		let s = n > 0 ? actions.drawCards(f.s, {amount: n}) : f.s
		s = produce(s, (d) => {
			d.turn++
			d.player.currentEnergy = MAX_ENERGY
			d.player.block = 0
		})
		f.s = plain(s)
		f.ended = away
		f.away = away
	}
	setIntents(pc)
	events.push({k: 'round', amount: pc.round})
	mechTurnStarts(pc, events)
}

function finish(pc, won, events) {
	if (pc.over) return
	pc.over = {won}
	pc.timerEndsAt = null
	events.push({k: won ? 'win' : 'lose'})
}

/** 60 s turn timer (GDD 7.3): at 0, every connected fighter still playing auto-ends. */
export function tickTimers(pc0, now = Date.now()) {
	if (!pc0 || pc0.over || !pc0.timerEndsAt || now < pc0.timerEndsAt) return {pc: pc0, events: []}
	const pc = structuredClone(pc0)
	const events = []
	for (const f of pc.fighters) {
		if (active(f) && !f.ended) {
			endFighter(pc, f, events, f.connected)
			events.push({k: 'end', seat: f.seat, text: 'timer'})
		}
	}
	pc.timerEndsAt = null
	maybeResolveRound(pc, events)
	return {pc, events}
}

/** Intent with the numbers the player will actually feel (Warden Weak, target Vulnerable). */
function intentFor(pc, intent) {
	const base = ENEMIES[pc.enemyId].intents[intent.step - 1]
	const f = fighterOf(pc, intent.seat)
	let damage = base.damage || 0
	if (pc.warden.powers.weak) damage = Math.floor(damage * 0.75)
	if (f?.s.player.powers.vulnerable) damage = Math.floor(damage * 1.5)
	const out = {seat: intent.seat, step: intent.step, damage, name: f?.name ?? ''}
	if (base.block) out.block = base.block
	if (base.weak) out.weak = base.weak
	if (base.vulnerable) out.vulnerable = base.vulnerable
	out.label = intentLabel(out, pc.enemyId)
	out.skipped = !f || !active(f) || !f.connected
	return out
}

/**
 * What one player may see (own hand only). seat -1 (or a non-fighter) = spectator.
 * @returns {import('../../core/contracts.js').CombatView & {enemyId: string, tip: boolean, tokens: string[], exhaustCount: number}}
 */
export function viewFor(pc, seat) {
	const me = fighterOf(pc, seat)
	const hand = me
		? me.s.hand.map((c) => {
				const unplayable = Boolean(c.conditions?.some((x) => x.type === 'unplayable'))
				return {
					id: c.id,
					name: baseName(c.name),
					type: c.type,
					energy: c.energy,
					upgraded: Boolean(c.upgraded),
					unplayable,
					playable: !pc.over && active(me) && !me.ended && me.connected && !unplayable && canPlay(me.s, c),
					target: c.target,
					description: c.description,
					...(c.everGen ? {gen: c.everGen, art: c.everArt, rarity: c.everRarity} : {}),
				}
			})
		: []
	return {
		round: pc.round,
		you: me ? seat : -1,
		enemyId: pc.enemyId,
		warden: {
			name: pc.warden.name,
			hp: Math.max(0, pc.warden.hp),
			maxHp: pc.warden.maxHp,
			block: pc.warden.block,
			powers: {...pc.warden.powers},
			intents: pc.over ? [] : pc.intents.map((i) => intentFor(pc, i)).filter((i) => !(fighterOf(pc, i.seat)?.dead || fighterOf(pc, i.seat)?.removed)),
		},
		fighters: pc.fighters.map((f) => ({
			seat: f.seat,
			name: f.name,
			hp: Math.max(0, f.s.player.currentHealth),
			maxHp: f.s.player.maxHealth,
			block: f.s.player.block,
			energy: f.s.player.currentEnergy,
			maxEnergy: f.s.player.maxEnergy,
			powers: clean(f.s.player.powers),
			ended: f.ended,
			dead: f.dead,
			removed: f.removed,
			connected: f.connected,
			handCount: f.s.hand.length,
			drawCount: f.s.drawPile.length,
			discardCount: f.s.discardPile.length,
		})),
		hand,
		tip: Boolean(me?.tip),
		tokens: me ? [...me.tokens] : [],
		exhaustCount: me ? me.s.exhaustPile.length : 0,
		timerEndsAt: pc.timerEndsAt,
		over: pc.over ? {won: pc.over.won} : null,
	}
}

/** null while the fight runs; then {won, bySeat: {seat: {hpLeft, dead}}, rounds}. */
export function outcome(pc) {
	if (!pc?.over) return null
	const bySeat = {}
	for (const f of pc.fighters) bySeat[f.seat] = {hpLeft: f.dead ? 0 : Math.max(0, f.s.player.currentHealth), dead: f.dead, removed: f.removed}
	return {won: pc.over.won, bySeat, rounds: pc.round}
}
