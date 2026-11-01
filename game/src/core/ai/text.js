// EVER AI: sanitizing model-written words that are not card names or flavor (those are
// mechanics/text.js): NPC replies, world lines, titles, inscriptions. GDD_V2 20.
// All output is plain text for textContent. A reply that looks like the model talking
// about itself or its instructions (a sign of prompt injection) is refused, and the
// caller uses an authored line instead.
// PURE.
//
// Copyright (C) 2026 the EVER contributors.
// SPDX-License-Identifier: AGPL-3.0-or-later

import {BASE_BLOCKLIST} from '../../mechanics/index.js'

export const REPLY_MAX = 240
export const REPLY_WORDS = 45

const INVISIBLE = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2066-\\u2069\\ufeff]', 'g')
/** Phrases that mean the model left the fiction (or was steered out of it). */
const META = /(https?:|www\.|\.(com|net|org|io|ai|gg|xyz|dev)\b|@\w|\bas an ai\b|\blanguage model\b|\bsystem prompt\b|\binstructions?\b|\bjailbreak|\bdeveloper mode\b|\bopenai\b|\bchatgpt\b|\bgpt\b|\bjson\b|\bpower points?\b|\bpp\b|\bvalidator\b|\bschema\b)/i
// Replies may say "ignore" or "system" in character; only the rest of the base list blocks.
const REPLY_BLOCK = BASE_BLOCKLIST.filter((w) => !['ignore', 'system', 'assistant', 'prompt', 'instruction', 'instructions'].includes(w))

const norm = (s) => s.normalize('NFKC').replace(INVISIBLE, ' ').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim()

function blocked(s, list) {
	const lower = s.toLowerCase()
	const ws = new Set(lower.split(/[^a-z']+/).filter(Boolean))
	return list.some((b) => {
		const t = String(b).toLowerCase().trim()
		return t && (t.includes(' ') ? lower.includes(t) : ws.has(t))
	})
}

/**
 * An NPC's spoken reply (GDD 2.5 step 3 plus v2 rules). Digits are allowed ("three nights",
 * "2 cards") but markup, links, meta talk and blocked words are not.
 * @param {unknown} raw
 * @param {{blocklist?: string[]}} [o]
 * @returns {{ok: true, value: string} | {ok: false, reason: string}}
 */
export function cleanReplyText(raw, {blocklist = []} = {}) {
	if (typeof raw !== 'string') return {ok: false, reason: 'reply must be text'}
	let s = norm(raw).replace(/[<>`{}[\]|\\]/g, ' ').replace(/\s+/g, ' ').trim()
	if (!s) return {ok: false, reason: 'empty reply'}
	if (META.test(s)) return {ok: false, reason: 'reply leaves the fiction'}
	if (blocked(s, [...REPLY_BLOCK, ...blocklist])) return {ok: false, reason: 'reply uses a blocked word'}
	const words = s.split(' ')
	if (words.length > REPLY_WORDS) s = words.slice(0, REPLY_WORDS).join(' ')
	if (s.length > REPLY_MAX) s = s.slice(0, REPLY_MAX).replace(/\s+\S*$/, '')
	if (!/[.?"')]$/.test(s)) s = s.replace(/[,;:\s-]+$/, '') + '.'
	return {ok: true, value: s}
}

/**
 * Words that enter the shared world (NPC lines, inscriptions, titles): stricter. Letters
 * and plain punctuation only, no digits, no "!", no links, no meta talk, blocklisted words
 * refused, and (when given) never a player's name.
 * @param {unknown} raw
 * @param {{max: number, sentences?: number, blocklist?: string[], names?: string[]}} o
 * @returns {{ok: true, value: string} | {ok: false, reason: string}}
 */
export function cleanWorldText(raw, {max, sentences = 2, blocklist = [], names = []}) {
	if (typeof raw !== 'string') return {ok: false, reason: 'must be text'}
	const s = norm(raw)
	if (!s) return {ok: false, reason: 'empty'}
	if (s.length > max) return {ok: false, reason: `at most ${max} characters`}
	if (/\d/.test(s)) return {ok: false, reason: 'no digits'}
	if (/!/.test(s)) return {ok: false, reason: 'no exclamation marks'}
	if (!/^[\p{L}\p{M} ,.;:'"?()-]+$/u.test(s)) return {ok: false, reason: 'plain letters and punctuation only'}
	if (/\b[A-Z]{3,}\b/.test(s)) return {ok: false, reason: 'no shouting'}
	if (META.test(s)) return {ok: false, reason: 'leaves the fiction'}
	if (blocked(s, [...BASE_BLOCKLIST, ...blocklist])) return {ok: false, reason: 'uses a blocked word'}
	if (names.some((n) => n && n.length >= 2 && s.toLowerCase().includes(String(n).toLowerCase()))) return {ok: false, reason: 'names a player'}
	if (s.split(/[.?]+\s+(?=\S)/).filter(Boolean).length > sentences) return {ok: false, reason: `at most ${sentences} sentences`}
	return {ok: true, value: s}
}

/** A short title (proposal titles, page titles): <= max chars, <= 6 words, world rules. */
export function cleanTitle(raw, {max = 48, blocklist = [], names = []} = {}) {
	const r = cleanWorldText(raw, {max, sentences: 1, blocklist, names})
	if (!r.ok) return r
	if (r.value.split(' ').length > 8) return {ok: false, reason: 'at most 8 words'}
	return {ok: true, value: r.value.replace(/[.]+$/, '')}
}
