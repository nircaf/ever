// EVER mechanics sandbox: the ONLY module a code block (game/src/mechanics/blocks/*.js)
// may import. Small pure helpers so blocks never need computed member access or loops.
// This file is outside blocks/, so world-change pull requests cannot modify it.
//
// Copyright (C) 2026 the EVER contributors.
// SPDX-License-Identifier: AGPL-3.0-or-later

/** Clamp to an integer range; non-numbers become `lo`. */
export function clamp(v, lo, hi) {
	return Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.trunc(v))) : lo
}

/** Element i of a list (integer index, bounds-checked), or undefined. */
export function at(list, i) {
	if (!Array.isArray(list)) return undefined
	const k = Math.trunc(Number(i))
	return k >= 0 && k < list.length ? list[k] : undefined
}

/** Percent of a value, rounded down. */
export const pct = (value, percent) => Math.floor((Number(value) * Number(percent)) / 100)
