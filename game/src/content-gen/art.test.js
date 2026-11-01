// Card art: recipes are deterministic and only name kit props and palette keys; icon.js
// builds every prop from the kit with a small triangle budget and palette materials only.
// Presets: 24, three per theme, all valid world changes.
// Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later
import {describe, expect, it} from 'vitest'
import {ART_PROPS, ART_TINTS, THEMES} from '../mechanics/index.js'
import {COLORS} from '../shared/style.js'
import {artKey, artRecipe, isValidRecipe} from './art.js'
import {generateDef} from './generate.js'
import {ICON_PROPS, createCardArt, makeIconFromRecipe} from './icon.js'
import {WORLD_PRESETS, presetEntries, presetWorldChanges} from './presets.js'
import {validateWorldEntry} from '../platform/world-schema.js'

const triangles = (obj) => {
	let n = 0
	obj.traverse((o) => {
		if (o.isMesh) n += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3
	})
	return n
}

describe('artRecipe', () => {
	it('is deterministic and valid for generated content of every kind', () => {
		for (let i = 0; i < 60; i++) {
			const def = generateDef(`art${i}`, 'a', {kind: ['card', 'item', 'token', 'curse'][i % 4], theme: THEMES[i % 8], rarity: ['common', 'uncommon', 'rare'][i % 3]})
			const r = artRecipe(def)
			expect(isValidRecipe(r), JSON.stringify(r)).toBe(true)
			expect(artRecipe(structuredClone(def))).toEqual(r)
			if (def.kind === 'curse') expect(r.tint).toBe('doubt')
			expect(r.tint).not.toBe(r.accent)
		}
	})
	it('says the mechanic at a glance and varies between cards', () => {
		const skill = artRecipe({kind: 'card', type: 'skill', rarity: 'rare', effects: [{do: 'block', n: 6}, {do: 'draw', n: 1}], art: {prop: 'sword', tint: 'paper'}})
		expect(skill).toMatchObject({prop: 'shield', badge: 'book', glow: 2, frame: 'slate'})
		const twin = artRecipe({kind: 'card', type: 'attack', effects: [{do: 'damage', n: 4, hits: 2}]})
		expect(twin.count).toBe(2)
		const keys = new Set()
		for (let n = 1; n < 30; n++) keys.add(artKey(artRecipe({kind: 'card', type: 'attack', name: `X${n}`, effects: [{do: 'damage', n}]})))
		expect(keys.size).toBeGreaterThan(20)
	})
	it('refuses recipes outside the kit', () => {
		const ok = artRecipe({kind: 'card', type: 'attack', effects: [{do: 'damage', n: 6}]})
		expect(isValidRecipe(ok)).toBe(true)
		for (const bad of [null, {}, {...ok, prop: 'gun'}, {...ok, tint: '#ff00ff'}, {...ok, badge: 'skull'}, {...ok, count: 9}, {...ok, v: 2}]) expect(isValidRecipe(bad)).toBe(false)
	})
})

describe('icon.js (kit renderer input)', () => {
	it('builds every ART_PROP, small and only from palette materials', () => {
		expect([...ICON_PROPS].sort()).toEqual([...ART_PROPS].sort())
		for (const prop of ART_PROPS) {
			for (const tint of ['ember', 'paper', 'gold']) {
				const g = makeIconFromRecipe({v: 1, prop, tint, accent: tint === 'gold' ? 'ink' : 'gold', badge: 'shield', count: 3, frame: 'ember', glow: 2, rot: 3, scale: 1.1, seed: 7})
				expect(triangles(g), prop).toBeLessThan(900)
				g.traverse((o) => {
					if (!o.isMesh) return
					const key = String(o.material.name).replace(/^ever:/, '')
					expect(key in COLORS, `${prop}: ${o.material.name}`).toBe(true)
				})
			}
		}
		expect(ART_TINTS.every((t) => t in COLORS)).toBe(true)
	})
	it('falls back to a gem for a bad recipe and caches rendered art by key', () => {
		expect(makeIconFromRecipe({prop: 'gun'}).children).toHaveLength(1)
		let renders = 0
		const art = createCardArt({render: () => `data:${++renders}`}, {max: 2})
		const r = artRecipe({kind: 'card', type: 'attack', effects: [{do: 'damage', n: 6}]})
		expect(art.get(r)).toBe(art.get(structuredClone(r)))
		expect(renders).toBe(1)
	})
})

describe('preset world changes', () => {
	it('24 presets, 3 per theme, all valid platform preset entries, unique ids and content', () => {
		expect(WORLD_PRESETS).toHaveLength(24)
		for (const th of THEMES) expect(WORLD_PRESETS.filter((p) => p.themes[0] === th)).toHaveLength(3)
		const keys = new Set()
		for (const e of presetEntries()) {
			const v = validateWorldEntry(e)
			expect(v.ok, `${e.id}: ${JSON.stringify(v.errors)}`).toBe(true)
			expect(e.proposal.kind).not.toBe('block') // GDD 14.2: presets never make code
			keys.add(JSON.stringify(e.proposal))
		}
		expect(keys.size).toBe(24)
		expect(new Set(WORLD_PRESETS.map((p) => p.id)).size).toBe(24)
	})
	it('picks the book themes first, skips used ones, and is seeded', () => {
		const themes = {primary: 'crow', secondary: 'oath', shadow: 'well'}
		const a = presetWorldChanges({themes, seed: 'S1'})
		expect(a.map((p) => p.themes.includes('crow') || p.themes.includes('oath') || p.themes.includes('well'))).toEqual([true, true, true])
		expect(a[0].themes).toContain('crow')
		expect(presetWorldChanges({themes, seed: 'S1'})).toEqual(a)
		const used = WORLD_PRESETS.filter((p) => p.themes.includes('crow')).map((p) => p.id)
		const b = presetWorldChanges({themes, used, seed: 'S1'})
		expect(b).toHaveLength(3)
		expect(b.some((p) => used.includes(p.id))).toBe(false)
		expect(presetWorldChanges({themes, used: WORLD_PRESETS.map((p) => p.id)})).toEqual([])
	})
})
