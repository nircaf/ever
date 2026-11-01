// EVER content-gen: card art recipes. A recipe is a small, deterministic, plain-JSON
// description of a card icon built ONLY from the art kit (props from ART_PROPS, colors
// from the palette keys in ART_TINTS). The same def always gives the same recipe, on every
// machine, so a generated card looks the same in solo, in co-op and after a reload.
// icon.js turns a recipe into a Three.js group that the kit's createIconRenderer() renders.
// PURE (no three here, so the room server and tests can use it).
//
// Copyright (C) 2026 the EVER contributors.
// SPDX-License-Identifier: AGPL-3.0-or-later

import {ART_PROPS, ART_TINTS, canonicalJson, hash32} from '../mechanics/index.js'
import {THEME_WORDS} from './lexicon.js'

export const ART_RECIPE_VERSION = 1

/** Frame band color key by card type / kind (shared/style.js CARD_TYPE_COLORS). */
const FRAME = Object.freeze({attack: 'ember', skill: 'slate', power: 'moss', curse: 'doubt', item: 'gold', token: 'gold'})

/** Mechanic family -> the prop that says it at a glance. */
const FAMILY_PROP = Object.freeze({
	damage: 'sword', block: 'shield', draw: 'book', energy: 'spark', heal: 'apple', loseHp: 'drop',
	poison: 'thorn', regen: 'leaf', weak: 'cloud', vulnerable: 'beak', strength: 'hammer', thorns: 'thorn',
	discard: 'wave', exhaust: 'ember', addCard: 'book', removePower: 'lantern', loseEnergy: 'cloud', healNow: 'apple',
})
/** Default tint per prop when nothing else decides (all palette keys). */
const PROP_TINT = Object.freeze({
	sword: 'iron', shield: 'slate', hammer: 'iron', token: 'gold', ember: 'ember', ward: 'ward', whetstone: 'stone',
	doubt: 'doubt', bolt: 'gold', coal: 'ember', drop: 'ward', thorn: 'moss', leaf: 'moss', feather: 'ink', bell: 'slate',
	coin: 'gold', ring: 'gold', apple: 'ember', bucket: 'wood', rope: 'wood', lantern: 'window', book: 'paper',
	apron: 'apron', cloud: 'ash', wave: 'ward', beak: 'ink', spark: 'gold',
})

const familyOf = (e) => (e?.do === 'power' ? e.kind : e?.do === 'addCard' && e.card === 'Doubt' ? 'doubt' : e?.do)

/** All effects of a def in reading order (card effects, then trigger effects). */
function effectsOf(def) {
	const out = [...(def.effects ?? [])]
	for (const t of def.triggers ?? []) out.push(...(t.effects ?? []))
	return out
}

/**
 * @typedef {object} ArtRecipe
 * @prop {1} v
 * @prop {string} prop      main prop (ART_PROPS)
 * @prop {string} tint      palette key for the main prop
 * @prop {string} accent    palette key for details / the badge
 * @prop {string|null} badge  small second prop for the card's second mechanic, or null
 * @prop {1|2|3} count      copies of the main prop (multi-hit attacks)
 * @prop {string} frame     palette key of the card frame band
 * @prop {0|1|2} glow       0 common, 1 uncommon, 2 rare (emissive strength step)
 * @prop {number} rot       roll in steps of 0.12 rad, -3..3
 * @prop {number} scale     0.9 .. 1.1 in steps of 0.05
 * @prop {number} seed      0..999, jitter seed for the low-poly facets
 */

/**
 * Deterministic icon recipe for a canonical def (card, item, curse or token).
 * @param {object} def  canonical def (validateContent(...).def)
 * @returns {ArtRecipe}
 */
export function artRecipe(def) {
	const h = hash32(canonicalJson({...def, art: undefined, v: undefined}))
	const r = (shift, mod) => (h >>> shift) % mod
	const kind = def?.kind ?? 'card'
	const theme = THEME_WORDS[def?.theme] ? def.theme : null
	const fx = effectsOf(def ?? {})
	const families = fx.map(familyOf).filter(Boolean)
	const lead = families[0]
	const asked = def?.art ?? {}

	let prop = ART_PROPS.includes(asked.prop) ? asked.prop : null
	// The schema falls back to 'sword' for a card without art; a sword on a skill misleads.
	if (!prop || (prop === 'sword' && kind === 'card' && def.type !== 'attack')) prop = FAMILY_PROP[lead] ?? theme?.art?.prop ?? 'token'
	if (kind === 'curse') prop = ART_PROPS.includes(asked.prop) ? asked.prop : 'doubt'
	if (!ART_PROPS.includes(prop)) prop = 'token'

	const themeArt = theme ? THEME_WORDS[theme].art : null
	let tint = ART_TINTS.includes(asked.tint) && asked.tint !== 'paper' ? asked.tint : themeArt?.tint ?? PROP_TINT[prop] ?? 'gold'
	if (kind === 'curse') tint = 'doubt'
	let accent = ART_TINTS.includes(asked.accent) ? asked.accent : themeArt?.accent ?? 'gold'
	if (accent === tint) accent = tint === 'gold' ? 'ink' : 'gold'

	const second = families.find((f) => FAMILY_PROP[f] && FAMILY_PROP[f] !== prop && f !== lead)
	let badge = second ? FAMILY_PROP[second] : families.includes('doubt') ? 'doubt' : null
	if (badge === prop) badge = null

	const hits = fx.find((e) => e.do === 'damage')?.hits ?? 1
	const frame = kind === 'card' ? FRAME[def.type] ?? 'ember' : FRAME[kind]
	const glow = def?.rarity === 'rare' ? 2 : def?.rarity === 'uncommon' ? 1 : 0
	return {
		v: ART_RECIPE_VERSION,
		prop,
		tint,
		accent,
		badge,
		count: /** @type {1|2|3} */ (Math.max(1, Math.min(3, hits))),
		frame,
		glow,
		rot: r(0, 7) - 3,
		scale: (18 + r(3, 5)) / 20,
		seed: r(8, 1000),
	}
}

/** Stable cache key for a recipe (equal recipes, equal keys). */
export const artKey = (recipe) => canonicalJson(recipe)

/** True if a recipe only names kit props and palette keys (the room and tests use it). */
export function isValidRecipe(rc) {
	if (!rc || typeof rc !== 'object' || rc.v !== ART_RECIPE_VERSION) return false
	if (!ART_PROPS.includes(rc.prop) || (rc.badge !== null && !ART_PROPS.includes(rc.badge))) return false
	if (![rc.tint, rc.accent, rc.frame].every((t) => ART_TINTS.includes(t))) return false
	return [1, 2, 3].includes(rc.count) && [0, 1, 2].includes(rc.glow) && Number.isInteger(rc.rot) && Math.abs(rc.rot) <= 3 && rc.scale >= 0.9 && rc.scale <= 1.1 && Number.isInteger(rc.seed)
}
