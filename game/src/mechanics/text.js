// EVER mechanics: text. (1) Sanitizing model-written names and flavor lines (GDD_V2 20);
// (2) rendering rules text FROM DATA. The model never writes rules text.
// Output is plain text: render it with textContent, never innerHTML.
// PURE.
//
// Copyright (C) 2026 the EVER contributors.
// SPDX-License-Identifier: AGPL-3.0-or-later

import {CONDITIONS, SCALINGS, SIZE_LIMITS, TRIGGERS} from './library.js'
import {effectSpec} from './blocks-registry.js'

/**
 * Small built-in blocklist (whole words, lowercase). The Creative Director's full list
 * (slurs, sexual terms, brands, real people/places) is passed in as `blocklist`.
 */
export const BASE_BLOCKLIST = Object.freeze([
	'fuck', 'shit', 'cunt', 'bitch', 'nazi', 'hitler', 'rape', 'porn', 'sex', 'nigger', 'faggot',
	'openai', 'chatgpt', 'google', 'microsoft', 'apple inc', 'disney', 'nike', 'coca', 'pepsi',
	'ignore', 'instruction', 'instructions', 'prompt', 'system', 'assistant', 'http', 'https', 'www',
])
/** Names that always exist (engine cards, MVP NPCs and tokens). */
export const RESERVED_NAMES = Object.freeze([
	'strike', 'defend', 'bash', 'doubt', 'bludgeon', 'pommel strike', 'iron wave', 'sucker punch', 'thunderclap', 'body slam',
	'intimidate', 'cleave', 'adrenaline', 'flourish', 'clash', 'terror', 'marcus', 'marcus hale', 'tobin', 'ember', 'ward', 'whetstone',
	'ash warden', 'the ash warden',
])

const words = (s) => s.toLowerCase().split(/[^a-z']+/).filter(Boolean)
function hitsBlocklist(s, extra = []) {
	const lower = s.toLowerCase()
	const ws = new Set(words(s))
	for (const b of [...BASE_BLOCKLIST, ...extra]) {
		const t = String(b).toLowerCase().trim()
		if (!t) continue
		if (t.includes(' ') ? lower.includes(t) : ws.has(t)) return t
	}
	return null
}

/** Control, zero-width and bidi characters (built from code points so the source stays ASCII). */
const INVISIBLE = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2066-\\u2069\\ufeff]', 'g')

const titleWord = (w) => w.replace(/(^|-)([a-z])/g, (_m, a, b) => a + b.toUpperCase())
const SMALL = new Set(['of', 'the', 'and', 'a', 'an', 'in', 'on', 'to', 'for'])

/**
 * GDD 20: 2-24 chars, letters, spaces, apostrophe and hyphen only, at most 4 words,
 * Title Case applied by the game, not equal to a reserved/existing name.
 * @returns {{ok: true, value: string}|{ok: false, reason: string}}
 */
export function cleanName(raw, {existing = [], blocklist = []} = {}) {
	if (typeof raw !== 'string') return {ok: false, reason: 'name must be text'}
	const s = raw.normalize('NFKC').replace(INVISIBLE, '').replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/\s+/g, ' ').trim()
	if (s.length < SIZE_LIMITS.nameMin || s.length > SIZE_LIMITS.nameMax) return {ok: false, reason: `name must be ${SIZE_LIMITS.nameMin}-${SIZE_LIMITS.nameMax} characters`}
	if (!/^[A-Za-z][A-Za-z' -]*[A-Za-z]$/.test(s)) return {ok: false, reason: 'name may only use letters, spaces, apostrophes and hyphens'}
	if (/['-]{2}|\s['-]|['-]\s/.test(s)) return {ok: false, reason: 'name punctuation looks wrong'}
	const parts = s.split(' ')
	if (parts.length > SIZE_LIMITS.nameWords) return {ok: false, reason: `name may have at most ${SIZE_LIMITS.nameWords} words`}
	const bad = hitsBlocklist(s, blocklist)
	if (bad) return {ok: false, reason: 'name uses a blocked word'}
	const value = parts.map((w, i) => (i > 0 && SMALL.has(w.toLowerCase()) ? w.toLowerCase() : titleWord(w.toLowerCase()))).join(' ')
	const key = value.toLowerCase()
	if (RESERVED_NAMES.includes(key) || existing.some((n) => String(n).toLowerCase() === key)) return {ok: false, reason: 'that name is taken'}
	return {ok: true, value}
}

/**
 * GDD 20: <= 90 chars, one sentence, no <>{}[]@#`| , no digits, no URLs, no "!".
 * Empty flavor is allowed (the card simply has none).
 * @returns {{ok: true, value: string}|{ok: false, reason: string}}
 */
export function cleanFlavor(raw, {blocklist = []} = {}) {
	if (raw === undefined || raw === null || raw === '') return {ok: true, value: ''}
	if (typeof raw !== 'string') return {ok: false, reason: 'flavor must be text'}
	const s = raw.normalize('NFKC').replace(INVISIBLE, '').replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/\s+/g, ' ').trim()
	if (!s) return {ok: true, value: ''}
	if (s.length > SIZE_LIMITS.flavorMax) return {ok: false, reason: `flavor must be at most ${SIZE_LIMITS.flavorMax} characters`}
	if (/[<>{}[\]@#`|\\]/.test(s)) return {ok: false, reason: 'flavor has a forbidden character'}
	if (/\d/.test(s)) return {ok: false, reason: 'flavor may not contain digits'}
	if (/!/.test(s)) return {ok: false, reason: 'flavor may not shout'}
	if (/(https?:|www\.|\.[a-z]{2,6}\/|[a-z0-9-]+\.(com|net|org|io|ai|gg|xyz|ru|dev)\b)/i.test(s)) return {ok: false, reason: 'flavor may not contain a link'}
	if (!/^[\p{L}\p{M} ,.;:'"?()-]+$/u.test(s)) return {ok: false, reason: 'flavor has a character outside plain letters and punctuation'}
	const sentences = s.split(/[.?]+\s+(?=\S)/).filter(Boolean)
	if (sentences.length > 1) return {ok: false, reason: 'flavor must be one sentence'}
	if (hitsBlocklist(s, blocklist)) return {ok: false, reason: 'flavor uses a blocked word'}
	return {ok: true, value: s}
}

// -------------------------------------------------------------------------------------
// Rules text from data
// -------------------------------------------------------------------------------------

const lowerFirst = (s) => (s ? s[0].toLowerCase() + s.slice(1) : s)
const upperFirst = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s)

/** One effect as a sentence fragment (no trailing period). */
export function effectText(e, ctx) {
	const spec = effectSpec(e.do)
	if (!spec) return ''
	let t
	if (!e.scale) t = spec.text(e, String(e.n), ctx)
	else {
		const sc = SCALINGS[e.scale.per]
		t = e.n === 0
			? `${spec.text(e, String(e.scale.each), ctx)} ${sc.text} (up to ${e.scale.cap})`
			: `${spec.text(e, String(e.n), ctx)}, plus ${e.scale.each} more ${sc.text} (up to ${e.scale.cap} times)`
	}
	if (e.if) t = `${CONDITIONS[e.if.is].text(e.if)}, ${lowerFirst(t)}`
	if (e.when === 'nextTurn') t = `Next turn, ${lowerFirst(t)}`
	return t
}

const sentence = (s) => (s ? upperFirst(s.replace(/\s+/g, ' ').trim()) + '.' : '')

/** Trigger as one sentence: "At the start of your turn, gain 3 Block and draw a card." */
export function triggerText(t, ctx, {onCard = false} = {}) {
	const spec = TRIGGERS[t.on]
	let head = spec.text(t, onCard)
	if (t.if) head += `, ${lowerFirst(CONDITIONS[t.if.is].text(t.if)).replace(/^if /, 'if ')}`
	const body = t.effects.map((e) => lowerFirst(effectText(e, ctx))).join(' and ')
	return sentence(`${head}, ${body}`)
}

/**
 * Full rules text for a canonical def (a card def may be an upgraded variant).
 * @param {object} def
 * @param {{refName?: (ref: string) => string}} [ctx]
 * @returns {string}
 */
export function rulesText(def, ctx) {
	const parts = []
	if (def.kind === 'curse' && def.energy === null) parts.push('Unplayable.')
	if (def.kind === 'item' && def.bound) parts.push('Bound.')
	for (const e of def.effects ?? []) parts.push(sentence(effectText(e, ctx)))
	for (const t of def.triggers ?? []) parts.push(triggerText(t, ctx, {onCard: def.kind === 'curse'}))
	if (def.kind === 'item' && def.stats?.maxHp) parts.push(`${def.stats.maxHp > 0 ? '+' : ''}${def.stats.maxHp} max HP.`)
	if (def.retain) parts.push('Retain.')
	if (def.exhaust) parts.push('Exhaust.')
	if (def.kind === 'token') parts.unshift('Next fight:')
	return parts.filter(Boolean).join(' ')
}
