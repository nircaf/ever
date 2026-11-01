// EVER v2 world: the named sites a seeded path walks through (GDD_V2 6.3), built from the
// art kit: the Wayfarer and their cart, the Keeper on a stool by a lit lantern post, the
// Road Fire, four ash fight rings, the gold bookmark ribbon over the current page, and the
// small foes (Ash Motes, Cinder Hound, Iron Husk) with the Warden's actor API so the
// combat stage can pose them. Positions come from core/rules/path.js SITES (pure, shared
// with the room server). Every client builds identical geometry (fixed seeds).
// OWNER: world engineer.
// Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later

import * as THREE from 'three'
import {MOTION, REDUCED_MOTION, jitter, makeCampfire, makeCharacter, makeEmberSparks, makeEnemy, makeGroundTile, makeLantern, makeMaterial} from '../shared/style.js'
import {RING_SITES, SITES} from '../core/rules/path.js'
import {heightAt} from './nav.js'

const mesh = (geo, key, opts = {}) => {
	const m = new THREE.Mesh(geo, typeof key === 'string' ? makeMaterial(key, opts) : key)
	m.castShadow = true
	m.receiveShadow = true
	return m
}
const J = (geo, seed, amt = 0.03) => jitter(geo, amt, seed)
const at = (o, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0) => {
	o.position.set(x, y, z)
	o.rotation.set(rx, ry, rz)
	return o
}

/** Two-wheeled cart: box bed, six-sided wheels, a paper canvas wedge, a lantern on a pole. */
function makeCart(seed = 510) {
	const g = new THREE.Group()
	g.name = 'ever:cart'
	g.add(at(mesh(J(new THREE.BoxGeometry(2.2, 0.5, 1.3), seed), 'wood'), 0, 0.75, 0))
	g.add(at(mesh(J(new THREE.BoxGeometry(2.3, 0.12, 1.4), seed + 1), 'roof'), 0, 1.02, 0))
	for (const s of [-1, 1]) {
		const w = new THREE.CylinderGeometry(0.5, 0.5, 0.14, 6, 1)
		w.rotateX(Math.PI / 2)
		g.add(at(mesh(J(w, seed + 2 + s), 'wood'), 0.1, 0.5, s * 0.75))
		g.add(at(mesh(new THREE.BoxGeometry(0.12, 0.12, 0.2), 'iron'), 0.1, 0.5, s * 0.84))
	}
	// canvas wedge: a three-sided prism lying along the cart (paper)
	const wedge = new THREE.CylinderGeometry(0.75, 0.75, 2.0, 3, 1)
	wedge.rotateZ(Math.PI / 2)
	g.add(at(mesh(J(wedge, seed + 5), 'paper'), 0, 1.45, 0, 0, Math.PI / 6))
	// shafts
	for (const s of [-1, 1]) g.add(at(mesh(new THREE.BoxGeometry(1.6, 0.08, 0.08), 'wood'), -1.8, 0.6, s * 0.5, 0, 0, -0.12))
	const lamp = makeLantern({lit: true, post: true, seed: seed + 9})
	lamp.scale.setScalar(0.8)
	g.add(at(lamp, 1.15, 0, -0.7))
	return g
}

/** The Wayfarer (GDD_V2 10.3): haze cloak, gold accent and sash, hood, a lantern. */
function makeWayfarer(seed = 520) {
	const c = makeCharacter({body: 'haze', accent: 'gold', hat: 'hood', holding: 'lantern', scale: 1.0, seed})
	c.parts?.torso?.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.9, 0.62), makeMaterial('gold')), 0, 0.05, 0, 0, 0, 0.55))
	c.name = 'ever:wayfarer'
	return c
}

/** The Keeper (GDD_V2 10.4): small and bent, slate and ward, a lantern held high. */
function makeKeeper(seed = 530) {
	const c = makeCharacter({body: 'slate', accent: 'ward', hat: 'hood', holding: 'lantern', scale: 0.9, seed})
	c.name = 'ever:keeper'
	if (c.parts?.rig) c.parts.rig.rotation.x = 0.12
	return c
}

/** A low stool (three legs) and a lit lantern on its post. */
function makeBench(seed = 540) {
	const g = new THREE.Group()
	g.add(at(mesh(J(new THREE.CylinderGeometry(0.32, 0.32, 0.1, 6), seed), 'wood'), 0, 0.5, 0))
	for (let i = 0; i < 3; i++) {
		const a = (i / 3) * Math.PI * 2
		g.add(at(mesh(new THREE.BoxGeometry(0.07, 0.5, 0.07), 'wood'), Math.cos(a) * 0.2, 0.25, Math.sin(a) * 0.2))
	}
	const lamp = makeLantern({lit: true, post: true, seed: seed + 3})
	lamp.scale.setScalar(1.15)
	g.add(at(lamp, 0.9, 0, -0.4))
	return g
}

/** The Road Fire: the kit campfire and two log benches. */
function makeRoadFire(seed = 550) {
	const g = new THREE.Group()
	const fire = makeCampfire({lit: true, seed})
	g.add(fire)
	for (const [x, z, r] of [[-1.5, 0.3, 0.3], [1.4, 0.5, -0.4]]) g.add(at(mesh(J(new THREE.CylinderGeometry(0.22, 0.24, 1.6, 6), seed + x * 10), 'wood'), x, 0.22, z, r, 0, Math.PI / 2))
	g.update = (t) => fire.update?.(t)
	return g
}

/** An ash fight ring: an ash ground tile and ember sparks. Appears only on its page. */
function makeRing(seed) {
	const g = new THREE.Group()
	const tile = makeGroundTile({radius: 2.8, sides: 7, colorKey: 'ash', seed, height: 0.06})
	g.add(tile)
	const sparks = makeEmberSparks({count: 18, radius: 2.4, height: 2.2, seed: seed + 1})
	g.add(sparks)
	g.update = (t) => sparks.update?.(t)
	return g
}

/** The gold bookmark ribbon floating over the current page's site (slow sway). */
function makeRibbon() {
	const g = new THREE.Group()
	g.name = 'ever:ribbon'
	const gold = makeMaterial('gold', {emissive: 0.45})
	g.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.34, 1.1, 0.04), gold), 0, 0.2, 0))
	for (const s of [-1, 1]) g.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.34, 0.04), gold), s * 0.09, -0.48, 0, 0, 0, s * 0.45))
	return g
}

// ---------------------------------------------------------------------------------------
// Foes with the Warden's actor API (setPose, setIntentPose, flash, getPose, update)
// ---------------------------------------------------------------------------------------

function withPoses(g, {onPose = () => {}, onUpdate = () => {}} = {}) {
	let pose = 'idle'
	let flashT = 0
	const glow = []
	g.traverse((o) => o.isMesh && o.material?.emissive && glow.push(o))
	g.setPose = (name) => {
		pose = name
		onPose(name)
	}
	g.setIntentPose = (step) => g.setPose(['cleave', 'brace', 'smother', 'slam'][(((step - 1) % 4) + 4) % 4])
	g.flash = () => {
		flashT = MOTION.hitFlash ?? 0.12
	}
	g.getPose = () => pose
	g.update = (t, dt = 1 / 60) => {
		flashT = Math.max(0, flashT - dt)
		g.scale.setScalar(g.userData.baseScale * (flashT > 0 ? 1.06 : 1))
		onUpdate(t, dt, pose)
	}
	g.userData.baseScale = 1
	return g
}

/** Ash Motes: three floating ember octahedra in a loose triangle (one HP bar, "a swarm"). */
function makeMotes(seed = 600) {
	const g = new THREE.Group()
	g.name = 'ever:ashMotes'
	const motes = []
	for (let i = 0; i < 3; i++) {
		const m = new THREE.Group()
		m.add(new THREE.Mesh(jitter(new THREE.OctahedronGeometry(0.42, 0), 0.05, seed + i, {keepBottom: false}), makeMaterial('ember', {emissive: 0.9})))
		m.add(new THREE.Mesh(jitter(new THREE.OctahedronGeometry(0.2, 0), 0.02, seed + 9 + i, {keepBottom: false}), makeMaterial('gold', {emissive: 1.2})))
		const a = (i / 3) * Math.PI * 2
		m.position.set(Math.cos(a) * 0.8, 1.4 + i * 0.25, Math.sin(a) * 0.8)
		motes.push(m)
		g.add(m)
	}
	let dead = false
	return withPoses(g, {
		onPose: (p) => (dead = p === 'dead'),
		onUpdate: (t) => {
			motes.forEach((m, i) => {
				const y = dead ? 0.25 : 1.4 + i * 0.25 + (REDUCED_MOTION ? 0 : Math.sin(t * 2 + i * 2) * 0.18)
				m.position.y += (y - m.position.y) * 0.1
				if (!REDUCED_MOTION) m.rotation.y = t * (1 + i * 0.3)
			})
		},
	})
}

/** Cinder Hound: long and low; box body, cone snout, ember cracks, ash-cone tail. */
function makeHound(seed = 620) {
	const g = new THREE.Group()
	g.name = 'ever:cinderHound'
	const body = new THREE.Group()
	g.add(body)
	body.add(at(mesh(J(new THREE.BoxGeometry(0.8, 0.7, 1.9), seed), 'ink'), 0, 0.85, 0))
	body.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.08, 1.4), makeMaterial('ember', {emissive: 1})), 0, 1.0, 0))
	const head = new THREE.Group()
	head.position.set(0, 1.1, 1.05)
	head.add(mesh(J(new THREE.BoxGeometry(0.6, 0.55, 0.6), seed + 1), 'ink'))
	const snout = new THREE.ConeGeometry(0.22, 0.6, 4)
	snout.rotateX(Math.PI / 2)
	head.add(at(mesh(snout, 'ash'), 0, -0.08, 0.5))
	for (const s of [-1, 1]) head.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.06), makeMaterial('ember', {emissive: 1.2})), s * 0.16, 0.08, 0.3))
	body.add(head)
	for (const [x, z] of [[-0.3, 0.7], [0.3, 0.7], [-0.3, -0.7], [0.3, -0.7]]) body.add(at(mesh(new THREE.BoxGeometry(0.2, 0.55, 0.2), 'ink'), x, 0.28, z))
	const tail = new THREE.ConeGeometry(0.15, 0.8, 4)
	tail.rotateX(-Math.PI / 2.6)
	body.add(at(mesh(tail, 'ash'), 0, 1.1, -1.15))
	let lunge = 0
	return withPoses(g, {
		onPose: (p) => (lunge = p === 'slam' || p === 'cleave' ? 1 : p === 'dead' ? -1 : 0),
		onUpdate: (t) => {
			const want = lunge === 1 ? 0.35 : 0
			body.position.z += (want - body.position.z) * 0.15
			body.rotation.z += ((lunge === -1 ? 1.3 : 0) - body.rotation.z) * 0.1
			if (!REDUCED_MOTION && lunge === 0) head.rotation.x = Math.sin(t * 3) * 0.06
		},
	})
}

/** Iron Husk: Warden-kin at two thirds height, cold (no coal glow). Reuses the Warden's poses. */
function makeHusk() {
	const w = makeEnemy('ashWarden', {seed: 640})
	w.name = 'ever:ironHusk'
	w.scale.setScalar(0.68)
	const baseUpdate = w.update
	w.update = (t, dt) => baseUpdate(t, dt)
	return w
}

export function makeFoe(kind) {
	if (kind === 'motes') return makeMotes()
	if (kind === 'hound') return makeHound()
	if (kind === 'husk') return makeHusk()
	return null
}

// ---------------------------------------------------------------------------------------
// The site layer
// ---------------------------------------------------------------------------------------

/**
 * Build every v2 site into `scene`. Returns an API the world calls from syncBook and its
 * frame loop.
 * @param {THREE.Scene} scene
 */
export function buildSites(scene) {
	const root = new THREE.Group()
	root.name = 'ever:v2sites'
	scene.add(root)
	const placeAt = (o, site, dx = 0, dz = 0, ry = 0) => {
		const [x, z] = SITES[site].pos
		o.position.set(x + dx, heightAt(x + dx, z + dz), z + dz)
		o.rotation.y = ry
		root.add(o)
		return o
	}
	const cart = placeAt(makeCart(), 'cart', -1.4, -1.2, 0.3)
	const wayfarer = placeAt(makeWayfarer(), 'cart', 0.6, 0.6)
	wayfarer.faceTowards?.(0, 22)
	const bench = placeAt(makeBench(), 'bench', 0.2, -0.6)
	const keeper = placeAt(makeKeeper(), 'bench', 0, -0.6)
	keeper.faceTowards?.(0, 10)
	const fire = placeAt(makeRoadFire(), 'roadfire')
	const rings = Object.fromEntries(RING_SITES.map((id, i) => [id, placeAt(makeRing(700 + i * 10), id)]))
	for (const r of Object.values(rings)) {
		r.visible = false
		r.scale.setScalar(0.01)
	}
	const ribbon = makeRibbon()
	ribbon.visible = false
	root.add(ribbon)

	cart.userData.pick = 'cart'
	wayfarer.userData.pick = 'cart'
	bench.userData.pick = 'bench'
	keeper.userData.pick = 'bench'
	fire.userData.pick = 'roadfire'
	for (const [id, r] of Object.entries(rings)) r.userData.pick = id

	let ringOn = null
	const ringT = Object.fromEntries(RING_SITES.map((id) => [id, 0]))
	let ribbonSite = null
	let clock = 0

	return {
		root,
		pickables: [cart, wayfarer, bench, keeper, fire, ...Object.values(rings)],
		npcs: {wayfarer, keeper},
		/**
		 * Follow a v2 book: the ribbon over the current page's site, the current fight
		 * ring, which archetypes are in this path (dim when their page is done).
		 * @param {any} book  null = no v2 book (MVP or the cover): hide everything v2
		 * @param {string|null} site  the current page's site (Hearth moves to the forge when lit)
		 */
		sync(book, site) {
			const v2 = book?.v === 2 && book.path
			ribbonSite = v2 && book.status === 'exploring' && book.page < book.path.L ? site : null
			const cur = v2 ? book.path.pages[book.page] : null
			ringOn = v2 && cur && RING_SITES.includes(cur.site) && (cur.type === 'skirmish' || cur.type === 'elite') ? cur.site : null
			const has = (a) => Boolean(v2 && book.path.pages.some((p) => p.archetype === a))
			wayfarer.visible = cart.visible = !v2 || has('wayfarer')
			keeper.visible = !v2 || has('keeper')
			const lampOut = v2 && book.npcs?.keeper?.closed
			bench.children.at(-1)?.setLit?.(!lampOut)
		},
		/** World position of a site's ribbon anchor (for tests and tutorials). */
		ribbonAt: () => ribbonSite,
		update(t, dt) {
			clock = t
			fire.update(t)
			wayfarer.update?.(t, dt)
			keeper.update?.(t, dt)
			for (const [id, r] of Object.entries(rings)) {
				const want = id === ringOn ? 1 : 0
				ringT[id] += (want - ringT[id]) * Math.min(1, dt / 0.15)
				r.visible = ringT[id] > 0.02
				r.scale.setScalar(Math.max(0.01, ringT[id]))
				if (r.visible) r.update(t)
			}
			if (ribbonSite && SITES[ribbonSite]) {
				const [x, z] = SITES[ribbonSite].pos
				ribbon.visible = true
				ribbon.position.set(x, 3.4 + (REDUCED_MOTION ? 0 : Math.sin(clock * 1.4) * 0.12), z)
				ribbon.rotation.z = REDUCED_MOTION ? 0 : Math.sin(clock * 0.9) * 0.12
				ribbon.rotation.y += REDUCED_MOTION ? 0 : dt * 0.6
			} else ribbon.visible = false
		},
	}
}
