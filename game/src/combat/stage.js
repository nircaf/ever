// EVER combat stage: the 3D actors combat animates (Warden + party), built from the
// shared art kit so they are the same models as in the village.
// OWNER: combat engineer.
//
// Preferred path: the world owns the ONE canvas and re-frames the village
// (world.setStage('combat')); we only drive its actors through WorldApi
// getWardenActor() / getPartyActor(seat). If the world does not provide actors (yet),
// we build a self-contained gate-arena diorama with the same kit, light rig, fog, sky
// and camera framing (ART_BIBLE 5), and pause the world canvas while it shows.
//
// Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later

import * as THREE from 'three'
import {
	CHARACTERS,
	COMBAT_STAGE,
	MOTION,
	REDUCED_MOTION,
	buildAshbrook,
	configureRenderer,
	easeInOut,
	frameCombat,
	makeCamera,
	makeEnemy,
	makeFog,
	makeLightRig,
	makeSky,
	pickQuality,
} from '../shared/style.js'

/**
 * @typedef {object} CombatStage
 * @prop {any} warden                         style.js makeEnemy('ashWarden') instance (or null)
 * @prop {(seat: number) => any} actor        party character at that seat (or null)
 * @prop {(seat: number) => void} hit         recoil a party actor
 * @prop {(seat: number) => void} fall        a fighter dies: the actor tips over
 * @prop {() => void} shake                   Ember Slam camera shake (own stage only)
 * @prop {(seats: number[]) => void} setParty which seats stand in the arena
 * @prop {() => void} dispose
 * @prop {boolean} own                        true = our fallback diorama
 */

/** Small tweens on actor rigs (rotation.z is untouched by the kit's own update()). */
function makeTweens() {
	const list = new Set()
	return {
		add(dur, fn, done) {
			const tw = {t: 0, dur: Math.max(0.001, dur), fn, done}
			list.add(tw)
			return tw
		},
		step(dt) {
			for (const tw of list) {
				tw.t += dt
				const k = Math.min(1, tw.t / tw.dur)
				tw.fn(k)
				if (k >= 1) {
					list.delete(tw)
					tw.done?.()
				}
			}
		},
		clear() {
			list.clear()
		},
	}
}

function recoil(tweens, actor) {
	const rig = actor?.parts?.rig
	if (!rig || REDUCED_MOTION) return
	tweens.add(0.32, (k) => {
		rig.rotation.z = -Math.sin(k * Math.PI) * 0.35
	})
}
function tipOver(tweens, actor) {
	const rig = actor?.parts?.rig
	if (!rig) return
	if (REDUCED_MOTION) {
		rig.rotation.z = -1.35
		return
	}
	tweens.add(0.6, (k) => {
		rig.rotation.z = -1.35 * easeInOut(k)
	})
}

/**
 * @param {HTMLElement} host   element to put our own canvas in (fallback only)
 * @param {import('../core/contracts.js').WorldApi|null|undefined} world
 * @param {{seats: number[]}} opts
 * @returns {CombatStage}
 */
export function createStage(host, world, {seats = [0]} = {}) {
	let worldWarden = null
	try {
		worldWarden = world?.getWardenActor?.() ?? null
	} catch {}
	if (worldWarden) return worldStage(world, worldWarden)
	try {
		return ownStage(host, world, seats)
	} catch (e) {
		// No WebGL: the card UI still works on its own.
		console.warn('[combat] 3D stage unavailable', e)
		return nullStage()
	}
}

function nullStage() {
	return {warden: null, actor: () => null, hit() {}, fall() {}, shake() {}, setParty() {}, dispose() {}, own: false}
}

/** The world owns the canvas and the actors; we pose them. */
function worldStage(world, warden) {
	const tweens = makeTweens()
	let raf = 0
	let last = performance.now()
	const loop = (t) => {
		const dt = Math.min(0.1, (t - last) / 1000)
		last = t
		tweens.step(dt)
		raf = requestAnimationFrame(loop)
	}
	raf = requestAnimationFrame(loop)
	const actor = (seat) => {
		try {
			return world.getPartyActor(seat) ?? null
		} catch {
			return null
		}
	}
	const touched = new Set()
	warden.setPose?.('idle')
	return {
		own: false,
		warden,
		actor,
		hit(seat) {
			const a = actor(seat)
			if (a) touched.add(a)
			recoil(tweens, a)
		},
		fall(seat) {
			const a = actor(seat)
			if (a) touched.add(a)
			tipOver(tweens, a)
		},
		shake() {
			/** @type {any} */ (world).shake?.(MOTION.slamShake.amount, MOTION.slamShake.time)
		},
		setParty() {},
		dispose() {
			cancelAnimationFrame(raf)
			tweens.clear()
			for (const a of touched) if (a.parts?.rig) a.parts.rig.rotation.z = 0
		},
	}
}

/** Fallback: our own gate-arena diorama with the same kit, rig, fog, sky and framing. */
function ownStage(host, world, seats) {
	const quality = pickQuality()
	const wrap = document.createElement('div')
	wrap.className = 'cbt-stage'
	const renderer = new THREE.WebGLRenderer({antialias: quality !== 'low'})
	configureRenderer(renderer, quality)
	wrap.appendChild(renderer.domElement)
	host.prepend(wrap)

	const scene = new THREE.Scene()
	const rig = makeLightRig(scene, {quality, shadowSize: 14})
	rig.follow(1, -22)
	makeFog(scene, 'combat')
	const sky = makeSky()
	scene.add(sky)
	const village = buildAshbrook({quality})
	scene.add(village.root)
	village.stations.gate.setOpen?.(1)

	const warden = makeEnemy('ashWarden')
	const [wx, wz] = COMBAT_STAGE.warden
	warden.position.set(wx, 0, wz)
	scene.add(warden)
	warden.setPose('idle')

	const actors = new Map()
	const placeParty = (list) => {
		for (const [seat, a] of actors) {
			if (!list.includes(seat)) {
				scene.remove(a)
				actors.delete(seat)
			}
		}
		list.forEach((seat) => {
			if (actors.has(seat)) return
			const a = CHARACTERS.player(seat + 1)
			const [x, z] = COMBAT_STAGE.players[seat % 4]
			a.position.set(x, 0, z)
			a.faceTowards(wx, wz)
			scene.add(a)
			actors.set(seat, a)
		})
		const p = COMBAT_STAGE.players[0]
		warden.rotation.y = Math.atan2(p[0] - wx, p[1] - wz)
	}
	placeParty(seats)

	const camera = makeCamera(16 / 9, 'combat')
	// Ease in from a higher, wider pose so the move reads like the world's 1.2 s camera move.
	const from = {position: new THREE.Vector3(0, 16, -6), target: new THREE.Vector3(0, 0, -22)}
	let camT = REDUCED_MOTION ? 1 : 0
	const resize = () => {
		const w = host.clientWidth || innerWidth
		const h = host.clientHeight || innerHeight
		renderer.setSize(w, h, false)
		camera.aspect = w / h
		camera.updateProjectionMatrix()
	}
	addEventListener('resize', resize)
	resize()

	// Pause the world canvas behind us (two full renders per frame would waste phones).
	const worldEl = document.getElementById('world')
	const worldWasVisible = worldEl ? !worldEl.hidden : false
	if (worldWasVisible) world?.hide?.()

	const tweens = makeTweens()
	let shakeT = 0
	let raf = 0
	let last = performance.now()
	const clock0 = last
	const loop = (now) => {
		const dt = Math.min(0.1, (now - last) / 1000)
		last = now
		const t = (now - clock0) / 1000
		camT = Math.min(1, camT + dt / MOTION.combatCameraMove)
		frameCombat(camera, camera.aspect, camT, camT < 1 ? from : null)
		if (shakeT > 0) {
			shakeT = Math.max(0, shakeT - dt)
			const a = MOTION.slamShake.amount * (shakeT / MOTION.slamShake.time)
			camera.position.x += (Math.random() - 0.5) * a * 2
			camera.position.y += (Math.random() - 0.5) * a * 2
		}
		sky.position.copy(camera.position)
		warden.update(t, dt)
		for (const a of actors.values()) a.update(t, dt)
		village.stations.gate.update?.(t, dt)
		tweens.step(dt)
		renderer.render(scene, camera)
		raf = requestAnimationFrame(loop)
	}
	raf = requestAnimationFrame(loop)

	return {
		own: true,
		warden,
		actor: (seat) => actors.get(seat) ?? null,
		hit: (seat) => recoil(tweens, actors.get(seat)),
		fall: (seat) => tipOver(tweens, actors.get(seat)),
		shake() {
			if (!REDUCED_MOTION) shakeT = MOTION.slamShake.time
		},
		setParty: placeParty,
		dispose() {
			cancelAnimationFrame(raf)
			removeEventListener('resize', resize)
			tweens.clear()
			scene.traverse((o) => {
				if (o.geometry) o.geometry.dispose()
			})
			renderer.dispose()
			wrap.remove()
			if (worldWasVisible) world?.show?.()
		},
	}
}
