// EVER AI: getting ONE JSON object out of hostile model text.
// The model is asked for a bare JSON object; it may still wrap it in markdown, chatter
// around it, send two objects, send 50 KB, nest 1000 levels deep or plant "__proto__".
// This file finds the first balanced {...} (string-aware), size-checks it before parsing,
// parses it without prototype keys and bounds its depth. Nothing here evaluates anything.
// PURE.
//
// Copyright (C) 2026 the EVER contributors.
// SPDX-License-Identifier: AGPL-3.0-or-later

/** Longest model text we look at, in characters (the bridge streams more; we refuse). */
export const MAX_MODEL_TEXT = 16384
/** Longest JSON object we parse, in UTF-8 bytes (3 offers of ~2 KB plus a reply). */
export const MAX_JSON_BYTES = 12288
// proposals > [i] > data > def > triggers > [j] > effects > [k] > if > ... needs about 10.
export const MAX_JSON_DEPTH = 12
const POISON_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

const bytes = (s) => new TextEncoder().encode(s).length

/** Index just past the "}" that closes the "{" at `start`, or -1. String- and escape-aware. */
function closeOf(text, start) {
	let depth = 0
	let inStr = false
	for (let i = start; i < text.length; i++) {
		const ch = text[i]
		if (inStr) {
			if (ch === '\\') i++
			else if (ch === '"') inStr = false
			continue
		}
		if (ch === '"') inStr = true
		else if (ch === '{' || ch === '[') depth++
		else if (ch === '}' || ch === ']') {
			depth--
			if (depth === 0) return ch === '}' ? i + 1 : -1
			if (depth < 0) return -1
		}
	}
	return -1
}

function depthOf(v, d = 0) {
	if (d > MAX_JSON_DEPTH) return d
	if (!v || typeof v !== 'object') return d
	let m = d
	for (const x of Array.isArray(v) ? v : Object.values(v)) m = Math.max(m, depthOf(x, d + 1))
	return m
}

/**
 * @param {unknown} text  raw model text
 * @param {{maxBytes?: number}} [o]
 * @returns {{ok: true, value: Record<string, unknown>} | {ok: false, reason: 'empty'|'too_large'|'no_json'|'bad_json'|'too_deep'|'not_object'}}
 */
export function extractJsonObject(text, {maxBytes = MAX_JSON_BYTES} = {}) {
	if (typeof text !== 'string' || !text.trim()) return {ok: false, reason: 'empty'}
	if (text.length > MAX_MODEL_TEXT) return {ok: false, reason: 'too_large'}
	const start = text.indexOf('{')
	if (start < 0) return {ok: false, reason: 'no_json'}
	const end = closeOf(text, start)
	if (end < 0) return {ok: false, reason: 'bad_json'}
	const slice = text.slice(start, end)
	if (bytes(slice) > maxBytes) return {ok: false, reason: 'too_large'}
	let value
	try {
		value = JSON.parse(slice, (k, v) => (POISON_KEYS.has(k) ? undefined : v))
	} catch {
		return {ok: false, reason: 'bad_json'}
	}
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {ok: false, reason: 'not_object'}
	if (depthOf(value) > MAX_JSON_DEPTH) return {ok: false, reason: 'too_deep'}
	return {ok: true, value}
}

/** Plain-object check for parsed model data. */
export const isPlainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
