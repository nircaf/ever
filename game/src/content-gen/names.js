// EVER content-gen: names and flavor lines from the theme lexicons (GDD_V2 10.6).
// Names never repeat a name already in the book or the world pool, and always pass the
// mechanics name rules (cleanName), so the validator never rejects an offline name.
// PURE.
//
// Copyright (C) 2026 the EVER contributors.
// SPDX-License-Identifier: AGPL-3.0-or-later

import {cleanName, cleanFlavor, pick} from '../mechanics/index.js'
import {NPC_WORDS, THEME_WORDS, THEMED_CURSES, CURSE_PREFIX} from './lexicon.js'

const lower = (s) => String(s).toLowerCase()

/**
 * A fresh name for a generated thing.
 * @param {() => number} rand
 * @param {string} theme
 * @param {{taken?: Set<string>, npc?: string, kind?: string}} [o]  taken: lowercase names already used
 * @returns {string}
 */
export function makeName(rand, theme, {taken = new Set(), npc} = {}) {
	const lx = THEME_WORDS[theme] ?? THEME_WORDS.forge
	const npcAdj = NPC_WORDS[npc]?.adj
	const ok = (n) => {
		const w = n.toLowerCase().split(' ')
		// "Sealed Seal", "Iron Iron": no two words sharing a stem.
		if (w.some((a, i) => w.some((b, k) => k > i && a.slice(0, 4) === b.slice(0, 4)))) return null
		const c = cleanName(n, {existing: [...taken]})
		return c.ok ? c.value : null
	}
	for (let i = 0; i < 24; i++) {
		const adj = npcAdj && rand() < 0.3 ? pick(rand, npcAdj) : pick(rand, lx.adj)
		const v = ok(`${adj} ${pick(rand, lx.noun)}`)
		if (v) return remember(taken, v)
	}
	for (let i = 0; i < 24; i++) {
		const v = ok(`${pick(rand, lx.adj)} ${pick(rand, lx.adj)} ${pick(rand, lx.noun)}`)
		if (v) return remember(taken, v)
	}
	// Practically unreachable (400+ combinations per theme), but never loop forever.
	return remember(taken, `${pick(rand, lx.adj)} ${pick(rand, lx.noun)} ${['Anew', 'Again', 'Twice'][Math.floor(rand() * 3)]}`)
}

function remember(taken, v) {
	taken.add(lower(v))
	return v
}

/** Name for a themed curse; prefixes it ("Old Slag") if the book already has one. */
export function curseName(rand, theme, taken = new Set()) {
	const base = THEMED_CURSES[theme]?.name ?? 'Doubt'
	if (!taken.has(lower(base)) && cleanName(base).ok) return remember(taken, base)
	for (let i = 0; i < 12; i++) {
		const n = `${pick(rand, CURSE_PREFIX)} ${base}`
		if (!taken.has(lower(n)) && cleanName(n).ok) return remember(taken, n)
	}
	return makeName(rand, theme, {taken})
}

/**
 * A flavor line. `dark` lines are for curses and bargains.
 * @returns {string}
 */
export function makeFlavor(rand, theme, {dark = false} = {}) {
	const lx = THEME_WORDS[theme] ?? THEME_WORDS.forge
	const line = pick(rand, dark ? lx.dark : lx.flavor)
	return cleanFlavor(line).ok ? line : ''
}
