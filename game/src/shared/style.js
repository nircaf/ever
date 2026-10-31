// EVER shared art kit: palette, lights, fog, camera framing and procedural
// low-poly factories used by BOTH exploration and combat.
// Spec: docs/ART_BIBLE.md. Depends only on 'three'.
//
// Copyright (C) 2026 the EVER contributors.
// SPDX-License-Identifier: AGPL-3.0-or-later
// This program is free software: you can redistribute it and/or modify it under
// the terms of the GNU Affero General Public License as published by the Free
// Software Foundation, either version 3 of the License, or (at your option) any
// later version. See the LICENSE file at the project root.

import * as THREE from 'three'

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

/** The ten named colors (docs/ART_BIBLE.md section 3). Hex strings. */
export const PALETTE = Object.freeze({
	paper: '#F2E8D5',
	ink: '#2B2A33',
	ember: '#E4572E',
	slate: '#4F6D8A',
	moss: '#6A994E',
	dusk: '#F6C28B',
	gold: '#E9B44C',
	doubt: '#7D6B91',
	ward: '#A9CCE3',
	haze: '#8E9DB3',
})

/** Supporting 3D-only shades (section 3.1). Never use these as UI colors. */
export const WORLD = Object.freeze({
	pine: '#2F5D57',
	pineDark: '#24474A',
	// cooler, less saturated than moss so the ground recedes (QA: green dominated the frame)
	grass: '#5B8462',
	grassLight: '#6A9168',
	grassDark: '#4C7459',
	path: '#B9AD95',
	ash: '#6E6B74',
	stone: '#8C93A0',
	stoneDark: '#666D7A',
	wood: '#6B5242',
	roof: '#3E5872',
	window: '#F2B84B',
	apron: '#5E5B69', // lifted so Marcus reads under the forge roof
	rust: '#B5523B',
	beard: '#9DA0A8',
	iron: '#3B3C46',
	keyLight: '#FFE2BF',
})

/** Every color key accepted by makeMaterial(). */
export const COLORS = Object.freeze({...WORLD, ...PALETTE})

/** Card frame band colors by Slay the Web card type, plus our token. */
export const CARD_TYPE_COLORS = Object.freeze({
	attack: PALETTE.ember,
	skill: PALETTE.slate,
	power: PALETTE.moss,
	curse: PALETTE.doubt,
	token: PALETTE.gold,
	status: PALETTE.haze,
})

/** Seat 1..4 cloak colors (index 0 = seat 1). */
export const SEAT_COLORS = Object.freeze([PALETTE.ember, PALETTE.slate, PALETTE.moss, PALETTE.gold])
export const SEAT_KEYS = Object.freeze(['ember', 'slate', 'moss', 'gold'])

export const FONTS = Object.freeze({
	display: "'Young Serif', Georgia, 'Times New Roman', serif",
	ui: "'Figtree', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
	googleFontsHref:
		'https://fonts.googleapis.com/css2?family=Figtree:wght@400;600;800&family=Young+Serif&display=swap',
})

/** Motion constants in seconds (section 10). */
export const MOTION = Object.freeze({
	bobAmp: 0.03,
	bobSpeed: 1.6,
	walkSpeed: 6,
	walkLeanRad: 0.105,
	turnTime: 0.12,
	cameraLag: 0.25,
	combatCameraMove: 1.2,
	tellPose: 0.4,
	lunge: 0.12,
	hitFlash: 0.15,
	slamShake: {amount: 0.15, time: 0.25},
	stationFade: 0.6,
	cardDraw: 0.18,
	cardDrawStagger: 0.04,
	cardHover: 0.12,
	cardPlay: 0.22,
	toast: 2.4,
})

/** True when the user asked the OS for less motion. Safe outside browsers. */
export const REDUCED_MOTION =
	typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

// ---------------------------------------------------------------------------
// CSS tokens (style.css declares the same values; this keeps JS-built UI and
// canvas-drawn UI in sync and lets a page without style.css still get tokens)
// ---------------------------------------------------------------------------

function cssVarName(key) {
	return '--ever-' + key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())
}

/** `:root{...}` block with every palette, card-type, seat and font token. */
export const CSS_TOKENS = (() => {
	const lines = []
	for (const [k, v] of Object.entries(PALETTE)) lines.push(`${cssVarName(k)}: ${v};`)
	for (const [k, v] of Object.entries(CARD_TYPE_COLORS)) lines.push(`--ever-card-${k}: ${v};`)
	SEAT_COLORS.forEach((c, i) => lines.push(`--ever-seat-${i + 1}: ${c};`))
	lines.push(`--ever-font-display: ${FONTS.display};`)
	lines.push(`--ever-font-ui: ${FONTS.ui};`)
	return `:root {\n  ${lines.join('\n  ')}\n}`
})()

/** Write the tokens as inline custom properties on `root` (default <html>). */
export function applyCssTokens(root = typeof document !== 'undefined' ? document.documentElement : null) {
	if (!root || !root.style) return
	for (const [k, v] of Object.entries(PALETTE)) root.style.setProperty(cssVarName(k), v)
	for (const [k, v] of Object.entries(CARD_TYPE_COLORS)) root.style.setProperty(`--ever-card-${k}`, v)
	SEAT_COLORS.forEach((c, i) => root.style.setProperty(`--ever-seat-${i + 1}`, c))
	root.style.setProperty('--ever-font-display', FONTS.display)
	root.style.setProperty('--ever-font-ui', FONTS.ui)
}

// ---------------------------------------------------------------------------
// Seeded randomness and jitter
// ---------------------------------------------------------------------------

/** Deterministic PRNG (mulberry32). Returns () => float in [0, 1). */
export function rng(seed = 1) {
	let a = hashString(String(seed)) || 1
	return () => {
		a = (a + 0x6d2b79f5) | 0
		let t = Math.imul(a ^ (a >>> 15), 1 | a)
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

function hashString(s) {
	let h = 2166136261
	for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
	return h >>> 0
}

function hash3(x, y, z, seed) {
	let h = Math.imul(Math.round(x * 1000) | 0, 73856093)
	h ^= Math.imul(Math.round(y * 1000) | 0, 19349663)
	h ^= Math.imul(Math.round(z * 1000) | 0, 83492791)
	h ^= Math.imul(seed | 0, 2654435761)
	h = Math.imul(h ^ (h >>> 16), 2246822507)
	h = Math.imul(h ^ (h >>> 13), 3266489909)
	return (h ^ (h >>> 16)) >>> 0
}

/** Seed from a map position, so co-op clients build identical props. */
export function seedFromPos(x, z, salt = 0) {
	return hash3(x, 0, z, salt + 7) % 100000
}

/**
 * Offset every vertex by a hash of its position + seed. Coincident vertices
 * (seams) move together, so no cracks. Vertices at the minimum Y keep their Y
 * so the object still sits flat on the ground. Mutates and returns geo.
 */
export function jitter(geo, amount = 0.05, seed = 1, {keepBottom = true} = {}) {
	if (!amount) return geo
	const pos = geo.attributes.position
	let minY = Infinity
	if (keepBottom) for (let i = 0; i < pos.count; i++) minY = Math.min(minY, pos.getY(i))
	const s = typeof seed === 'number' ? seed : hashString(String(seed))
	for (let i = 0; i < pos.count; i++) {
		const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
		const h = hash3(x, y, z, s)
		const dx = ((h & 1023) / 1023 - 0.5) * 2 * amount
		const dy = (((h >>> 10) & 1023) / 1023 - 0.5) * 2 * amount
		const dz = (((h >>> 20) & 1023) / 1023 - 0.5) * 2 * amount
		const bottom = keepBottom && y - minY < 1e-4
		pos.setXYZ(i, x + dx, bottom ? y : y + dy, z + dz)
	}
	pos.needsUpdate = true
	geo.computeVertexNormals()
	geo.computeBoundingSphere()
	return geo
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

const materialCache = new Map()

/**
 * Cached flat-shaded Lambert material.
 * @param {string} colorKey  a key of COLORS (e.g. 'ember', 'pine') or a '#RRGGBB' hex
 * @param {{emissive?: boolean|number, transparent?: boolean, opacity?: number, side?: number, vertexColors?: boolean, fog?: boolean}} [opts]
 *   emissive: true = glow in its own color at 0.9, or a number 0..2 for the intensity.
 * Materials are shared: clone() before animating one instance's color/emissive.
 */
export function makeMaterial(colorKey = 'paper', opts = {}) {
	const key = colorKey + '|' + JSON.stringify(opts)
	let m = materialCache.get(key)
	if (m) return m
	const hex = COLORS[colorKey] || (String(colorKey).startsWith('#') ? colorKey : null)
	if (!hex) throw new Error(`style.js: unknown color key "${colorKey}"`)
	const emissive = opts.emissive === true ? 0.9 : Number(opts.emissive) || 0
	m = new THREE.MeshLambertMaterial({
		color: opts.vertexColors ? 0xffffff : hex,
		flatShading: true,
		vertexColors: !!opts.vertexColors,
		emissive: emissive ? hex : 0x000000,
		emissiveIntensity: emissive || 1,
		transparent: !!opts.transparent || opts.opacity != null,
		opacity: opts.opacity ?? 1,
		side: opts.side ?? THREE.FrontSide,
		fog: opts.fog ?? true,
	})
	m.name = 'ever:' + colorKey
	materialCache.set(key, m)
	return m
}

/** Linear-space THREE.Color for a palette or world key. */
export function color(key) {
	return new THREE.Color(COLORS[key] || key)
}

// ---------------------------------------------------------------------------
// Renderer, lights, fog, sky, cameras
// ---------------------------------------------------------------------------

/** 'high' on big desktop screens, 'low' on phones / coarse pointers. */
export function pickQuality() {
	if (typeof window === 'undefined') return 'medium'
	const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
	if (coarse || Math.min(window.innerWidth, window.innerHeight) < 600) return 'low'
	return window.devicePixelRatio > 1.5 ? 'medium' : 'high'
}

/** Standard renderer settings: sRGB, NO tone mapping, capped DPR, soft shadows. */
export function configureRenderer(renderer, quality = pickQuality()) {
	renderer.outputColorSpace = THREE.SRGBColorSpace
	renderer.toneMapping = THREE.NoToneMapping
	if (typeof window !== 'undefined') renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'low' ? 1.5 : 2))
	renderer.shadowMap.enabled = quality !== 'low'
	renderer.shadowMap.type = THREE.PCFSoftShadowMap
	renderer.setClearColor(PALETTE.haze, 1)
	return renderer
}

/** Direction from the scene target toward the low dusk sun (west-south-west). */
export const SUN_DIR = Object.freeze(new THREE.Vector3(-0.75, 0.55, 0.35).normalize())

/**
 * The one light rig: warm key directional + cool hemisphere. Adds to scene.
 * Call rig.follow(x, z) each frame (or on big moves) so the shadow box stays
 * centered on the action.
 */
export function makeLightRig(scene, {quality = pickQuality(), shadowSize = 24} = {}) {
	const hemi = new THREE.HemisphereLight(PALETTE.ward, WORLD.pineDark, 0.85)
	hemi.name = 'ever:hemi'
	const key = new THREE.DirectionalLight(WORLD.keyLight, 1.15)
	key.name = 'ever:key'
	key.castShadow = quality !== 'low'
	const map = quality === 'high' ? 2048 : 1024
	key.shadow.mapSize.set(map, map)
	const c = key.shadow.camera
	c.left = -shadowSize; c.right = shadowSize; c.top = shadowSize; c.bottom = -shadowSize
	c.near = 1; c.far = 120
	key.shadow.bias = -0.0006
	key.shadow.normalBias = 0.03
	const target = new THREE.Object3D()
	key.target = target
	scene.add(hemi, key, target)
	const follow = (x = 0, z = 0) => {
		target.position.set(x, 0, z)
		key.position.set(x + SUN_DIR.x * 50, SUN_DIR.y * 50, z + SUN_DIR.z * 50)
	}
	follow(0, 0)
	return {key, hemi, target, follow}
}

/** Linear fog in the haze color. mode 'explore' | 'combat'. */
export function makeFog(scene, mode = 'explore') {
	const fog = mode === 'combat' ? new THREE.Fog(PALETTE.haze, 24, 70) : new THREE.Fog(PALETTE.haze, 30, 78)
	if (scene) {
		scene.fog = fog
		scene.background = new THREE.Color(PALETTE.haze)
	}
	return fog
}

/**
 * Sky dome: slate zenith, haze horizon, dusk glow band toward the sun.
 * Not fogged, follows the camera if you call sky.position.copy(camera.position).
 */
export function makeSky({radius = 160} = {}) {
	const geo = new THREE.IcosahedronGeometry(radius, 2)
	const pos = geo.attributes.position
	const cols = new Float32Array(pos.count * 3)
	const zen = color('slate'), hor = color('haze'), glow = color('dusk')
	const sunFlat = new THREE.Vector2(SUN_DIR.x, SUN_DIR.z).normalize()
	const c = new THREE.Color()
	for (let i = 0; i < pos.count; i++) {
		const x = pos.getX(i) / radius, y = pos.getY(i) / radius, z = pos.getZ(i) / radius
		const up = THREE.MathUtils.clamp(y, 0, 1)
		c.copy(hor).lerp(zen, Math.pow(up, 0.6))
		const flat = new THREE.Vector2(x, z)
		const facing = flat.lengthSq() > 1e-6 ? Math.max(0, flat.normalize().dot(sunFlat)) : 0
		const band = Math.max(0, 1 - Math.abs(y - 0.08) / 0.18)
		c.lerp(glow, band * Math.pow(facing, 2) * 0.85)
		cols.set([c.r, c.g, c.b], i * 3)
	}
	geo.setAttribute('color', new THREE.BufferAttribute(cols, 3))
	const mat = new THREE.MeshBasicMaterial({vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false})
	const sky = new THREE.Mesh(geo, mat)
	sky.name = 'ever:sky'
	sky.renderOrder = -1
	return sky
}

/** Camera framing constants (section 5). */
export const CAMERA = Object.freeze({
	explore: {fov: 32, offset: [0, 14, 15], lookAhead: [0, 1, -2], portraitScale: 1.6},
	combat: {fov: 34, position: [-6, 7.5, -8], target: [1, 0.6, -23], portraitPosition: [-3.5, 15, 3], portraitTarget: [0.3, 0, -22.4]},
	cover: {fov: 30, position: [0, 4.2, 4.6], target: [0, 0.6, 0]},
})

/** Combat arena positions (x, z) and facing. GDD: circle (0,-22) r=3, gate (0,-25). */
export const COMBAT_STAGE = Object.freeze({
	warden: [-1.2, -23.6], // stepped out of the opened gate into the circle
	wardenDormant: [0, -27],
	// seat 1..4, east side of the circle, facing the Warden;
	// spaced along the combat camera's right axis so no seat hides another
	// (QA: +0.4 u per seat along the camera's right axis, so heads no longer overlap)
	players: [
		[1.0, -22.3],
		[2.46, -21.93],
		[3.82, -20.96],
		[5.29, -20.59],
	],
})

export function makeCamera(aspect = 16 / 9, mode = 'explore') {
	const cam = new THREE.PerspectiveCamera(CAMERA[mode].fov, aspect, 0.5, 400)
	if (mode === 'combat') frameCombat(cam, aspect)
	return cam
}

const _v = new THREE.Vector3()
/**
 * Smoothly follow `target` (Vector3-like) with the exploration offset.
 * Pass dt in seconds; pass dt = Infinity to snap.
 */
export function followCamera(camera, target, dt = 1 / 60) {
	const e = CAMERA.explore
	const s = camera.aspect < 1 ? e.portraitScale : 1
	_v.set(target.x + e.offset[0] * s, target.y + e.offset[1] * s, target.z + e.offset[2] * s)
	const k = dt === Infinity ? 1 : 1 - Math.exp(-dt / (MOTION.cameraLag / 3))
	camera.position.lerp(_v, k)
	camera.lookAt(target.x + e.lookAhead[0], target.y + e.lookAhead[1], target.z + e.lookAhead[2])
}

/** Snap (or with t in 0..1, blend from `from` pose) to the combat shot. */
export function frameCombat(camera, aspect = camera.aspect, t = 1, from = null) {
	const c = CAMERA.combat
	camera.fov = c.fov
	camera.updateProjectionMatrix()
	const p = new THREE.Vector3(...(aspect < 1 ? c.portraitPosition : c.position))
	const tg = new THREE.Vector3(...(aspect < 1 ? c.portraitTarget : c.target))
	if (from && t < 1) {
		const e = easeInOut(t)
		p.lerpVectors(from.position, p, e)
		tg.lerpVectors(from.target, tg, e)
	}
	camera.position.copy(p)
	camera.lookAt(tg)
	return {position: p, target: tg}
}

export function easeInOut(t) {
	t = THREE.MathUtils.clamp(t, 0, 1)
	return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

// ---------------------------------------------------------------------------
// Mesh helpers and baking
// ---------------------------------------------------------------------------

function mesh(geo, matKey, {shadow = true, receive = true, matOpts} = {}) {
	const m = new THREE.Mesh(geo, typeof matKey === 'string' ? makeMaterial(matKey, matOpts) : matKey)
	m.castShadow = shadow
	m.receiveShadow = receive
	return m
}

function at(obj, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
	obj.position.set(x, y, z)
	obj.rotation.set(rx, ry, rz)
	return obj
}

const box = (w, h, d, seed, j = 0.04) => jitter(new THREE.BoxGeometry(w, h, d), Math.min(w, h, d) * j, seed)
const cyl = (rt, rb, h, seg, seed, j = 0.04) =>
	jitter(new THREE.CylinderGeometry(rt, rb, h, seg, 1), Math.max(rt, rb) * j, seed)
const cone = (r, h, seg, seed, j = 0.05) => jitter(new THREE.ConeGeometry(r, h, seg, 1), r * j, seed)
const ico = (r, detail, seed, j = 0.08) => jitter(new THREE.IcosahedronGeometry(r, detail), r * j, seed, {keepBottom: false})

/**
 * Merge every static mesh under `root` into one mesh per material (positions +
 * normals + optional vertex colors). Use for scenery to save draw calls. The
 * returned group replaces root; root's own transform is kept.
 */
export function bakeStatic(root, {shadow = true} = {}) {
	root.updateMatrixWorld(true)
	const inv = new THREE.Matrix4().copy(root.matrixWorld).invert()
	const byMat = new Map()
	root.traverse((o) => {
		if (!o.isMesh) return
		const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()
		g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld))
		const list = byMat.get(o.material) || []
		list.push(g)
		byMat.set(o.material, list)
	})
	const out = new THREE.Group()
	out.name = (root.name || 'baked') + ':baked'
	out.position.copy(root.position)
	out.quaternion.copy(root.quaternion)
	out.scale.copy(root.scale)
	out.userData = {...root.userData}
	for (const [mat, geos] of byMat) {
		const merged = mergeGeos(geos)
		out.add(mesh(merged, mat, {shadow}))
		geos.forEach((g) => g.dispose())
	}
	return out
}

function mergeGeos(geos) {
	let n = 0
	const hasColor = geos.every((g) => g.attributes.color)
	for (const g of geos) n += g.attributes.position.count
	const pos = new Float32Array(n * 3)
	const col = hasColor ? new Float32Array(n * 3) : null
	let o = 0
	for (const g of geos) {
		pos.set(g.attributes.position.array, o * 3)
		if (col) col.set(g.attributes.color.array, o * 3)
		o += g.attributes.position.count
	}
	const geo = new THREE.BufferGeometry()
	geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
	if (col) geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
	geo.computeVertexNormals()
	geo.computeBoundingSphere()
	return geo
}

/** Count triangles under an object (for budget checks). */
export function countTriangles(root) {
	let t = 0
	root.traverse((o) => {
		if (!o.isMesh) return
		const g = o.geometry
		t += (g.index ? g.index.count : g.attributes.position.count) / 3
	})
	return t
}

// ---------------------------------------------------------------------------
// Nature
// ---------------------------------------------------------------------------

/**
 * @param {{kind?: 'pine'|'round', seed?: number, scale?: number}} o
 * pine: 3 stacked teal cones (~5 u tall). round: big faceted crown (the Lectern tree, ~7 u).
 */
export function makeTree({kind = 'pine', seed = 1, scale = 1} = {}) {
	const r = rng(seed)
	const g = new THREE.Group()
	g.name = 'ever:tree'
	if (kind === 'round') {
		g.add(at(mesh(cyl(0.35, 0.55, 3.2, 6, seed), 'wood'), 0, 1.6, 0, 0, 0, (r() - 0.5) * 0.08))
		g.add(at(mesh(ico(2.6, 1, seed + 1, 0.12), 'moss'), 0, 4.6, 0))
		g.add(at(mesh(ico(1.7, 0, seed + 2, 0.12), 'grassDark'), 1.4, 3.9, 0.6))
		g.add(at(mesh(ico(1.5, 0, seed + 3, 0.12), 'grassLight'), -1.2, 5.3, -0.4))
	} else {
		const h = 0.85 + r() * 0.35
		g.add(at(mesh(cyl(0.16, 0.22, 0.9, 5, seed), 'wood'), 0, 0.45, 0))
		const tiers = [
			[1.35, 1.9, 1.7, 'pineDark'],
			[1.05, 1.6, 2.7, 'pine'],
			[0.7, 1.3, 3.6, 'pine'],
		]
		tiers.forEach(([rad, ht, y, c], i) => {
			const m = mesh(cone(rad, ht, 6, seed + i * 13, 0.12), c)
			at(m, (r() - 0.5) * 0.12, y * h, (r() - 0.5) * 0.12, 0, r() * Math.PI, 0)
			g.add(m)
		})
	}
	g.scale.setScalar(scale)
	g.rotation.y = r() * Math.PI * 2
	return g
}

export function makeRock({seed = 1, size = 1, colorKey = 'stone'} = {}) {
	const geo = new THREE.DodecahedronGeometry(size, 0)
	geo.scale(1, 0.62, 0.85)
	jitter(geo, size * 0.22, seed, {keepBottom: false})
	const m = mesh(geo, colorKey)
	m.position.y = size * 0.3
	m.rotation.y = rng(seed)() * Math.PI * 2
	m.name = 'ever:rock'
	return m
}

/**
 * Ground for Ashbrook: a flat-shaded slab with per-triangle grass shades, the
 * road and the ash circle painted in. Heights jitter only +-0.08 so actors can
 * stand at y = 0. A paper "page edge" slab sits underneath (pop-up book look).
 */
export function makeTerrain({
	size = 64,
	segments = 40,
	seed = 11,
	paths = [
		{from: [0, 24], to: [0, -24], width: 3.2},
		{from: [0, 1], to: [-12, 1], width: 2.4},
		{from: [0, 2], to: [12, 3], width: 2},
	],
	pads = [
		{x: 0, z: 0, r: 4.2, color: 'path'},
		{x: -14, z: 0, r: 4.5, color: 'path'},
		{x: 0, z: -23, r: 4.6, color: 'ash'},
	],
} = {}) {
	const geo = new THREE.PlaneGeometry(size, size, segments, segments)
	geo.rotateX(-Math.PI / 2)
	const p = geo.attributes.position
	for (let i = 0; i < p.count; i++) {
		const x = p.getX(i), z = p.getZ(i)
		const edge = Math.max(Math.abs(x), Math.abs(z)) > size / 2 - 0.01
		const h = edge ? 0 : ((hash3(x, 0, z, seed) & 1023) / 1023 - 0.5) * 0.16
		p.setY(i, h)
	}
	const flat = geo.toNonIndexed()
	geo.dispose()
	const fp = flat.attributes.position
	const cols = new Float32Array(fp.count * 3)
	const shades = [color('grass'), color('grassLight'), color('grassDark'), color('grass')]
	const c = new THREE.Color()
	const distToSeg = (x, z, a, b) => {
		const dx = b[0] - a[0], dz = b[1] - a[1]
		const t = THREE.MathUtils.clamp(((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz), 0, 1)
		return Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t))
	}
	for (let t = 0; t < fp.count; t += 3) {
		const cx = (fp.getX(t) + fp.getX(t + 1) + fp.getX(t + 2)) / 3
		const cz = (fp.getZ(t) + fp.getZ(t + 1) + fp.getZ(t + 2)) / 3
		const h = hash3(cx, 1, cz, seed)
		c.copy(shades[h & 3])
		for (const pa of paths) {
			if (distToSeg(cx, cz, pa.from, pa.to) < pa.width / 2 + ((h >>> 4) & 3) * 0.15) c.copy(color('path'))
		}
		for (const pd of pads) {
			if (Math.hypot(cx - pd.x, cz - pd.z) < pd.r + ((h >>> 6) & 3) * 0.12) c.copy(color(pd.color))
		}
		if ((h >>> 8) % 9 === 0) c.multiplyScalar(0.94)
		for (let k = 0; k < 3; k++) cols.set([c.r, c.g, c.b], (t + k) * 3)
	}
	flat.setAttribute('color', new THREE.BufferAttribute(cols, 3))
	flat.computeVertexNormals()
	const g = new THREE.Group()
	g.name = 'ever:terrain'
	const ground = mesh(flat, makeMaterial('paper', {vertexColors: true}), {shadow: false})
	ground.name = 'ever:ground'
	g.add(ground)
	// page edge: paper slab with an ink base line
	const slab = mesh(new THREE.BoxGeometry(size, 1.4, size), 'paper', {shadow: false})
	slab.position.y = -0.86 // top at -0.16, below the lowest terrain dip (-0.08)
	const base = mesh(new THREE.BoxGeometry(size + 0.3, 0.25, size + 0.3), 'ink', {shadow: false})
	base.position.y = -1.64
	g.add(slab, base)
	g.userData.size = size
	return g
}

/** Flat low-poly pad (hex by default) for station footprints, the combat circle, etc. */
export function makeGroundTile({radius = 2, sides = 6, colorKey = 'path', seed = 3, height = 0.08} = {}) {
	const m = mesh(cyl(radius, radius * 1.04, height, sides, seed, 0.03), colorKey, {shadow: false})
	m.position.y = height / 2
	m.name = 'ever:tile'
	return m
}

/** Ring of pines around the square map, merged into 2-3 draw calls. */
export function makePineRing({size = 64, inset = 3, count = 70, seed = 5, gaps = [[0, 30, 4]]} = {}) {
	const r = rng(seed)
	const g = new THREE.Group()
	const half = size / 2 - inset
	for (let i = 0; i < count; i++) {
		const side = i % 4
		const t = (r() * 2 - 1) * half
		const depth = r() * 2.6
		let x, z
		if (side === 0) { x = t; z = -half + depth }
		else if (side === 1) { x = t; z = half - depth }
		else if (side === 2) { x = -half + depth; z = t }
		else { x = half - depth; z = t }
		if (gaps.some(([gx, gz, gr]) => Math.hypot(x - gx, z - gz) < gr)) continue
		const tree = makeTree({seed: seedFromPos(x, z, seed), scale: 0.85 + r() * 0.55})
		tree.position.set(x, 0, z)
		g.add(tree)
	}
	return bakeStatic(g)
}

/** Low dry-stone wall around the map edge, merged. */
export function makeStoneWall({size = 64, inset = 0.8, seed = 9, gaps = []} = {}) {
	const g = new THREE.Group()
	const half = size / 2 - inset
	const r = rng(seed)
	for (let side = 0; side < 4; side++) {
		for (let t = -half; t < half; t += 1.6) {
			const len = 1.4 + r() * 0.3
			const h = 0.6 + r() * 0.35
			const b = mesh(box(len, h, 0.8, seedFromPos(t, side, seed), 0.12), r() < 0.3 ? 'stoneDark' : 'stone')
			const x = side < 2 ? t + 0.8 : side === 2 ? -half : half
			const z = side < 2 ? (side === 0 ? -half : half) : t + 0.8
			if (gaps.some(([gx, gz, gr]) => Math.hypot(x - gx, z - gz) < gr)) continue
			at(b, x, h / 2, z, 0, side < 2 ? (r() - 0.5) * 0.1 : Math.PI / 2 + (r() - 0.5) * 0.1, 0)
			g.add(b)
		}
	}
	return bakeStatic(g)
}

/** Scatter rocks at given [x,z] points (or random in a square), merged. */
export function makeRockScatter({points, count = 20, area = 56, seed = 4} = {}) {
	const r = rng(seed)
	const pts = points || Array.from({length: count}, () => [(r() - 0.5) * area, (r() - 0.5) * area])
	const g = new THREE.Group()
	for (const [x, z] of pts) {
		const rock = makeRock({seed: seedFromPos(x, z, seed), size: 0.3 + r() * 0.5})
		rock.position.x = x
		rock.position.z = z
		g.add(rock)
	}
	return bakeStatic(g)
}

// ---------------------------------------------------------------------------
// Village props
// ---------------------------------------------------------------------------

/** Decor house: stone base, plaster walls, slate-blue gable roof, warm window. */
export function makeHouse({seed = 1, width = 4, depth = 3.4, lit = true} = {}) {
	const r = rng(seed)
	const g = new THREE.Group()
	g.name = 'ever:house'
	const wallH = 2.2 + r() * 0.5
	g.add(at(mesh(box(width + 0.2, 0.5, depth + 0.2, seed, 0.1), 'stoneDark'), 0, 0.25, 0))
	g.add(at(mesh(box(width, wallH, depth, seed + 1, 0.02), 'paper'), 0, 0.5 + wallH / 2, 0))
	// gable roof: a 3-sided prism (cylinder with 3 segments) laid along x
	const roofGeo = new THREE.CylinderGeometry(depth * 0.78, depth * 0.78, width + 0.6, 3, 1)
	roofGeo.rotateZ(Math.PI / 2)
	roofGeo.rotateX(-Math.PI / 2) // apex up
	roofGeo.scale(1, 0.72, 1)
	jitter(roofGeo, 0.08, seed + 2, {keepBottom: false})
	g.add(at(mesh(roofGeo, 'roof'), 0, 0.5 + wallH + depth * 0.25, 0))
	g.add(at(mesh(box(0.7, 1.4, 0.8, seed + 3), 'stone'), width * 0.28, 0.5 + wallH + 1.0, -depth * 0.2))
	g.add(at(mesh(box(0.8, 1.5, 0.08, seed + 4), 'wood'), -width * 0.22, 1.25, depth / 2 + 0.02))
	const win = mesh(box(0.7, 0.6, 0.08, seed + 5), lit ? makeMaterial('window', {emissive: 0.8}) : 'ink', {shadow: false})
	g.add(at(win, width * 0.22, 1.7, depth / 2 + 0.02))
	g.userData.window = win
	return g
}

/** Lantern on a post. setLit(bool). */
export function makeLantern({lit = false, post = true, seed = 2} = {}) {
	const g = new THREE.Group()
	g.name = 'ever:lantern'
	let y = 0
	if (post) {
		g.add(at(mesh(box(0.18, 2.4, 0.18, seed), 'wood'), 0, 1.2, 0))
		g.add(at(mesh(box(0.7, 0.12, 0.12, seed + 1), 'wood'), 0.3, 2.3, 0))
		y = 1.95
	}
	const holder = new THREE.Group()
	holder.position.set(post ? 0.55 : 0, y, 0)
	holder.add(at(mesh(cone(0.22, 0.18, 4, seed + 2), 'iron'), 0, 0.36, 0, 0, Math.PI / 4, 0))
	const glass = mesh(box(0.26, 0.3, 0.26, seed + 3, 0.02), 'ink')
	glass.position.y = 0.13
	holder.add(glass)
	holder.add(at(mesh(box(0.3, 0.05, 0.3, seed + 4), 'iron'), 0, -0.04, 0))
	g.add(holder)
	g.setLit = (on) => {
		glass.material = on ? makeMaterial('window', {emissive: 1.1}) : makeMaterial('ink')
		g.userData.lit = !!on
	}
	g.setLit(lit)
	return g
}

/** Small campfire (village decor or epilogue). setLit(bool), update(t). */
export function makeCampfire({lit = true, seed = 6} = {}) {
	const g = new THREE.Group()
	g.name = 'ever:campfire'
	for (let i = 0; i < 7; i++) {
		const a = (i / 7) * Math.PI * 2
		g.add(at(makeRock({seed: seed + i, size: 0.22, colorKey: 'stoneDark'}), Math.cos(a) * 0.65, 0.05, Math.sin(a) * 0.65))
	}
	for (let i = 0; i < 3; i++) {
		const l = mesh(cyl(0.08, 0.1, 1.0, 5, seed + 10 + i), 'wood')
		at(l, 0, 0.18, 0, Math.PI / 2, (i / 3) * Math.PI, 0.25)
		g.add(l)
	}
	const flame = mesh(cone(0.32, 0.8, 5, seed + 20), makeMaterial('ember', {emissive: 1.1}), {shadow: false})
	flame.position.y = 0.55
	const core = mesh(cone(0.16, 0.5, 4, seed + 21), makeMaterial('gold', {emissive: 1.2}), {shadow: false})
	core.position.y = 0.45
	g.add(flame, core)
	g.setLit = (on) => { flame.visible = core.visible = !!on }
	g.update = (t) => {
		if (!flame.visible || REDUCED_MOTION) return
		flame.scale.set(1, 1 + Math.sin(t * 9) * 0.08, 1)
		flame.rotation.y = t * 1.5
	}
	g.setLit(lit)
	return g
}

/**
 * Signpost at spawn: three arrow boards, no text. The top arrow points up the road to the
 * gate (gold tip), the left one to the forge (ember tip), the right one to the stone (ward tip).
 */
export function makeSignpost({seed = 8} = {}) {
	const g = new THREE.Group()
	g.name = 'ever:signpost'
	g.add(at(mesh(box(0.2, 2.3, 0.2, seed), 'wood'), 0, 1.15, 0))
	const arrow = (len, tipKey, s) => {
		const a = new THREE.Group()
		a.add(at(mesh(box(len, 0.34, 0.1, s, 0.03), 'paper'), len / 2, 0, 0))
		const tip = new THREE.CylinderGeometry(0.3, 0.3, 0.12, 3, 1)
		tip.rotateX(Math.PI / 2)
		tip.rotateZ(Math.PI / 2) // one corner points along +x
		a.add(at(mesh(tip, tipKey), len + 0.12, 0, 0))
		return a
	}
	g.add(at(arrow(0.55, 'gold', seed + 1), 0, 2.2, 0.06, 0, 0, Math.PI / 2)) // north: straight up the road
	g.add(at(arrow(0.8, 'ember', seed + 2), -0.05, 1.75, 0.06, 0, 0, Math.PI - 0.08)) // west: forge
	g.add(at(arrow(0.8, 'ward', seed + 3), 0.05, 1.35, 0.06, 0, 0, 0.06)) // east: stone and lectern
	g.userData.station = 'signpost'
	return g
}

// ---------------------------------------------------------------------------
// Small props (also used as card icons)
// ---------------------------------------------------------------------------

export function makeHammer({seed = 12, size = 1, head = 'iron'} = {}) {
	const g = new THREE.Group()
	g.name = 'ever:hammer'
	g.add(at(mesh(box(0.08, 0.75, 0.08, seed), 'wood'), 0, 0.375, 0))
	g.add(at(mesh(box(0.34, 0.16, 0.16, seed + 1, 0.06), head), 0, 0.78, 0))
	g.scale.setScalar(size)
	return g
}

export function makeSword({seed = 13, size = 1} = {}) {
	const g = new THREE.Group()
	g.name = 'ever:sword'
	g.add(at(mesh(box(0.12, 0.9, 0.04, seed, 0.05), 'stone'), 0, 0.75, 0))
	g.add(at(mesh(cone(0.085, 0.2, 4, seed + 1), 'stone'), 0, 1.3, 0, 0, Math.PI / 4, 0))
	g.add(at(mesh(box(0.42, 0.07, 0.1, seed + 2), 'iron'), 0, 0.3, 0))
	g.add(at(mesh(box(0.07, 0.28, 0.07, seed + 3), 'wood'), 0, 0.13, 0))
	g.add(at(mesh(ico(0.07, 0, seed + 4), 'gold'), 0, -0.03, 0))
	g.scale.setScalar(size)
	return g
}

export function makeShield({seed = 14, size = 1, colorKey = 'slate'} = {}) {
	const g = new THREE.Group()
	g.name = 'ever:shield'
	const geo = new THREE.CylinderGeometry(0.5, 0.5, 0.1, 6, 1)
	geo.rotateX(Math.PI / 2)
	jitter(geo, 0.03, seed, {keepBottom: false})
	g.add(at(mesh(geo, colorKey), 0, 0.5, 0))
	g.add(at(mesh(cyl(0.14, 0.14, 0.14, 6, seed + 1), 'gold'), 0, 0.5, 0.05, Math.PI / 2, 0, 0))
	g.scale.setScalar(size)
	return g
}

/**
 * Token pickups / HUD icons. kind: 'ember' (glowing orange octahedron),
 * 'ward' (pale blue disc), 'whetstone' (grey wedge with a white edge).
 * update(t) spins and hovers.
 */
export function makeToken(kind = 'ember', {seed = 15} = {}) {
	const g = new THREE.Group()
	g.name = 'ever:token:' + kind
	const inner = new THREE.Group()
	inner.position.y = 0.9
	if (kind === 'ember') {
		inner.add(mesh(jitter(new THREE.OctahedronGeometry(0.32, 0), 0.02, seed, {keepBottom: false}), makeMaterial('ember', {emissive: 1.0})))
		inner.add(mesh(jitter(new THREE.OctahedronGeometry(0.17, 0), 0.01, seed + 1, {keepBottom: false}), makeMaterial('gold', {emissive: 1.2}), {shadow: false}))
	} else if (kind === 'ward') {
		const d = new THREE.CylinderGeometry(0.36, 0.36, 0.1, 8, 1)
		d.rotateX(Math.PI / 2)
		inner.add(mesh(jitter(d, 0.02, seed, {keepBottom: false}), makeMaterial('ward', {emissive: 0.35})))
		inner.add(at(mesh(cyl(0.38, 0.38, 0.05, 8, seed + 1), 'gold'), 0, 0, -0.03, Math.PI / 2, 0, 0))
	} else if (kind === 'whetstone') {
		const w = new THREE.CylinderGeometry(0.34, 0.34, 0.6, 3, 1)
		w.rotateZ(Math.PI / 2)
		w.scale(1, 0.55, 1)
		inner.add(mesh(jitter(w, 0.02, seed, {keepBottom: false}), 'stoneDark'))
		inner.add(at(mesh(box(0.62, 0.04, 0.06, seed + 1), 'paper'), 0, 0.2, 0))
	} else throw new Error('style.js: unknown token ' + kind)
	g.add(inner)
	g.update = (t) => {
		if (REDUCED_MOTION) return
		inner.rotation.y = t * 1.2
		inner.position.y = 0.9 + Math.sin(t * 2) * 0.06
	}
	return g
}

/**
 * Card icon prop for a Slay the Web card name (MVP pool), built from the kit.
 * Unknown names fall back to a type-colored gem.
 */
export function makeCardIcon(name = 'Strike', type = 'attack') {
	const n = String(name).replace(/\+$/, '').trim().toLowerCase()
	const g = new THREE.Group()
	g.name = 'ever:icon:' + n
	const add = (o, x = 0, y = 0, z = 0, rz = 0) => { at(o, x, y, z, 0, 0, rz); g.add(o); return o }
	switch (n) {
		case 'strike': add(makeSword(), 0, -0.6, 0, -0.6); break
		case 'defend': add(makeShield(), 0, -0.5); break
		case 'bash': add(makeHammer({size: 1.3}), 0.1, -0.6, 0, 0.5); break
		case 'bludgeon': add(makeHammer({size: 1.7, head: 'stoneDark'}), 0.2, -0.75, 0, 0.6); break
		case 'pommel strike': {
			const s = add(makeSword(), 0, -0.5, 0, Math.PI - 0.6)
			s.position.y = 0.75
			break
		}
		case 'iron wave':
			add(makeShield({size: 0.8}), -0.25, -0.45)
			add(makeSword({size: 0.8}), 0.3, -0.5, 0.1, -0.5)
			break
		case 'sucker punch': {
			add(mesh(box(0.55, 0.45, 0.45, 21, 0.1), 'paper'), 0, 0, 0)
			add(mesh(box(0.2, 0.2, 0.3, 22), 'paper'), -0.32, -0.05, 0.05)
			add(mesh(box(0.6, 0.08, 0.47, 23), 'ember'), 0, -0.2, 0)
			break
		}
		case 'thunderclap': {
			const bolt = new THREE.Shape([
				new THREE.Vector2(0.1, 0.6), new THREE.Vector2(-0.25, 0.0), new THREE.Vector2(0.0, 0.0),
				new THREE.Vector2(-0.12, -0.6), new THREE.Vector2(0.28, 0.08), new THREE.Vector2(0.02, 0.08),
			])
			const geo = new THREE.ExtrudeGeometry(bolt, {depth: 0.12, bevelEnabled: false})
			add(mesh(geo, makeMaterial('gold', {emissive: 0.4})), 0, 0, -0.06)
			break
		}
		case 'body slam': {
			add(mesh(cyl(0.3, 0.45, 0.8, 6, 24), 'ember'), 0, -0.1)
			add(mesh(ico(0.22, 0, 25), 'paper'), 0, 0.45)
			add(mesh(box(1.1, 0.08, 0.5, 26), 'ink'), 0, -0.55)
			break
		}
		case 'intimidate': {
			add(mesh(ico(0.42, 0, 27), 'ink'), 0, 0)
			add(mesh(cone(0.1, 0.35, 4, 28), 'paper'), -0.28, 0.42, 0, 0.5)
			add(mesh(cone(0.1, 0.35, 4, 29), 'paper'), 0.28, 0.42, 0, -0.5)
			add(mesh(box(0.12, 0.06, 0.1, 30), makeMaterial('ember', {emissive: 0.8})), -0.14, 0.05, 0.38)
			add(mesh(box(0.12, 0.06, 0.1, 31), makeMaterial('ember', {emissive: 0.8})), 0.14, 0.05, 0.38)
			break
		}
		case 'doubt': {
			add(mesh(jitter(new THREE.OctahedronGeometry(0.5, 0), 0.08, 32, {keepBottom: false}), makeMaterial('doubt', {emissive: 0.25})))
			add(mesh(box(0.06, 0.8, 0.1, 33), 'ink'), 0.05, 0, 0.32, 0.4)
			add(mesh(box(0.06, 0.4, 0.1, 34), 'ink'), -0.12, -0.2, 0.3, -0.5)
			break
		}
		case 'ember': case 'ward': case 'whetstone': {
			const t = makeToken(n)
			t.children[0].position.y = 0
			add(t)
			break
		}
		default: {
			const key = {attack: 'ember', skill: 'slate', power: 'moss', curse: 'doubt'}[type] || 'gold'
			add(mesh(ico(0.45, 0, 35), key))
		}
	}
	return g
}

/**
 * Offscreen renderer for card/HUD icons. Uses the same palette + a fixed copy
 * of the light rig. render(object, size?) -> PNG data URL (transparent). Cache
 * the results; creating it costs one extra WebGL context (dispose() after).
 */
export function createIconRenderer({size = 160, pixelRatio = 2} = {}) {
	const renderer = new THREE.WebGLRenderer({antialias: true, alpha: true, preserveDrawingBuffer: true})
	renderer.outputColorSpace = THREE.SRGBColorSpace
	renderer.toneMapping = THREE.NoToneMapping
	renderer.setPixelRatio(pixelRatio) // render at 2x so the icon stays crisp in the card window
	renderer.setClearColor(0x000000, 0)
	const scene = new THREE.Scene()
	scene.add(new THREE.HemisphereLight(PALETTE.ward, WORLD.pineDark, 0.95))
	const key = new THREE.DirectionalLight(WORLD.keyLight, 1.2)
	key.position.set(-2, 3, 4)
	scene.add(key)
	const cam = new THREE.OrthographicCamera(-0.8, 0.8, 0.8, -0.8, 0.1, 40)
	cam.position.set(1.2, 1.0, 5)
	cam.lookAt(0, 0, 0)
	cam.updateMatrixWorld(true)
	const v = new THREE.Vector3()
	/** Fit the ortho frustum to the object's projected vertices (12% padding), square. */
	function fit(object) {
		object.updateMatrixWorld(true)
		let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
		object.traverse((o) => {
			const pos = o.isMesh && o.visible ? o.geometry?.attributes?.position : null
			if (!pos) return
			for (let i = 0; i < pos.count; i++) {
				v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).applyMatrix4(cam.matrixWorldInverse)
				if (v.x < x0) x0 = v.x
				if (v.x > x1) x1 = v.x
				if (v.y < y0) y0 = v.y
				if (v.y > y1) y1 = v.y
			}
		})
		if (!Number.isFinite(x0)) return void Object.assign(cam, {left: -0.8, right: 0.8, top: 0.8, bottom: -0.8})
		const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2
		const half = (Math.max(x1 - x0, y1 - y0) / 2) * 1.12 || 0.8
		cam.left = cx - half; cam.right = cx + half; cam.top = cy + half; cam.bottom = cy - half
	}
	return {
		render(object, px = size) {
			renderer.setSize(px, px, false)
			scene.add(object)
			fit(object)
			cam.updateProjectionMatrix()
			renderer.render(scene, cam)
			scene.remove(object)
			return renderer.domElement.toDataURL('image/png')
		},
		dispose() { renderer.dispose() },
	}
}

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------

/**
 * Low-poly figure (~1.8 u tall at scale 1). Faces and hands are paper.
 * @param {{body?: string, accent?: string, hat?: 'hood'|'cap'|'bald'|'none', scale?: number,
 *   beard?: boolean, apron?: string|null, holding?: 'hammer'|'lantern'|null, seed?: number, broad?: number}} o
 * Returns a Group with .parts {torso, head, armL, armR, hat, prop} and helpers:
 *   .setWalking(bool), .update(t, dt) (idle bob / walk), .faceTowards(x, z)
 */
export function makeCharacter({
	body = 'ember',
	accent = 'paper',
	hat = 'hood',
	scale = 1,
	beard = false,
	apron = null,
	holding = null,
	seed = 1,
	broad = 1,
} = {}) {
	const g = new THREE.Group()
	g.name = 'ever:character'
	const rig = new THREE.Group() // bobs and leans; g holds world position
	g.add(rig)
	// legs (two short ink blocks under the cloak)
	rig.add(at(mesh(box(0.16, 0.4, 0.18, seed), 'ink'), -0.13 * broad, 0.2, 0))
	rig.add(at(mesh(box(0.16, 0.4, 0.18, seed + 1), 'ink'), 0.13 * broad, 0.2, 0))
	// cloak / torso: hexagonal tapered cylinder
	const torso = mesh(cyl(0.27 * broad, 0.44 * broad, 0.95, 6, seed + 2, 0.06), body)
	torso.position.y = 0.36 + 0.475
	rig.add(torso)
	// collar / scarf band in the accent color
	rig.add(at(mesh(cyl(0.3 * broad, 0.31 * broad, 0.1, 6, seed + 3), accent), 0, 1.28, 0))
	if (apron) rig.add(at(mesh(box(0.5 * broad, 0.75, 0.06, seed + 4, 0.03), apron), 0, 0.82, 0.33 * broad, -0.17, 0, 0))
	// head
	const head = mesh(ico(0.25, 1, seed + 5, 0.06), 'paper')
	head.position.y = 1.55
	rig.add(head)
	// eyes: two tiny ink chips facing +z
	head.add(at(mesh(box(0.05, 0.07, 0.03, seed + 6, 0), 'ink', {shadow: false}), -0.08, 0.02, 0.23))
	head.add(at(mesh(box(0.05, 0.07, 0.03, seed + 7, 0), 'ink', {shadow: false}), 0.08, 0.02, 0.23))
	let hatMesh = null
	if (hat === 'hood') {
		hatMesh = mesh(cone(0.3, 0.62, 6, seed + 8, 0.06), body)
		hatMesh.position.set(0, 0.25, -0.1)
		hatMesh.rotation.x = -0.18
		head.add(hatMesh)
	} else if (hat === 'cap') {
		hatMesh = mesh(cyl(0.22, 0.27, 0.16, 6, seed + 8), accent)
		hatMesh.position.y = 0.2
		head.add(hatMesh)
	} else if (hat === 'bald') {
		// bare dome: a darker fringe ring sells "bald crown"
		hatMesh = mesh(cyl(0.255, 0.255, 0.1, 7, seed + 8), 'beard')
		hatMesh.position.y = -0.02
		hatMesh.scale.z = 0.9
		head.add(hatMesh)
	}
	if (beard) {
		const b = mesh(cone(0.2, 0.42, 4, seed + 9, 0.08), 'beard')
		b.rotation.x = Math.PI
		b.rotation.y = Math.PI / 4
		b.position.set(0, -0.2, 0.12)
		head.add(b)
	}
	// arms on shoulder pivots; hands are paper
	const mkArm = (side) => {
		const pivot = new THREE.Group()
		pivot.position.set(side * 0.36 * broad, 1.22, 0)
		pivot.add(at(mesh(box(0.15, 0.58, 0.16, seed + 10 + side, 0.05), accent === 'paper' ? body : accent), 0, -0.27, 0))
		pivot.add(at(mesh(box(0.13, 0.13, 0.13, seed + 12 + side), 'paper'), 0, -0.6, 0))
		pivot.rotation.z = side * 0.12
		rig.add(pivot)
		return pivot
	}
	const armL = mkArm(-1)
	const armR = mkArm(1)
	let prop = null
	if (holding === 'hammer') {
		prop = makeHammer({seed: seed + 20})
		at(prop, 0, -0.62, 0.05, Math.PI / 2, 0, 0)
		armR.add(prop)
	} else if (holding === 'lantern') {
		prop = makeLantern({post: false, lit: true, seed: seed + 20})
		at(prop, 0, -0.95, 0)
		armR.add(prop)
	}
	g.scale.setScalar(scale)
	g.parts = {rig, torso, head, armL, armR, hat: hatMesh, prop}
	const phase = rng(seed)() * Math.PI * 2
	let walking = false
	let walkT = 0
	g.setWalking = (w) => { walking = !!w }
	g.update = (t, dt = 1 / 60) => {
		if (REDUCED_MOTION) { rig.position.y = 0; rig.rotation.x = 0; return }
		walkT = THREE.MathUtils.damp(walkT, walking ? 1 : 0, 10, dt)
		const bob = Math.sin(t * MOTION.bobSpeed + phase) * MOTION.bobAmp
		const step = Math.abs(Math.sin(t * 9 + phase)) * 0.06
		rig.position.y = THREE.MathUtils.lerp(bob, step, walkT)
		rig.rotation.x = MOTION.walkLeanRad * walkT
		const swing = Math.sin(t * 9 + phase) * 0.5 * walkT
		armL.rotation.x = swing
		if (!g.userData.posing) armR.rotation.x = -swing
	}
	g.faceTowards = (x, z) => {
		g.rotation.y = Math.atan2(x - g.position.x, z - g.position.z)
	}
	return g
}

/**
 * Tiny standalone bob helper for any object: returns update(t).
 * (Characters already have .update; use this for props, tokens, the book.)
 */
export function makeIdleBob(obj, {amp = MOTION.bobAmp, speed = MOTION.bobSpeed, phase = 0} = {}) {
	const base = obj.position.y
	return (t) => {
		if (REDUCED_MOTION) return
		obj.position.y = base + Math.sin(t * speed + phase) * amp
	}
}

/** Presets so every department builds the same people. */
export const CHARACTERS = Object.freeze({
	/** seat 1..4 */
	player: (seat = 1) =>
		makeCharacter({body: SEAT_KEYS[(seat - 1) % 4], accent: 'paper', hat: 'hood', seed: 100 + seat}),
	/** Marcus Hale: 1.2x, broad, bald, beard wedge, charcoal apron, rust sleeves, hammer. */
	marcus: () => {
		const m = makeCharacter({body: 'stoneDark', accent: 'rust', hat: 'bald', beard: true, apron: 'apron', holding: 'hammer', scale: 1.2, broad: 1.25, seed: 77})
		m.name = 'ever:marcus'
		// idle loop (GDD): lifts hammer, does not strike, lowers it. ~4 s cycle.
		const baseUpdate = m.update
		m.userData.posing = true
		m.update = (t, dt) => {
			baseUpdate(t, dt)
			if (REDUCED_MOTION) return
			const c = (t % 4) / 4
			const lift = c < 0.35 ? easeInOut(c / 0.35) : c < 0.6 ? 1 : 1 - easeInOut((c - 0.6) / 0.3)
			m.parts.armR.rotation.x = -lift * 1.9
		}
		return m
	},
})

// ---------------------------------------------------------------------------
// Enemy: the Ash Warden
// ---------------------------------------------------------------------------

const WARDEN_POSES = {
	// [armL.x, armL.z, armR.x, armR.z, torso.x (lean), head.x, coal glow]
	dormant: [0.1, 0.05, 0.1, -0.05, 0.35, 0.4, 0.25],
	idle: [0, 0.15, 0, -0.15, 0.05, 0, 0.9],
	cleave: [0.2, 0.2, -2.2, -0.5, -0.12, -0.1, 1.0], // arm swings back
	brace: [-1.2, -0.9, -1.2, 0.9, 0.25, 0.25, 1.1], // shoulders hunch, arms crossed
	smother: [-0.6, 0.3, -0.6, -0.3, 0.3, 0.45, 0.8], // leans in, ash at the mouth
	slam: [-2.9, 0.25, -2.9, -0.25, -0.18, -0.25, 1.3], // both arms raised
	hit: [0.3, 0.35, 0.3, -0.35, -0.2, -0.2, 1.4],
	dead: [0.6, 0.5, 0.6, -0.5, 0.9, 0.8, 0.0],
}

/**
 * The Ash Warden (~3 u tall): faceted charcoal blocks, emissive ember cracks,
 * a glowing chest coal, Tobin's small hammer stuck in the left shoulder.
 * API: setPose(name) where name is one of Object.keys(WARDEN_POSES),
 *      setIntentPose(step 1..4) maps the GDD cycle to the tell pose,
 *      flash() for a hit, update(t, dt) every frame.
 */
export function makeEnemy(kind = 'ashWarden', {seed = 66} = {}) {
	if (kind !== 'ashWarden') throw new Error('style.js: unknown enemy ' + kind)
	const g = new THREE.Group()
	g.name = 'ever:ashWarden'
	const rig = new THREE.Group()
	g.add(rig)
	const crack = makeMaterial('ember', {emissive: 1.0})
	// charcoal body with a faint ash glow, so the faces read against the dark gate (QA)
	const wardenBody = new THREE.MeshLambertMaterial({color: PALETTE.ink, emissive: WORLD.ash, emissiveIntensity: 0.3, flatShading: true})
	wardenBody.name = 'ever:wardenBody'
	// legs
	for (const s of [-1, 1]) {
		rig.add(at(mesh(box(0.5, 0.9, 0.55, seed + s, 0.1), wardenBody), s * 0.38, 0.45, 0))
		rig.add(at(mesh(box(0.62, 0.22, 0.75, seed + 3 + s, 0.1), 'iron'), s * 0.38, 0.11, 0.08))
	}
	// torso pivot at the hips
	const torso = new THREE.Group()
	torso.position.y = 0.9
	rig.add(torso)
	torso.add(at(mesh(box(1.0, 0.6, 0.7, seed + 6, 0.08), wardenBody), 0, 0.3, 0)) // belly
	const chest = mesh(jitter(new THREE.DodecahedronGeometry(0.95, 0), 0.08, seed + 7, {keepBottom: false}), wardenBody)
	chest.scale.set(1.25, 0.9, 0.8)
	chest.position.y = 1.2
	torso.add(chest)
	// cracks: thin emissive slivers on the chest
	const cracks = [
		[0.35, 1.45, 0.62, 0.5, 0.05, 0.4],
		[-0.4, 1.1, 0.64, 0.4, 0.05, -0.7],
		[0.15, 0.85, 0.7, 0.3, 0.05, 1.1],
		[-0.2, 1.7, 0.5, 0.35, 0.05, 0.2],
	]
	for (const [x, y, z, w, h, rz] of cracks) torso.add(at(mesh(box(w, h, 0.06, seed + x * 10, 0), crack, {shadow: false}), x, y, z, 0, 0, rz))
	const coalMat = makeMaterial('ember', {emissive: 1.2}).clone()
	const coal = mesh(jitter(new THREE.OctahedronGeometry(0.22, 0), 0.03, seed + 8, {keepBottom: false}), coalMat, {shadow: false})
	coal.position.set(0, 1.25, 0.72)
	torso.add(coal)
	const coalCore = mesh(new THREE.OctahedronGeometry(0.1, 0), makeMaterial('gold', {emissive: 1.4}), {shadow: false})
	coalCore.position.set(0, 1.25, 0.78)
	torso.add(coalCore)
	// shoulders
	for (const s of [-1, 1]) torso.add(at(mesh(box(0.7, 0.55, 0.75, seed + 9 + s, 0.12), 'iron'), s * 1.05, 1.75, 0, 0, 0, s * -0.15))
	// head sunk between shoulders
	const head = new THREE.Group()
	head.position.y = 2.0
	torso.add(head)
	head.add(at(mesh(box(0.5, 0.42, 0.5, seed + 12, 0.1), wardenBody), 0, 0.15, 0.1))
	head.add(at(mesh(box(0.34, 0.06, 0.06, seed + 13, 0), crack, {shadow: false}), 0, 0.18, 0.37))
	// ash cloud at the mouth (smother tell)
	const ash = new THREE.Group()
	for (let i = 0; i < 6; i++) {
		const r = rng(seed + 40 + i)
		ash.add(at(mesh(ico(0.12 + r() * 0.1, 0, seed + 40 + i), makeMaterial('ash', {opacity: 0.85}), {shadow: false}), (r() - 0.5) * 0.6, (r() - 0.5) * 0.3, 0.45 + r() * 0.4))
	}
	ash.visible = false
	head.add(ash)
	// arms on shoulder pivots: long, fists reach the knees
	const mkArm = (s) => {
		const p = new THREE.Group()
		p.position.set(s * 1.2, 1.75, 0)
		p.add(at(mesh(box(0.42, 0.9, 0.42, seed + 20 + s, 0.1), wardenBody), 0, -0.45, 0))
		p.add(at(mesh(box(0.06, 0.5, 0.05, seed + 22 + s, 0), crack, {shadow: false}), s * 0.05, -0.5, 0.22))
		p.add(at(mesh(box(0.38, 0.8, 0.38, seed + 24 + s, 0.1), wardenBody), 0, -1.25, 0.02))
		p.add(at(mesh(jitter(new THREE.DodecahedronGeometry(0.34, 0), 0.04, seed + 26 + s, {keepBottom: false}), 'iron'), 0, -1.75, 0.04))
		torso.add(p)
		return p
	}
	const armL = mkArm(-1)
	const armR = mkArm(1)
	// Tobin's hammer, stuck in the left shoulder
	const tob = makeHammer({seed: seed + 30, size: 0.7})
	at(tob, -1.05, 2.0, 0.1, 0.4, 0, 0.9)
	torso.add(tob)

	const cur = [...WARDEN_POSES.dormant]
	let target = WARDEN_POSES.dormant
	let poseName = 'dormant'
	let flashT = 0
	let lungeT = 0
	g.parts = {rig, torso, head, armL, armR, coal, ash, hammer: tob}
	g.setPose = (name) => {
		if (!WARDEN_POSES[name]) throw new Error('style.js: unknown Warden pose ' + name)
		poseName = name
		target = WARDEN_POSES[name]
		ash.visible = name === 'smother'
		if (REDUCED_MOTION) cur.splice(0, cur.length, ...target)
	}
	/** step 1..4 of the GDD cycle: Cleave, Brace, Smother, Ember Slam */
	g.setIntentPose = (step) => g.setPose(['cleave', 'brace', 'smother', 'slam'][((step - 1) % 4 + 4) % 4])
	g.flash = () => { flashT = MOTION.hitFlash }
	/** forward lunge when the attack lands (call when the intent resolves) */
	g.lunge = () => { lungeT = MOTION.lunge * 2 }
	g.getPose = () => poseName
	g.update = (t, dt = 1 / 60) => {
		const k = 1 - Math.exp(-dt / (MOTION.tellPose / 4))
		for (let i = 0; i < cur.length; i++) cur[i] += (target[i] - cur[i]) * k
		armL.rotation.x = cur[0]; armL.rotation.z = cur[1]
		armR.rotation.x = cur[2]; armR.rotation.z = cur[3]
		torso.rotation.x = cur[4]
		head.rotation.x = cur[5]
		const breathe = REDUCED_MOTION ? 0 : Math.sin(t * 0.8) * 0.04
		coal.scale.setScalar(1 + breathe)
		flashT = Math.max(0, flashT - dt)
		coalMat.emissiveIntensity = Math.max(0.05, cur[6] + breathe * 3 + (flashT > 0 ? 1.2 : 0))
		lungeT = Math.max(0, lungeT - dt)
		const l = lungeT > 0 ? Math.sin((1 - lungeT / (MOTION.lunge * 2)) * Math.PI) * 0.5 : 0
		rig.position.z = l
		if (poseName === 'smother' && !REDUCED_MOTION) ash.rotation.z = t * 0.6
	}
	g.update(0, 1)
	return g
}

// ---------------------------------------------------------------------------
// Stations (GDD 3.5 / 5)
// ---------------------------------------------------------------------------

/** Aliases so generic names from briefs map to the GDD stations. */
export const STATION_ALIASES = Object.freeze({
	upgrade: 'forge', smithy: 'forge', remove: 'well', spring: 'well', 'token-spring': 'well',
	curse: 'shrine', altar: 'shrine', 'cursed-altar': 'shrine', gain: 'lectern', chest: 'lectern',
	merchant: 'lectern', 'margin-stone': 'lectern', token: 'grindstone', whetstone: 'grindstone',
	combat: 'gate', 'ash-gate': 'gate', spawn: 'signpost',
})

/** GDD interact radii. */
export const STATION_RADIUS = Object.freeze({well: 2.5, forge: 3.0, anvil: 3.0, grindstone: 2.0, lectern: 2.5, shrine: 2.5, gate: 3.0, signpost: 0})

/**
 * Build a station. type: 'well' | 'lectern' | 'grindstone' | 'forge' | 'anvil' |
 * 'shrine' | 'gate' | 'signpost' (or an alias from STATION_ALIASES).
 * Every station: userData.station, userData.radius, setUsed(bool), update(t, dt).
 * Extras: forge.setLanternLit(bool), forge.anvilPos (local), gate.setOpen(0..1),
 * gate.arena (the r=3 circle group, local origin = circle center offset).
 */
export function makeStation(type, {seed = 50} = {}) {
	type = STATION_ALIASES[type] || type
	const builders = {well: buildWell, lectern: buildLectern, grindstone: buildGrindstone, forge: buildForge, anvil: buildAnvil, shrine: buildShrine, gate: buildGate, signpost: () => makeSignpost({seed})}
	const b = builders[type]
	if (!b) throw new Error('style.js: unknown station ' + type)
	const g = b(seed)
	g.name = 'ever:station:' + type
	g.userData.station = type
	g.userData.radius = STATION_RADIUS[type]
	g.userData.used = false
	if (!g.setUsed) g.setUsed = (u) => { g.userData.used = !!u }
	if (!g.update) g.update = () => {}
	return g
}

function glowSwap(meshes, onKey, onIntensity, offKey) {
	return (used) => {
		for (const m of meshes) m.material = used ? makeMaterial(offKey) : makeMaterial(onKey, {emissive: onIntensity})
	}
}

function buildWell(seed) {
	const g = new THREE.Group()
	const ringN = 9
	for (let i = 0; i < ringN; i++) {
		const a = (i / ringN) * Math.PI * 2
		const b = mesh(box(0.95, 0.85, 0.42, seed + i, 0.08), i % 3 ? 'stone' : 'stoneDark')
		at(b, Math.cos(a) * 1.15, 0.42, Math.sin(a) * 1.15, 0, -a + Math.PI / 2, 0)
		g.add(b)
	}
	const water = mesh(cyl(1.0, 1.0, 0.05, 9, seed + 20, 0), makeMaterial('ward', {emissive: 0.6}), {shadow: false})
	water.position.y = 0.6
	g.add(water)
	for (const s of [-1, 1]) g.add(at(mesh(box(0.16, 2.2, 0.16, seed + 30 + s), 'wood'), s * 1.25, 1.1, 0))
	g.add(at(mesh(box(2.7, 0.12, 0.12, seed + 33), 'wood'), 0, 2.05, 0))
	const roof = new THREE.CylinderGeometry(1.0, 1.0, 3.0, 3, 1)
	roof.rotateZ(Math.PI / 2)
	roof.rotateX(-Math.PI / 2)
	roof.scale(1, 0.6, 1)
	jitter(roof, 0.05, seed + 34, {keepBottom: false})
	g.add(at(mesh(roof, 'roof'), 0, 2.45, 0))
	const bucket = mesh(cyl(0.2, 0.16, 0.28, 6, seed + 35), 'wood')
	bucket.position.set(0.4, 1.4, 0)
	g.add(bucket)
	g.add(at(mesh(box(0.02, 0.6, 0.02, seed + 36, 0), 'ink', {shadow: false}), 0.4, 1.75, 0))
	g.setUsed = (u) => {
		g.userData.used = !!u
		glowSwap([water], 'ward', 0.6, 'slate')(u)
	}
	return g
}

function buildLectern(seed) {
	const g = new THREE.Group()
	g.add(at(mesh(box(1.3, 0.25, 1.0, seed, 0.1), 'stoneDark'), 0, 0.125, 0))
	g.add(at(mesh(cyl(0.3, 0.42, 1.0, 6, seed + 1), 'stone'), 0, 0.75, 0))
	g.add(at(mesh(box(1.2, 0.18, 0.85, seed + 2, 0.06), 'stone'), 0, 1.32, 0, 0.35, 0, 0))
	const pages = []
	for (const s of [-1, 1]) {
		const p = mesh(box(0.5, 0.06, 0.66, seed + 3 + s, 0.04), makeMaterial('paper', {emissive: 0.35}))
		at(p, s * 0.27, 1.44, 0.02, 0.35, 0, s * -0.12)
		g.add(p)
		pages.push(p)
	}
	// three lines of "margin text" in ink on the right page
	const lines = new THREE.Group()
	for (let i = 0; i < 3; i++) lines.add(at(mesh(box(0.34, 0.01, 0.05, seed + 10 + i, 0), 'ink', {shadow: false}), 0.27, 1.48 - i * 0.07, -0.15 + i * 0.17, 0.35, 0, -0.12))
	g.add(lines)
	g.setUsed = (u) => {
		g.userData.used = !!u
		glowSwap(pages, 'paper', 0.35, 'paper')(u)
		lines.visible = !u // "The margin is blank now."
	}
	return g
}

function buildGrindstone(seed) {
	const g = new THREE.Group()
	for (const s of [-1, 1]) {
		g.add(at(mesh(box(0.14, 1.1, 0.14, seed + s), 'wood'), s * 0.32, 0.55, -0.35))
		g.add(at(mesh(box(0.14, 1.1, 0.14, seed + 2 + s), 'wood'), s * 0.32, 0.55, 0.35))
		g.add(at(mesh(box(0.14, 0.12, 0.9, seed + 4 + s), 'wood'), s * 0.32, 1.05, 0))
	}
	const wheel = new THREE.Group()
	wheel.position.y = 1.15
	const wg = new THREE.CylinderGeometry(0.62, 0.62, 0.22, 10, 1)
	wg.rotateZ(Math.PI / 2)
	jitter(wg, 0.02, seed + 6, {keepBottom: false})
	wheel.add(mesh(wg, 'stoneDark'))
	wheel.add(at(mesh(box(0.06, 0.2, 0.06, seed + 7, 0), 'paper', {shadow: false}), 0.12, 0.55, 0))
	wheel.add(at(mesh(cyl(0.05, 0.05, 0.9, 5, seed + 8), 'iron'), 0, 0, 0, 0, 0, Math.PI / 2))
	g.add(wheel)
	g.add(at(mesh(box(0.08, 0.5, 0.08, seed + 9), 'wood'), 0.55, 1.15, 0.0, 0, 0, 0.3))
	const token = makeToken('whetstone')
	token.scale.setScalar(0.6)
	token.position.set(0, 0.7, 0.9)
	g.add(token)
	let spin = 0
	g.setUsed = (u) => {
		if (u && !g.userData.used) spin = 5
		g.userData.used = !!u
		token.visible = !u
	}
	g.update = (t, dt = 1 / 60) => {
		spin = Math.max(0, spin - dt * (5 / 1.5)) // spins down over 1.5 s
		wheel.rotation.x += spin * dt
		if (token.visible) token.update(t)
	}
	return g
}

function buildAnvil(seed) {
	const g = new THREE.Group()
	g.add(at(mesh(cyl(0.3, 0.38, 0.55, 6, seed), 'wood'), 0, 0.275, 0))
	g.add(at(mesh(box(0.38, 0.3, 0.3, seed + 1, 0.06), 'iron'), 0, 0.7, 0))
	g.add(at(mesh(box(0.85, 0.2, 0.36, seed + 2, 0.06), 'iron'), 0.05, 0.94, 0))
	g.add(at(mesh(cone(0.16, 0.42, 4, seed + 3), 'iron'), 0.66, 0.94, 0, 0, Math.PI / 4, -Math.PI / 2))
	return g
}

/**
 * Marcus's open-sided forge, built around local origin = forge building center
 * (GDD (-15,-1)); the anvil sits at local (+1.6, 0, +0.6) so Marcus at (-13,0)
 * stands beside it. Cold hearth, chimney, lantern on the front-right post.
 */
function buildForge(seed) {
	const g = new THREE.Group()
	const W = 5.2, D = 4.4, H = 2.8
	g.add(at(mesh(box(W + 0.4, 0.2, D + 0.4, seed, 0.1), 'stoneDark'), 0, 0.1, 0))
	for (const [x, z] of [[-W / 2, -D / 2], [W / 2, -D / 2], [-W / 2, D / 2], [W / 2, D / 2]]) {
		g.add(at(mesh(box(0.24, H, 0.24, seedFromPos(x, z, seed)), 'wood'), x, H / 2 + 0.2, z))
	}
	g.add(at(mesh(box(W + 0.3, 0.2, 0.2, seed + 5), 'wood'), 0, H + 0.2, D / 2))
	g.add(at(mesh(box(W + 0.3, 0.2, 0.2, seed + 6), 'wood'), 0, H + 0.2, -D / 2))
	// roof: mono-pitch slab, lower to the back
	g.add(at(mesh(box(W + 1.0, 0.18, D + 1.0, seed + 7, 0.05), 'roof'), 0, H + 0.62, 0, -0.16, 0, 0))
	// back wall, half height
	g.add(at(mesh(box(W, 1.3, 0.2, seed + 8, 0.03), 'stone'), 0, 0.85, -D / 2))
	// hearth (cold): stone block with ash bed, and chimney through the roof
	g.add(at(mesh(box(1.6, 1.0, 1.2, seed + 9, 0.06), 'stone'), -1.4, 0.7, -1.4))
	const ashBed = mesh(box(1.1, 0.1, 0.8, seed + 10, 0.05), 'ash')
	ashBed.position.set(-1.4, 1.24, -1.4)
	g.add(ashBed)
	g.add(at(mesh(box(0.8, 3.4, 0.8, seed + 11, 0.05), 'stoneDark'), -1.4, 2.9, -1.7))
	const anvil = buildAnvil(seed + 20)
	anvil.position.set(1.6, 0.2, 0.6)
	anvil.rotation.y = -0.3
	g.add(anvil)
	const lantern = makeLantern({lit: false, seed: seed + 30})
	lantern.position.set(W / 2, 0.2, D / 2)
	g.add(lantern)
	g.anvilPos = new THREE.Vector3(1.6, 0, 0.6)
	g.setLanternLit = (on) => lantern.setLit(on)
	/** relight the hearth (epilogue) */
	g.setHearthLit = (on) => { ashBed.material = on ? makeMaterial('ember', {emissive: 0.9}) : makeMaterial('ash') }
	g.parts = {anvil, lantern, ashBed}
	return g
}

function buildShrine(seed) {
	const g = new THREE.Group()
	g.add(at(mesh(box(1.4, 0.3, 1.4, seed, 0.12), 'stoneDark'), 0, 0.15, 0, 0, 0.3, 0.05))
	const ob = new THREE.Group()
	ob.position.y = 0.3
	ob.rotation.set(0.12, 0.2, -0.22) // crooked
	ob.add(at(mesh(cyl(0.28, 0.45, 2.2, 4, seed + 1, 0.08), 'stoneDark'), 0, 1.1, 0, 0, Math.PI / 4, 0))
	ob.add(at(mesh(cone(0.3, 0.5, 4, seed + 2), 'stoneDark'), 0, 2.45, 0, 0, Math.PI / 4, 0))
	const gem = mesh(jitter(new THREE.OctahedronGeometry(0.26, 0), 0.04, seed + 3, {keepBottom: false}), makeMaterial('doubt', {emissive: 1.0}), {shadow: false})
	gem.position.set(0, 1.5, 0.34)
	gem.scale.set(0.8, 1.3, 0.6)
	ob.add(gem)
	g.add(ob)
	// offering stone with a little Bludgeon-shaped hammer on it
	g.add(at(mesh(box(0.6, 0.3, 0.4, seed + 4, 0.1), 'stone'), 0.2, 0.45, 0.75))
	const offer = makeHammer({size: 0.6, head: 'stoneDark'})
	at(offer, 0.1, 0.62, 0.75, 0, 0, Math.PI / 2)
	g.add(offer)
	g.setUsed = (u) => {
		g.userData.used = !!u
		glowSwap([gem], 'doubt', 1.0, 'ink')(u) // "The shrine is dark."
		offer.visible = !u
	}
	g.update = (t) => {
		if (!g.userData.used && !REDUCED_MOTION) gem.scale.y = 1.3 + Math.sin(t * 1.7) * 0.08
	}
	return g
}

/**
 * Ash Gate. Local origin = combat circle center (GDD (0,-22)); the gate itself
 * stands at local z = -3 (GDD (0,-25)). setOpen(0..1) raises the bars.
 */
function buildGate(seed) {
	const g = new THREE.Group()
	const arena = new THREE.Group()
	arena.add(makeGroundTile({radius: 3.1, sides: 10, colorKey: 'ash', seed, height: 0.05}))
	for (let i = 0; i < 14; i++) {
		const a = (i / 14) * Math.PI * 2
		const r = makeRock({seed: seed + i, size: 0.2, colorKey: i % 2 ? 'stone' : 'stoneDark'})
		r.position.set(Math.cos(a) * 3.15, 0.02, Math.sin(a) * 3.15)
		arena.add(r)
	}
	g.add(arena)
	const gate = new THREE.Group()
	gate.position.z = -3
	for (const s of [-1, 1]) {
		gate.add(at(mesh(box(1.0, 4.2, 1.0, seed + 20 + s, 0.06), 'stone'), s * 2.3, 2.1, 0))
		gate.add(at(mesh(box(1.3, 0.4, 1.3, seed + 22 + s, 0.06), 'stoneDark'), s * 2.3, 4.35, 0))
	}
	gate.add(at(mesh(box(5.8, 0.55, 0.9, seed + 25, 0.05), 'stoneDark'), 0, 4.0, 0))
	const bars = new THREE.Group()
	for (let i = 0; i < 6; i++) bars.add(at(mesh(box(0.12, 3.6, 0.12, seed + 30 + i, 0.05), 'iron'), -1.5 + i * 0.6, 1.8, 0))
	bars.add(at(mesh(box(3.6, 0.12, 0.12, seed + 40, 0.03), 'iron'), 0, 1.2, 0))
	bars.add(at(mesh(box(3.6, 0.12, 0.12, seed + 41, 0.03), 'iron'), 0, 2.6, 0))
	gate.add(bars)
	g.add(gate)
	const sparks = makeEmberSparks({count: 26, radius: 3, height: 3, seed: seed + 50})
	g.add(sparks)
	g.setOpen = (k) => { bars.position.y = THREE.MathUtils.clamp(k, 0, 1) * 3.4 }
	g.update = (t) => sparks.update(t)
	g.arena = arena
	g.parts = {bars, gate, sparks}
	return g
}

/** Rising ember sparks (one Points draw call). update(t). */
export function makeEmberSparks({count = 30, radius = 3, height = 3, seed = 3} = {}) {
	const r = rng(seed)
	const base = new Float32Array(count * 4)
	const pos = new Float32Array(count * 3)
	for (let i = 0; i < count; i++) {
		const a = r() * Math.PI * 2, d = Math.sqrt(r()) * radius
		base.set([Math.cos(a) * d, Math.sin(a) * d, r() * height, 0.25 + r() * 0.5], i * 4)
	}
	const geo = new THREE.BufferGeometry()
	geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
	const mat = new THREE.PointsMaterial({color: PALETTE.ember, size: 0.12, sizeAttenuation: true, transparent: true, opacity: 0.9})
	const pts = new THREE.Points(geo, mat)
	pts.name = 'ever:sparks'
	pts.frustumCulled = false
	pts.update = (t) => {
		for (let i = 0; i < count; i++) {
			const [x, z, y0, sp] = [base[i * 4], base[i * 4 + 1], base[i * 4 + 2], base[i * 4 + 3]]
			const y = REDUCED_MOTION ? y0 : (y0 + t * sp) % height
			pos[i * 3] = x + (REDUCED_MOTION ? 0 : Math.sin(t + i) * 0.1)
			pos[i * 3 + 1] = y
			pos[i * 3 + 2] = z
		}
		geo.attributes.position.needsUpdate = true
	}
	pts.update(0)
	return pts
}

// ---------------------------------------------------------------------------
// Book cover screen
// ---------------------------------------------------------------------------

/** Closed book (slate boards, paper block, gold spine bands). setOpen(0..1) hinges the cover. */
export function makeBook({seed = 90, coverKey = 'slate'} = {}) {
	const g = new THREE.Group()
	g.name = 'ever:book'
	const W = 1.6, D = 2.2, T = 0.34
	g.add(at(mesh(box(W, 0.06, D, seed, 0.01), coverKey), 0, 0.03, 0))
	g.add(at(mesh(box(W - 0.08, T - 0.1, D - 0.1, seed + 1, 0.01), 'paper'), 0.02, T / 2, 0))
	g.add(at(mesh(box(0.1, T, D, seed + 2, 0.02), coverKey), -W / 2, T / 2, 0))
	for (const z of [-0.7, 0.7]) g.add(at(mesh(box(0.12, T + 0.02, 0.08, seed + 3, 0), 'gold'), -W / 2, T / 2, z))
	const hinge = new THREE.Group()
	hinge.position.set(-W / 2, T, 0)
	const cover = mesh(box(W, 0.06, D, seed + 4, 0.01), coverKey)
	cover.position.x = W / 2
	hinge.add(cover)
	// title plate + ember spine line on the cover
	hinge.add(at(mesh(box(0.9, 0.02, 0.5, seed + 5, 0), 'paper'), W / 2, 0.04, -0.35))
	hinge.add(at(mesh(box(0.06, 0.02, D - 0.2, seed + 6, 0), 'ember'), 0.18, 0.04, 0))
	g.add(hinge)
	g.setOpen = (k) => { hinge.rotation.z = THREE.MathUtils.clamp(k, 0, 1) * Math.PI * 0.97 }
	return g
}

export function makeTable({seed = 91} = {}) {
	const g = new THREE.Group()
	g.name = 'ever:table'
	g.add(at(mesh(box(4.4, 0.24, 3.2, seed, 0.04), 'wood'), 0, -0.12, 0))
	for (const [x, z] of [[-1.9, -1.3], [1.9, -1.3], [-1.9, 1.3], [1.9, 1.3]]) g.add(at(mesh(box(0.22, 2.4, 0.22, seedFromPos(x, z, seed)), 'wood'), x, -1.44, z))
	return g
}

// ---------------------------------------------------------------------------
// Convenience: the whole Ashbrook layout (GDD section 5)
// ---------------------------------------------------------------------------

/** GDD 5 positions [x, z] (origin at the well). */
export const ASHBROOK = Object.freeze({
	spawn: [0, 22],
	well: [0, 0],
	forge: [-15, -1],
	marcus: [-13, 0],
	grindstone: [-10, 5],
	lectern: [13, 3],
	// QA: trees and houses stay north of (behind) or beside the stations, never between
	// the south-facing camera and a station; no house stands in the combat shot.
	bigTree: [17.4, -0.6],
	shrine: [16, -14],
	shrinePines: [[13.4, -15.4], [18.7, -14.8], [16.6, -17.2]],
	gateCircle: [0, -22],
	wardenDormant: [0, -27],
	houses: [[-8, 14], [9, 13], [10, -6], [-10.5, -11]],
})

/**
 * Build the static Ashbrook scenery + stations with the GDD layout. Returns
 * {root, stations: {well, forge, grindstone, lectern, shrine, gate, signpost}, houses}.
 * Characters (players, Marcus, Warden) are added by the caller.
 */
export function buildAshbrook({quality = pickQuality()} = {}) {
	const root = new THREE.Group()
	root.name = 'ever:ashbrook'
	root.add(makeTerrain())
	root.add(makePineRing({count: quality === 'low' ? 50 : 76, gaps: [[0, 30, 3]]}))
	root.add(makeStoneWall({gaps: [[0, 31.2, 2.5]]}))
	root.add(makeRockScatter({count: 18, area: 50}))
	const S = ASHBROOK
	const place = (o, [x, z], ry = 0) => { o.position.set(x, 0, z); o.rotation.y = ry; root.add(o); return o }
	const stations = {
		well: place(makeStation('well'), S.well, 0.2),
		forge: place(makeStation('forge'), S.forge, Math.PI / 2 - 0.25),
		grindstone: place(makeStation('grindstone'), S.grindstone, 0.4),
		lectern: place(makeStation('lectern'), S.lectern, -Math.PI / 2 + 0.3),
		shrine: place(makeStation('shrine'), S.shrine, -0.6),
		gate: place(makeStation('gate'), S.gateCircle),
		signpost: place(makeStation('signpost'), S.spawn, 0),
	}
	place(makeTree({kind: 'round', seed: 31, scale: 1.1}), S.bigTree)
	S.shrinePines.forEach((p, i) => place(makeTree({seed: 200 + i, scale: 1.1}), p))
	const houses = S.houses.map((p, i) => place(makeHouse({seed: 300 + i}), p, Math.atan2(-p[0], -p[1])))
	return {root, stations, houses}
}
