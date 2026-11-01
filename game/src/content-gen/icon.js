// EVER content-gen: card art from a recipe (art.js), built ONLY from the art kit
// (game/src/shared/style.js): kit props where the kit has one (sword, shield, hammer,
// lantern, tokens, the Doubt crystal), and the kit's own recipe for the rest: low-poly
// primitives, makeMaterial palette keys, flat shading, jitter. Render it with the kit's
// createIconRenderer(); createCardArt() caches one PNG per recipe key.
// BROWSER (imports three through the kit). Pure data lives in art.js.
//
// Copyright (C) 2026 the EVER contributors.
// SPDX-License-Identifier: AGPL-3.0-or-later

import * as THREE from 'three'
import {jitter, makeCardIcon, makeHammer, makeLantern, makeMaterial, makeShield, makeSword, makeToken} from '../shared/style.js'
import {artKey, isValidRecipe} from './art.js'

const mat = (key, glow = 0) => makeMaterial(key, glow ? {emissive: glow} : {})
function mesh(geo, key, glow = 0) {
	const m = new THREE.Mesh(geo, typeof key === 'string' ? mat(key, glow) : key)
	m.castShadow = false
	m.receiveShadow = false
	return m
}
function at(o, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
	o.position.set(x, y, z)
	o.rotation.set(rx, ry, rz)
	return o
}
const box = (w, h, d, s) => jitter(new THREE.BoxGeometry(w, h, d), Math.min(w, h, d) * 0.05, s, {keepBottom: false})
const cyl = (rt, rb, h, seg, s) => jitter(new THREE.CylinderGeometry(rt, rb, h, seg, 1), Math.max(rt, rb) * 0.05, s, {keepBottom: false})
const cone = (r, h, seg, s) => jitter(new THREE.ConeGeometry(r, h, seg, 1), r * 0.06, s, {keepBottom: false})
const ico = (r, s, j = 0.08) => jitter(new THREE.IcosahedronGeometry(r, 0), r * j, s, {keepBottom: false})
const oct = (r, s) => jitter(new THREE.OctahedronGeometry(r, 0), r * 0.08, s, {keepBottom: false})
const torus = (r, t, s, seg = 7) => jitter(new THREE.TorusGeometry(r, t, 4, seg), t * 0.15, s, {keepBottom: false})
const group = (...kids) => {
	const g = new THREE.Group()
	for (const k of kids) g.add(k)
	return g
}
/** Center a kit prop built standing on y=0 around the origin. */
function centered(obj) {
	const b = new THREE.Box3().setFromObject(obj)
	const c = b.getCenter(new THREE.Vector3())
	const g = new THREE.Group()
	obj.position.sub(c)
	g.add(obj)
	return g
}

/**
 * Prop builders: (tint, accent, seed, glow) -> Object3D centered on the origin, ~1 unit.
 * Every color is a palette key; nothing outside the kit's look.
 */
const PROPS = {
	sword: (t, a, s) => centered(makeSword({seed: s})),
	shield: (t, a, s) => centered(makeShield({seed: s, colorKey: t === 'gold' ? 'slate' : t})),
	hammer: (t, a, s) => centered(makeHammer({seed: s, size: 1.2, head: t === 'paper' ? 'iron' : t})),
	lantern: (t, a, s, g) => {
		const l = makeLantern({lit: true, post: false, seed: s})
		if (g) l.add(at(mesh(oct(0.08, s + 9), 'gold', 1.2), 0, 0.55, 0))
		return centered(l)
	},
	token: (t, a, s) => group(mesh(cyl(0.42, 0.42, 0.1, 8, s), t), at(mesh(cyl(0.3, 0.3, 0.12, 8, s + 1), a), 0, 0, 0.02)).rotateX(Math.PI / 2),
	ember: () => centered(makeToken('ember')),
	ward: () => centered(makeToken('ward')),
	whetstone: () => centered(makeToken('whetstone')),
	doubt: () => centered(makeCardIcon('Doubt', 'curse')),
	bolt: (t, a, s, g) => {
		const shape = new THREE.Shape([[0.1, 0.6], [-0.25, 0], [0, 0], [-0.12, -0.6], [0.28, 0.08], [0.02, 0.08]].map(([x, y]) => new THREE.Vector2(x, y)))
		return at(mesh(new THREE.ExtrudeGeometry(shape, {depth: 0.12, bevelEnabled: false}), t, 0.4 + 0.3 * g), 0, 0, -0.06)
	},
	spark: (t, a, s, g) => group(mesh(oct(0.32, s), t, 0.6 + 0.3 * g), at(mesh(oct(0.16, s + 1), a, 1), 0.32, 0.3, 0.1), at(mesh(oct(0.1, s + 2), a, 1), -0.3, -0.28, 0.1)),
	coal: (t, a, s, g) => group(mesh(oct(0.42, s), 'iron'), at(mesh(oct(0.2, s + 1), t, 0.9 + 0.2 * g), 0.12, 0.1, 0.28)),
	drop: (t, a, s) => group(at(mesh(cone(0.3, 0.55, 6, s), t), 0, 0.22, 0), at(mesh(ico(0.3, s + 1, 0.04), t), 0, -0.08, 0)),
	thorn: (t, a, s) => {
		const g = group(at(mesh(cyl(0.05, 0.07, 1.1, 5, s), a === 'gold' ? 'pine' : a), 0, 0, 0, 0, 0, 0.3))
		for (let i = 0; i < 4; i++) g.add(at(mesh(cone(0.07, 0.24, 4, s + 2 + i), t), (i % 2 ? 0.12 : -0.12) + 0.08 * (i - 1.5) * -0.3, -0.35 + i * 0.24, 0, 0, 0, i % 2 ? -1.2 : 1.2))
		return g
	},
	leaf: (t, a, s) => {
		const geo = ico(0.42, s)
		geo.scale(0.55, 1, 0.18)
		return group(at(mesh(geo, t), 0, 0.05, 0, 0, 0, -0.4), at(mesh(box(0.05, 0.5, 0.05, s + 1), a === 'gold' ? 'pine' : a), 0.12, -0.38, 0, 0, 0, -0.4))
	},
	feather: (t, a, s) => {
		const vane = cone(0.2, 1.0, 4, s)
		vane.scale(1, 1, 0.25)
		return group(at(mesh(vane, t), 0, 0.05, 0, 0, 0, -0.5), at(mesh(box(0.04, 0.5, 0.04, s + 1), a), -0.24, -0.38, 0, 0, 0, -0.5))
	},
	bell: (t, a, s) => group(at(mesh(cyl(0.18, 0.42, 0.6, 7, s), t), 0, 0.05, 0), at(mesh(ico(0.09, s + 1), a), 0, -0.32, 0), at(mesh(torus(0.1, 0.03, s + 2), 'iron'), 0, 0.42, 0)),
	coin: (t, a, s) => group(at(mesh(cyl(0.45, 0.45, 0.1, 8, s), t), 0, 0, 0, Math.PI / 2, 0, 0), at(mesh(box(0.2, 0.2, 0.06, s + 1), a), 0, 0, 0.06, 0, 0, Math.PI / 4)),
	ring: (t, a, s) => group(mesh(torus(0.36, 0.09, s, 8), t), at(mesh(oct(0.14, s + 1), a, 0.4), 0, 0.42, 0)),
	apple: (t, a, s) => group(mesh(ico(0.4, s), t), at(mesh(box(0.04, 0.2, 0.04, s + 1), 'wood'), 0, 0.45, 0), at(mesh(cone(0.08, 0.22, 4, s + 2), a === t ? 'moss' : a), 0.12, 0.45, 0, 0, 0, -1.1)),
	bucket: (t, a, s) => group(mesh(cyl(0.38, 0.3, 0.6, 7, s), t), at(mesh(cyl(0.4, 0.4, 0.06, 7, s + 1), 'iron'), 0, 0.2, 0), at(mesh(torus(0.32, 0.025, s + 2), 'iron'), 0, 0.3, 0, 0, 0, 0)),
	rope: (t, a, s) => group(mesh(torus(0.34, 0.1, s), t), at(mesh(torus(0.22, 0.08, s + 1), t), 0, 0, 0.1), at(mesh(box(0.1, 0.4, 0.1, s + 2), t), 0.36, -0.3, 0)),
	book: (t, a, s) => group(mesh(box(0.8, 0.12, 0.6, s), t === 'paper' ? 'slate' : t), at(mesh(box(0.74, 0.08, 0.56, s + 1), 'paper'), 0.02, 0.09, 0), at(mesh(box(0.06, 0.04, 0.5, s + 2), a), 0.2, 0.15, 0)).rotateX(0.7),
	apron: (t, a, s) => group(mesh(box(0.7, 0.85, 0.08, s), t), at(mesh(box(0.84, 0.06, 0.1, s + 1), a), 0, 0.3, 0), at(mesh(box(0.3, 0.2, 0.1, s + 2), a), 0, -0.1, 0.02)),
	cloud: (t, a, s) => group(mesh(ico(0.32, s), t), at(mesh(ico(0.24, s + 1), t), 0.32, -0.05, 0), at(mesh(ico(0.22, s + 2), a), -0.3, -0.06, 0.05)),
	wave: (t, a, s) => {
		const g = new THREE.Group()
		for (let i = 0; i < 3; i++) g.add(at(mesh(torus(0.22, 0.06, s + i, 6), i === 1 ? a : t), -0.4 + i * 0.4, (i % 2) * 0.1, 0, 0, 0, Math.PI * 0.1))
		return g
	},
	beak: (t, a, s) => group(at(mesh(cone(0.22, 0.7, 4, s), t === 'paper' ? 'ink' : t), 0.1, 0, 0, 0, 0, -Math.PI / 2), at(mesh(ico(0.26, s + 1), 'ink'), -0.3, 0, 0), at(mesh(oct(0.06, s + 2), a, 0.8), -0.28, 0.08, 0.22)),
}

/** Prop ids icon.js can build (tests keep this equal to ART_PROPS). */
export const ICON_PROPS = Object.freeze(Object.keys(PROPS))

/**
 * Build the icon for a recipe. Invalid recipes fall back to a gold gem (never throws).
 * @param {import('./art.js').ArtRecipe} rc
 * @returns {THREE.Group}
 */
export function makeIconFromRecipe(rc) {
	const root = new THREE.Group()
	root.name = 'ever:genicon'
	if (!isValidRecipe(rc)) {
		root.add(mesh(ico(0.45, 35), 'gold'))
		return root
	}
	const build = PROPS[rc.prop] ?? PROPS.token
	const main = new THREE.Group()
	for (let i = 0; i < rc.count; i++) {
		const p = build(rc.tint, rc.accent, rc.seed + i * 17, rc.glow)
		const off = (i - (rc.count - 1) / 2) * 0.32
		p.position.x += off
		p.position.y -= off * 0.4
		main.add(p)
	}
	main.rotation.z = rc.rot * 0.12
	main.scale.setScalar(rc.scale)
	root.add(main)
	if (rc.badge && PROPS[rc.badge]) {
		const b = PROPS[rc.badge](rc.accent, rc.tint, rc.seed + 101, 0)
		b.scale.setScalar(0.42)
		b.position.set(0.55, -0.5, 0.3)
		root.add(b)
	}
	if (rc.glow === 2) root.add(at(mesh(oct(0.07, rc.seed + 7), 'gold', 1.2), -0.55, 0.55, 0.3))
	return root
}

/**
 * Cached PNG card art. `renderer` is the kit's createIconRenderer() (one per page).
 * @param {{render: (obj: THREE.Object3D, px?: number) => string}} renderer
 */
export function createCardArt(renderer, {max = 200} = {}) {
	const cache = new Map()
	return {
		/** @param {import('./art.js').ArtRecipe} rc @returns {string} data URL */
		get(rc, px) {
			const key = artKey(rc) + (px ? `@${px}` : '')
			let url = cache.get(key)
			if (!url) {
				url = renderer.render(makeIconFromRecipe(rc), px)
				if (cache.size >= max) cache.delete(cache.keys().next().value)
				cache.set(key, url)
			}
			return url
		},
		clear: () => cache.clear(),
	}
}
