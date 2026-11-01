// EVER content-gen: the offline procedural generator (GDD_V2 10.6, 9.1-9.4, 10.1-10.4).
// From seed + themes + page (+ NPC, trust and any typed request) it makes the same offers
// the AI would: new cards, items, tokens, bargains, sealed offers, curses, upgrades and
// removals, with names, flavor and art. Every def goes through the mechanics validator
// (and, with `sim`, the balance check), so offline content obeys the same budgets as AI
// content. Same inputs, same offers: offline books are reproducible from the seed.
// PURE: no DOM, no network, no Math.random.
//
// Copyright (C) 2026 the EVER contributors.
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
	CARD_BUDGET, ITEM_BUDGET, TOKEN_BUDGET, THEMES, checkCaps, generateContent, normalizeContent, pickWeighted, rng, scoreContent, validateContent,
} from '../mechanics/index.js'
import {artRecipe} from './art.js'
import {THEMED_CURSES, THEME_WORDS, readRequest} from './lexicon.js'
import {curseName, makeFlavor, makeName} from './names.js'
import {BARGAIN_COSTS, CARD_TEMPLATES, ITEM_TEMPLATES, TOKEN_TEMPLATES} from './templates.js'

export const CONTENT_GEN_VERSION = 1

/** GDD_V2 9.3 rarity odds by page. */
const RARITY_ODDS = [
	[3, [['common', 75], ['uncommon', 22], ['rare', 3]]],
	[6, [['common', 55], ['uncommon', 35], ['rare', 10]]],
	[Infinity, [['common', 40], ['uncommon', 40], ['rare', 20]]],
]
const RARITY_STEPS = ['common', 'uncommon', 'rare']
const stepRarity = (r, d) => RARITY_STEPS[Math.max(0, Math.min(2, RARITY_STEPS.indexOf(r) + d))]

/**
 * Rarity for a slot (GDD_V2 9.3; trust moves one band: Trusting rarer, Cold commoner).
 * @param {() => number} rand @param {number} page @param {number} [trust]
 */
export function rarityFor(rand, page, trust = 0) {
	const odds = RARITY_ODDS.find(([max]) => page <= max)[1]
	const r = pickWeighted(rand, odds)
	return stepRarity(r, trust >= 2 ? 1 : trust <= -2 ? -1 : 0)
}

// -------------------------------------------------------------------------------------
// Number solving: fill `share` params up to the budget, judged by the mechanics budget.
// -------------------------------------------------------------------------------------

const clone = (o) => JSON.parse(JSON.stringify(o))
// healNow stays small: out-of-Hearth healing is capped at 30 HP per book (GDD_V2 8.2).
const MAXN = {damage: 30, block: 25, heal: 15, healNow: 4}
function maxOf(e) {
	if (e.do === 'power') return e.kind === 'poison' || e.kind === 'regen' ? 5 : 3
	if (e.do === 'damage') return Math.floor(30 / (e.hits ?? 1))
	return MAXN[e.do] ?? 3
}
const UNIT = {damage: 1, block: 1, heal: 1.5, healNow: 0.5, power: 3}

function tunables(raw) {
	const out = []
	const visit = (list) => {
		for (const e of list ?? []) if (e.share !== undefined && e.share > 0) out.push(e)
	}
	visit(raw.effects)
	for (const t of raw.triggers ?? []) visit(t.effects)
	return out
}
function stripShares(raw) {
	const r = clone(raw)
	const strip = (list) => list?.forEach((e) => delete e.share)
	strip(r.effects)
	for (const t of r.triggers ?? []) strip(t.effects)
	return r
}
function measure(raw) {
	const n = normalizeContent(stripShares(raw))
	if (!n.def) return null
	return {pp: scoreContent(n.def).pp, pos: scoreContent(n.def).pos, caps: checkCaps(n.def).length}
}

/**
 * Raise the shared numbers one step at a time (lowest filled share first) while the
 * mechanics budget says the thing still fits `budget` and no hard cap breaks.
 * @returns {object} raw def without `share` fields
 */
export function solveToBudget(rawIn, budget, {measureKey = 'pp'} = {}) {
	const raw = clone(rawIn)
	const tun = tunables(raw)
	for (const e of raw.effects ?? []) if (e.share === 0) e.n = e.n ?? 0
	for (const e of tun) e.n = 1
	for (let i = 0; i < 80; i++) {
		const order = [...tun].sort((a, b) => (a.n * (UNIT[a.do] ?? 1)) / a.share - (b.n * (UNIT[b.do] ?? 1)) / b.share)
		let moved = false
		for (const e of order) {
			if (e.n >= maxOf(e)) continue
			e.n++
			const m = measure(raw)
			if (m && m.caps === 0 && m[measureKey] <= budget + 0.4) {
				moved = true
				break
			}
			e.n--
		}
		if (!moved) break
	}
	return stripShares(raw)
}

// -------------------------------------------------------------------------------------
// One def
// -------------------------------------------------------------------------------------

const themeWeight = (tpl, theme) => tpl.themes?.[theme] ?? 0.4
function pickTemplate(rand, list, {theme, want, rarity}) {
	const pairs = list
		.filter((t) => !t.rarities || !rarity || t.rarities.includes(rarity))
		.map((t) => [t, themeWeight(t, theme) * (want && t.tags?.includes(want) ? 5 : 1)])
	return pickWeighted(rand, pairs)
}

/**
 * @typedef {object} GenOpts
 * @prop {'card'|'item'|'token'|'curse'} kind
 * @prop {'common'|'uncommon'|'rare'} [rarity]
 * @prop {string} theme
 * @prop {'gift'|'bargain'|'sealed'|'curse'} [offer]
 * @prop {string|null} [want]       request family (lexicon REQUEST_KEYWORDS)
 * @prop {string} [npc]             'marcus' | 'wayfarer' | 'keeper' (names)
 * @prop {Set<string>} [taken]      lowercase names already used (updated)
 * @prop {object} [content]         run content (addCard refs)
 * @prop {false|true|object} [sim]  balance check options for validateContent
 * @prop {string[]} [blocklist]
 */

/**
 * Generate one validated canonical def from a named stream.
 * @param {string|number} seed @param {string} label @param {GenOpts} o
 * @returns {object} canonical def (always valid; falls back to the mechanics floor generator)
 */
export function generateDef(seed, label, o) {
	const {kind, rarity = 'common', offer = kind === 'curse' ? 'curse' : 'gift', want = null, npc, content, sim = false, blocklist = []} = o
	const theme = THEMES.includes(o.theme) ? o.theme : 'forge'
	const taken = o.taken ?? new Set()
	const rand = rng(seed, `cg:${label}`)
	const existingNames = [...taken]
	const check = (raw, off = offer) =>
		validateContent(raw, {offer: off === 'sealed' ? 'gift' : off, rarity: kind === 'card' || kind === 'item' ? rarity : undefined, existingNames, content, sim, blocklist})

	for (let attempt = 0; attempt < 8; attempt++) {
		let raw
		if (kind === 'curse') {
			const base = THEMED_CURSES[attempt === 0 ? theme : pickWeighted(rand, THEMES.map((t) => [t, 1]))]
			raw = {kind: 'curse', ...clone(base), name: curseName(rand, theme, new Set(taken))}
		} else if (kind === 'token') {
			const tpl = pickTemplate(rand, TOKEN_TEMPLATES, {theme, want})
			const budget = TOKEN_BUDGET.min + 3 + Math.floor(rand() * 3)
			raw = {...solveToBudget({kind: 'token', effects: tpl.effects}, budget), art: {prop: tpl.prop}}
		} else if (kind === 'item') {
			const tpl = pickTemplate(rand, ITEM_TEMPLATES, {theme, want})
			const band = ITEM_BUDGET[rarity]
			const bargain = offer === 'bargain'
			const target = bargain ? Math.floor(band * 1.4) : band - Math.floor(rand() * 2)
			raw = {...solveToBudget({kind: 'item', slot: tpl.slot, rarity, triggers: tpl.triggers}, target), art: {prop: tpl.prop}}
			if (bargain) {
				const m = measure(raw)
				const excess = Math.max(0, (m?.pos ?? 0) - band)
				raw.bound = true
				raw.stats = {maxHp: -Math.min(10, Math.max(2, Math.ceil(excess / 4) + 1))}
			}
		} else {
			const tpl = pickTemplate(rand, CARD_TEMPLATES, {theme, want, rarity})
			const energy = pickWeighted(rand, tpl.energies ?? [[1, 8], [2, 2], [0, 0.4]])
			const band = CARD_BUDGET[rarity](energy)
			const bargain = offer === 'bargain'
			const target = bargain ? Math.floor(band * 1.4) : band - Math.floor(rand() * 2)
			raw = {...solveToBudget({kind: 'card', type: tpl.type, target: tpl.target, energy, rarity, exhaust: Boolean(tpl.exhaust), effects: tpl.effects, triggers: tpl.triggers}, target), art: {prop: tpl.prop}}
			if (!raw.triggers?.length) delete raw.triggers
			if (bargain) {
				const excess = Math.max(0, (measure(raw)?.pos ?? 0) - band)
				const need = Math.ceil(excess / 2) + 1
				const cost = need <= 6 && rand() < 0.5 ? BARGAIN_COSTS[1] : BARGAIN_COSTS[0]
				raw.effects = [...raw.effects, cost.make(Math.max(need, 1))]
			}
		}
		raw.theme = theme
		if (kind !== 'curse') raw.name = makeName(rand, theme, {taken: new Set(taken), npc})
		raw.flavor = kind === 'curse' ? raw.flavor : makeFlavor(rand, theme, {dark: offer === 'bargain'})
		raw.art = {...(THEME_WORDS[theme]?.art ?? {}), ...(raw.art ?? {})}
		const v = check(raw)
		if (v.ok) {
			taken.add(v.def.name.toLowerCase())
			return v.def
		}
	}
	// Floor: the mechanics generator always returns a valid def (sim not required).
	const def = generateContent(seed, `cg-floor:${label}`, {kind, rarity, theme, offer: offer === 'sealed' ? 'gift' : offer, existingNames})
	taken.add(def.name.toLowerCase())
	return def
}

// -------------------------------------------------------------------------------------
// Offers (GDD_V2 10.1 table, 10.2-10.4 NPC specialities, 9.2 stations)
// -------------------------------------------------------------------------------------

/**
 * One offer as the Offer panel shows it. Out-of-book data only: Systems applies it.
 * @typedef {object} Offer
 * @prop {number} slot
 * @prop {'gift'|'bargain'|'sealed'|'curse'} label   "Gift" / "Bargain" / "Sealed" / a curse that was earned
 * @prop {'card'|'item'|'token'|'curse'|'upgrade'|'remove'} kind
 * @prop {object|null} def            validated canonical def (null for upgrade/remove)
 * @prop {object} [hidden]            sealed offers: the curse inside (validated, offer 'curse')
 * @prop {{uid: string, name: string}} [target]  upgrade/remove: the deck card
 * @prop {{doubt: number}} [cost]     station costs applied by Systems (the Shrine's Doubts)
 * @prop {'ai'|'offline'|'world'} src
 * @prop {string} theme
 * @prop {object|null} art            artRecipe(def)
 */

/**
 * @typedef {object} MomentContext
 * @prop {string|number} seed           book seed
 * @prop {number} page                  1-based page index
 * @prop {number} [pages]               path length
 * @prop {{primary: string, secondary: string, shadow: string}} themes
 * @prop {{id: string, name?: string}} npc  id: 'marcus' | 'wayfarer' | 'keeper' (or a world NPC with an archetype)
 * @prop {number} [trust]               -3..3
 * @prop {string} [request]             the player's typed request (only keywords are used offline)
 * @prop {{uid: string, name: string, upgraded?: boolean, curse?: boolean, keepsake?: boolean}[]} [deck]
 * @prop {string[]} [existingNames]     names in the book + the world pool
 * @prop {{cards?: object[], items?: object[]}} [worldPool]  global pool defs (world/)
 * @prop {boolean} [earned]             the player was hostile or let trust fall to Cold (allows curse offers)
 * @prop {boolean} [hostile]            attacked this NPC: no offer at all
 * @prop {boolean} [removal]            the path needs this NPC to offer removal (GDD 6.2 rule 7)
 * @prop {object} [content]             run content
 * @prop {false|true|object} [sim]
 * @prop {string[]} [blocklist]
 */

function themeForSlot(rand, ctx, j, {kind}) {
	const t = ctx.themes ?? {}
	const req = readRequest(ctx.request)
	if (j === 0 && req.theme) return {theme: req.theme, pool: false}
	if (j === 0 && ctx.npc?.id === 'marcus' && rand() < 0.5) return {theme: 'forge', pool: false}
	const r = rand()
	const pool = kind === 'card' ? ctx.worldPool?.cards : kind === 'item' ? ctx.worldPool?.items : null
	if (r >= 0.8 && pool?.length) return {theme: t.primary, pool: true}
	return {theme: r < 0.5 ? t.primary : t.secondary ?? t.primary, pool: false}
}

/** Slot plan by NPC and trust. Returns [{kind, label, rarityStep}] */
export function planMoment(ctx) {
	const trust = ctx.trust ?? 0
	if (ctx.hostile) return []
	const npc = ctx.npc?.id ?? 'marcus'
	const count = trust <= -2 ? 1 : trust >= 2 ? 3 : 2
	if (trust <= -2) return [{kind: npc === 'wayfarer' ? 'item' : 'card', label: 'bargain'}]
	const deck = ctx.deck ?? []
	const canUpgrade = deck.some((c) => !c.upgraded && !c.curse)
	const canRemove = deck.some((c) => !c.keepsake)
	let plan
	if (npc === 'wayfarer') {
		plan = [{kind: 'item', label: 'gift'}, {kind: 'token', label: 'gift'}, {kind: 'card', label: 'bargain'}]
		plan = plan.slice(0, count - 1)
		plan.push({kind: 'card', label: 'sealed'}) // GDD 10.3: always one Sealed offer
	} else if (npc === 'keeper') {
		plan = []
		const curses = deck.some((c) => c.curse)
		if ((ctx.removal || curses || trust >= 1) && canRemove) plan.push({kind: 'remove', label: 'gift'})
		if (canUpgrade) plan.push({kind: 'upgrade', label: 'gift'})
		plan.push({kind: 'card', label: 'gift'}, {kind: 'item', label: 'gift'})
		plan = plan.slice(0, count)
	} else {
		// Marcus and any other NPC: always at least one new card (GDD 10.2).
		plan = [{kind: 'card', label: 'gift'}]
		if (count >= 2) plan.push(canUpgrade && trust >= 1 ? {kind: 'upgrade', label: 'gift'} : {kind: 'card', label: trust <= 0 ? 'bargain' : 'gift'})
		if (count >= 3) plan.push({kind: 'item', label: 'gift'})
	}
	if (ctx.earned && trust <= -1 && plan.length > 1) plan[plan.length - 1] = {kind: 'curse', label: 'curse'}
	return plan
}

/** Kinds the AI may use for a planned slot (the offline plan's kind is always first). */
const AI_KINDS = Object.freeze({card: ['card'], item: ['item', 'token'], token: ['token', 'item'], upgrade: ['upgrade', 'card'], remove: ['remove'], curse: ['curse']})

/**
 * The moment's slots with the game's rarity and a power-budget hint per slot: the one
 * plan both the AI prompt and the offline generator fill (so a failed AI offer is replaced
 * by the offline offer of the SAME slot, GDD_V2 9.5).
 * @param {MomentContext} ctx
 * @returns {{kind: string, label: string, rarity?: string, pp: number, kinds: string[]}[]}
 */
export function momentSlots(ctx) {
	const trust = ctx.trust ?? 0
	return planMoment(ctx).map((spec, j) => {
		const rand = rng(ctx.seed, `offer:${ctx.page}:${j}:rarity`)
		let rarity
		if (spec.kind === 'card' || spec.kind === 'item') rarity = spec.label === 'sealed' ? 'rare' : trust >= -1 && trust <= 0 ? 'common' : rarityFor(rand, ctx.page ?? 1, trust)
		const pp = spec.kind === 'card' ? CARD_BUDGET[rarity](1) : spec.kind === 'item' ? ITEM_BUDGET[rarity] : spec.kind === 'token' ? 8 : spec.kind === 'curse' ? -5 : 0
		return {...spec, ...(rarity ? {rarity} : {}), pp, kinds: AI_KINDS[spec.kind] ?? [spec.kind]}
	})
}

function pickDeckCard(rand, deck, filter) {
	const list = (deck ?? []).filter(filter)
	if (!list.length) return null
	const c = list[Math.floor(rand() * list.length)]
	return {uid: String(c.uid), name: String(c.name ?? c.id ?? '')}
}

/**
 * One offline offer for slot j of a moment (or a station). Never throws.
 * @param {MomentContext} ctx
 * @param {{kind: string, label: string, rarity?: string}} spec
 * @param {number} j
 * @param {{stream?: string, taken?: Set<string>}} [o]
 * @returns {Offer|null}
 */
export function generateOffer(ctx, spec, j, {stream, taken} = {}) {
	const label = stream ?? `offer:${ctx.page}:${j}`
	const req = readRequest(ctx.request)
	const rand = rng(ctx.seed, `${label}|${req.hash}`)
	taken = taken ?? new Set((ctx.existingNames ?? []).map((n) => String(n).toLowerCase()))
	const trust = ctx.trust ?? 0
	const shadow = ctx.themes?.shadow ?? ctx.themes?.primary ?? 'ash'
	const base = {slot: j, label: spec.label, kind: spec.kind, src: 'offline'}

	if (spec.kind === 'upgrade') {
		const target = pickDeckCard(rand, ctx.deck, (c) => !c.upgraded && !c.curse)
		return target ? {...base, def: null, target, theme: ctx.themes?.primary ?? 'forge', art: null} : null
	}
	if (spec.kind === 'remove') {
		const target = pickDeckCard(rand, ctx.deck, (c) => c.curse && !c.keepsake) ?? pickDeckCard(rand, ctx.deck, (c) => !c.keepsake)
		return target ? {...base, def: null, target, theme: ctx.themes?.primary ?? 'well', art: null} : null
	}
	const slotTheme = spec.label === 'bargain' || spec.label === 'curse' ? {theme: rand() < 0.6 ? shadow : ctx.themes?.primary, pool: false} : themeForSlot(rand, ctx, j, spec)
	const rarity = spec.rarity ?? (spec.label === 'sealed' ? 'rare' : trust >= -1 && trust <= 0 ? 'common' : rarityFor(rand, ctx.page ?? 1, trust))
	const common = {npc: ctx.npc?.id, taken, content: ctx.content, sim: ctx.sim ?? false, blocklist: ctx.blocklist, want: j === 0 ? req.want : null}

	if (slotTheme.pool) {
		const pool = spec.kind === 'card' ? ctx.worldPool.cards : ctx.worldPool.items
		const fresh = pool.filter((d) => d?.name && !taken.has(String(d.name).toLowerCase()))
		const pickDef = fresh.length ? fresh[Math.floor(rand() * fresh.length)] : null
		const v = pickDef && validateContent(pickDef, {offer: 'gift', kind: spec.kind, authored: true, existingNames: [...taken], content: ctx.content})
		if (v?.ok) {
			taken.add(v.def.name.toLowerCase())
			return {...base, label: 'gift', def: v.def, src: 'world', theme: v.def.theme ?? slotTheme.theme, art: artRecipe(v.def)}
		}
	}

	if (spec.kind === 'curse') {
		const def = generateDef(ctx.seed, `${label}:curse`, {...common, kind: 'curse', theme: shadow, offer: 'curse'})
		return {...base, def, theme: shadow, art: artRecipe(def)}
	}
	if (spec.label === 'sealed') {
		const def = generateDef(ctx.seed, `${label}:sealed`, {...common, kind: 'card', rarity, theme: slotTheme.theme, offer: 'gift'})
		return {...base, def, ...sealInside(ctx, j, def, {taken}), theme: slotTheme.theme, art: artRecipe(def)}
	}
	const kind = spec.kind
	const def = generateDef(ctx.seed, `${label}:${kind}`, {...common, kind, rarity: kind === 'token' ? undefined : rarity, theme: slotTheme.theme, offer: spec.label === 'bargain' ? 'bargain' : 'gift'})
	return {...base, def, theme: slotTheme.theme, art: artRecipe(def)}
}

/**
 * What is inside a Sealed offer besides its card (GDD_V2 8.2 / 18.3): maybe one curse from
 * the shadow theme, decided by the slot's own stream (so the AI path and the offline path
 * seal the same way), and only if the offer stays worth at least +4 PP with it.
 * @returns {{hidden?: object}}
 */
export function sealInside(ctx, j, def, {taken, stream} = {}) {
	const label = stream ?? `offer:${ctx.page}:${j}`
	const shadow = ctx.themes?.shadow ?? ctx.themes?.primary ?? 'ash'
	const coin = rng(ctx.seed, `${label}:seal`)()
	if (coin >= 0.5) return {}
	const hidden = generateDef(ctx.seed, `${label}:inside`, {kind: 'curse', theme: shadow, offer: 'curse', taken, content: ctx.content, blocklist: ctx.blocklist})
	return scoreContent(def).pp + scoreContent(hidden).pp >= 4 ? {hidden} : {}
}

/**
 * All offline offers for an NPC moment (GDD_V2 10.1). Same ctx, same offers.
 * @param {MomentContext} ctx
 * @returns {Offer[]}
 */
export function generateMomentOffers(ctx) {
	const taken = new Set((ctx.existingNames ?? []).map((n) => String(n).toLowerCase()))
	const out = []
	momentSlots(ctx).forEach((spec, j) => {
		let o = generateOffer(ctx, spec, j, {taken})
		// An upgrade/removal with nothing to target becomes a card.
		if (!o) o = generateOffer(ctx, {kind: 'card', label: 'gift'}, j, {taken})
		if (o) out.push(o)
	})
	return out
}

/**
 * Station offers (GDD_V2 9.2). lectern: 3 cards; spoils: 3 cards; eliteSpoils: 2 items;
 * shrine: one rare card that costs 2 Doubt (MVP deal, rare now generated); transform:
 * one card of the target's rarity (pass `rarity`).
 * @param {MomentContext} ctx
 * @param {'lectern'|'spoils'|'eliteSpoils'|'shrine'|'transform'} station
 * @param {{seat?: number, rarity?: string, extra?: number}} [o]  extra: path twist "show one more"
 * @returns {Offer[]}
 */
export function generateStationOffers(ctx, station, {seat = 0, rarity, extra = 0} = {}) {
	const taken = new Set((ctx.existingNames ?? []).map((n) => String(n).toLowerCase()))
	const base = station === 'spoils' || station === 'eliteSpoils' ? `spoils:${ctx.page}:${seat}` : station === 'lectern' ? 'lectern' : `${station}:${ctx.page}`
	const mk = (kind, j, spec = {}) => generateOffer({...ctx, npc: null, request: '', trust: 0}, {kind, label: 'gift', ...spec}, j, {stream: `${base}:${j}`, taken})
	const rr = rng(ctx.seed, `${base}:rarity`)
	if (station === 'eliteSpoils') return [0, 1, ...Array.from({length: extra}, (_, i) => 2 + i)].map((j) => mk('item', j, {rarity: rarityFor(rr, ctx.page ?? 7, 1)})).filter(Boolean)
	if (station === 'shrine') {
		const o = mk('card', 0, {rarity: 'rare'})
		return o ? [{...o, label: 'bargain', cost: {doubt: 2}}] : []
	}
	if (station === 'transform') return [mk('card', 0, {rarity: rarity ?? 'common'})].filter(Boolean)
	return Array.from({length: 3 + extra}, (_, j) => mk('card', j, {rarity: rarityFor(rr, ctx.page ?? 1)})).filter(Boolean)
}

/** Names of the things in a set of offers (to keep later offers from repeating them). */
export const offerNames = (offers) => offers.flatMap((o) => [o?.def?.name, o?.hidden?.name]).filter(Boolean)
