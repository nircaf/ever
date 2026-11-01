// EVER AI: the NPC moment pipeline (GDD_V2 9.5 and 10.1-10.5).
//   plan slots (content-gen momentSlots) -> prompt -> bridge -> extract ONE JSON object ->
//   per offer: shape, text, caps, budget, fairness and balance sim (mechanics validateContent)
//   -> any failed or missing offer is replaced by the offline offer of the SAME slot.
// The result always has a reply and a full set of offers, never throws, and never contains
// anything the validator did not accept. Model output is hostile data throughout.
//
// Copyright (C) 2026 the EVER contributors.
// SPDX-License-Identifier: AGPL-3.0-or-later

import {rng, validateContent} from '../../mechanics/index.js'
import {artRecipe} from '../../content-gen/art.js'
import {generateOffer, momentSlots, sealInside} from '../../content-gen/generate.js'
import {extractJsonObject, isPlainObject} from './json.js'
import {fallbackReply} from './lines.js'
import {buildMomentInput, momentInstructions} from './prompts.js'
import {cleanReplyText} from './text.js'

export const MAX_AI_OFFERS = 3

/**
 * @typedef {import('../../content-gen/generate.js').MomentContext & {
 *   npc: {id: string, name: string, archetype?: string, knows?: string[]},
 *   says?: string, items?: string[], hp?: number, maxHp?: number, curses?: number}} AiMomentContext
 * @typedef {import('../../content-gen/generate.js').Offer} Offer
 * @typedef {object} MomentResult
 * @prop {string} reply                    what the NPC says before the Offer panel
 * @prop {Offer[]} offers                  validated offers, one per slot
 * @prop {'ai'|'mixed'|'offline'} source
 * @prop {number} replaced                 AI offers swapped for offline ones
 * @prop {boolean} fallbackNote            show AI_LINES.fallbackNote (once per book; the UI keeps the "once")
 * @prop {string|null} notice              why the AI was not used: off|limit|auth|timeout|aborted|too_large|error|invalid
 * @prop {{slot: number, codes: string[]}[]} rejected   why AI offers were refused (codes only, for logs/tests)
 * @prop {string} [model]
 */

/**
 * Parse the model text into a reply and up to 3 raw offers. Shape only.
 * @returns {{ok: true, reply: string|null, offers: unknown[]} | {ok: false, reason: string}}
 */
export function parseMomentText(text, {blocklist = []} = {}) {
	const j = extractJsonObject(text)
	if (!j.ok) return {ok: false, reason: j.reason}
	const v = j.value
	const r = cleanReplyText(v.reply, {blocklist})
	const offers = Array.isArray(v.offers) ? v.offers.slice(0, MAX_AI_OFFERS) : []
	return {ok: true, reply: r.ok ? r.value : null, offers}
}

const baseName = (s) => String(s ?? '').trim().replace(/\+$/, '').toLowerCase()

function findTarget(deck, name, kind) {
	const want = baseName(name)
	if (!want) return null
	const c = (deck ?? []).find((d) => baseName(d.name) === want && (kind === 'upgrade' ? !d.upgraded && !d.curse : !d.keepsake))
	return c ? {uid: String(c.uid), name: String(c.name)} : null
}

/**
 * Check one AI offer against its slot. Pure apart from the sim (deterministic).
 * @param {unknown} raw
 * @param {{kind: string, label: string, rarity?: string, kinds: string[]}} slot
 * @param {number} j
 * @param {AiMomentContext} ctx
 * @param {Set<string>} taken  lowercase names in use (updated on success)
 * @returns {{ok: true, offer: Offer} | {ok: false, codes: string[]}}
 */
export function checkMomentOffer(raw, slot, j, ctx, taken) {
	if (!isPlainObject(raw)) return {ok: false, codes: ['not_object']}
	const kind = raw.kind
	if (typeof kind !== 'string' || !slot.kinds.includes(kind)) return {ok: false, codes: ['slot']}
	const base = {slot: j, label: slot.label, kind, src: 'ai', theme: ctx.themes?.primary ?? 'forge'}
	if (kind === 'upgrade' || kind === 'remove') {
		const target = findTarget(ctx.deck, raw.target, kind)
		return target ? {ok: true, offer: {...base, def: null, target, art: null}} : {ok: false, codes: ['target']}
	}
	if (kind === 'curse' && slot.label !== 'curse') return {ok: false, codes: ['unearned']}
	const offer = slot.label === 'sealed' ? 'gift' : slot.label
	const v = validateContent(raw, {
		offer,
		kind,
		rarity: kind === 'card' || kind === 'item' ? slot.rarity : undefined,
		existingNames: [...taken],
		content: ctx.content,
		blocklist: ctx.blocklist,
		sim: ctx.sim ?? false,
	})
	if (!v.ok) return {ok: false, codes: [...new Set(v.errors.map((e) => e.code))]}
	taken.add(v.def.name.toLowerCase())
	const theme = v.def.theme ?? base.theme
	const sealed = slot.label === 'sealed' ? sealInside(ctx, j, v.def, {taken}) : {}
	return {ok: true, offer: {...base, def: v.def, ...sealed, theme, art: artRecipe(v.def)}}
}

/** Everything a moment needs offline: authored reply + seeded offers. */
export function offlineMoment(ctx, {notice = null, expectAi = false} = {}) {
	const slots = momentSlots(ctx)
	const taken = new Set((ctx.existingNames ?? []).map((n) => String(n).toLowerCase()))
	const offers = slots.map((s, j) => generateOffer(ctx, s, j, {taken}) ?? generateOffer(ctx, {kind: 'card', label: 'gift', rarity: 'common'}, j, {taken})).filter(Boolean)
	return {
		reply: fallbackReply(ctx.npc?.id, rng(ctx.seed, `reply:${ctx.page}`)),
		offers,
		source: /** @type {'offline'} */ ('offline'),
		replaced: 0,
		fallbackNote: expectAi,
		notice,
		rejected: [],
	}
}

/**
 * Run one NPC moment's offer call. Never throws; on any failure the offline offers stand in.
 * @param {AiMomentContext} ctx
 * @param {{transport?: ReturnType<typeof import('./bridge.js').createAiTransport>|null, active?: boolean,
 *   signal?: AbortSignal, onState?: (s: 'thinking'|'checking') => void}} [o]
 *   active: false = the AI is off for this book (not signed in, 429 earlier): no call, no note.
 * @returns {Promise<MomentResult>}
 */
export async function runMoment(ctx, {transport = null, active = true, signal, onState = () => {}} = {}) {
	if (!transport?.enabled || !active) return offlineMoment(ctx, {notice: 'off'})
	const slots = momentSlots(ctx)
	if (!slots.length) return offlineMoment(ctx) // hostile: no offer to make, nothing to ask
	let res
	try {
		onState('thinking')
		const input = buildMomentInput({
			npc: ctx.npc,
			themes: ctx.themes,
			page: ctx.page,
			pages: ctx.pages,
			deck: ctx.deck,
			items: ctx.items,
			curses: ctx.curses,
			hp: ctx.hp,
			maxHp: ctx.maxHp,
			says: ctx.says,
			request: ctx.request,
			slots,
			taken: ctx.existingNames,
		})
		res = await transport.call({instructions: momentInstructions(), input, signal})
	} catch {
		res = {ok: false, reason: 'error'}
	}
	if (!res.ok) return offlineMoment(ctx, {notice: res.reason, expectAi: res.reason !== 'aborted'})
	const parsed = parseMomentText(res.text, {blocklist: ctx.blocklist})
	if (!parsed.ok) return offlineMoment(ctx, {notice: 'invalid', expectAi: true})

	onState('checking')
	const taken = new Set((ctx.existingNames ?? []).map((n) => String(n).toLowerCase()))
	const offers = []
	const rejected = []
	let replaced = 0
	slots.forEach((slot, j) => {
		let r
		try {
			r = j < parsed.offers.length ? checkMomentOffer(parsed.offers[j], slot, j, ctx, taken) : {ok: false, codes: ['missing']}
		} catch {
			r = {ok: false, codes: ['error']}
		}
		if (r.ok) offers.push(r.offer)
		else {
			rejected.push({slot: j, codes: r.codes})
			replaced++
			const o = generateOffer(ctx, slot, j, {taken}) ?? generateOffer(ctx, {kind: 'card', label: 'gift', rarity: 'common'}, j, {taken})
			if (o) offers.push(o)
		}
	})
	const reply = parsed.reply ?? fallbackReply(ctx.npc?.id, rng(ctx.seed, `reply:${ctx.page}`))
	return {
		reply,
		offers,
		source: replaced === 0 ? 'ai' : replaced === slots.length ? 'offline' : 'mixed',
		replaced,
		fallbackNote: replaced > 0,
		notice: replaced === slots.length ? 'invalid' : null,
		rejected,
		model: res.model,
	}
}
