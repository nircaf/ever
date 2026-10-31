// World navigation tests (pure). Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later
import {describe, expect, it} from 'vitest'
import {ASHBROOK} from '../shared/style.js'
import {SPAWN, STATIONS} from '../core/contracts.js'
import {
	BOUNDS,
	LAYOUT,
	PLAYER_RADIUS,
	WALK_SPEED,
	RING_GAPS,
	approachPoint,
	inRingGap,
	buildColliders,
	createMoveTarget,
	heightAt,
	inputVector,
	isFree,
	resolve,
	stationAt,
	step,
	stepBackFromGate,
	toLocal,
	toWorld,
} from './nav.js'

const C = buildColliders()

describe('layout', () => {
	it('matches the art kit (style.js ASHBROOK)', () => {
		expect(LAYOUT.forge.pos).toEqual(ASHBROOK.forge)
		expect(LAYOUT.bigTree).toEqual(ASHBROOK.bigTree)
		expect(LAYOUT.shrinePines).toEqual(ASHBROOK.shrinePines)
		expect(LAYOUT.houses).toEqual(ASHBROOK.houses)
		expect(LAYOUT.signpost).toEqual(ASHBROOK.spawn)
	})
	it('local/world transforms invert', () => {
		const [lx, lz] = toLocal(3, -2, -15, -1, 1.3)
		const [x, z] = toWorld(lx, lz, -15, -1, 1.3)
		expect(x).toBeCloseTo(3)
		expect(z).toBeCloseTo(-2)
	})
	it('every station can be reached: a free spot exists inside each interact radius', () => {
		for (const [id, s] of Object.entries(STATIONS)) {
			let ok = false
			for (let a = 0; a < Math.PI * 2 && !ok; a += 0.2) {
				for (const r of [s.radius - 0.2, s.radius - 0.6]) {
					const x = s.pos[0] + Math.cos(a) * r
					const z = s.pos[1] + Math.sin(a) * r
					if (isFree(x, z, C) && stationAt(x, z) === id) ok = true
				}
			}
			expect(ok, id).toBe(true)
		}
	})
	it('spawn resolves to a free spot near the signpost', () => {
		const [x, z] = resolve(SPAWN[0], SPAWN[1], C)
		expect(isFree(x, z, C)).toBe(true)
		expect(Math.hypot(x - SPAWN[0], z - SPAWN[1])).toBeLessThan(1)
	})
})

describe('camera corridor', () => {
	it('no ring pine stands on the south strip between the follow cam and the player', () => {
		// the camera sits 15 u south of the player; ring pines there are only occluders
		for (let x = -29; x <= 29; x += 0.5) for (let z = 26; z <= 29.2; z += 0.4) expect(inRingGap(x, z), `${x},${z}`).toBe(true)
	})
	it('keeps the rest of the ring (east, west and north edges stay wooded)', () => {
		expect(inRingGap(0, -28)).toBe(false)
		expect(inRingGap(-28, 0)).toBe(false)
		expect(inRingGap(28, 10)).toBe(false)
		expect(RING_GAPS.length).toBeGreaterThan(0)
	})
})

describe('movement', () => {
	it('walks at 6 u/s in open ground', () => {
		const [x, z] = step(0, 10, 0, -1, 0.1, C)
		expect(x).toBeCloseTo(0)
		expect(10 - z).toBeCloseTo(WALK_SPEED * 0.1)
	})
	it('caps a huge frame so nobody teleports', () => {
		const [, z] = step(0, 10, 0, -1, 5, C)
		expect(10 - z).toBeLessThanOrEqual(WALK_SPEED * 0.1 + 1e-9)
	})
	it('cannot walk through the well, and slides around it', () => {
		let p = [0, 4]
		for (let i = 0; i < 60; i++) p = step(p[0] + 0, p[1], 0.05, -1, 1 / 60, C)
		expect(Math.hypot(p[0], p[1])).toBeGreaterThanOrEqual(1.55 + PLAYER_RADIUS - 1e-6)
		// pushing slightly sideways makes it slide past instead of sticking forever
		for (let i = 0; i < 240; i++) p = step(p[0], p[1], 0.05, -1, 1 / 60, C)
		expect(p[1]).toBeLessThan(-1)
	})
	it('walking straight north from spawn veers around the signpost instead of sticking', () => {
		let p = resolve(SPAWN[0], SPAWN[1], C)
		for (let i = 0; i < 60; i++) p = step(p[0], p[1], 0, -1, 1 / 60, C)
		expect(p[1]).toBeLessThan(SPAWN[1] - 3)
		expect(isFree(p[0], p[1], C)).toBe(true)
	})
	it('head-on into a flat wall it stops without drifting through', () => {
		const [hx, hz] = LAYOUT.houses[0]
		let p = [hx, hz + 4]
		const dir = [0, -1]
		for (let i = 0; i < 120; i++) p = step(p[0], p[1], dir[0], dir[1], 1 / 60, C)
		expect(isFree(p[0], p[1], C)).toBe(true)
	})
	it('cannot enter a house', () => {
		const [hx, hz] = LAYOUT.houses[0]
		const [x, z] = resolve(hx, hz, C)
		expect(isFree(x, z, C)).toBe(true)
		expect(Math.hypot(x - hx, z - hz)).toBeGreaterThan(1.5)
	})
	it('stays inside the map and south of the gate bars', () => {
		let p = [0, -20]
		for (let i = 0; i < 120; i++) p = step(p[0], p[1], 0, -1, 1 / 30, C)
		expect(p[1]).toBeGreaterThanOrEqual(BOUNDS.minZ + PLAYER_RADIUS - 1e-9)
		p = [20, 0]
		for (let i = 0; i < 120; i++) p = step(p[0], p[1], 1, 0, 1 / 30, C)
		expect(p[0]).toBeLessThanOrEqual(BOUNDS.maxX - PLAYER_RADIUS + 1e-9)
	})
	it('keyboard maps to camera-relative directions (up = north = -z)', () => {
		expect(inputVector(new Set(['KeyW']))).toEqual([0, -1])
		expect(inputVector(['ArrowRight'])).toEqual([1, 0])
		const [x, z] = inputVector(['KeyW', 'KeyD'])
		expect(Math.hypot(x, z)).toBeCloseTo(1)
		expect(inputVector(['KeyW', 'KeyS'])).toEqual([0, 0])
	})
	it('forge floor is raised, the square is flat', () => {
		expect(heightAt(...STATIONS.marcus.pos)).toBeCloseTo(0.2)
		expect(heightAt(0, 5)).toBe(0)
	})
})

describe('stations and targets', () => {
	it('stationAt uses the GDD radius with no client tolerance', () => {
		expect(stationAt(0, 2.4)).toBe('well')
		expect(stationAt(0, 2.6)).toBe(null)
		expect(stationAt(0, -20)).toBe('gate')
		expect(stationAt(-13, 2.5)).toBe('marcus')
	})
	it('approach point lands inside the radius', () => {
		for (const id of ['well', 'lectern', 'grindstone', 'shrine', 'marcus', 'gate']) {
			const [x, z] = approachPoint(id, 0, 20)
			expect(stationAt(x, z, {only: [id]})).toBe(id)
		}
	})
	it('"Not yet" steps you out of the gate circle', () => {
		const [x, z] = stepBackFromGate(0.5, -21, C)
		expect(stationAt(x, z)).not.toBe('gate')
		expect(Math.hypot(x - 0.5, z + 21)).toBeGreaterThanOrEqual(1.9)
	})
	it('click-to-move walks to the target and calls onArrive', () => {
		const t = createMoveTarget()
		let arrived = 0
		t.set(0, 6, () => arrived++)
		let p = [0, 12]
		for (let i = 0; i < 200 && t.target; i++) {
			const r = t.update(p[0], p[1], 1 / 60)
			if (r.onArrive) r.onArrive()
			p = step(p[0], p[1], r.dir[0], r.dir[1], 1 / 60, C)
		}
		expect(arrived).toBe(1)
		expect(Math.hypot(p[0], p[1] - 6)).toBeLessThan(0.2)
	})
	it('click-to-move gives up when blocked', () => {
		const t = createMoveTarget()
		t.set(0, 0) // the middle of the well
		let p = [0, 6]
		let frames = 0
		for (; frames < 600 && t.target; frames++) {
			const r = t.update(p[0], p[1], 1 / 60)
			p = step(p[0], p[1], r.dir[0], r.dir[1], 1 / 60, C)
		}
		expect(t.target).toBe(null)
		expect(frames).toBeLessThan(200)
	})
})
