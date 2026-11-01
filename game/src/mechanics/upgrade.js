// EVER mechanics: upgrade variants (GDD_V2 8.1 card frame: "numbers +~30%, or energy -1",
// 8.2: "Upgrade +3 PP, or energy -1"). Deterministic: the same card always upgrades the
// same way, so the upgraded variant never needs to be stored.
// PURE.
//
// Copyright (C) 2026 the EVER contributors.
// SPDX-License-Identifier: AGPL-3.0-or-later

import {UPGRADE_BUDGET} from './library.js'
import {effectPP} from './budget.js'
import {effectSpec} from './blocks-registry.js'

const BUMPABLE = new Set(['damage', 'block', 'heal', 'power', 'healNow'])

function bumpEffects(effects) {
	const out = effects.map((e) => ({...e}))
	let left = UPGRADE_BUDGET
	let changed = false
	for (const e of out) {
		if (!BUMPABLE.has(e.do) && !effectSpec(e.do)?.code) continue
		if (typeof e.n !== 'number' || effectPP(e) <= 0) continue
		const spec = effectSpec(e.do)
		const max = Math.min(spec.params.n?.max ?? e.n, Math.max(e.n + 1, Math.round(e.n * 1.4)))
		while (e.n < max) {
			const before = effectPP(e)
			e.n++
			const delta = effectPP(e) - before
			if (delta > left + 1e-9 || delta <= 0) {
				e.n--
				break
			}
			left -= delta
			changed = true
		}
		if (left < 1) break
	}
	return changed ? out : null
}

/**
 * The upgraded variant of a card def (a full card def, without `upgrade`), or null when
 * the card cannot be upgraded (curses, tokens, items).
 */
export function upgradedCard(def) {
	if (def?.kind !== 'card') return null
	const {upgrade, ...base} = def
	if (upgrade) {
		return {
			...base,
			energy: upgrade.energy ?? base.energy,
			effects: upgrade.effects ?? base.effects,
			...(base.type === 'power' ? {triggers: upgrade.triggers ?? base.triggers ?? []} : {}),
		}
	}
	const effects = bumpEffects(base.effects)
	if (effects) return {...base, effects}
	if (base.type === 'power' && base.triggers?.length) {
		const triggers = base.triggers.map((t) => ({...t}))
		for (const t of triggers) {
			const e = bumpEffects(t.effects)
			if (e) {
				t.effects = e
				return {...base, triggers}
			}
		}
	}
	if (base.energy > 0) return {...base, energy: base.energy - 1}
	return {...base}
}
