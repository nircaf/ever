// Card + token icon cache for the exploration UI (deck viewer, pickers, offers, HUD slots).
// Renders kit props (style.js makeCardIcon / makeToken) to PNG data URLs once, then
// frees the extra WebGL context after a short idle so exploration keeps one context.
//
// v2: generated cards, items, curses and tokens get procedural icons from their art recipe
// (content-gen/art.js artRecipe: a kit prop, palette tints, a badge, a count, a glow step).
// Every prop below is built only from low-poly primitives with the kit's flat-shaded palette
// materials (makeMaterial) and its facet jitter, so they sit next to the MVP icons.
// OWNER: world engineer.
// Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later

import * as THREE from 'three'
import {createIconRenderer, jitter, makeCardIcon, makeHammer, makeLantern, makeMaterial, makeShield, makeSword, makeToken} from '../shared/style.js'

const cache = new Map()
let renderer = null
let idle = 0

function freeGeometry(obj) {
	obj.traverse((o) => o.geometry?.dispose?.()) // materials are the kit's shared cache: keep them
}

function render(key, build) {
	if (cache.has(key)) return cache.get(key)
	let url = ''
	try {
		renderer ||= createIconRenderer({size: 128})
		const obj = build()
		url = renderer.render(obj)
		freeGeometry(obj)
	} catch {
		url = ''
	}
	cache.set(key, url)
	clearTimeout(idle)
	idle = setTimeout(disposeIcons, 1500)
	return url
}

/** PNG data URL for a card (by STW base name) or a token kind; '' if WebGL is unavailable. */
export function iconUrl(name, type = 'attack') {
	return render(name + '|' + type, () => makeCardIcon(name, type))
}

// ---------------------------------------------------------------------------------------
// Recipe icons (v2)
// ---------------------------------------------------------------------------------------

const mat = (key, glow = 0) => {
	try {
		return makeMaterial(key, glow ? {emissive: glow} : {})
	} catch {
		return makeMaterial('gold')
	}
}
const mesh = (geo, key, glow = 0) => new THREE.Mesh(geo, mat(key, glow))
const J = (geo, seed, amt = 0.04) => jitter(geo, amt, seed, {keepBottom: false})
const place = (o, x = 0, y = 0, z = 0, rz = 0, rx = 0, ry = 0) => {
	o.position.set(x, y, z)
	o.rotation.set(rx, ry, rz)
	return o
}

/** One kit-style prop, centred near the origin, about 1 u tall. */
export function makeIconProp(prop, tint = 'gold', accent = 'ink', seed = 1, glow = 0) {
	const g = new THREE.Group()
	const add = (o, ...p) => g.add(place(o, ...p))
	switch (prop) {
		case 'sword':
			add(makeSword(), 0, -0.6, 0, -0.6)
			break
		case 'shield':
			add(makeShield({colorKey: tint === 'paper' ? 'slate' : tint}), 0, -0.5)
			break
		case 'hammer':
			add(makeHammer({size: 1.3}), 0.1, -0.6, 0, 0.5)
			break
		case 'lantern': {
			const l = makeLantern({lit: true, post: false, seed})
			add(l, 0, -0.35)
			break
		}
		case 'ember':
		case 'ward':
		case 'whetstone': {
			const t = makeToken(prop)
			t.children[0].position.y = 0
			add(t)
			break
		}
		case 'token':
			add(mesh(J(new THREE.CylinderGeometry(0.45, 0.45, 0.12, 7), seed), tint, glow * 0.3), 0, 0, 0, 0, Math.PI / 2)
			add(mesh(J(new THREE.OctahedronGeometry(0.18, 0), seed + 1), accent, 0.6), 0, 0, 0.12)
			break
		case 'doubt':
			add(mesh(J(new THREE.OctahedronGeometry(0.5, 0), seed, 0.08), 'doubt', 0.25))
			add(mesh(new THREE.BoxGeometry(0.06, 0.8, 0.1), 'ink'), 0.05, 0, 0.32, 0.4)
			break
		case 'bolt': {
			const sh = new THREE.Shape([new THREE.Vector2(0.1, 0.6), new THREE.Vector2(-0.25, 0), new THREE.Vector2(0, 0), new THREE.Vector2(-0.12, -0.6), new THREE.Vector2(0.28, 0.08), new THREE.Vector2(0.02, 0.08)])
			add(mesh(new THREE.ExtrudeGeometry(sh, {depth: 0.12, bevelEnabled: false}), tint, 0.4), 0, 0, -0.06)
			break
		}
		case 'spark':
			for (let i = 0; i < 4; i++) add(mesh(J(new THREE.ConeGeometry(0.1, 0.7, 4), seed + i), tint, 0.8), 0, 0, 0, (i * Math.PI) / 2)
			add(mesh(J(new THREE.OctahedronGeometry(0.2, 0), seed + 9), 'paper', 0.6))
			break
		case 'coal':
			add(mesh(J(new THREE.OctahedronGeometry(0.45, 0), seed, 0.1), 'ink'))
			add(mesh(new THREE.BoxGeometry(0.5, 0.06, 0.5), tint, 1.0), 0, 0.02, 0, 0.4, 0.3)
			break
		case 'drop': {
			add(mesh(J(new THREE.IcosahedronGeometry(0.38, 0), seed), tint, 0.25), 0, -0.15)
			add(mesh(J(new THREE.ConeGeometry(0.3, 0.55, 6), seed + 1), tint, 0.25), 0, 0.3)
			break
		}
		case 'thorn':
			add(mesh(J(new THREE.CylinderGeometry(0.05, 0.08, 1.2, 5), seed), 'pine'), 0, 0, 0, 0.3)
			for (let i = 0; i < 4; i++) add(mesh(J(new THREE.ConeGeometry(0.07, 0.3, 4), seed + i), tint), -0.12 + i * 0.08, -0.4 + i * 0.27, 0, (i % 2 ? 1 : -1) * 1.2)
			add(mesh(J(new THREE.OctahedronGeometry(0.16, 0), seed + 7), accent), 0.22, 0.5, 0)
			break
		case 'leaf':
			add(mesh(J(new THREE.OctahedronGeometry(0.5, 0), seed).scale(0.55, 1, 0.18), tint), 0, 0.05, 0, 0.5)
			add(mesh(new THREE.BoxGeometry(0.05, 0.5, 0.05), 'wood'), 0.18, -0.45, 0, 0.5)
			break
		case 'feather':
			add(mesh(J(new THREE.ConeGeometry(0.28, 1.2, 4), seed).scale(1, 1, 0.25), tint), 0, 0, 0, -0.5)
			add(mesh(new THREE.BoxGeometry(0.04, 1.3, 0.04), 'paper'), 0, 0, 0.05, -0.5)
			break
		case 'beak':
			add(mesh(J(new THREE.IcosahedronGeometry(0.34, 0), seed), tint), -0.2, 0.05)
			add(mesh(J(new THREE.ConeGeometry(0.16, 0.6, 4), seed + 1), 'gold'), 0.28, 0, 0, -Math.PI / 2)
			add(mesh(new THREE.BoxGeometry(0.08, 0.08, 0.08), 'paper', 0.4), -0.12, 0.15, 0.3)
			break
		case 'bell':
			add(mesh(J(new THREE.CylinderGeometry(0.22, 0.48, 0.7, 6), seed), tint), 0, 0)
			add(mesh(J(new THREE.OctahedronGeometry(0.12, 0), seed + 1), accent), 0, -0.42)
			add(mesh(new THREE.TorusGeometry(0.1, 0.04, 4, 6), 'iron'), 0, 0.44)
			break
		case 'coin':
			add(mesh(J(new THREE.CylinderGeometry(0.48, 0.48, 0.1, 8), seed), tint, 0.25), 0, 0, 0, 0, Math.PI / 2)
			add(mesh(new THREE.BoxGeometry(0.2, 0.2, 0.04), accent), 0, 0, 0.07, Math.PI / 4)
			break
		case 'ring':
			add(mesh(new THREE.TorusGeometry(0.38, 0.1, 5, 7), tint, 0.2), 0, -0.05, 0, 0, 0.5)
			add(mesh(J(new THREE.OctahedronGeometry(0.16, 0), seed), accent, 0.5), 0, 0.42)
			break
		case 'apple':
			add(mesh(J(new THREE.IcosahedronGeometry(0.45, 0), seed, 0.06), tint), 0, -0.05)
			add(mesh(new THREE.BoxGeometry(0.05, 0.25, 0.05), 'wood'), 0, 0.45)
			add(mesh(J(new THREE.OctahedronGeometry(0.16, 0), seed + 1).scale(1, 0.4, 0.5), 'moss'), 0.15, 0.5, 0, -0.5)
			break
		case 'bucket':
			add(mesh(J(new THREE.CylinderGeometry(0.42, 0.32, 0.6, 7), seed), tint))
			add(mesh(new THREE.TorusGeometry(0.4, 0.03, 3, 8, Math.PI), 'iron'), 0, 0.3)
			add(mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.02, 7), 'ward', 0.3), 0, 0.22)
			break
		case 'rope':
			for (let i = 0; i < 3; i++) add(mesh(new THREE.TorusGeometry(0.34 - i * 0.04, 0.07, 4, 8), tint), 0, -0.15 + i * 0.14, 0, 0, Math.PI / 2 - 0.4)
			break
		case 'book':
			add(mesh(J(new THREE.BoxGeometry(0.8, 0.12, 0.6), seed), tint), 0, 0, 0, 0.15, 0.4)
			add(mesh(new THREE.BoxGeometry(0.74, 0.08, 0.54), 'paper'), 0.02, 0.09, 0, 0.15, 0.4)
			break
		case 'apron':
			add(mesh(J(new THREE.BoxGeometry(0.6, 0.85, 0.06), seed), tint), 0, -0.05)
			add(mesh(new THREE.BoxGeometry(0.74, 0.06, 0.07), accent), 0, 0.15)
			break
		case 'cloud':
			for (let i = 0; i < 3; i++) add(mesh(J(new THREE.IcosahedronGeometry(0.3 - (i % 2) * 0.06, 0), seed + i), tint), -0.32 + i * 0.32, (i % 2) * 0.12)
			break
		case 'wave':
			for (let i = 0; i < 3; i++) add(mesh(J(new THREE.ConeGeometry(0.2, 0.5, 4), seed + i), tint, 0.2), -0.36 + i * 0.36, 0, 0, -0.6)
			add(mesh(new THREE.BoxGeometry(1.1, 0.1, 0.2), tint), 0, -0.25)
			break
		default:
			add(mesh(J(new THREE.IcosahedronGeometry(0.45, 0), seed), tint, glow * 0.3))
	}
	return g
}

/**
 * A recipe as one icon group: main prop (1-3 copies), optional small badge prop, a rarity
 * glow ring for uncommon and rare. Unknown props fall back to a gem.
 * @param {{prop: string, tint?: string, accent?: string, badge?: string|null, count?: number, glow?: number, rot?: number, scale?: number, seed?: number}} rc
 */
export function makeRecipeIcon(rc) {
	const g = new THREE.Group()
	const n = Math.max(1, Math.min(3, rc.count ?? 1))
	for (let i = 0; i < n; i++) {
		const p = makeIconProp(rc.prop, rc.tint ?? 'gold', rc.accent ?? 'ink', (rc.seed ?? 1) + i * 7, rc.glow ?? 0)
		const off = (i - (n - 1) / 2) * 0.32
		p.position.x += off
		p.position.y += off * -0.4
		p.rotation.z += (rc.rot ?? 0) * 0.12
		p.scale.setScalar((rc.scale ?? 1) * (n > 1 ? 0.8 : 1))
		g.add(p)
	}
	if (rc.badge && rc.badge !== rc.prop) {
		const b = makeIconProp(rc.badge, rc.accent ?? 'gold', rc.tint ?? 'ink', (rc.seed ?? 1) + 31, 0)
		b.scale.setScalar(0.42)
		b.position.set(0.55, -0.5, 0.3)
		g.add(b)
	}
	if (rc.glow) {
		const ring = mesh(new THREE.TorusGeometry(0.85, 0.035, 3, 12), rc.glow > 1 ? 'gold' : 'ward', 0.8)
		ring.position.z = -0.3
		g.add(ring)
	}
	return g
}

/** PNG data URL for an art recipe ('' without WebGL). Equal recipes share one render. */
export function recipeIconUrl(rc) {
	if (!rc || typeof rc !== 'object' || typeof rc.prop !== 'string') return ''
	const key = 'rc|' + [rc.prop, rc.tint, rc.accent, rc.badge, rc.count, rc.glow, rc.rot, rc.scale, rc.seed].join(',')
	return render(key, () => makeRecipeIcon(rc))
}

/** Free the offscreen renderer (the cache of data URLs stays). */
export function disposeIcons() {
	clearTimeout(idle)
	try {
		renderer?.dispose()
	} catch {}
	renderer = null
}
