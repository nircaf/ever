// EVER v2 seed codes (GDD_V2 3.1). PURE: the room server imports this file.
// A seed is 8 symbols from the room-code alphabet (no vowels, no 0/O/1/I), shown as two
// groups of four (KQ7F-M2XB). A share code adds the world edition: 14-KQ7F-M2XB.
// Anything else a player types (1-24 characters) is a word seed: normalized and hashed
// (FNV-1a 64-bit, base 28) into a code, so the same word gives the same book everywhere.
// OWNER: systems engineer.
// Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later

import {ROOM_CODE_ALPHABET} from '../contracts.js'

export const SEED_ALPHABET = ROOM_CODE_ALPHABET
export const SEED_LENGTH = 8
export const WORD_SEED_MAX = 24

const FNV_OFFSET = 0xcbf29ce484222325n
const FNV_PRIME = 0x100000001b3n
const MASK64 = (1n << 64n) - 1n

/** FNV-1a 64-bit over the UTF-8 bytes of `text`, as a BigInt. */
export function fnv1a64(text) {
	let h = FNV_OFFSET
	for (const b of new TextEncoder().encode(String(text))) {
		h ^= BigInt(b)
		h = (h * FNV_PRIME) & MASK64
	}
	return h
}

/** 8 symbols of the alphabet from a 64-bit hash (base 28, least significant first). */
function codeFromHash(h) {
	let out = ''
	const base = BigInt(SEED_ALPHABET.length)
	for (let i = 0; i < SEED_LENGTH; i++) {
		out += SEED_ALPHABET[Number(h % base)]
		h /= base
	}
	return out
}

export const isSeedCode = (s) => typeof s === 'string' && s.length === SEED_LENGTH && [...s].every((c) => SEED_ALPHABET.includes(c))

/** "KQ7FM2XB" -> "KQ7F-M2XB" (anything else is returned as is). */
export const formatSeed = (code) => (isSeedCode(code) ? `${code.slice(0, 4)}-${code.slice(4)}` : String(code ?? ''))

/** Share code: edition + seed, e.g. "14-KQ7F-M2XB". */
export const shareCode = (edition, code) => `${edition}-${formatSeed(code)}`

/** Normalize a word seed: trim, lowercase, collapse spaces. */
export const normalizeWord = (text) =>
	String(text ?? '')
		.trim()
		.toLowerCase()
		.replace(/\s+/g, ' ')

/** Word -> seed code (same word, same book, everywhere). */
export const wordSeed = (word) => codeFromHash(fnv1a64(normalizeWord(word)))

/** Today's page: everyone gets the same book on a UTC day. */
export function dailySeed(date = new Date()) {
	const d = date instanceof Date ? date : new Date(date)
	return wordSeed(`daily:${d.toISOString().slice(0, 10)}`)
}

/** 8 random symbols. Uses crypto.getRandomValues when available. */
export function randomSeed(rand) {
	let out = ''
	const c = globalThis.crypto
	const bytes = !rand && c?.getRandomValues ? c.getRandomValues(new Uint32Array(SEED_LENGTH)) : null
	for (let i = 0; i < SEED_LENGTH; i++) {
		const r = bytes ? bytes[i] / 2 ** 32 : (rand ?? Math.random)()
		out += SEED_ALPHABET[Math.floor(r * SEED_ALPHABET.length) % SEED_ALPHABET.length]
	}
	return out
}

/**
 * Parse what a player typed in the seed field.
 * @param {string} text
 * @returns {{ok: true, code: string, edition: number|null, word: string|null} | {ok: false, empty: boolean}}
 *   word: the normalized word when the text was a word seed (for "'tobin' becomes ...")
 */
export function parseSeedInput(text) {
	const raw = String(text ?? '').trim()
	if (!raw) return {ok: false, empty: true}
	// Share code: digits, a dash, then the 8-symbol code (dashes and spaces ignored).
	const share = raw.match(/^(\d{1,6})\s*-\s*([A-Za-z0-9][A-Za-z0-9\s-]*)$/)
	if (share) {
		const code = share[2].toUpperCase().replace(/[\s-]/g, '')
		if (isSeedCode(code)) return {ok: true, code, edition: Number(share[1]), word: null}
	}
	const compact = raw.toUpperCase().replace(/[\s-]/g, '')
	if (isSeedCode(compact)) return {ok: true, code: compact, edition: null, word: null}
	const word = normalizeWord(raw)
	if (word.length < 1 || word.length > WORD_SEED_MAX) return {ok: false, empty: false}
	return {ok: true, code: wordSeed(word), edition: null, word}
}

/** A stable uint32 for a seed code (combat and sim seeds). */
export function seedNumber(code) {
	let h = 0x811c9dc5
	for (const ch of String(code)) {
		h ^= ch.charCodeAt(0)
		h = Math.imul(h, 0x01000193) >>> 0
	}
	return h >>> 0
}
