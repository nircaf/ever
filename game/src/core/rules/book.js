// EVER book rules: stations, Marcus trust/beats/free text, tokens, curses (GDD 2, 3).
// OWNER: systems engineer. PURE (no DOM): the room server imports this exact file.
// Contract: applyBookAction(book, action, ctx) -> BookResult (contracts.js section 2).
// It never mutates `book`: it works on a private clone and returns it. Deck changes go
// through the deck mutation helpers of contracts.js, so their validation applies here too.
//
// Effects (what the UI shows) carry GDD copy only; the single exception is a `say` that
// holds a validated AI reply. Outcome lines ("-6 HP", "A Doubt is written...") are ours.
//
// Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later

import {
	CURSE_ID,
	FREE_TEXT_MAX,
	SHRINE_CARD,
	STATIONS,
	addCard,
	addCurse,
	addToken,
	inStationRange,
	removeCard,
	trustWord,
	upgradableCards,
	upgradeCard,
	validateAiProposal,
} from '../contracts.js'
import {COPY} from '../copy.js'
import {EPILOGUE, FREE_RULES, FREE_TEXT_CAP, GREETINGS, LINES, NOTHING_MORE, OPTION_TEXT, classifyFreeText, topicAnswer} from './marcus.js'

/** Display name of a deck card: base id plus "+" when upgraded (engine convention). */
export const cardLabel = (c) => c.id + (c.upgraded ? '+' : '')

const clampTrust = (n) => Math.max(-3, Math.min(3, n))
const fail = (book, error, effects = []) => ({ok: false, book, error, effects})

// ---------------------------------------------------------------------------------------
// Working state: `s.b` is a private clone. Always re-read s.b after calling a deck helper
// (they return a new book), never cache s.b.marcus across such a call.
// ---------------------------------------------------------------------------------------

const say = (s, text, narr = false) => s.fx.push(narr ? {k: 'say', who: 'marcus', text, narr: true} : {k: 'say', who: 'marcus', text})
const toast = (s, text) => s.fx.push({k: 'toast', text})
const said = (s, key) => s.b.marcus.said.includes(key)
const markSaid = (s, key) => {
	if (!said(s, key)) s.b.marcus.said.push(key)
}

function gainCard(s, id) {
	s.b = addCard(s.b, id)
	s.fx.push({k: 'card', op: 'add', id})
}
function gainDoubt(s, source, n = 1) {
	s.b = addCurse(s.b, source, n)
	for (let i = 0; i < n; i++) s.fx.push({k: 'card', op: 'add', id: CURSE_ID})
}
function gainToken(s, kind) {
	s.b = addToken(s.b, kind)
	s.fx.push({k: 'token', kind})
	toast(s, COPY.toasts.tokenGained(COPY.hud.tokenName[kind]))
}
function loseHp(s, n) {
	const before = s.b.hp
	s.b.hp = Math.max(1, before - n)
	if (s.b.hp !== before) s.fx.push({k: 'hp', delta: s.b.hp - before})
}

// ---------------------------------------------------------------------------------------
// Marcus: options and thresholds
// ---------------------------------------------------------------------------------------

/** Ids of the dialogue options currently offered (GDD 2.3). */
export function marcusOptionIds(b) {
	const m = b.marcus
	const f = m.flags
	if (b.status === 'epilogue') return []
	if (!f.met || m.beat === 1) return ['b1.what', 'b1.sorry', 'b1.smith']
	if (m.trust <= -2) return []
	const out = []
	if (!m.anvilClosed && m.upgradesLeft > 0) out.push('anvil.open')
	if (f.confessed) {
		const forgave = m.said.includes('b3.forgive')
		if (!forgave) out.push('b3.forgive')
		if (!f.tip) out.push('b3.tip')
		if (!forgave && !m.said.includes('b3.insult')) out.push('b3.insult')
	}
	for (const id of ['b2.promise', 'b2.greedy', 'b2.why']) if (!m.said.includes(id)) out.push(id)
	if (!f.confessed && (f.promised || f.askedWhy)) out.push('b3.who')
	return out
}

/** What the dialogue panel needs besides effects. */
export function marcusPanel(b) {
	return {
		trust: b.marcus.trust,
		word: trustWord(b.marcus.trust),
		freeText: !b.marcus.flags.struck && b.status === 'exploring',
		options: marcusOptionIds(b).map((id) => ({id, text: OPTION_TEXT[id]})),
	}
}

const pushOptions = (s) => s.fx.push({k: 'options', options: marcusOptionIds(s.b).map((id) => ({id, text: OPTION_TEXT[id]}))})

/**
 * Apply the trust thresholds of GDD 2.2 after a change. `prev` is the trust before it.
 * allowCold: whether crossing -2 hands out the Doubt (own actions yes; a friend's strike no).
 */
function settle(s, prev, allowCold = true) {
	const t = s.b.marcus.trust
	if (t <= -2 && !s.b.marcus.anvilClosed) {
		s.b.marcus.anvilClosed = true
		s.b.marcus.upgradesLeft = 0
	}
	if (allowCold && prev > -2 && t <= -2 && !s.b.curses.cold) {
		say(s, LINES.curse)
		gainDoubt(s, 'cold')
		toast(s, COPY.toasts.doubt)
	}
	if (prev >= 2 !== t >= 2) s.fx.push({k: 'lantern', lit: t >= 2})
	if (t >= 1 && !s.b.marcus.anvilClosed && !s.b.marcus.flags.upgradeAt1) {
		s.b.marcus.flags.upgradeAt1 = true
		s.b.marcus.upgradesLeft += 1
		toast(s, COPY.toasts.anvilOpen)
	}
	if (t >= 2 && s.b.marcus.flags.confessed && !s.b.marcus.flags.emberGiven) {
		s.b.marcus.flags.emberGiven = true
		say(s, LINES.ember)
		gainToken(s, 'ember')
	}
	if (t >= 3 && !s.b.marcus.anvilClosed && !s.b.marcus.flags.upgradeAt3) {
		s.b.marcus.flags.upgradeAt3 = true
		s.b.marcus.upgradesLeft += 1
		say(s, LINES.second)
	}
}

function changeTrust(s, delta, {setTo = null, allowCold = true} = {}) {
	const prev = s.b.marcus.trust
	const next = setTo ?? clampTrust(prev + delta)
	s.b.marcus.trust = next
	if (next !== prev) s.fx.push({k: 'trust', delta: next - prev, trust: next})
	settle(s, prev, allowCold)
}

// ---------------------------------------------------------------------------------------
// Marcus: actions
// ---------------------------------------------------------------------------------------

function talk(s) {
	const b = s.b
	const f = b.marcus.flags
	b.visited.marcus = true
	if (b.status === 'epilogue') {
		say(s, b.marcus.trust >= 1 ? EPILOGUE.warm : EPILOGUE.plain)
		return
	}
	if (!f.met) {
		f.met = true
		if (b.booksWritten > 0) say(s, LINES.haveWeMet, true)
	}
	if (f.friendStruck && !said(s, 'greet.friend')) {
		markSaid(s, 'greet.friend')
		say(s, LINES.friendStruck)
	}
	if (b.marcus.beat === 1) say(s, LINES.beat1)
	else if (!said(s, 'beat2')) {
		markSaid(s, 'beat2')
		say(s, LINES.beat2)
	} else say(s, GREETINGS[trustWord(b.marcus.trust)])
	pushOptions(s)
}

function enterBeat2(s) {
	s.b.marcus.beat = Math.max(2, s.b.marcus.beat)
	markSaid(s, 'beat2')
	say(s, LINES.beat2)
}

function option(s, id) {
	if (!marcusOptionIds(s.b).includes(id)) return 'not_allowed'
	let close = false
	switch (id) {
		case 'b1.what':
			changeTrust(s, 0)
			enterBeat2(s)
			break
		case 'b1.sorry':
			say(s, LINES.beat1Sorry)
			changeTrust(s, 1)
			enterBeat2(s)
			break
		case 'b1.smith':
			say(s, LINES.beat1Smith)
			s.b.marcus.beat = 2 // next talk opens at beat 2
			changeTrust(s, -1)
			close = true
			break
		case 'b2.promise':
			markSaid(s, id)
			s.b.marcus.flags.promised = true
			say(s, LINES.promise)
			changeTrust(s, 1)
			break
		case 'b2.greedy':
			markSaid(s, id)
			say(s, LINES.greedy)
			changeTrust(s, -1)
			break
		case 'b2.why':
			markSaid(s, id)
			s.b.marcus.flags.askedWhy = true
			say(s, LINES.why)
			break
		case 'b3.who':
			if (s.b.marcus.trust <= 0) {
				say(s, LINES.whoCold)
				break
			}
			s.b.marcus.flags.confessed = true
			s.b.marcus.beat = Math.max(3, s.b.marcus.beat)
			say(s, LINES.confession)
			settle(s, s.b.marcus.trust) // Ember check fires if trust is already 2
			break
		case 'b3.forgive':
			markSaid(s, id)
			s.b.marcus.beat = 4
			say(s, LINES.forgive)
			changeTrust(s, 2)
			break
		case 'b3.tip':
			s.b.marcus.flags.tip = true
			say(s, LINES.tip)
			break
		case 'b3.insult':
			markSaid(s, id)
			say(s, LINES.insult)
			changeTrust(s, -2)
			close = true
			break
		case 'anvil.open':
			say(s, LINES.anvilPrompt)
			s.fx.push({k: 'picker', purpose: 'anvil'})
			break
		default:
			return 'bad_action'
	}
	if (close) s.fx.push({k: 'close'})
	else pushOptions(s)
	return null
}

function anvilUpgrade(s, uid) {
	const m = s.b.marcus
	if (s.b.status !== 'exploring') return 'not_allowed'
	if (m.anvilClosed || m.upgradesLeft < 1) return 'not_allowed'
	const card = upgradableCards(s.b).find((c) => c.uid === uid)
	if (!card) return 'bad_card'
	s.b = upgradeCard(s.b, uid)
	s.b.marcus.upgradesLeft -= 1
	say(s, LINES.anvilDone)
	s.fx.push({k: 'card', op: 'upgrade', id: card.id})
	toast(s, COPY.toasts.upgraded(card.id))
	pushOptions(s)
	return null
}

function freeText(s, action) {
	if (s.b.marcus.flags.struck || s.b.status !== 'exploring') return 'not_allowed'
	const text = String(action.text ?? '')
		.replace(/\s+/g, ' ')
		.trim()
	if (!text || text.length > FREE_TEXT_MAX) return 'bad_text'

	// The model only PROPOSES. A bad proposal is dropped and the local classifier decides.
	let intent = null
	let aiReply = null
	let aiTrust = 0
	if (action.ai !== undefined && action.ai !== null) {
		const v = validateAiProposal(action.ai)
		if (v.ok) {
			intent = v.proposal.intent
			aiReply = v.proposal.reply
			aiTrust = v.proposal.trust
		}
	}
	if (!intent) intent = classifyFreeText(text)

	const rule = FREE_RULES[intent]
	const variant = s.b.marcus.freeTextCount % 2
	s.b.marcus.freeTextCount += 1

	if (rule.narr) say(s, rule.narr, true)
	if (rule.hp) loseHp(s, rule.hp)
	if (aiReply) say(s, aiReply)
	else if (intent === 'ask') say(s, topicAnswer(text, s.b.marcus.trust))
	else if (rule.reply) say(s, rule.reply[variant])

	if (intent === 'attack') {
		changeTrust(s, 0, {setTo: rule.setTrust, allowCold: false})
		s.b.marcus.flags.struck = true
		s.b.marcus.anvilClosed = true
		s.b.marcus.upgradesLeft = 0
		if (!s.b.curses.struck) {
			gainDoubt(s, 'struck')
			toast(s, COPY.toasts.doubt)
		}
	} else {
		let delta = rule.trust
		if (rule.aiTrust && aiReply) delta = aiTrust
		if (delta > 0) {
			const gain = Math.max(0, Math.min(delta, FREE_TEXT_CAP - s.b.marcus.freeTextGain))
			s.b.marcus.freeTextGain += gain
			if (gain === 0 && intent === 'help') say(s, NOTHING_MORE, true)
			delta = gain
		}
		if (delta !== 0) changeTrust(s, delta)
	}
	pushOptions(s)
	return null
}

/** GDD 7.2 shared memory. Room-internal. Once per book, never hands out a Doubt. */
function friendStruck(book) {
	if (book.marcus.flags.friendStruck) return {ok: true, book, effects: []}
	const s = {b: structuredClone(book), fx: []}
	s.b.marcus.flags.friendStruck = true
	changeTrust(s, -1, {allowCold: false})
	return {ok: true, book: s.b, effects: s.fx}
}

// ---------------------------------------------------------------------------------------
// The one entry point
// ---------------------------------------------------------------------------------------

const STATION_OF = {
	'well.remove': 'well',
	'well.ward': 'well',
	'lectern.take': 'lectern',
	'lectern.leave': 'lectern',
	'grindstone.take': 'grindstone',
	'shrine.take': 'shrine',
	'marcus.talk': 'marcus',
	'marcus.option': 'marcus',
	'marcus.free': 'marcus',
	'anvil.upgrade': 'marcus',
}

/**
 * @param {import('../contracts.js').Book} book
 * @param {import('../contracts.js').BookAction} action
 * @param {import('../contracts.js').BookCtx} ctx
 * @returns {import('../contracts.js').BookResult}
 */
export function applyBookAction(book, action, ctx) {
	if (!book || !action || typeof action.type !== 'string') return fail(book, 'bad_action')
	if (action.type === 'marcus.friendStruck') return friendStruck(book)
	if (action.type === 'epilogue.stay') {
		// "Stay in Ashbrook" after a win (solo and co-op): the book stays won, the village
		// stays open for a last word with Marcus. No deck change.
		if (book.status !== 'won') return fail(book, 'not_allowed')
		const b = structuredClone(book)
		b.status = 'epilogue'
		return {ok: true, book: b, effects: []}
	}
	const station = action.type === 'visit' ? action.place : STATION_OF[action.type]
	if (!station || !(station in STATIONS)) return fail(book, 'bad_action')
	if (book.status !== 'exploring' && !(book.status === 'epilogue' && action.type === 'marcus.talk')) return fail(book, 'not_allowed')
	const pos = ctx?.pos
	if (!Array.isArray(pos) || !inStationRange(station, pos[0], pos[1])) return fail(book, 'too_far')

	const s = {b: structuredClone(book), fx: []}
	let err = null
	switch (action.type) {
		case 'visit':
			if (station in s.b.visited) s.b.visited[station] = true
			break
		case 'well.remove': {
			if (s.b.used.well) return fail(book, 'used')
			const card = s.b.deck.find((c) => c.uid === action.uid)
			if (!card) return fail(book, 'bad_card')
			s.b = removeCard(s.b, card.uid)
			s.b.used.well = true
			s.fx.push({k: 'card', op: 'remove', id: card.id})
			toast(s, COPY.toasts.cardRemoved(cardLabel(card)))
			break
		}
		case 'well.ward':
			if (s.b.used.well) return fail(book, 'used')
			if (s.b.tokens.includes('ward')) return fail(book, 'not_allowed')
			s.b.used.well = true
			gainToken(s, 'ward')
			break
		case 'lectern.take':
			if (s.b.used.lectern) return fail(book, 'used')
			if (!s.b.lecternOffer.includes(action.id)) return fail(book, 'bad_card')
			s.b.used.lectern = true
			gainCard(s, action.id)
			toast(s, COPY.toasts.cardGained(action.id))
			break
		case 'lectern.leave':
			// Declining does not spend the stone: you may come back and choose.
			s.fx.push({k: 'close'})
			break
		case 'grindstone.take':
			if (s.b.used.grindstone) return fail(book, 'used')
			if (s.b.tokens.includes('whetstone')) return fail(book, 'not_allowed')
			s.b.used.grindstone = true
			gainToken(s, 'whetstone')
			break
		case 'shrine.take':
			if (s.b.used.shrine) return fail(book, 'used')
			s.b.used.shrine = true
			gainCard(s, SHRINE_CARD)
			gainDoubt(s, 'shrine', 2)
			toast(s, COPY.toasts.shrine)
			break
		case 'marcus.talk':
			talk(s)
			break
		case 'marcus.option':
			err = option(s, String(action.option))
			if (err === 'not_allowed' && action.option === 'anvil.open') return fail(book, err, [{k: 'say', who: 'marcus', text: LINES.anvilProve}])
			break
		case 'marcus.free':
			err = freeText(s, action)
			break
		case 'anvil.upgrade':
			err = anvilUpgrade(s, action.uid)
			break
		default:
			err = 'bad_action'
	}
	if (err) return fail(book, err)
	return {ok: true, book: s.b, effects: s.fx}
}

// ---------------------------------------------------------------------------------------
// Meta, ending a book, hints
// ---------------------------------------------------------------------------------------

/**
 * GDD 1.2 remembered-line priority, applied when a book ends.
 * @param {import('../contracts.js').Book} book
 * @param {{won?: boolean, dead?: boolean}} end   dead = the Warden killed you (not a reload)
 * @param {string} previous
 * @returns {string}
 */
export function rememberedLineFor(book, end, previous) {
	const L = COPY.rememberedLines
	if (book.marcus.trust === 3) return L.trust3
	if (end.won && book.marcus.trust <= 2) return L.wonCold
	if (book.marcus.flags.struck) return L.struck
	if (end.dead) return L.died
	return previous
}

/**
 * The meta after a book ends (win, death, or abandoned by reload): booksWritten +1 and the
 * remembered line by priority. Pure.
 * @returns {import('../contracts.js').Meta}
 */
export function metaAfterBook(meta, book, end) {
	return {booksWritten: meta.booksWritten + 1, rememberedLine: rememberedLineFor(book, end, meta.rememberedLine)}
}

const SIX_MINUTES = 6 * 60_000

/** The HUD hint line (GDD 5, discovery order). The shrine is never hinted. */
export function hintFor(book, now = Date.now()) {
	if (book.status === 'epilogue' || book.status === 'won' || book.status === 'dead') return ''
	const v = book.visited
	if ((v.well && v.marcus && v.grindstone && v.lectern) || now - book.openedAt >= SIX_MINUTES) return COPY.hints.gate
	if (!v.well) return COPY.hints.walk
	if (!v.marcus) return COPY.hints.forge
	// QA: the forge hint used to stick for the whole village. Name only what is left.
	return COPY.hints.look([!v.lectern && 'lectern', !v.grindstone && 'grindstone'].filter(Boolean))
}
