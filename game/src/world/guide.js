// EVER exploration copy + view models: prompts, hints, station panels, deck grouping,
// effect toasts, the Marcus dialogue reducer and the free-text proposal pipeline.
// OWNER: world engineer. PURE (no DOM, no three) so it is unit-tested in Node.
// All player-facing strings are GDD section 6 copy unless marked "(not in GDD)".
// Nothing here decides an outcome: panels only produce BookActions for the rules.
//
// Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later

import {CURSE_ID, FREE_TEXT_MAX, TOKEN_KINDS, buildAiInput, trustWord, upgradableCards} from '../core/contracts.js'

// -------------------------------------------------------------------------------------
// Prompts and hints (GDD 5, 6)
// -------------------------------------------------------------------------------------

export const PROMPTS = Object.freeze({
	marcus: 'Talk to Marcus',
	well: 'Look into the well',
	lectern: 'Read the stone',
	grindstone: 'Use the grindstone',
	shrine: 'Touch the shrine',
	gate: 'The Warden stirs. Begin the fight?',
})

/** Can this book use the village right now? */
export const canExplore = (book) => !!book && (book.status === 'exploring' || book.status === 'epilogue')

/**
 * Prompt label for the station the player stands in, or null when there is nothing to do
 * (gate during an epilogue, or the book is not exploring).
 */
export function promptFor(station, book) {
	if (!station || !canExplore(book)) return null
	if (station === 'gate') return book.status === 'exploring' ? PROMPTS.gate : null
	return PROMPTS[station] || null
}

export const HINTS = Object.freeze({
	start: 'Walk into the village.',
	forge: 'Someone is standing in the forge.',
	look: 'The well, the stone by the tree, the grindstone. Look around.',
	gate: 'The Ash Gate is north.',
})
export const GATE_HINT_AFTER_MS = 6 * 60_000

/** GDD 5 discovery order. Returns the hint line, or null (epilogue / not exploring). */
export function hintFor(book, now = Date.now()) {
	if (!book || book.status !== 'exploring') return null
	const v = book.visited || {}
	const m = book.marcus || {flags: {}}
	const allSeen = v.well && v.marcus && v.grindstone && v.lectern
	if (allSeen || now - (book.openedAt || now) >= GATE_HINT_AFTER_MS) return HINTS.gate
	if (!v.well) return HINTS.start
	const pastBeat2 = m.beat >= 3 || m.flags?.promised || m.flags?.askedWhy
	return pastBeat2 ? HINTS.look : HINTS.forge
}

// -------------------------------------------------------------------------------------
// Station panels (GDD 3.5, 6 "Station prompts"). A panel is a plain view model; the DOM
// layer renders it and turns `do` into a dispatch / picker / fight request.
// -------------------------------------------------------------------------------------

/**
 * @typedef {{label: string, kind?: 'primary'|'secondary'|'doubt'|'quiet', key?: string,
 *   do: {act: import('../core/contracts.js').BookAction} | {picker: 'well'|'anvil'} | {close: true}
 *     | {fight: true} | {stepBack: true} | {ready: boolean}, disabled?: boolean}} PanelButton
 * @typedef {{station: string, title: string|null, text: string, small?: string,
 *   cards?: {id: string, upgraded: boolean, do: {act: any}}[], buttons: PanelButton[], prompt?: boolean}} Panel
 */

const leave = (label = 'Leave') => ({label, kind: 'secondary', do: {close: true}})

/** Spent in this book? (Epilogue: every station is spent, GDD 1.1 "Stay".) */
export function stationUsed(station, book) {
	if (book?.status === 'epilogue') return true
	return !!book?.used?.[station]
}

/**
 * @param {string} station
 * @param {import('../core/contracts.js').Book} book
 * @param {{coop?: boolean, room?: any, seat?: number|null, now?: number}} [opt]
 * @returns {Panel|null}
 */
export function stationPanel(station, book, {coop = false, room = null, seat = null, now = Date.now()} = {}) {
	if (!canExplore(book)) return null
	const used = stationUsed(station, book)
	switch (station) {
		case 'well':
			return used
				? {station, title: 'The Well', text: 'The well is still.', buttons: [leave()]}
				: {
						station,
						title: 'The Well',
						text: 'Cold water, very deep. It will take one thing from you, or give you one.',
						buttons: [
							{label: 'Drop a card in', kind: 'secondary', do: {picker: 'well'}, disabled: book.deck.length === 0},
							{label: 'Draw up the Ward', kind: 'secondary', do: {act: {type: 'well.ward'}}, disabled: book.tokens.includes('ward')},
							leave(),
						],
					}
		case 'lectern':
			return used
				? {station, title: 'The Margin Stone', text: 'The margin is blank now.', buttons: [leave()]}
				: {
						station,
						title: 'The Margin Stone',
						text: 'Three cards are written in the margin. One can be yours.',
						cards: (book.lecternOffer || []).map((id) => ({id, upgraded: false, do: {act: {type: 'lectern.take', id}}})),
						buttons: [{label: 'Leave them', kind: 'secondary', do: {act: {type: 'lectern.leave'}}}],
					}
		case 'grindstone':
			return used
				? {station, title: 'The Grindstone', text: 'The wheel has stopped.', buttons: [leave()]}
				: {
						station,
						title: 'The Grindstone',
						text: 'A worn wheel. Good for one sharp edge.',
						buttons: [{label: 'Sharpen (take Whetstone)', kind: 'primary', do: {act: {type: 'grindstone.take'}}, disabled: book.tokens.includes('whetstone')}, leave()],
					}
		case 'shrine':
			return used
				? {station, title: 'The Crooked Shrine', text: 'The shrine is dark.', buttons: [leave('Walk away')]}
				: {
						station,
						title: 'The Crooked Shrine',
						text: 'Power, freely given. Almost.',
						small: 'Gain Bludgeon. Two Doubts are written into your deck.',
						buttons: [{label: 'Take the Bludgeon', kind: 'doubt', do: {act: {type: 'shrine.take'}}}, leave('Walk away')],
					}
		case 'gate':
			return gatePanel(book, {coop, room, seat, now})
		default:
			return null
	}
}

/** GDD 5 combat trigger (solo) and 7.4 fight lobby (co-op). */
export function gatePanel(book, {coop = false, room = null, seat = null, now = Date.now()} = {}) {
	if (book.status !== 'exploring') return null
	if (!coop) {
		return {
			station: 'gate',
			title: null,
			prompt: true,
			text: PROMPTS.gate,
			buttons: [
				{label: 'Fight', kind: 'primary', key: 'F', do: {fight: true}},
				{label: 'Not yet', kind: 'secondary', do: {stepBack: true}},
			],
		}
	}
	const w = room?.warden || {state: 'dormant', round: 0}
	if (w.state === 'defeated') return null
	if (w.state === 'fighting') {
		const me = room?.seats?.find((s) => s.seat === seat)
		if (me?.inFight) return null
		return {station: 'gate', title: null, prompt: true, text: `Your party is fighting the Warden. Round ${w.round || 1}.`, buttons: [{label: 'Not yet', kind: 'secondary', do: {stepBack: true}}]}
	}
	const lobby = room?.lobby || {ready: 0, of: 1, startsAt: null}
	const me = room?.seats?.find((s) => s.seat === seat)
	const lines = [`${lobby.ready}/${lobby.of} ready at the gate`]
	if (lobby.startsAt) lines.push(`The fight starts in ${Math.max(0, Math.ceil((lobby.startsAt - now) / 1000))}s.`)
	return {
		station: 'gate',
		title: null,
		prompt: true,
		text: lines.join(' '),
		buttons: me?.ready
			? [{label: 'Not ready', kind: 'secondary', do: {ready: false}}]
			: [
					{label: 'Ready', kind: 'primary', do: {ready: true}},
					{label: 'Not yet', kind: 'secondary', do: {stepBack: true}},
				],
	}
}

/** Picker panels: the anvil (GDD 2.3 beat 4) and the well's "Drop a card in". */
export function pickerPanel(purpose, book) {
	if (purpose === 'anvil') {
		return {
			station: 'anvil',
			title: 'The Anvil',
			text: 'Choose a card to upgrade.',
			pick: upgradableCards(book).map((c) => ({...c, do: {act: {type: 'anvil.upgrade', uid: c.uid}}})),
			buttons: [{label: 'Not now', kind: 'secondary', do: {close: true}}],
		}
	}
	return {
		station: 'well',
		title: 'The Well',
		text: 'Choose a card to drop in.', // (not in GDD: picker subtitle)
		pick: book.deck.map((c) => ({...c, do: {act: {type: 'well.remove', uid: c.uid}}})),
		buttons: [{label: 'Back', kind: 'secondary', do: {close: true}}],
	}
}

// -------------------------------------------------------------------------------------
// Deck view (GDD 3.6): grouped by card with counts; curses last.
// -------------------------------------------------------------------------------------

/** @returns {{id: string, upgraded: boolean, count: number, uids: string[], curse: boolean}[]} */
export function groupDeck(deck = []) {
	const map = new Map()
	for (const c of deck) {
		const k = c.id + (c.upgraded ? '+' : '')
		const g = map.get(k) || {id: c.id, upgraded: !!c.upgraded, count: 0, uids: [], curse: c.id === CURSE_ID}
		g.count++
		g.uids.push(c.uid)
		map.set(k, g)
	}
	return [...map.values()].sort((a, b) => a.curse - b.curse || a.id.localeCompare(b.id) || Number(b.upgraded) - Number(a.upgraded))
}

/** Small numbers for the HUD. */
export function deckSummary(book) {
	const deck = book?.deck || []
	return {
		count: deck.length,
		doubts: deck.filter((c) => c.id === CURSE_ID).length,
		upgraded: deck.filter((c) => c.upgraded).length,
	}
}

export const TOKEN_INFO = Object.freeze({
	ember: {name: 'Ember', tip: 'Ember: +1 Energy on your first turn.'},
	ward: {name: 'Ward', tip: 'Ward: start the fight with 8 Block.'},
	whetstone: {name: 'Whetstone', tip: 'Whetstone: the Warden starts Vulnerable.'},
})

/** Three HUD slots in fixed order: [{kind, full, tip}] */
export function tokenSlots(book) {
	return TOKEN_KINDS.map((k) => ({kind: k, full: !!book?.tokens?.includes(k), tip: TOKEN_INFO[k].tip}))
}

// -------------------------------------------------------------------------------------
// Effects -> toasts (GDD 6 "Toasts")
// -------------------------------------------------------------------------------------

const toneOf = (text) => (/doubt/i.test(text) ? 'bad' : /token/i.test(text) ? 'gold' : 'good')

/**
 * Toasts for a batch of rule effects. If the rules sent their own `toast` effects those
 * are shown as-is; otherwise card/token effects get the standard GDD lines.
 * @param {import('../core/contracts.js').Effect[]} effects
 * @returns {{text: string, tone: 'good'|'bad'|'gold'}[]}
 */
export function effectToasts(effects = []) {
	const own = effects.filter((e) => e.k === 'toast' && e.text)
	if (own.length) return own.map((e) => ({text: e.text, tone: toneOf(e.text)}))
	const out = []
	let doubts = 0
	for (const e of effects) {
		if (e.k === 'card') {
			if (e.op === 'add' && e.id === CURSE_ID) doubts++
			else if (e.op === 'add') out.push({text: `Card gained: ${e.id}`, tone: 'good'})
			else if (e.op === 'remove') out.push({text: `Card removed: ${e.id}`, tone: 'good'})
			else if (e.op === 'upgrade') out.push({text: `Upgraded: ${e.id}+`, tone: 'gold'})
		} else if (e.k === 'token') {
			out.push({text: `Token gained: ${TOKEN_INFO[e.kind]?.name || e.kind}`, tone: 'gold'})
		}
	}
	if (doubts === 1) out.push({text: 'A Doubt is written into your deck.', tone: 'bad'})
	else if (doubts > 1) out.push({text: `${doubts === 2 ? 'Two' : doubts} Doubts are written into your deck.`, tone: 'bad'})
	return out
}

/** Error code from applyBookAction / the room -> a short line, or null to stay quiet. */
export function errorText(code) {
	switch (code) {
		case 'too_far':
			return 'Step a little closer.' // (not in GDD)
		case 'rate':
			return null
		default:
			return null
	}
}

// -------------------------------------------------------------------------------------
// Marcus dialogue (GDD 2.3, 2.4). The rules return effects; this folds them into what the
// panel shows. Display only: no trust maths here.
// -------------------------------------------------------------------------------------

/**
 * @typedef {{lines: string[], options: {id: string, text: string}[], note: string|null,
 *   closed: boolean, picker: 'anvil'|'well'|null, extra: string[]}} DialogueView
 */

/** @returns {DialogueView} */
export function dialogueStart() {
	return {lines: [], options: [], note: null, closed: false, picker: null, extra: []}
}

/**
 * Fold one result's effects into the dialogue. A new `say` replaces the previous line
 * (several `say`s in one batch are shown together, e.g. a reply + the Ember gift line).
 * @param {DialogueView} view
 * @param {import('../core/contracts.js').Effect[]} effects
 * @returns {DialogueView}
 */
export function dialogueReduce(view, effects = []) {
	const says = effects.filter((e) => e.k === 'say' && typeof e.text === 'string').map((e) => e.text)
	const next = {...view, picker: null, note: null, extra: []}
	if (says.length) next.lines = says
	const opts = effects.find((e) => e.k === 'options')
	if (opts) next.options = Array.isArray(opts.options) ? opts.options.filter((o) => o && typeof o.id === 'string' && typeof o.text === 'string') : []
	const trust = effects.filter((e) => e.k === 'trust').reduce((s, e) => s + (Number(e.delta) || 0), 0)
	if (trust > 0) next.note = 'Marcus trusts you more.'
	else if (trust < 0) next.note = 'Marcus trusts you less.'
	for (const e of effects) {
		if (e.k === 'close') {
			next.closed = true
			next.options = []
		}
		if (e.k === 'picker') next.picker = e.purpose === 'well' ? 'well' : 'anvil'
	}
	return next
}

/** Trust label pill text (GDD 2.2). */
export const trustLabel = (book) => trustWord(book?.marcus?.trust ?? 0)

/** Is free text allowed with Marcus right now? (GDD 2.4: disabled after attacking him) */
export const freeTextAllowed = (book) => !book?.marcus?.flags?.struck

// -------------------------------------------------------------------------------------
// Free text (GDD 2.4, 2.5). The AI may only PROPOSE {reply, intent, trust}; the rules
// decide. Offline (hosted site) it never touches the network.
// -------------------------------------------------------------------------------------

export const FREE_TEXT = Object.freeze({
	placeholder: 'e.g. I help him sweep the cold ash',
	button: 'Do it',
	back: 'Back',
	offline: 'Marcus is voiced by a local script.',
	ai: "AI voices Marcus. The game's rules decide what happens.",
	thinking: 'Marcus thinks it over',
	unavailable: 'AI unavailable, using the local script.',
	limit: 'AI usage limit reached. Using the local script.',
	connect: 'Connect AI',
	open: 'Try something else',
})

/** Trim, strip control chars, clamp to 120. */
export function cleanFreeText(text) {
	return String(text ?? '')
		.replace(/[\u0000-\u001f\u007f]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, FREE_TEXT_MAX)
}

/**
 * Build the BookAction for a free-text line. With the bridge on, asks the AI for a
 * proposal (validated in contracts.validateAiProposal); any failure falls back to the
 * local classifier silently, which the rules run when `ai` is absent.
 * @param {{book: any, text: string, bridge?: {enabled: boolean, ask: (input: string) => Promise<any>}|null,
 *   ai: {on: boolean, disabled?: boolean, warned?: boolean}}} p
 * @returns {Promise<{action: {type: 'marcus.free', text: string, ai?: any}, toast?: string, disableAi?: boolean, warned?: boolean, recheck?: boolean}>}
 */
export async function proposeFreeText({book, text, bridge = null, ai}) {
	const clean = cleanFreeText(text)
	const action = {type: 'marcus.free', text: clean}
	if (!clean || !bridge?.enabled || !ai?.on || ai.disabled || book?.marcus?.aiDisabled) return {action}
	let r
	try {
		r = await bridge.ask(buildAiInput(book, clean))
	} catch {
		r = {ok: false, reason: 'error'}
	}
	if (r?.ok && r.proposal) return {action: {...action, ai: r.proposal}}
	if (r?.reason === 'limit') return {action, toast: FREE_TEXT.limit, disableAi: true, warned: true}
	const res = {action, recheck: r?.reason === 'auth', warned: true}
	return ai.warned ? res : {...res, toast: FREE_TEXT.unavailable}
}

// -------------------------------------------------------------------------------------
// Co-op labels
// -------------------------------------------------------------------------------------

/** Name tag text above a peer (GDD 7.2 speech bubble). */
export function peerTag(name, talking) {
	const n = name || 'Reader'
	return talking ? `${n} is talking to Marcus` : n
}

/** Party list row (GDD 6 HUD: "{name} · HP {cur}/{max}"). */
export function partyRow(s) {
	return `${s.name} · HP ${s.hp}/${s.maxHp}`
}
