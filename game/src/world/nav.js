// EVER world navigation: colliders, movement, bounds, station ranges (GDD 5).
// OWNER: world engineer. PURE: no DOM, no three (unit-tested in Node, and simple enough
// that the room server could reuse it for a movement sanity check).
// Units are meters, x east, z south, origin at the well. Player walks at 6 u/s.
//
// Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later

import {STATIONS, SPAWN} from '../core/contracts.js'
import {SITES} from '../core/rules/path.js'

export const WALK_SPEED = 6
export const PLAYER_RADIUS = 0.45
/** Walkable rectangle: inside the pine ring, south of the Ash Gate bars (z = -25). */
export const BOUNDS = Object.freeze({minX: -25.5, maxX: 25.5, minZ: -24.3, maxZ: 26})

/** Layout copied from style.js ASHBROOK / buildAshbrook (a unit test keeps them equal). */
export const LAYOUT = Object.freeze({
	forge: {pos: [-15, -1], rot: Math.PI / 2 - 0.25, w: 5.2, d: 4.4},
	/** Marcus's anvil, moved next to him (the kit's forge puts it 2.6 u away). */
	anvil: [-14.0, 0.5],
	bigTree: [17.4, -0.6],
	shrinePines: [[13.4, -15.4], [18.7, -14.8], [16.6, -17.2]],
	houses: [[-8, 14], [9, 13], [10, -6], [-10.5, -11]],
	signpost: SPAWN,
})

/**
 * Pine-ring gaps (circles [x, z, r]) for the village scene. The follow camera sits 15 u
 * south of the player and never rotates, so pines on the south edge (z > ~25) are never
 * seen as trees, only as dark slabs between the camera and the player near spawn. We
 * leave that strip open (the road's exit) instead of cutting them with the near plane.
 */
export const RING_GAPS = Object.freeze([
	...Array.from({length: 17}, (_, i) => Object.freeze([-32 + i * 4, 30.5, 5.2])),
])
/** True when a ring tree at (x, z) is skipped (same test style.js makePineRing uses). */
export function inRingGap(x, z, gaps = RING_GAPS) {
	return gaps.some(([gx, gz, gr]) => Math.hypot(x - gx, z - gz) < gr)
}

/** World -> local for an object rotated by `rot` about +y (three.js convention). */
export function toLocal(x, z, cx, cz, rot) {
	const dx = x - cx
	const dz = z - cz
	const c = Math.cos(rot)
	const s = Math.sin(rot)
	return [dx * c - dz * s, dx * s + dz * c]
}
/** Local -> world (inverse of toLocal). */
export function toWorld(lx, lz, cx, cz, rot) {
	const c = Math.cos(rot)
	const s = Math.sin(rot)
	return [cx + lx * c + lz * s, cz - lx * s + lz * c]
}

/**
 * @typedef {{kind: 'circle', x: number, z: number, r: number, tag: string} |
 *           {kind: 'box', x: number, z: number, hx: number, hz: number, rot: number, tag: string}} Collider
 */

/** Every solid thing a player can bump into. Small rocks and the ash circle are walkable. */
export function buildColliders() {
	/** @type {Collider[]} */
	const out = []
	const circle = (x, z, r, tag) => out.push({kind: 'circle', x, z, r, tag})
	const box = (x, z, hx, hz, rot, tag) => out.push({kind: 'box', x, z, hx, hz, rot, tag})

	circle(STATIONS.well.pos[0], STATIONS.well.pos[1], 1.55, 'well')
	circle(STATIONS.grindstone.pos[0], STATIONS.grindstone.pos[1], 0.75, 'grindstone')
	circle(STATIONS.lectern.pos[0], STATIONS.lectern.pos[1], 0.8, 'lectern')
	circle(STATIONS.shrine.pos[0], STATIONS.shrine.pos[1], 0.95, 'shrine')
	circle(STATIONS.marcus.pos[0], STATIONS.marcus.pos[1], 0.6, 'marcus')
	circle(LAYOUT.anvil[0], LAYOUT.anvil[1], 0.55, 'anvil')
	circle(LAYOUT.bigTree[0], LAYOUT.bigTree[1], 0.65, 'tree')
	for (const [x, z] of LAYOUT.shrinePines) circle(x, z, 0.55, 'tree')
	circle(LAYOUT.signpost[0], LAYOUT.signpost[1], 0.25, 'signpost')

	// Forge: open-sided. Back wall + hearth are solid, the four posts are poles.
	const F = LAYOUT.forge
	const fw = (lx, lz) => toWorld(lx, lz, F.pos[0], F.pos[1], F.rot)
	{
		const [x, z] = fw(0, -F.d / 2)
		box(x, z, F.w / 2 + 0.1, 0.25, F.rot, 'forge')
		const [hx, hz] = fw(-1.4, -1.5)
		box(hx, hz, 0.85, 0.8, F.rot, 'forge')
		for (const [lx, lz] of [[-F.w / 2, F.d / 2], [F.w / 2, F.d / 2], [F.w / 2, -F.d / 2], [-F.w / 2, -F.d / 2]]) {
			const [px, pz] = fw(lx, lz)
			circle(px, pz, 0.25, 'forge')
		}
	}
	// Houses face the well (style.js buildAshbrook): 4 x 3.4 plus a 0.1 base lip.
	for (const [x, z] of LAYOUT.houses) box(x, z, 2.15, 1.85, Math.atan2(-x, -z), 'house')
	// Gate pillars (also covered by BOUNDS.minZ, kept for completeness).
	for (const s of [-1, 1]) circle(s * 2.3, -25, 0.7, 'gate')
	// v2 sites (world/sites.js places these props): cart, Wayfarer, Keeper's stool and lamp,
	// the Road Fire. Fight rings are walkable ash.
	{
		const [cx, cz] = SITES.cart.pos
		box(cx - 1.4, cz - 1.2, 1.25, 0.85, 0.3, 'cart')
		circle(cx + 0.6, cz + 0.6, 0.35, 'npc')
		const [bx, bz] = SITES.bench.pos
		circle(bx, bz - 0.6, 0.4, 'npc')
		circle(bx + 1.1, bz - 1.0, 0.22, 'lantern')
		const [fx, fz] = SITES.roadfire.pos
		circle(fx, fz, 0.85, 'fire')
	}
	return out
}

const EPS = 1e-4

/** Push (x, z) out of one collider. Returns the new point (or the same if clear). */
function pushOut(x, z, c, r) {
	if (c.kind === 'circle') {
		const dx = x - c.x
		const dz = z - c.z
		const d = Math.hypot(dx, dz)
		const min = c.r + r
		if (d >= min - EPS) return null
		const out = min + EPS
		if (d < 1e-6) return [c.x, c.z + out] // dead center: step out to the south
		return [c.x + (dx / d) * out, c.z + (dz / d) * out]
	}
	const [lx, lz] = toLocal(x, z, c.x, c.z, c.rot)
	const qx = Math.max(-c.hx, Math.min(c.hx, lx))
	const qz = Math.max(-c.hz, Math.min(c.hz, lz))
	const dx = lx - qx
	const dz = lz - qz
	const d = Math.hypot(dx, dz)
	if (d >= r - EPS) return null
	let nx, nz
	if (d > 1e-6) {
		nx = qx + (dx / d) * (r + EPS)
		nz = qz + (dz / d) * (r + EPS)
	} else {
		// centre inside the box: leave by the nearest face
		const px = c.hx - Math.abs(lx)
		const pz = c.hz - Math.abs(lz)
		if (px < pz) {
			nx = Math.sign(lx || 1) * (c.hx + r + EPS)
			nz = lz
		} else {
			nx = lx
			nz = Math.sign(lz || 1) * (c.hz + r + EPS)
		}
	}
	return toWorld(nx, nz, c.x, c.z, c.rot)
}

export function clampToBounds(x, z, r = PLAYER_RADIUS) {
	return [Math.max(BOUNDS.minX + r, Math.min(BOUNDS.maxX - r, x)), Math.max(BOUNDS.minZ + r, Math.min(BOUNDS.maxZ - r, z))]
}

/** Resolve overlaps (a few relaxation passes so corners between colliders settle). */
export function resolve(x, z, colliders, r = PLAYER_RADIUS) {
	let p = clampToBounds(x, z, r)
	for (let pass = 0; pass < 4; pass++) {
		let moved = false
		for (const c of colliders) {
			const q = pushOut(p[0], p[1], c, r)
			if (q) {
				p = q
				moved = true
			}
		}
		p = clampToBounds(p[0], p[1], r)
		if (!moved) break
	}
	return p
}

/** True if (x, z) overlaps nothing solid. */
export function isFree(x, z, colliders, r = PLAYER_RADIUS) {
	const [cx, cz] = clampToBounds(x, z, r)
	if (Math.abs(cx - x) > 1e-9 || Math.abs(cz - z) > 1e-9) return false
	return colliders.every((c) => !pushOut(x, z, c, r))
}

/**
 * Move along direction (dx, dz) for dt seconds at `speed` (a vector shorter than 1 walks slower),
 * sliding along colliders. Sub-steps keep fast frames from tunnelling through posts.
 * @returns {[number, number]}
 */
export function step(x, z, dx, dz, dt, colliders, speed = WALK_SPEED) {
	const len = Math.hypot(dx, dz)
	if (len < 1e-6 || dt <= 0) return resolve(x, z, colliders)
	const dist = speed * Math.min(dt, 0.1) * Math.min(1, len) // len < 1 = slow (arrival)
	const n = Math.max(1, Math.ceil(dist / 0.2))
	const ux = dx / len
	const uz = dz / len
	const d = dist / n
	let p = [x, z]
	for (let i = 0; i < n; i++) {
		let q = resolve(p[0] + ux * d, p[1] + uz * d, colliders)
		// Head-on into a round post (e.g. the signpost right at spawn) the push-out cancels
		// the move exactly and the player sticks. Then try veering 40 then 75 degrees either
		// way and take whichever makes the most progress along the wanted direction.
		if ((q[0] - p[0]) * ux + (q[1] - p[1]) * uz < d * 0.25) {
			let best = q
			let bestGain = (q[0] - p[0]) * ux + (q[1] - p[1]) * uz
			for (const a of [0.7, -0.7, 1.3, -1.3]) {
				const c = Math.cos(a)
				const s = Math.sin(a)
				const vx = ux * c - uz * s
				const vz = ux * s + uz * c
				const r = resolve(p[0] + vx * d, p[1] + vz * d, colliders)
				const gain = (r[0] - p[0]) * ux + (r[1] - p[1]) * uz
				if (gain > bestGain + 1e-6) {
					best = r
					bestGain = gain
				}
			}
			q = best
		}
		p = q
	}
	return p
}

/**
 * Keyboard to a walk direction. The camera never rotates and looks north, so
 * up = -z. Accepts KeyboardEvent.code values (WASD and arrows).
 * @param {Set<string>|Iterable<string>} keys
 * @returns {[number, number]} unit vector or [0, 0]
 */
export function inputVector(keys) {
	const k = keys instanceof Set ? keys : new Set(keys)
	let x = 0
	let z = 0
	if (k.has('KeyW') || k.has('ArrowUp')) z -= 1
	if (k.has('KeyS') || k.has('ArrowDown')) z += 1
	if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1
	if (k.has('KeyD') || k.has('ArrowRight')) x += 1
	const l = Math.hypot(x, z)
	return l ? [x / l, z / l] : [0, 0]
}

/** Facing angle (three.js rotation.y) for a walk direction; matches faceTowards in style.js. */
export function yawOf(dx, dz) {
	return Math.atan2(dx, dz)
}

/** Shortest-path angle damping (turn to face in ~0.12 s). */
export function dampAngle(from, to, lambda, dt) {
	let d = ((to - from + Math.PI) % (Math.PI * 2)) - Math.PI
	if (d < -Math.PI) d += Math.PI * 2
	return from + d * (1 - Math.exp(-lambda * dt))
}

/** Ground height: the forge stands on a 0.2 u stone base, everything else is y = 0. */
export function heightAt(x, z) {
	const F = LAYOUT.forge
	const [lx, lz] = toLocal(x, z, F.pos[0], F.pos[1], F.rot)
	return Math.abs(lx) <= F.w / 2 + 0.2 && Math.abs(lz) <= F.d / 2 + 0.2 ? 0.2 : 0
}

/** Stations a player can use from the village, nearest first. */
export const INTERACTABLE = Object.freeze(['marcus', 'well', 'grindstone', 'lectern', 'shrine', 'gate'])

/**
 * The station whose radius contains (x, z), nearest centre wins. Client side the
 * tolerance is 0 (the room adds +1 when it re-checks).
 * @returns {import('../core/contracts.js').StationId|null}
 */
export function stationAt(x, z, {tolerance = 0, only = INTERACTABLE} = {}) {
	let best = null
	let bestD = Infinity
	for (const id of only) {
		const s = STATIONS[id]
		if (!s) continue
		const d = Math.hypot(x - s.pos[0], z - s.pos[1])
		if (d <= s.radius + tolerance && d < bestD) {
			best = id
			bestD = d
		}
	}
	return best
}

/**
 * Where to walk to use a station by clicking it: the point on its radius ring
 * nearest the player, pulled 0.4 u inside so we really arrive in range.
 */
export function approachPoint(station, fromX, fromZ) {
	const s = STATIONS[station]
	const dx = fromX - s.pos[0]
	const dz = fromZ - s.pos[1]
	const d = Math.hypot(dx, dz) || 1
	const k = Math.max(0.6, s.radius - 0.4)
	return [s.pos[0] + (dx / d) * k, s.pos[1] + (dz / d) * k]
}

/** "Not yet" at the gate: step 2 u back out along the line from the circle centre. */
export function stepBackFromGate(x, z, colliders) {
	const c = STATIONS.gate.pos
	let dx = x - c[0]
	let dz = z - c[1]
	const d = Math.hypot(dx, dz)
	if (d < 1e-3) {
		dx = 0
		dz = 1
	} else {
		dx /= d
		dz /= d
	}
	const out = Math.max(d + 2, STATIONS.gate.radius + 0.6) // always end outside the circle
	return resolve(c[0] + dx * out, c[1] + dz * out, colliders)
}

/**
 * Click-to-move follower. Holds a target; `update` returns the direction to walk this
 * frame and cancels when arrived or stuck (pushing into a wall for 0.6 s).
 */
export function createMoveTarget() {
	let target = null
	let stuckT = 0
	let lastD = Infinity
	return {
		get target() {
			return target
		},
		set(x, z, onArrive = null) {
			const [cx, cz] = clampToBounds(x, z)
			target = {x: cx, z: cz, onArrive}
			stuckT = 0
			lastD = Infinity
		},
		clear() {
			target = null
		},
		/** @returns {{dir: [number, number], arrived: boolean, onArrive: Function|null}} */
		update(x, z, dt) {
			if (!target) return {dir: [0, 0], arrived: false, onArrive: null}
			const dx = target.x - x
			const dz = target.z - z
			const d = Math.hypot(dx, dz)
			if (d < 0.15) {
				const cb = target.onArrive
				target = null
				return {dir: [0, 0], arrived: true, onArrive: cb}
			}
			stuckT = lastD - d < WALK_SPEED * dt * 0.25 ? stuckT + dt : 0
			lastD = d
			if (stuckT > 0.6) {
				target = null
				return {dir: [0, 0], arrived: false, onArrive: null}
			}
			// slow down for the last step so we don't overshoot
			const k = Math.min(1, d / Math.max(1e-6, WALK_SPEED * dt))
			return {dir: [(dx / d) * k, (dz / d) * k], arrived: false, onArrive: null}
		},
	}
}
