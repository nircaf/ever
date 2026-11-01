// EVER v2 book rules: seeded runs, pages, offers, stations, spoils, the Hearth, items,
// curses, tokens, echoes (GDD_V2 4-12, 15, 16). OWNER: systems engineer.
// PURE (no DOM): the room server imports this exact file, through rules/book.js.
//
// A v2 book is the MVP book (contracts.newBook, so Marcus's dialogue rules keep working)
// plus: a seed code, a pinned plan (path, themes, keepsake), the current page, run
// content (generated cards/items/curses/tokens as validated data, mechanics/registry),
// items, NPC trust for the two archetypes, twists, marks and an echo.
//
// Offline offers are a pure function of (book, page, slot): the client renders them and
// the rules regenerate the same thing when the player takes one, so offline actions only
// carry a slot number. AI offers carry their definition; the rules re-validate it with
// the mechanics validator (schema, budget, fairness, balance sim with the book's seed),
// so a modified client (or the room re-checking a co-op client) gets the same verdict.
//
// Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later

import {BOOK_V2, CURSE_ID, ENGINE_VERSION, FREE_TEXT_MAX, START_HP, TOKEN_KINDS, WORLD_EDITION_FALLBACK, newBook, validateAiProposal} from '../contracts.js'
import {classifyFreeText} from './marcus.js'
import {COPY2, FLAVOR, NPC_FREE, NPC_LINES} from '../copy-v2.js'
import {addContent, createRunContent, generateContent, getDef, parseRunContent, removeContent, rulesText, scoreContent, validateContent} from '../../mechanics/index.js'
import {generateMomentOffers, generateStationOffers, momentSlots} from '../../content-gen/generate.js'
import {checkMomentOffer} from '../ai/moment.js'
import {KEEPSAKES} from '../../mechanics/reference.js'
import {afterFight} from '../../mechanics/engine.js'
import {pick, pickWeighted, rng} from '../../mechanics/prng.js'
import {SITES, SKIPPABLE, THEME_NAMES, inSiteRange, isFight, keepsakeFor, planBook} from './path.js'
import {isSeedCode, seedNumber} from './seed.js'

export const RUN_VERSION = 1
export const MAX_CURSES = 3
export const CURSE_CAP_MAXHP = 4
export const OUT_OF_HEARTH_HEAL_CAP = 30
export const MAX_TOKENS = 3
export const MAX_HP_RANGE = Object.freeze([20, 80])
export const SPOILS_LEAVE_HEAL = 4
export const CATCH_UP_HP = 35
export const ITEM_SLOTS = Object.freeze(['hand', 'body', 'charm'])

export const isV2 = (book) => book?.v === BOOK_V2

const clone = (x) => structuredClone(x)
const clampInt = (n, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(n) || 0)))
const fail = (book, error, effects = []) => ({ok: false, book, error, effects})

// =======================================================================================
// Content helpers
// =======================================================================================

/** The generated def behind a deck card, or null for engine cards (Strike, Doubt...). */
export const deckDef = (book, card) => (card?.id?.startsWith?.('g:') ? getDef(book.content, card.id) : null)
export const isKeepsake = (book, card) => deckDef(book, card)?.rarity === 'keepsake'
export const isCurseCard = (book, card) => card?.id === CURSE_ID || deckDef(book, card)?.kind === 'curse'
export const curseCount = (book) => book.deck.filter((c) => isCurseCard(book, c)).length
/** Display name of a deck card ("Tobin's Hammer+", "Strike"). */
export const deckName = (book, card) => (deckDef(book, card)?.name ?? card.id) + (card.upgraded ? '+' : '')
export const itemDefs = (book) => (book.items ?? []).map((id) => getDef(book.content, id)).filter(Boolean)
export const itemInSlot = (book, slot) => (book.items ?? []).find((id) => getDef(book.content, id)?.slot === slot) ?? null
/** Names already used in this book (offline names avoid them). */
export const takenNames = (book) => Object.values(book.content?.defs ?? {}).map((d) => d.name)
const upgradable = (book) => book.deck.filter((c) => !c.upgraded && !isCurseCard(book, c))

/** Card rarity odds by page (GDD_V2 9.3), shifted one band by trust. */
export function rarityFor(seed, label, page, shift = 0) {
	const r = rng(seed, `rarity:${label}`)
	const bands = page <= 2 ? [75, 22, 3] : page <= 5 ? [55, 35, 10] : [40, 40, 20]
	const base = pickWeighted(r, [['common', bands[0]], ['uncommon', bands[1]], ['rare', bands[2]]])
	const order = ['common', 'uncommon', 'rare']
	return order[Math.max(0, Math.min(2, order.indexOf(base) + shift))]
}

const OFFLINE_CACHE = new Map()
/**
 * Offline generated def for a slot: generateContent with the balance check, named from the
 * theme lexicon and given a flavor line. Memoized (pure function of its arguments).
 */
export function offlineDef(book, label, {kind = 'card', rarity = 'common', theme, offer} = {}) {
	const names = takenNames(book)
	const L = book.path?.L ?? 9
	const key = [book.seed, label, kind, rarity, theme, offer, L, names.join('|')].join('#')
	if (OFFLINE_CACHE.has(key)) return clone(OFFLINE_CACHE.get(key))
	let def = generateContent(book.seed, label, {kind, rarity, theme, offer, existingNames: names, sim: kind === 'curse' ? false : {pages: L, seed: seedNumber(book.seed)}})
	const lines = FLAVOR[def.theme]
	if (lines && kind !== 'curse') {
		const withFlavor = validateContent({...def, flavor: pick(rng(book.seed, `flavor:${label}`), lines)}, {offer: offer ?? (kind === 'curse' ? 'curse' : 'gift'), kind, rarity: kind === 'card' || kind === 'item' ? rarity : undefined, existingNames: names})
		if (withFlavor.ok) def = withFlavor.def
	}
	if (OFFLINE_CACHE.size > 600) OFFLINE_CACHE.clear()
	OFFLINE_CACHE.set(key, def)
	return clone(def)
}

/** Theme for an offer slot: primary 60%, secondary 40% (bargains and curses: shadow). */
function themeFor(book, label, offer) {
	const [p, s, sh] = book.path.themes
	if (offer === 'bargain' || offer === 'curse') return sh
	return rng(book.seed, `theme:${label}`)() < 0.6 ? p : s
}

/** Did the player ask for something specific (9th intent, GDD_V2 10.1)? */
export const isRequest = (text) => /^\s*(can|could|would|will)\s+you\s+(make|give|forge|craft|turn|change|find|sell)\b|^\s*(make|give me|i want|i need|forge me|sell me)\b/i.test(String(text ?? ''))

// =======================================================================================
// New book
// =======================================================================================

const npcState = () => ({trust: 0, n: 0, met: false, closed: false, said: [], request: '', freeTextGain: 0, offered: false})

/**
 * A fresh v2 book. Pure.
 * @param {{meta?: {booksWritten: number, rememberedLine?: string, echo?: any, cleanReads?: boolean}, seed: string, seat?: number,
 *   edition?: number, engine?: string, now?: number, startPage?: number, catchUp?: number, hp?: number}} o
 */
export function newBookV2({meta = {booksWritten: 0, rememberedLine: ''}, seed, seat = 0, edition = WORLD_EDITION_FALLBACK, engine = ENGINE_VERSION, now = Date.now(), startPage = 0, catchUp = 0, hp} = {}) {
	if (!isSeedCode(seed)) throw new RangeError('newBookV2: bad seed code')
	const base = newBook({meta: {booksWritten: meta.booksWritten ?? 0, rememberedLine: meta.rememberedLine ?? ''}, seed: seedNumber(seed), now})
	const plan = planBook(seed, {seat})
	const ks = keepsakeFor(seed, seat, plan.themes)
	const v = validateContent(ks, {authored: true})
	if (!v.ok) throw new Error(`keepsake ${ks.name} is invalid: ${v.errors[0]?.msg}`)
	let rc = createRunContent({engine, world: edition, seed})
	const added = addContent(rc, v.def, {offer: 'gift', src: 'world', page: 0})
	rc = added.rc
	const echo = !meta.cleanReads && meta.echo?.def ? {def: meta.echo.def, name: String(meta.echo.name ?? '').slice(0, 24)} : null
	const page = clampInt(startPage, 0, plan.L - 1)
	return {
		...base,
		v: BOOK_V2,
		run: RUN_VERSION,
		seed,
		seat,
		edition,
		engine,
		hp: hp === undefined ? START_HP : clampInt(hp, 1, START_HP),
		deck: [{uid: 'c0', id: added.id, upgraded: false}],
		nextUid: 1,
		lecternOffer: [],
		content: rc,
		path: plan,
		page,
		pend: catchUp > 0 ? {kind: 'catchup', left: clampInt(catchUp, 0, 5), n: 0, page} : null,
		items: [],
		npcs: {wayfarer: npcState(), keeper: npcState()},
		twists: [],
		marks: 0,
		healed: 0,
		echo,
		echoUsed: false,
		aiRead: false,
		scriptNote: false,
		stats: {turns: 0, fights: 0},
	}
}

/** Current page object (null when the book is finished). */
export const currentPage = (book) => book.path?.pages?.[book.page] ?? null
/** Site of a page; the Hearth moves to the lit forge when Marcus trusts you (GDD_V2 6.5). */
export function siteOf(book, i = book.page) {
	const p = book.path.pages[i]
	if (!p) return null
	if (p.type === 'hearth') return book.marcus.trust >= 2 ? 'forge' : 'roadfire'
	return p.site
}
export const hearthLit = (book) => book.marcus.trust >= 2
export const temperCount = (book) => (book.marcus.trust >= 3 ? 2 : 1)

/** Human title of a page (Hearth title follows the lit forge). */
export function pageTitle(book, i = book.page) {
	const p = book.path.pages[i]
	if (!p) return ''
	if (p.type === 'hearth') return hearthLit(book) ? COPY2.hearth.titleLit : COPY2.hearth.titleRoad
	return p.title
}

// =======================================================================================
// Offers (GDD_V2 9, 10.1). The slot plan and the offline offers come from content-gen
// (the same plan the AI moment pipeline fills, core/ai/moment.js), so an AI offer that
// fails is replaced by the offline offer of the SAME slot, and the rules can re-check
// any offer the client sends against that slot.
// =======================================================================================

/** content-gen MomentContext for the current page of a book (pure; the room builds the same). */
export function momentContext(book, {page = book.page, says = ''} = {}) {
	const p = book.path.pages[page]
	const who = p?.type === 'marcus' ? 'marcus' : p?.archetype ?? null
	const npc = who === 'marcus' ? null : who ? book.npcs[who] : null
	const trust = who === 'marcus' ? book.marcus.trust : npc?.trust ?? 0
	const [primary, secondary, shadow] = book.path.themes
	return {
		seed: book.seed,
		page: page + 1,
		pages: book.path.L,
		themes: {primary, secondary, shadow},
		npc: {id: who ?? 'marcus', name: who === 'marcus' ? 'Marcus Hale' : p?.npc ?? '', archetype: who ?? undefined},
		trust,
		request: (who === 'marcus' ? book.marcus.request : npc?.request) ?? '',
		says,
		deck: book.deck.map((c) => ({uid: c.uid, name: deckDef(book, c)?.name ?? c.id, upgraded: c.upgraded, curse: isCurseCard(book, c), keepsake: isKeepsake(book, c)})),
		existingNames: takenNames(book),
		content: book.content,
		items: itemDefs(book).map((d) => d.name),
		hp: book.hp,
		maxHp: book.maxHp,
		curses: curseCount(book),
		earned: who === 'marcus' ? book.marcus.trust <= -2 || book.marcus.flags.struck : Boolean(npc && npc.trust <= -2),
		hostile: who === 'marcus' ? book.marcus.flags.struck : Boolean(npc?.closed),
		removal: who === 'keeper' && Boolean(book.path.keeperRemoves),
		sim: {pages: book.path.L, seed: seedNumber(book.seed)},
	}
}

const MEMO = new Map()
/** Memoized pure call (offline generation with the balance check costs ~20 ms per def). */
function memo(key, fn) {
	if (MEMO.has(key)) return clone(MEMO.get(key))
	const v = fn()
	if (MEMO.size > 300) MEMO.clear()
	MEMO.set(key, v)
	return clone(v)
}
const ctxKey = (book, page, extra = '') => {
	const c = momentContext(book, {page})
	return [book.seed, page, c.npc.id, c.trust, c.request, c.earned, c.hostile, c.deck.map((d) => `${d.uid}${d.upgraded ? '+' : ''}`).join(','), c.existingNames.join('|'), extra].join('#')
}

/** The slot plan of a moment page (kind, label, rarity, allowed kinds). */
export const offerSlots = (book, page = book.page) => momentSlots(momentContext(book, {page}))

/** The offline offers of a moment page (what the UI shows without AI, and the fallback). */
export function offlineOffers(book, page = book.page) {
	return memo(`m#${ctxKey(book, page)}`, () => generateMomentOffers(momentContext(book, {page})))
}

/** Lectern cards (GDD_V2 9.2, 15): 3 offline cards, +1 with the twist, + the echo at the first Lectern. */
export function lecternOffers(book, i = book.page) {
	const extra = book.twists.some((t) => t.kind === 'lectern4' && !t.used) ? 1 : 0
	const out = memo(`l#${ctxKey(book, i, extra)}`, () => generateStationOffers(momentContext(book, {page: i}), 'lectern', {extra}))
	if (book.echo && !book.echoUsed) {
		const v = validateContent(book.echo.def, {offer: 'gift', existingNames: takenNames(book)})
		if (v.ok) out.push({slot: out.length, kind: 'card', label: 'echo', echo: true, def: v.def, src: 'echo'})
	}
	return out.map((o, j) => ({...o, slot: j}))
}

/** Spoils after a fight (GDD_V2 6.5): 3 cards (4 with the twist); after the elite also 2 items. Catch-up picks: 3 commons. */
export function spoilsOffers(book) {
	const pend = book.pend
	if (!pend) return []
	if (pend.kind === 'catchup') {
		const out = []
		for (let j = 0; j < 3; j++) {
			const label = `catchup:${book.bookNo}:${pend.n}:${j}`
			out.push({slot: j, kind: 'card', label: 'gift', def: offlineDef(book, label, {kind: 'card', rarity: 'common', theme: themeFor(book, label, 'gift')}), src: 'offline'})
		}
		return out
	}
	const seat = book.seat ?? 0
	const ctx = momentContext(book, {page: pend.page})
	const extra = pend.extra ? 1 : 0
	const cards = memo(`s#${ctxKey(book, pend.page, `${seat}:${extra}`)}`, () => generateStationOffers(ctx, 'spoils', {seat, extra}))
	const items = pend.elite ? memo(`e#${ctxKey(book, pend.page, seat)}`, () => generateStationOffers(ctx, 'eliteSpoils', {seat})) : []
	return [...cards, ...items].map((o, j) => ({...o, slot: j}))
}

/** The Crooked Shrine's deal: a rare card and two Doubts (GDD_V2 9.2). */
export function shrineOffer(book, i = book.page) {
	return memo(`r#${ctxKey(book, i)}`, () => generateStationOffers(momentContext(book, {page: i}), 'shrine'))[0] ?? null
}

/** Display text for any offer (rules text is always rendered from data, never from the model). */
export function offerText(book, o) {
	const refName = (ref) => getDef(book.content, ref)?.name ?? ref
	if (o.kind === 'upgrade') {
		const name = o.target?.name ?? '?'
		return {name: COPY2.offer.upgradeName(name), text: COPY2.offer.upgradeText(name)}
	}
	if (o.kind === 'remove') return {name: COPY2.offer.removeName, text: o.target ? `Remove ${o.target.name} from your deck.` : COPY2.offer.removeText}
	if (o.label === 'sealed') return {name: COPY2.offer.sealed, text: COPY2.offer.sealedFace}
	return o.def ? {name: o.def.name, text: rulesText(o.def, {refName}), flavor: o.def.flavor || ''} : {name: '', text: ''}
}
export function costText(o) {
	if (o.cost?.doubt) return COPY2.offer.cost(`${o.cost.doubt} Doubts in your deck`)
	return ''
}

// =======================================================================================
// Working state helpers (s.b is a private clone)
// =======================================================================================

const toast = (s, text) => s.fx.push({k: 'toast', text})

function addDef(s, def, meta) {
	const r = addContent(s.b.content, def, meta)
	s.b.content = r.rc
	return r.id
}

/** Gain a card from a def (curses go through the cap). Returns the deck entry or null. */
function gainCardDef(s, def, meta) {
	if (def.kind === 'curse') return gainCurseDef(s, def, meta)
	const id = addDef(s, def, meta)
	const card = {uid: 'c' + s.b.nextUid++, id, upgraded: false}
	s.b.deck.push(card)
	s.fx.push({k: 'card', op: 'add', id, name: def.name})
	toast(s, COPY2.toasts.newCard(def.name))
	return card
}

function changeMaxHp(s, d) {
	const before = s.b.maxHp
	s.b.maxHp = clampInt(before + d, MAX_HP_RANGE[0], MAX_HP_RANGE[1])
	const real = s.b.maxHp - before
	if (real > 0) s.b.hp = Math.min(s.b.maxHp, s.b.hp + real)
	s.b.hp = Math.max(1, Math.min(s.b.hp, s.b.maxHp))
	if (real) s.fx.push({k: 'maxHp', delta: real})
	return real
}

/** GDD_V2 8.2: at most 3 curse cards; a 4th becomes -4 max HP. */
function gainCurseDef(s, def, meta) {
	if (curseCount(s.b) >= MAX_CURSES) {
		changeMaxHp(s, -CURSE_CAP_MAXHP)
		toast(s, COPY2.toasts.curseCap)
		return null
	}
	const id = addDef(s, def, meta)
	const card = {uid: 'c' + s.b.nextUid++, id, upgraded: false}
	s.b.deck.push(card)
	s.fx.push({k: 'card', op: 'add', id, name: def.name, curse: true})
	toast(s, COPY2.toasts.curse(def.name))
	return card
}

/** Doubt in a v2 book (Marcus Cold/struck, the Shrine): same cap. */
export function gainDoubtV2(s, source, n = 1) {
	for (let i = 0; i < n; i++) {
		if (curseCount(s.b) >= MAX_CURSES) {
			changeMaxHp(s, -CURSE_CAP_MAXHP)
			toast(s, COPY2.toasts.curseCap)
			continue
		}
		s.b.deck.push({uid: 'c' + s.b.nextUid++, id: CURSE_ID, upgraded: false})
		s.fx.push({k: 'card', op: 'add', id: CURSE_ID, curse: true})
		if (source === 'shrine') s.b.curses.shrine += 1
		else if (source) s.b.curses[source] = true
	}
}

function loseHp(s, n) {
	const before = s.b.hp
	s.b.hp = Math.max(1, before - n)
	if (s.b.hp !== before) s.fx.push({k: 'hp', delta: s.b.hp - before})
}

/** Out-of-Hearth healing is capped at 30 HP per book (GDD_V2 8.2). */
function heal(s, n, {hearth = false} = {}) {
	let amount = Math.max(0, Math.round(n))
	if (!hearth) amount = Math.min(amount, Math.max(0, OUT_OF_HEARTH_HEAL_CAP - s.b.healed))
	const before = s.b.hp
	s.b.hp = Math.min(s.b.maxHp, s.b.hp + amount)
	const got = s.b.hp - before
	if (!hearth) s.b.healed += got
	if (got > 0) s.fx.push({k: 'hp', delta: got})
	return got
}

function removeDeckCard(s, uid) {
	const i = s.b.deck.findIndex((c) => c.uid === uid)
	if (i < 0) return null
	const [card] = s.b.deck.splice(i, 1)
	if (card.id.startsWith('g:') && !s.b.deck.some((c) => c.id === card.id) && !s.b.items.includes(card.id)) s.b.content = removeContent(s.b.content, card.id)
	return card
}

/** Equip an item; full slot needs swap, a bound item never leaves. */
function equip(s, def, meta, swap) {
	const old = itemInSlot(s.b, def.slot)
	if (old) {
		const oldDef = getDef(s.b.content, old)
		if (oldDef?.bound) return {error: 'bound', name: oldDef.name}
		if (!swap) return {error: 'slot_full'}
		s.b.items = s.b.items.filter((x) => x !== old)
		if (oldDef?.stats?.maxHp) changeMaxHp(s, -oldDef.stats.maxHp)
		s.b.content = removeContent(s.b.content, old)
	}
	const id = addDef(s, def, meta)
	s.b.items.push(id)
	if (def.stats?.maxHp) changeMaxHp(s, def.stats.maxHp)
	s.fx.push({k: 'item', id, name: def.name, slot: def.slot})
	toast(s, COPY2.toasts.item(def.name, COPY2.hud.slotName[def.slot]))
	return {id}
}

function gainTokenDef(s, def, meta) {
	if (s.b.tokens.length >= MAX_TOKENS) return {error: 'tokens_full'}
	const id = addDef(s, def, meta)
	if (!s.b.tokens.includes(id)) s.b.tokens.push(id)
	s.fx.push({k: 'token', kind: id, name: def.name})
	toast(s, COPY2.toasts.token(def.name))
	return {id}
}

function gainMvpToken(s, kind) {
	if (!TOKEN_KINDS.includes(kind) || s.b.tokens.includes(kind)) return {error: 'not_allowed'}
	if (s.b.tokens.length >= MAX_TOKENS) return {error: 'tokens_full'}
	s.b.tokens.push(kind)
	s.fx.push({k: 'token', kind})
	return {}
}

function upgradeUid(s, uid) {
	const c = s.b.deck.find((x) => x.uid === uid)
	if (!c || c.upgraded || isCurseCard(s.b, c)) return false
	c.upgraded = true
	s.fx.push({k: 'card', op: 'upgrade', id: c.id})
	toast(s, COPY2.toasts.upgraded(deckName(s.b, {...c, upgraded: false})))
	return true
}

function nextPage(s) {
	s.b.page = Math.min(s.b.path.L, s.b.page + 1)
	s.fx.push({k: 'page', page: s.b.page})
}

function applyTwist(s, kind) {
	if (!kind) return
	s.b.twists.push({kind, used: false, page: s.b.page})
	toast(s, COPY2.toasts.twist(COPY2.offer.twists[kind]))
}

// =======================================================================================
// Moments: Wayfarer and Keeper dialogue (Marcus keeps the MVP rules in book.js)
// =======================================================================================

const optionIds = (b, who) => {
	const npc = b.npcs[who]
	if (npc.closed || npc.trust <= -3) return []
	const ids = Object.keys(NPC_LINES[who].options).filter((id) => !npc.said.includes(id))
	if (npc.n >= 1) ids.push('offer')
	return ids
}
const optionList = (b, who) => optionIds(b, who).map((id) => ({id, text: id === 'offer' ? COPY2.moment.offerAsk : NPC_LINES[who].options[id].text}))

export function momentPanel(book, who) {
	const npc = book.npcs[who]
	return {trust: npc.trust, freeText: !npc.closed && book.status === 'exploring', options: optionList(book, who), closed: npc.closed}
}

function npcSay(s, who, text, narr = false) {
	s.fx.push({k: 'say', who, text, ...(narr ? {narr: true} : {})})
}

function npcTrust(s, who, delta) {
	const npc = s.b.npcs[who]
	const prev = npc.trust
	npc.trust = Math.max(-3, Math.min(3, prev + delta))
	if (npc.trust !== prev) s.fx.push({k: 'trust', delta: npc.trust - prev, trust: npc.trust})
}

function afterExchange(s, who) {
	const npc = s.b.npcs[who]
	npc.n += 1
	if (npc.n === 2) npcSay(s, who, NPC_LINES[who].beat2)
	if (npc.n === 3 && npc.trust >= 1) npcSay(s, who, NPC_LINES[who].beat3)
	if (npc.n >= 3 && !npc.closed) {
		npc.offered = true
		npcSay(s, who, npc.trust <= -2 ? NPC_LINES[who].cold : NPC_LINES[who].offer)
		s.fx.push({k: 'offer'})
		return
	}
	s.fx.push({k: 'options', options: optionList(s.b, who)})
}

function momentTalk(s, who) {
	const npc = s.b.npcs[who]
	if (npc.closed) {
		npcSay(s, who, NPC_LINES[who].closed, true)
		s.fx.push({k: 'close'})
		return
	}
	if (!npc.met) {
		npc.met = true
		if (who === 'keeper' && (s.b.echo || s.b.booksWritten > 0)) npcSay(s, who, NPC_LINES.keeper.echo)
		npcSay(s, who, NPC_LINES[who].opening[s.b.path.themes[0]])
	} else npcSay(s, who, npc.n >= 1 ? NPC_LINES[who].beat2 : NPC_LINES[who].opening[s.b.path.themes[0]])
	if (npc.offered) s.fx.push({k: 'offer'})
	else s.fx.push({k: 'options', options: optionList(s.b, who)})
}

function momentOption(s, who, id) {
	if (!optionIds(s.b, who).includes(id)) return 'not_allowed'
	const npc = s.b.npcs[who]
	if (id === 'offer') {
		npc.offered = true
		npcSay(s, who, npc.trust <= -2 ? NPC_LINES[who].cold : NPC_LINES[who].offer)
		s.fx.push({k: 'offer'})
		return null
	}
	const o = NPC_LINES[who].options[id]
	npc.said.push(id)
	npcSay(s, who, o.reply)
	if (o.trust) npcTrust(s, who, o.trust)
	afterExchange(s, who)
	return null
}

/**
 * Free text with an archetype: the intent comes from the validated AI proposal or the
 * local classifier (passed in by book.js so this file does not import Marcus's tables).
 */
export function momentFree(s, who, {intent, aiReply, aiTrust, text}) {
	const npc = s.b.npcs[who]
	if (npc.closed) return 'not_allowed'
	const rule = NPC_FREE[who][intent] ?? NPC_FREE[who].ask
	if (intent === 'request') npc.request = String(text).slice(0, 120)
	if (rule.narr) npcSay(s, who, rule.narr, true)
	if (rule.hp) loseHp(s, rule.hp)
	npcSay(s, who, aiReply && !rule.closes ? aiReply : rule.reply)
	if (rule.mark) {
		s.b.marks = Math.min(2, s.b.marks + 1)
		toast(s, COPY2.toasts.mark)
	}
	if (rule.closes) {
		npc.closed = true
		npc.trust = Math.min(npc.trust, -2)
		s.fx.push({k: 'close'})
		return null
	}
	let delta = rule.aiTrust && aiReply ? aiTrust : rule.trust
	if (delta > 0) {
		delta = Math.max(0, Math.min(delta, 2 - npc.freeTextGain))
		npc.freeTextGain += delta
	}
	if (delta) npcTrust(s, who, delta)
	afterExchange(s, who)
	return null
}

// =======================================================================================
// The action table
// =======================================================================================

/** v2 action types handled here (book.js routes them). */
export const RUN_ACTIONS = new Set([
	'page.skip',
	'moment.talk',
	'moment.option',
	'moment.free',
	'offer.take',
	'offer.decline',
	'lectern.take',
	'well.remove',
	'well.ward',
	'grind.upgrade',
	'grindstone.take',
	'shrine.take',
	'hearth.rest',
	'hearth.temper',
	'hearth.burn',
	'hearth.remove',
	'spoils.take',
	'spoils.leave',
	'fight.begin',
	'fight.result',
	'fight.cancel',
	'book.unfinished',
])
/** Actions only the host (solo store / the room) may send, never a co-op client. */
export const INTERNAL_ACTIONS = new Set(['fight.result', 'fight.begin', 'fight.cancel', 'book.unfinished'])

/** Page checks shared by every page action. Returns an error string or ''. */
function pageGuard(book, action, ctx, {types, needPos = true} = {}) {
	if (book.status !== 'exploring') return 'not_allowed'
	if (book.pend) return 'pending'
	const p = currentPage(book)
	if (!p) return 'not_allowed'
	if (action.page !== undefined && action.page !== book.page) return 'not_allowed'
	if (types && !types.includes(p.type === 'station' ? p.station : p.type)) return 'not_allowed'
	if (ctx?.maxPage !== undefined && book.page > ctx.maxPage) return 'wait'
	if (needPos) {
		const pos = ctx?.pos
		if (!Array.isArray(pos) || !inSiteRange(siteOf(book), pos[0], pos[1])) return 'too_far'
	}
	return ''
}

const meta = (book, src = 'offline', offer = 'gift') => ({offer, src, page: book.page})
/** Registry offer kind for a content-gen label (parseRunContent re-validates with it). */
const offerOf = (label) => (label === 'bargain' ? 'bargain' : label === 'curse' ? 'curse' : 'gift')

/** "With a twist" (GDD_V2 9.1, 18.3): the Keeper's gift card at Warm or better changes a later page. */
export function twistFor(book, slot, page = book.page) {
	const p = book.path.pages[page]
	if (p?.archetype !== 'keeper' || book.npcs.keeper.trust < 1) return null
	const sl = offerSlots(book, page)[slot]
	if (sl?.kind !== 'card' || sl.label !== 'gift') return null
	return book.path.pages.some((q, j) => j > page && q.station === 'lectern') ? 'lectern4' : 'spoils4'
}

/**
 * Take one offer of the current moment. Offline: {slot} (the rules regenerate the offer).
 * AI: {slot, def} where def is the model's raw offer object; it is re-checked against the
 * slot (kind, label, rarity, schema, budget, fairness, balance sim with the book's seed).
 */
function takeOffer(s, book, action) {
	const p = currentPage(book)
	const who = p.type === 'marcus' ? 'marcus' : p.archetype
	if (who !== 'marcus' && !book.npcs[who].offered) return 'not_allowed'
	const ctx = momentContext(book)
	const slots = momentSlots(ctx)
	const j = action.slot
	const slot = Number.isInteger(j) ? slots[j] : null
	if (!slot) return 'bad_slot'
	let offer
	if (action.def && typeof action.def === 'object') {
		const r = checkMomentOffer(action.def, slot, j, ctx, new Set(ctx.existingNames.map((n) => String(n).toLowerCase())))
		if (!r.ok) return 'not_allowed'
		offer = r.offer
		s.b.aiRead = true
	} else offer = offlineOffers(book)[j]
	if (!offer) return 'bad_slot'
	const m = meta(book, offer.src === 'ai' ? 'ai' : offer.src === 'world' ? 'world' : 'offline', offerOf(offer.label))
	switch (offer.kind) {
		case 'card':
			gainCardDef(s, offer.def, m)
			if (offer.hidden) gainCurseDef(s, offer.hidden, {offer: 'curse', src: 'offline', page: book.page})
			break
		case 'curse':
			gainCurseDef(s, offer.def, {...m, offer: 'curse'})
			break
		case 'item': {
			const r = equip(s, offer.def, m, Boolean(action.swap))
			if (r.error) return r.error
			break
		}
		case 'token': {
			const r = gainTokenDef(s, offer.def, m)
			if (r.error) return r.error
			break
		}
		case 'upgrade':
			if (!upgradeUid(s, offer.target?.uid)) return 'bad_card'
			break
		case 'remove': {
			const c = s.b.deck.find((x) => x.uid === offer.target?.uid)
			if (!c) return 'bad_card'
			if (isKeepsake(s.b, c)) return 'keepsake'
			const name = deckName(s.b, c)
			removeDeckCard(s, c.uid)
			s.fx.push({k: 'card', op: 'remove', id: c.id})
			toast(s, COPY2.toasts.removed(name))
			break
		}
		default:
			return 'bad_slot'
	}
	applyTwist(s, twistFor(book, j))
	if (who !== 'marcus') npcSay(s, who, NPC_LINES[who].parting)
	nextPage(s)
	return null
}

function takeSpoils(s, action) {
	const offers = spoilsOffers(s.b)
	const o = offers.find((x) => x.slot === action.slot)
	if (!o) return 'bad_slot'
	const pend = s.b.pend
	const m = {offer: 'gift', src: o.src === 'world' ? 'world' : 'offline', page: pend.page}
	if (o.kind === 'item') {
		const r = equip(s, o.def, m, Boolean(action.swap))
		if (r.error) return r.error
	} else gainCardDef(s, o.def, m)
	if (pend.kind === 'catchup' && pend.left > 1) s.b.pend = {...pend, left: pend.left - 1, n: pend.n + 1}
	else s.b.pend = null
	return null
}

/**
 * Apply one v2 action. Same contract as applyBookAction (book.js calls this).
 * ctx: {pos, now, coop?, internal?, maxPage?}
 * @returns {import('../contracts.js').BookResult}
 */
export function applyRunAction(book, action, ctx = {}, hooks = {}) {
	if (!isV2(book)) return fail(book, 'not_allowed')
	if (INTERNAL_ACTIONS.has(action.type) && ctx.coop && !ctx.internal) return fail(book, 'not_allowed')
	const s = {b: clone(book), fx: []}
	let err = null
	const g = (opts) => pageGuard(book, action, ctx, opts)
	switch (action.type) {
		case 'page.skip': {
			const p = currentPage(book)
			err = g({needPos: false})
			if (!err && !SKIPPABLE.includes(p.type)) err = 'not_allowed'
			if (!err) nextPage(s)
			break
		}
		case 'moment.talk':
		case 'moment.option': {
			err = g({types: ['moment']})
			if (err) break
			const who = currentPage(book).archetype
			if (action.type === 'moment.talk') momentTalk(s, who)
			else err = momentOption(s, who, String(action.option))
			break
		}
		case 'moment.free': {
			err = g({types: ['moment']})
			if (err) break
			const text = String(action.text ?? '')
				.replace(/\s+/g, ' ')
				.trim()
			if (!text || text.length > FREE_TEXT_MAX) {
				err = 'bad_text'
				break
			}
			// The model only PROPOSES; a bad proposal falls back to the local classifier.
			let intent = isRequest(text) ? 'request' : null
			let aiReply = null
			let aiTrust = 0
			if (!intent && action.ai) {
				const v = validateAiProposal(action.ai)
				if (v.ok) ({intent, reply: aiReply, trust: aiTrust} = v.proposal)
			}
			if (aiReply) s.b.aiRead = true
			err = momentFree(s, currentPage(book).archetype, {intent: intent ?? classifyFreeText(text), aiReply, aiTrust, text})
			break
		}
		case 'offer.take':
			err = g({types: ['marcus', 'moment']}) || takeOffer(s, book, action)
			break
		case 'offer.decline': {
			err = g({types: ['marcus', 'moment']})
			if (err) break
			const p = currentPage(book)
			if (p.type === 'moment') npcSay(s, p.archetype, NPC_LINES[p.archetype].parting)
			nextPage(s)
			break
		}
		case 'lectern.take': {
			err = g({types: ['lectern']})
			if (err) break
			const o = lecternOffers(book).find((x) => x.slot === action.slot)
			if (!o) {
				err = 'bad_slot'
				break
			}
			gainCardDef(s, o.def, {offer: 'gift', src: o.echo ? 'echo' : 'offline', page: book.page})
			if (o.echo) s.b.echoUsed = true
			const tw = s.b.twists.find((t) => t.kind === 'lectern4' && !t.used)
			if (tw) tw.used = true
			s.b.used.lectern = true
			nextPage(s)
			break
		}
		case 'well.remove': {
			err = g({types: ['well']})
			if (err) break
			const c = s.b.deck.find((x) => x.uid === action.uid)
			if (!c) err = 'bad_card'
			else if (isKeepsake(s.b, c)) err = 'keepsake'
			else {
				const name = deckName(s.b, c)
				removeDeckCard(s, c.uid)
				s.fx.push({k: 'card', op: 'remove', id: c.id})
				toast(s, COPY2.toasts.removed(name))
				s.b.used.well = true
				nextPage(s)
			}
			break
		}
		case 'well.ward':
		case 'grindstone.take': {
			const kind = action.type === 'well.ward' ? 'ward' : 'whetstone'
			err = g({types: [action.type === 'well.ward' ? 'well' : 'grindstone']})
			if (err) break
			const r = gainMvpToken(s, kind)
			if (r.error) {
				err = r.error
				break
			}
			s.b.used[action.type === 'well.ward' ? 'well' : 'grindstone'] = true
			toast(s, COPY2.toasts.token(kind === 'ward' ? 'Ward' : 'Whetstone'))
			nextPage(s)
			break
		}
		case 'grind.upgrade':
			err = g({types: ['grindstone']})
			if (err) break
			if (!upgradeUid(s, action.uid)) err = 'bad_card'
			else {
				s.b.used.grindstone = true
				nextPage(s)
			}
			break
		case 'shrine.take': {
			err = g({types: ['shrine']})
			if (err) break
			const o = shrineOffer(book)
			if (!o) {
				err = 'not_allowed'
				break
			}
			gainCardDef(s, o.def, {offer: 'gift', src: 'offline', page: book.page})
			gainDoubtV2(s, 'shrine', o.cost?.doubt ?? 2)
			s.b.used.shrine = true
			nextPage(s)
			break
		}
		case 'hearth.rest':
			err = g({types: ['hearth']})
			if (err) break
			heal(s, Math.floor(s.b.maxHp * 0.3), {hearth: true})
			nextPage(s)
			break
		case 'hearth.temper': {
			err = g({types: ['hearth']})
			if (err) break
			const uids = [action.uid, action.uid2].filter((x) => typeof x === 'string').slice(0, temperCount(book))
			if (!uids.length || new Set(uids).size !== uids.length) {
				err = 'bad_card'
				break
			}
			for (const uid of uids) if (!upgradeUid(s, uid)) err = 'bad_card'
			if (!err) {
				if (uids.length > 1) s.fx.push({k: 'say', who: 'marcus', text: COPY2.hearth.forTobin})
				nextPage(s)
			}
			break
		}
		case 'hearth.burn':
		case 'hearth.remove': {
			err = g({types: ['hearth']})
			if (err) break
			const c = s.b.deck.find((x) => x.uid === action.uid)
			const burn = action.type === 'hearth.burn'
			if (!c) err = 'bad_card'
			else if (burn && (curseCount(book) < 2 || !isCurseCard(book, c))) err = 'not_allowed'
			else if (!burn && (!book.path.hearthRemove || isKeepsake(book, c))) err = isKeepsake(book, c) ? 'keepsake' : 'not_allowed'
			else {
				const name = deckName(s.b, c)
				removeDeckCard(s, c.uid)
				s.fx.push({k: 'card', op: 'remove', id: c.id})
				toast(s, COPY2.toasts.removed(name))
				nextPage(s)
			}
			break
		}
		case 'spoils.take':
			if (book.status !== 'exploring' || !book.pend) {
				err = 'not_allowed'
				break
			}
			err = takeSpoils(s, action)
			break
		case 'spoils.leave':
			if (book.status !== 'exploring' || !book.pend) {
				err = 'not_allowed'
				break
			}
			if (book.pend.kind === 'catchup') s.b.pend = book.pend.left > 1 ? {...book.pend, left: book.pend.left - 1, n: book.pend.n + 1} : null
			else {
				heal(s, SPOILS_LEAVE_HEAL)
				s.b.pend = null
			}
			break
		case 'fight.begin': {
			err = g({needPos: !ctx.internal})
			if (!err && !isFight(currentPage(book).type)) err = 'not_allowed'
			if (!err) s.b.status = 'fighting'
			break
		}
		case 'fight.cancel':
			if (book.status !== 'fighting') err = 'not_allowed'
			else s.b.status = 'exploring'
			break
		case 'fight.result': {
			const p = currentPage(book)
			if (!p || !isFight(p.type) || (book.status !== 'fighting' && book.status !== 'exploring')) {
				err = 'not_allowed'
				break
			}
			const won = Boolean(action.won)
			// Tokens are spent whatever the outcome (GDD 3.4).
			s.b.tokens = []
			s.b.stats.turns += clampInt(action.turns, 0, 999)
			s.b.stats.fights += 1
			if (!won) {
				s.b.hp = 0
				s.b.status = 'dead'
				break
			}
			s.b.hp = clampInt(action.hp, 1, s.b.maxHp)
			if (p.type === 'final') {
				s.b.status = 'won'
				s.b.page = s.b.path.L
				break
			}
			s.b.status = 'exploring'
			const after = afterFight({deckDefs: s.b.deck.map((c) => deckDef(s.b, c)).filter(Boolean), itemDefs: itemDefs(s.b), won: true})
			if (after.heal) heal(s, after.heal)
			const extra = s.b.twists.find((t) => t.kind === 'spoils4' && !t.used)
			if (extra) extra.used = true
			s.b.pend = {kind: 'spoils', page: book.page, elite: p.type === 'elite', extra: Boolean(extra)}
			nextPage(s)
			break
		}
		case 'book.unfinished':
			s.b.status = 'unfinished'
			break
		default:
			err = 'bad_action'
	}
	if (err) {
		const fx = err === 'keepsake' ? [{k: 'toast', text: COPY2.offer.keepsakeRefuse}] : err === 'tokens_full' ? [{k: 'toast', text: COPY2.offer.tokensFull}] : []
		return fail(book, err, fx)
	}
	hooks.after?.(s)
	return {ok: true, book: s.b, effects: s.fx}
}

// =======================================================================================
// Ends of books: echo, saving, loading
// =======================================================================================

/**
 * GDD_V2 15: the dead deck's best non-curse, non-keepsake card (highest PP), base version.
 * @returns {{def: object, name: string, fromBook: number} | null}
 */
export function echoFromBook(book) {
	let best = null
	let bestPP = -Infinity
	for (const c of book.deck) {
		const def = deckDef(book, c)
		if (!def || def.kind !== 'card' || def.rarity === 'keepsake' || def.rarity === 'special') continue
		const pp = scoreContent(def).pp
		if (pp > bestPP) {
			best = def
			bestPP = pp
		}
	}
	return best ? {def: best, name: best.name, fromBook: book.bookNo} : null
}

/**
 * Re-check a saved (or received) v2 book: shape, versions, and every generated def
 * (parseRunContent drops edited defs; deck cards, items and tokens pointing at them go).
 * Version pins (engine major, kept editions) are checked by the caller with the platform's
 * checkPin (game.js); this only checks the book itself.
 * @returns {{ok: true, book: object, dropped: number} | {ok: false, reason: 'shape'|'seed'}}
 */
export function parseSavedBook(raw) {
	if (!raw || typeof raw !== 'object' || raw.v !== BOOK_V2 || !raw.path || !Array.isArray(raw.path.pages) || !Array.isArray(raw.deck)) return {ok: false, reason: 'shape'}
	if (!isSeedCode(raw.seed)) return {ok: false, reason: 'seed'}
	const pr = parseRunContent(raw.content ?? null)
	if (!pr.ok) return {ok: false, reason: 'shape'}
	const book = clone(raw)
	book.content = pr.rc
	const has = (id) => !id.startsWith('g:') || Boolean(pr.rc.defs[id])
	book.deck = book.deck.filter((c) => c && typeof c.uid === 'string' && typeof c.id === 'string' && has(c.id))
	book.items = (book.items ?? []).filter((id) => typeof id === 'string' && pr.rc.defs[id])
	book.tokens = (book.tokens ?? []).filter((id) => typeof id === 'string' && (TOKEN_KINDS.includes(id) || pr.rc.defs[id])).slice(0, MAX_TOKENS)
	if (book.status === 'fighting') book.status = 'exploring' // GDD_V2 16: a reload resumes at the start of that fight
	book.page = clampInt(book.page, 0, book.path.L)
	return {ok: true, book, dropped: pr.dropped.length}
}

/** Theme display names for a book: [primary, secondary, shadow]. */
export const themeNames = (book) => book.path.themes.map((t) => THEME_NAMES[t] ?? t)

export {SITES}
export const KEEPSAKE_NAMES = Object.freeze(KEEPSAKES.map((k) => k.name))
