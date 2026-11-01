// EVER mechanics: seeded randomness and stable hashing.
// PURE: no DOM, no timers, no Math.random. Imported by the browser and by server/.
// Every random decision in a run comes from a NAMED stream, rng(seed, label), so adding a
// new kind of decision never shifts an existing one (GDD_V2 3.2).
//
// Copyright (C) 2026 the EVER contributors.
// SPDX-License-Identifier: AGPL-3.0-or-later

/** FNV-1a 32-bit over the UTF-16 code units of a string. */
export function hash32(str) {
	let h = 0x811c9dc5
	const s = String(str)
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i)
		h = Math.imul(h, 0x01000193)
	}
	return h >>> 0
}

/** Base-36 hash, handy for short deterministic ids. */
export const hashId = (str, len = 6) => hash32(str).toString(36).padStart(len, '0').slice(-len)

/** mulberry32 step function over a uint32 state (same as core/contracts.js seededRandom). */
export function mulberry32(seed) {
	let a = seed >>> 0
	const next = () => {
		a = (a + 0x6d2b79f5) >>> 0
		let t = a
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
	next.state = () => a
	return next
}

/**
 * A named random stream. `seed` may be a string (a seed code like "KQ7F-M2XB") or a number.
 * @param {string|number} seed
 * @param {string} [label]
 * @returns {() => number} uniform [0, 1)
 */
export function rng(seed, label = '') {
	return mulberry32(hash32(`${seed}|${label}`))
}

/** One step of a stored uint32 stream: returns [value in [0,1), nextState]. Lets plain-JSON state carry its own PRNG. */
export function stepState(state) {
	const a = (state + 0x6d2b79f5) >>> 0
	let t = a
	t = Math.imul(t ^ (t >>> 15), t | 1)
	t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
	return [((t ^ (t >>> 14)) >>> 0) / 4294967296, a]
}

export const randInt = (rand, lo, hi) => lo + Math.floor(rand() * (hi - lo + 1))
export const pick = (rand, list) => list[Math.floor(rand() * list.length)]

/** Weighted pick from [[item, weight], ...]. */
export function pickWeighted(rand, pairs) {
	let total = 0
	for (const [, w] of pairs) total += Math.max(0, w)
	let r = rand() * total
	for (const [item, w] of pairs) {
		r -= Math.max(0, w)
		if (r < 0) return item
	}
	return pairs[pairs.length - 1][0]
}

/** Fisher-Yates (same loop shape as the engine's shuffle), returns a new array. */
export function shuffle(arr, rand) {
	const a = arr.slice()
	for (let m = a.length; m; ) {
		const i = Math.floor(rand() * m--)
		const t = a[m]
		a[m] = a[i]
		a[i] = t
	}
	return a
}

/** Canonical JSON: object keys sorted, no whitespace. Same data => same string => same id. */
export function canonicalJson(value) {
	if (value === null || typeof value !== 'object') return JSON.stringify(value)
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
	const keys = Object.keys(value)
		.filter((k) => value[k] !== undefined)
		.sort()
	return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`
}
