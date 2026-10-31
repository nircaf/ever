// EVER world: exploration mode (Ashbrook) and the 3D stage combat re-frames.
// OWNER: world engineer. Contract: createWorld(el, ctx) -> WorldApi (core/contracts.js
// section 5). One WebGL canvas for both modes; combat moves the camera to the gate arena.
//
// What lives here: the village scene from the art kit, the player (WASD / arrows /
// click-or-tap to walk, collisions), Marcus with his idle loop and trust name tag, the
// dormant Warden, station visuals that follow the book, other players' avatars
// (interpolated, name tags, "talking to Marcus"), the combat camera + actor slots, and
// EV.ENTER_RANGE / EV.INTERACT for whoever draws the panels.
//
// Two UI modes:
//   'core'  (default when core/game.js is running): core/ui draws the HUD, prompts and
//           panels. The world only walks, renders, emits EV.INTERACT on click/tap, and
//           freezes movement while a core panel/screen is open.
//   'world' (standalone): ./ui.js draws the HUD, prompts, station panels, Marcus
//           dialogue, pickers and deck viewer itself, dispatching BookActions to the
//           store; the world also sends co-op moves and visit actions. Used when no core
//           UI exists (previews, tests), or force it with ctx.ui = 'world'.
//
// ctx (all optional):
//   bus      app bus (default: contracts.bus)
//   ui       'core' | 'world' (default: auto, decided on first activation)
//   store    BookStore (world UI mode). Falls back to globalThis.__ever.store.
//   net      NetClient in co-op (or world.setNet(net)). Falls back to __ever.session.net.
//   bridge   AI bridge client (world UI mode; default createBridgeClient(location.origin)).
//   onFight  () => void for the solo "Fight" button (world UI mode).
//
// Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later

import * as THREE from 'three'
import {
	ASHBROOK,
	CAMERA,
	CHARACTERS,
	COMBAT_STAGE,
	MOTION,
	REDUCED_MOTION,
	configureRenderer,
	frameCombat,
	followCamera,
	makeCamera,
	makeEnemy,
	makeFog,
	makeGroundTile,
	makeBook,
	makeHammer,
	makeLantern,
	makeLightRig,
	makeSky,
	makeTable,
	pickQuality,
	easeInOut,
} from '../shared/style.js'
import {EV, SPAWN, STATIONS, bus as appBus, createBridgeClient, trustWord} from '../core/contracts.js'
import {
	LAYOUT,
	approachPoint,
	buildColliders,
	createMoveTarget,
	dampAngle,
	heightAt,
	inputVector,
	resolve,
	stationAt,
	step,
	stepBackFromGate,
	toLocal,
	yawOf,
} from './nav.js'
import {buildVillage} from './scene.js'
import {createWorldUi} from './ui.js'
import {peerTag} from './guide.js'
import {disposeIcons} from './card-art.js'

const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])
/** Where the party is put back after a fight: just south of the circle. */
const AFTER_FIGHT = [0, -17.6]

/**
 * @param {HTMLElement} el   the #world container (holds the ONE WebGL canvas)
 * @param {{bus?: any, store?: any, net?: any, bridge?: any, onFight?: () => void}} [ctx]
 * @returns {import('../core/contracts.js').WorldApi & {setNet(net: any): void, setLocalSeat(seat: number): void, interact(station: string): void}}
 */
export function createWorld(el, ctx = {}) {
	const bus = ctx.bus || appBus
	const getStore = () => ctx.store || globalThis.__ever?.store || null
	let net = ctx.net || null
	const getNet = () => net || globalThis.__ever?.session?.net || null
	let bridge = ctx.bridge || null

	// ---- renderer, scene, rig -----------------------------------------------------------
	const quality = pickQuality()
	const renderer = new THREE.WebGLRenderer({antialias: quality !== 'low', powerPreference: 'high-performance'})
	configureRenderer(renderer, quality)
	el.appendChild(renderer.domElement)
	renderer.domElement.style.touchAction = 'none'

	const scene = new THREE.Scene()
	const rig = makeLightRig(scene, {quality})
	makeFog(scene, 'explore')
	const sky = makeSky()
	scene.add(sky)
	const village = buildVillage({quality})
	scene.add(village.root)
	const S = village.stations

	// Marcus's anvil sits beside him (the kit's forge puts it 2.6 u away from GDD (-13,0)).
	{
		const F = LAYOUT.forge
		const [lx, lz] = toLocal(LAYOUT.anvil[0], LAYOUT.anvil[1], F.pos[0], F.pos[1], F.rot)
		S.forge.parts.anvil.position.set(lx, 0.2, lz)
	}

	const marcus = CHARACTERS.marcus()
	marcus.position.set(STATIONS.marcus.pos[0], heightAt(...STATIONS.marcus.pos), STATIONS.marcus.pos[1])
	marcus.faceTowards(LAYOUT.anvil[0], LAYOUT.anvil[1])
	marcus.userData.pick = 'marcus'
	// He stands under the forge roof: let the roof shadow fall around him, not on him (QA:
	// he read as a dark shape).
	marcus.traverse((o) => o.isMesh && (o.receiveShadow = false))
	scene.add(marcus)
	const marcusRestYaw = marcus.rotation.y

	const warden = makeEnemy('ashWarden')
	warden.position.set(COMBAT_STAGE.wardenDormant[0], 0, COMBAT_STAGE.wardenDormant[1])
	warden.setPose('dormant')
	scene.add(warden)

	// click-to-move marker: a small dusk ring on the ground
	const marker = makeGroundTile({radius: 0.32, sides: 6, colorKey: 'dusk', seed: 401, height: 0.04})
	marker.visible = false
	scene.add(marker)

	const colliders = buildColliders()
	const camera = makeCamera(1, 'explore')

	// ---- occluder fade --------------------------------------------------------------------
	// Houses and the big trees fade to a ghost when they stand between the camera and what
	// you are looking at (player, station in range, the fight), or crowd the near edge of
	// the frame. Kit materials are shared, so each faded mesh gets its own clone.
	const occluders = (village.occluders || []).map((obj) => {
		obj.updateMatrixWorld(true)
		const meshes = []
		obj.traverse((o) => o.isMesh && !Array.isArray(o.material) && meshes.push({mesh: o, orig: o.material, faded: null}))
		return {box: new THREE.Box3().setFromObject(obj).expandByScalar(0.2), meshes, alpha: 1, want: 1}
	})
	const occ = {acc: 1, ray: new THREE.Ray(), hit: new THREE.Vector3(), d: new THREE.Vector3(), frustum: new THREE.Frustum(), m: new THREE.Matrix4()}
	const focusPts = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
	function segmentHits(box, from, to) {
		occ.d.subVectors(to, from)
		const len = occ.d.length()
		if (len < 1e-3) return false
		occ.ray.origin.copy(from)
		occ.ray.direction.copy(occ.d).divideScalar(len)
		return !!occ.ray.intersectBox(box, occ.hit) && occ.hit.distanceTo(from) < len - 0.4
	}
	function setAlpha(o) {
		for (const m of o.meshes) {
			if (o.alpha >= 0.999) {
				m.mesh.material = m.orig
				continue
			}
			if (!m.faded) {
				m.faded = m.orig.clone()
				m.faded.transparent = true
			}
			m.faded.opacity = o.alpha * (m.orig.opacity ?? 1)
			m.mesh.material = m.faded
		}
	}
	/** @param {number} dt @param {THREE.Vector3[]} pts focus points, the first one is the main subject */
	function updateOccluders(dt, pts) {
		occ.acc += dt
		if (occ.acc >= 0.1) {
			occ.acc = 0
			camera.updateMatrixWorld()
			occ.m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
			occ.frustum.setFromProjectionMatrix(occ.m)
			const cam = camera.position
			const near = cam.distanceTo(pts[0]) * 0.55
			for (const o of occluders) {
				const hide = occ.frustum.intersectsBox(o.box) && (o.box.distanceToPoint(cam) < near || pts.some((p) => segmentHits(o.box, cam, p)))
				o.want = hide ? 0.22 : 1
			}
		}
		const k = 1 - Math.exp(-dt * 10)
		for (const o of occluders) {
			if (o.alpha === o.want) continue
			o.alpha += (o.want - o.alpha) * k
			if (Math.abs(o.alpha - o.want) < 0.01) o.alpha = o.want
			setAlpha(o)
		}
	}

	// ---- book cover (ART_BIBLE 5: the closed book on a table, same rig) ---------------------
	// Built past the south edge of the village page, so the village sits in the fog behind it.
	const COVER_AT = [0, 0, 44]
	const coverRoot = new THREE.Group()
	coverRoot.name = 'ever:cover'
	coverRoot.position.set(...COVER_AT)
	const table = makeTable()
	const coverBook = makeBook()
	coverBook.position.set(-0.1, 0.02, 0.05)
	coverBook.rotation.y = 0.18
	const lamp = makeLantern({lit: true, post: false})
	lamp.position.set(-1.55, 0.05, -0.9)
	const tobinHammer = makeHammer({size: 0.9})
	tobinHammer.position.set(1.25, 0.06, 0.75)
	tobinHammer.rotation.set(Math.PI / 2, 0, 1.1)
	coverRoot.add(table, coverBook, lamp, tobinHammer)
	coverRoot.visible = false
	scene.add(coverRoot)
	const cover = {on: false, open: 0, openTarget: 0, push: 0, resolve: null}
	function frameCover() {
		const c = CAMERA.cover
		const wide = camera.aspect > 1.15 && (el.clientWidth || innerWidth) >= 900 // matches core.css
		const portrait = camera.aspect < 0.9
		// wide screens: the book sits left of the title page; phones: above it
		const k = easeInOut(cover.push)
		const sx = (wide ? 1.75 : 0) * (1 - k) // the page turn centres the open book
		const lift = portrait ? -2.4 : 0 // portrait: the book sits above the title page
		const back = portrait ? 2.5 : 1.55
		const px = c.position[0] + sx, py = c.position[1] * back - k * 2.4, pz = c.position[2] * back - k * 2.2
		camera.fov = c.fov
		camera.updateProjectionMatrix()
		camera.position.set(COVER_AT[0] + px, COVER_AT[1] + py, COVER_AT[2] + pz)
		camera.lookAt(COVER_AT[0] + c.target[0] + sx - 0.8 * k, COVER_AT[1] + c.target[1] + lift * (1 - k), COVER_AT[2] + c.target[2])
	}
	function setCover(on) {
		on = !!on
		if (on === cover.on) return
		cover.on = on
		coverRoot.visible = on
		cover.open = cover.openTarget = 0
		cover.push = 0
		coverBook.setOpen(0)
		cover.resolve?.()
		cover.resolve = null
		if (on) {
			rig.follow(COVER_AT[0], COVER_AT[2])
			frameCover()
		} else {
			camera.fov = CAMERA.explore.fov
			camera.updateProjectionMatrix()
			teleport(me.x, me.z)
		}
		refreshActive()
	}
	/** Open the cover (page turn, ART_BIBLE 10: 600 ms). Resolves when done. */
	function openBook() {
		if (!cover.on) return Promise.resolve()
		if (REDUCED_MOTION) {
			cover.open = cover.openTarget = 1
			cover.push = 1
			coverBook.setOpen(1)
			return Promise.resolve()
		}
		cover.openTarget = 1
		return new Promise((res) => (cover.resolve = res))
	}
	function updateCover(dt) {
		if (cover.open < cover.openTarget) {
			cover.open = Math.min(cover.openTarget, cover.open + dt / 0.6)
			cover.push = cover.open
			coverBook.setOpen(easeInOut(cover.open))
			if (cover.open >= cover.openTarget && cover.resolve) {
				const r = cover.resolve
				cover.resolve = null
				r()
			}
		}
		frameCover()
	}

	// ---- player -------------------------------------------------------------------------
	let mySeat = 0
	let player = CHARACTERS.player(1)
	scene.add(player)
	const me = {x: SPAWN[0], z: SPAWN[1], yaw: Math.PI, walking: false}
	;[me.x, me.z] = resolve(me.x, me.z, colliders)
	const camTarget = new THREE.Vector3(me.x, 0, me.z)
	const look = new THREE.Vector3()
	const moveTarget = createMoveTarget()
	const keys = new Set()

	function placePlayer() {
		player.position.set(me.x, heightAt(me.x, me.z), me.z)
		player.rotation.y = me.yaw
	}
	placePlayer()

	function setLocalSeat(seat) {
		if (!Number.isInteger(seat) || seat === mySeat) return
		mySeat = seat
		const old = player
		player = CHARACTERS.player(seat + 1)
		scene.remove(old)
		freeObject(old)
		scene.add(player)
		placePlayer()
		peers.get(seat) && removePeer(seat)
	}

	// ---- peers (co-op) -------------------------------------------------------------------
	/** @type {Map<number, {char: any, x: number, z: number, yaw: number, tx: number, tz: number, tyaw: number, walking: boolean, name: string, talking: boolean, connected: boolean, inFight: boolean, tag: HTMLElement, tagText: string}>} */
	const peers = new Map()

	function upsertPeer(seat, p) {
		if (!Number.isInteger(seat) || seat < 0 || seat > 3) return
		const n = getNet()
		if (n && Number.isInteger(n.seat)) setLocalSeat(n.seat)
		if (seat === mySeat && n) return // never draw myself as a peer
		let peer = peers.get(seat)
		if (!peer) {
			const char = CHARACTERS.player(seat + 1)
			char.userData.seat = seat
			scene.add(char)
			const tag = document.createElement('div')
			tag.className = 'ever-nametag'
			tag.style.setProperty('--seat', `var(--ever-seat-${seat + 1})`)
			tag.hidden = true
			tagLayer.append(tag)
			peer = {char, x: p.x, z: p.z, yaw: p.yaw || 0, tx: p.x, tz: p.z, tyaw: p.yaw || 0, walking: false, name: p.name || 'Reader', talking: false, connected: true, inFight: false, tag, tagText: ''}
			peers.set(seat, peer)
		}
		if (Number.isFinite(p.x) && Number.isFinite(p.z)) {
			peer.tx = p.x
			peer.tz = p.z
		}
		if (Number.isFinite(p.yaw)) peer.tyaw = p.yaw
		if (p.walking !== undefined) peer.walking = !!p.walking
		if (p.name) peer.name = p.name
	}

	function removePeer(seat) {
		const peer = peers.get(seat)
		if (!peer) return
		scene.remove(peer.char)
		freeObject(peer.char)
		peer.tag.remove()
		peers.delete(seat)
	}

	let room = null
	function onRoom(r) {
		room = r || null
		const n = getNet()
		if (n && Number.isInteger(n.seat)) setLocalSeat(n.seat)
		ui?.setRoom(room)
		if (!room) {
			if (ownUi()) for (const s of [...peers.keys()]) removePeer(s)
			return
		}
		const seen = new Set()
		for (const s of room.seats) {
			if (s.seat === mySeat) continue
			seen.add(s.seat)
			const peer = peers.get(s.seat)
			if (!peer) continue
			peer.name = s.name
			peer.talking = !!s.talking
			peer.connected = !!s.connected
			peer.inFight = !!s.inFight
		}
		if (ownUi()) for (const s of [...peers.keys()]) if (!seen.has(s)) removePeer(s)
		syncWarden()
	}

	// ---- book -> visuals ----------------------------------------------------------------
	let book = null
	let bookKey = null
	const visitSent = new Set()

	function syncBook(b) {
		if (!b) return
		const key = `${b.seed}:${b.bookNo}`
		if (bookKey && key !== bookKey) {
			// a new book opens on page one (GDD 1.1 / 7.3 death in co-op)
			visitSent.clear()
			teleport(SPAWN[0], SPAWN[1])
			me.yaw = Math.PI
		}
		bookKey = key
		book = b
		const epi = b.status === 'epilogue'
		for (const k of ['well', 'lectern', 'grindstone', 'shrine']) S[k].setUsed(epi || !!b.used?.[k])
		const warm = (b.marcus?.trust ?? 0) >= 2 || !!b.marcus?.flags?.emberGiven
		S.forge.setLanternLit(warm)
		S.forge.setHearthLit(warm || (epi && (b.marcus?.trust ?? 0) >= 1))
		syncWarden()
		ui?.syncBook(b)
	}

	let gateOpenTarget = 0
	let gateOpen = 0
	function wardenDefeated() {
		return room?.warden?.state === 'defeated' || book?.status === 'won' || book?.status === 'epilogue'
	}
	function syncWarden() {
		if (stage === 'combat') return
		const gone = wardenDefeated()
		warden.visible = !gone
		gateOpenTarget = gone ? 1 : 0
		if (!gone) {
			warden.position.set(COMBAT_STAGE.wardenDormant[0], 0, COMBAT_STAGE.wardenDormant[1])
			warden.rotation.y = 0
			if (warden.getPose() !== 'dormant') warden.setPose('dormant')
		}
	}

	// ---- UI -------------------------------------------------------------------------------
	// Name tags live in their own click-through layer under the HUD (z 5 < core HUD 10).
	const tagLayer = document.createElement('div')
	tagLayer.className = 'ever-ui'
	tagLayer.style.cssText = 'position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:5'
	document.body.append(tagLayer)

	/** @type {ReturnType<typeof createWorldUi>|null} */
	let ui = null
	let uiMode = ctx.ui === 'world' || ctx.ui === 'core' ? ctx.ui : null
	/** Decide once, on first activation: core/game.js present => core draws the UI. */
	function resolveUiMode() {
		if (uiMode) return uiMode
		uiMode = globalThis.__ever?.game ? 'core' : 'world'
		if (uiMode === 'world') {
			bridge ||= createBridgeClient({origin: typeof location !== 'undefined' ? location.origin : ''})
			ui = createWorldUi({
				bus,
				getStore,
				bridge,
				getNet,
				getSeat: () => (getNet() ? mySeat : 0),
				onInteract: (s) => interact(s),
				onFight: () => fight(),
				onStepBack: () => {
					const [x, z] = stepBackFromGate(me.x, me.z, colliders)
					moveTarget.set(x, z)
					showMarker(x, z)
				},
			})
			if (book) ui.syncBook(book)
			if (room) ui.setRoom(room)
		}
		return uiMode
	}
	const ownUi = () => uiMode === 'world'
	/** Core UI: a modal, dialogue or full screen in #ui freezes walking. */
	const coreBlocks = () => !!document.querySelector('#ui .ever-modal, #ui .ever-dialogue, #ui .ever-screen')
	const blocksMovement = () => (ui ? ui.blocksMovement() : coreBlocks())
	let blockCheckT = -1
	let blockCached = false
	/** blocksMovement() checked at most 5 times a second (used every frame for the tags). */
	const blockedFrame = () => {
		const now = performance.now()
		if (now - blockCheckT > 200) {
			blockCheckT = now
			blockCached = blocksMovement()
		}
		return blockCached
	}
	let talkCheckT = 0
	let talkCached = false
	/** A Marcus dialogue is open and we stand by him (checked at most 5 times a second). */
	const talkingFrame = () => {
		const now = performance.now()
		if (now - talkCheckT > 200) {
			talkCheckT = now
			talkCached = range === 'marcus' && !!document.querySelector('.ever-dialogue')
		}
		return talkCached
	}

	async function fight() {
		if (ctx.onFight) return ctx.onFight()
		const modes = globalThis.__ever?.modes
		if (!modes) return bus.emit(EV.INTERACT, {station: 'gate', fight: true})
		try {
			await modes.startCombat({enemyId: 'ashWarden'})
		} catch (err) {
			console.warn('[world] combat could not start', err)
			modes.showWorld()
		}
	}

	function interact(station) {
		if (!active() || !station) return
		bus.emit(EV.INTERACT, {station})
		ui?.open(station)
	}

	// ---- input --------------------------------------------------------------------------
	let shown = false
	let stage = 'explore'
	let stageSet = false // main.js shows the village behind the cover before any stage
	let mode = null
	const active = () => shown && stageSet && !cover.on && stage === 'explore' && mode !== 'title' && mode !== 'end' && mode !== 'combat'
	const refreshActive = () => {
		const a = active()
		if (a) resolveUiMode()
		ui?.setVisible(a)
		if (!a) {
			keys.clear()
			moveTarget.clear()
			marker.visible = false
		} else if (ownUi()) {
			const s = getStore()
			if (s) syncBook(s.get())
		}
	}

	function onKeyDown(e) {
		if (!active()) return
		if (ui?.keydown(e)) return
		const t = e.target
		if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
		if (e.metaKey || e.ctrlKey || e.altKey) return
		if (MOVE_KEYS.has(e.code)) {
			keys.add(e.code)
			moveTarget.clear()
			marker.visible = false
			if (e.code.startsWith('Arrow')) e.preventDefault()
		} else if (e.code === 'KeyE' && ownUi() && range && range !== 'gate') {
			// (core UI mode: core/game.js handles E itself)
			e.preventDefault()
			interact(range)
		}
	}
	const onKeyUp = (e) => keys.delete(e.code)
	const onBlur = () => keys.clear()

	const raycaster = new THREE.Raycaster()
	const ndc = new THREE.Vector2()
	const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
	const hit = new THREE.Vector3()
	const pickables = [marcus, S.well, S.grindstone, S.lectern, S.shrine, S.forge, S.gate]
	S.forge.userData.pick = 'marcus'
	for (const k of ['well', 'grindstone', 'lectern', 'shrine', 'gate']) S[k].userData.pick = k

	function pickAt(clientX, clientY) {
		const r = renderer.domElement.getBoundingClientRect()
		ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1)
		raycaster.setFromCamera(ndc, camera)
		for (const h of raycaster.intersectObjects(pickables, true)) {
			if (h.object.isPoints) continue
			let o = h.object
			while (o && !o.userData.pick) o = o.parent
			if (o) return {station: o.userData.pick}
		}
		return raycaster.ray.intersectPlane(ground, hit) ? {x: hit.x, z: hit.z} : null
	}

	function showMarker(x, z) {
		marker.position.set(x, 0.02, z)
		marker.visible = true
	}

	// Pointer input is read on the document, not the canvas, so a transparent full-screen
	// layer above it (HUD roots, slots) cannot swallow clicks. Anything that looks like UI
	// keeps its own clicks.
	const UI_SEL = 'button, a, input, textarea, select, label, [role=button], [role=dialog], .ever-panel, .ever-pill, .ever-hud, .ever-party, .ever-hint, .ever-prompt, .ever-card, .ever-modal, .ever-dialogue, .ever-screen, .ever-page, .ever-toast, #combat'
	const onWorld = (e) => e.target === renderer.domElement || (e.target instanceof Element && !e.target.closest(UI_SEL))
	let down = null
	function onPointerDown(e) {
		if (!active() || blocksMovement() || !onWorld(e) || e.button > 0) return
		down = {x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId}
	}
	function onPointerUp(e) {
		if (!down || down.id !== e.pointerId) return
		const d = down
		down = null
		if (!active() || blocksMovement() || !onWorld(e)) return
		if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 12 || performance.now() - d.t > 700) return
		const p = pickAt(e.clientX, e.clientY)
		if (!p) return
		if (p.station) {
			if (p.station === range || (p.station === 'gate' && stationAt(me.x, me.z) === 'gate')) return interact(p.station)
			const [x, z] = approachPoint(p.station, me.x, me.z)
			moveTarget.set(x, z, () => stationAt(me.x, me.z) === p.station && p.station !== 'gate' && interact(p.station))
			showMarker(x, z)
		} else {
			moveTarget.set(p.x, p.z)
			showMarker(...resolve(p.x, p.z, colliders))
		}
	}
	let hoverT = 0
	function onPointerMove(e) {
		if (e.pointerType !== 'mouse' || !active() || e.buttons) return
		const now = performance.now()
		if (now - hoverT < 90) return
		hoverT = now
		const over = onWorld(e) && !blocksMovement() && pickAt(e.clientX, e.clientY)?.station
		document.documentElement.classList.toggle('ever-world-pick', !!over)
	}
	// cursor hint for clickable stations (any overlay inherits it from <html>)
	const cursorStyle = document.createElement('style')
	cursorStyle.textContent = 'html.ever-world-pick, html.ever-world-pick body { cursor: pointer; }'
	document.head.append(cursorStyle)

	addEventListener('keydown', onKeyDown)
	addEventListener('keyup', onKeyUp)
	addEventListener('blur', onBlur)
	document.addEventListener('pointerdown', onPointerDown)
	document.addEventListener('pointerup', onPointerUp)
	document.addEventListener('pointermove', onPointerMove)

	// ---- bus ----------------------------------------------------------------------------
	const offs = [
		bus.on(EV.BOOK_CHANGED, ({book: b} = {}) => b && syncBook(b)),
		bus.on(EV.ROOM, ({room: r} = {}) => onRoom(r)),
		bus.on(EV.PEER_MOVE, (p = {}) => upsertPeer(p.seat, p)),
		bus.on(EV.NET_STATUS, ({status} = {}) => {
			if (status === 'closed' || status === 'idle') setLocalSeat(0)
		}),
		bus.on(EV.MODE, ({mode: m} = {}) => {
			mode = m
			refreshActive()
		}),
	]

	// ---- resize -------------------------------------------------------------------------
	const resize = () => {
		const w = el.clientWidth || innerWidth
		const h = el.clientHeight || innerHeight
		renderer.setSize(w, h, false)
		camera.aspect = w / Math.max(1, h)
		camera.updateProjectionMatrix()
	}
	const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null
	ro?.observe(el)
	addEventListener('resize', resize)
	resize()

	// ---- stage (explore / combat camera) ------------------------------------------------
	let camAnim = null
	function slotOf(seat) {
		return COMBAT_STAGE.players[Math.max(0, Math.min(3, seat))]
	}
	function stageActors() {
		const wp = COMBAT_STAGE.warden
		warden.visible = true
		warden.position.set(wp[0], 0, wp[1])
		const fighters = [[mySeat, player]]
		for (const [seat, p] of peers) if (p.inFight) fighters.push([seat, p.char])
		let cx = 0
		let cz = 0
		for (const [seat, char] of fighters) {
			const [x, z] = slotOf(seat)
			char.position.set(x, 0, z)
			char.faceTowards(wp[0], wp[1])
			char.setWalking(false)
			cx += x / fighters.length
			cz += z / fighters.length
		}
		warden.rotation.y = Math.atan2(cx - wp[0], cz - wp[1])
		warden.setPose('idle')
	}

	function setStage(next) {
		stageSet = true
		if (cover.on) setCover(false)
		if (next === stage && next === 'explore') return refreshActive()
		stage = next
		if (next === 'combat') {
			ui?.close()
			keys.clear()
			moveTarget.clear()
			marker.visible = false
			makeFog(scene, 'combat')
			camAnim = {t: 0, from: {position: camera.position.clone(), target: look.clone()}}
			gateOpenTarget = 1
			stageActors()
			rig.follow(-0.5, -22.5)
		} else {
			camAnim = null
			makeFog(scene, 'explore')
			camera.fov = CAMERA.explore.fov
			camera.updateProjectionMatrix()
			if (Math.hypot(me.x - STATIONS.gate.pos[0], me.z - STATIONS.gate.pos[1]) < STATIONS.gate.radius + 1.5) teleport(...AFTER_FIGHT)
			range = null
			placePlayer()
			syncWarden()
		}
		refreshActive()
	}

	// ---- frame loop -----------------------------------------------------------------------
	let running = false
	let raf = 0
	let last = 0
	let clock = 0
	let secAcc = 0
	let range = null
	let sentStill = true
	let sendAcc = 0
	const tagPos = new THREE.Vector3()
	let marcusTag = null
	let shakeT = 0
	let shakeAmt = 0
	let shakeDur = 1
	let marcusTagText = ''

	function updateRange() {
		const s = active() ? stationAt(me.x, me.z) : null
		if (s === range) return
		range = s
		ui?.setRange(s)
		bus.emit(EV.ENTER_RANGE, {station: s})
		// core UI mode: core/game.js sends the visits itself
		if (ownUi() && s && book && !book.visited?.[s] && !visitSent.has(s) && s in (book.visited || {})) {
			visitSent.add(s)
			getStore()?.dispatch({type: 'visit', place: s}).catch?.(() => {})
		}
	}

	function walk(dt) {
		let dir = [0, 0]
		if (active() && !blocksMovement()) {
			dir = inputVector(keys)
			if (!dir[0] && !dir[1]) {
				const r = moveTarget.update(me.x, me.z, dt)
				dir = r.dir
				if (r.arrived || !moveTarget.target) marker.visible = false
				if (r.onArrive) r.onArrive()
			}
		}
		const moving = Math.hypot(dir[0], dir[1]) > 1e-4
		if (moving) {
			const [x, z] = step(me.x, me.z, dir[0], dir[1], dt, colliders)
			me.x = x
			me.z = z
			me.yaw = dampAngle(me.yaw, yawOf(dir[0], dir[1]), 1 / MOTION.turnTime, dt)
		}
		me.walking = moving
		player.setWalking(moving)
		placePlayer()
		updateRange()
		// co-op (world UI mode; core/game.js sends them otherwise): my position at most
		// 10 Hz while moving, plus once on stop
		const n = ownUi() ? getNet() : null
		if (n?.sendMove) {
			sendAcc += dt
			if ((moving && sendAcc >= 0.1) || (!moving && !sentStill)) {
				n.sendMove(Math.round(me.x * 100) / 100, Math.round(me.z * 100) / 100, Math.round(me.yaw * 100) / 100, moving)
				sendAcc = 0
				sentStill = !moving
			}
		}
	}

	function updatePeers(dt) {
		const k = 1 - Math.exp(-12 * dt)
		for (const p of peers.values()) {
			p.char.visible = p.connected
			if (stage === 'combat' && p.inFight) {
				p.char.update(clock, dt)
				continue
			}
			p.x += (p.tx - p.x) * k
			p.z += (p.tz - p.z) * k
			p.yaw = dampAngle(p.yaw, p.tyaw, 14, dt)
			p.char.position.set(p.x, heightAt(p.x, p.z), p.z)
			p.char.rotation.y = p.yaw
			p.char.setWalking(p.walking && Math.hypot(p.tx - p.x, p.tz - p.z) > 0.05)
			p.char.update(clock, dt)
		}
	}

	function project(obj, y, tagEl) {
		tagPos.set(obj.position.x, obj.position.y + y, obj.position.z).project(camera)
		const vis = tagPos.z < 1 && Math.abs(tagPos.x) < 1.05 && Math.abs(tagPos.y) < 1.05
		tagEl.hidden = !vis
		if (!vis) return
		const w = renderer.domElement.clientWidth
		const h = renderer.domElement.clientHeight
		tagEl.style.left = `${((tagPos.x + 1) / 2) * w}px`
		tagEl.style.top = `${((1 - tagPos.y) / 2) * h}px`
	}

	function updateTags() {
		// Tags float above the canvas; hide them while a panel, dialogue or screen is up so
		// they never sit on top of the paper UI.
		const showTags = active() && !blockedFrame()
		for (const p of peers.values()) {
			if (!showTags || !p.connected) {
				p.tag.hidden = true
				continue
			}
			const text = peerTag(p.name, p.talking)
			if (text !== p.tagText) p.tag.textContent = p.tagText = text
			project(p.char, 2.25, p.tag)
		}
		// Marcus: name with the trust word under it (GDD 6 HUD)
		if (!marcusTag) {
			marcusTag = document.createElement('div')
			marcusTag.className = 'ever-nametag'
			marcusTag.style.cssText = '--seat: var(--ever-dusk); text-align: center'
			tagLayer.append(marcusTag)
		}
		const near = Math.hypot(me.x - marcus.position.x, me.z - marcus.position.z) < 12
		if (!showTags || !near || !book) {
			marcusTag.hidden = true
			return
		}
		const name = book.marcus?.flags?.met ? 'Marcus Hale' : 'The smith'
		const word = trustWord(book.marcus?.trust ?? 0)
		const text = name + '|' + word
		if (text !== marcusTagText) {
			marcusTagText = text
			const small = document.createElement('span')
			small.style.cssText = 'display:block;font-weight:600;opacity:.75'
			small.textContent = word
			marcusTag.replaceChildren(name, small)
		}
		project(marcus, 2.75, marcusTag)
	}

	function updateMarcus(dt) {
		const d = Math.hypot(me.x - marcus.position.x, me.z - marcus.position.z)
		const want = d < 5.5 && stage === 'explore' ? Math.atan2(me.x - marcus.position.x, me.z - marcus.position.z) : marcusRestYaw
		marcus.rotation.y = dampAngle(marcus.rotation.y, want, 4, dt)
		marcus.update(clock, dt)
	}

	function frame(now) {
		if (!running) return
		raf = requestAnimationFrame(frame)
		const dt = Math.min(0.1, Math.max(0, (now - last) / 1000))
		last = now
		clock += dt

		if (stage === 'explore') walk(dt)
		updatePeers(dt)
		updateMarcus(dt)
		player.update(clock, dt)
		warden.update(clock, dt)
		S.grindstone.update(clock, dt)
		S.shrine.update(clock, dt)
		S.gate.update(clock, dt)
		gateOpen += (gateOpenTarget - gateOpen) * (1 - Math.exp(-dt * 3))
		S.gate.setOpen(gateOpen)
		if (marker.visible) marker.rotation.y += dt

		if (cover.on) {
			updateCover(dt)
		} else if (stage === 'combat' && camAnim) {
			camAnim.t = Math.min(1, camAnim.t + dt / MOTION.combatCameraMove)
			frameCombat(camera, camera.aspect, camAnim.t, camAnim.from)
			if (shakeT > 0) {
				shakeT = Math.max(0, shakeT - dt)
				const a = shakeAmt * (shakeT / shakeDur)
				camera.position.x += (Math.random() - 0.5) * 2 * a
				camera.position.y += (Math.random() - 0.5) * 2 * a
			}
		} else {
			camTarget.set(me.x, heightAt(me.x, me.z), me.z)
			// While talking, frame the player and Marcus above the bottom dialogue panel.
			if (talkingFrame()) camTarget.set((me.x + marcus.position.x) / 2, 0, (me.z + marcus.position.z) / 2 + 3.2)
			followCamera(camera, camTarget, dt)
			look.set(me.x + CAMERA.explore.lookAhead[0], camTarget.y + CAMERA.explore.lookAhead[1], me.z + CAMERA.explore.lookAhead[2])
			rig.follow(me.x, me.z)
		}
		sky.position.copy(camera.position)
		if (!cover.on) {
			if (stage === 'combat') {
				const wp = COMBAT_STAGE.warden
				focusPts[0].set(wp[0], 1.6, wp[1])
				focusPts[1].set(COMBAT_STAGE.players[0][0], 1, COMBAT_STAGE.players[0][1])
				focusPts[2].set(COMBAT_STAGE.players[3][0], 1, COMBAT_STAGE.players[3][1])
			} else {
				focusPts[0].set(me.x, heightAt(me.x, me.z) + 1.1, me.z)
				focusPts[1].set(me.x, 0.3, me.z)
				const st = range && STATIONS[range]
				if (st) focusPts[2].set(st.pos[0], 1, st.pos[1])
				else focusPts[2].copy(focusPts[1])
			}
			updateOccluders(dt, focusPts)
		}
		updateTags()

		secAcc += dt
		if (secAcc >= 1) {
			secAcc = 0
			if (active()) ui?.tick()
		}
		renderer.render(scene, camera)
	}

	function teleport(x, z) {
		;[me.x, me.z] = resolve(x, z, colliders)
		moveTarget.clear()
		marker.visible = false
		placePlayer()
		camTarget.set(me.x, 0, me.z)
		followCamera(camera, camTarget, Infinity)
		look.set(me.x + CAMERA.explore.lookAhead[0], CAMERA.explore.lookAhead[1], me.z + CAMERA.explore.lookAhead[2])
		rig.follow(me.x, me.z)
	}
	teleport(me.x, me.z)

	// ---- helpers ------------------------------------------------------------------------
	function freeObject(obj) {
		obj.traverse((o) => o.geometry?.dispose?.())
	}

	return {
		show() {
			el.hidden = false
			shown = true
			if (!running) {
				running = true
				last = performance.now()
				raf = requestAnimationFrame(frame)
			}
			refreshActive()
		},
		hide() {
			running = false
			cancelAnimationFrame(raf)
			shown = false
			el.hidden = true
			refreshActive()
		},
		setStage,
		/** Book cover: the closed 3D book on its table behind the title page (true) or the village (false). */
		setCover,
		/** Page turn on the cover; resolves when the book is open. */
		openBook,
		syncBook,
		getPlayerPos: () => ({x: me.x, z: me.z, yaw: me.yaw}),
		upsertPeer,
		removePeer,
		getWardenActor: () => warden,
		getPartyActor: (seat) => (seat === mySeat || (!getNet() && seat === 0) ? player : peers.get(seat)?.char || null),
		teleport,
		/** co-op: hand the world the NetClient once Host/Join succeeded (null when leaving) */
		setNet(n) {
			net = n || null
			if (net && Number.isInteger(net.seat)) setLocalSeat(net.seat)
			if (!net) {
				setLocalSeat(0)
				onRoom(null)
			}
		},
		setLocalSeat,
		/** combat: Ember Slam camera shake (ART_BIBLE 10; off with reduced motion) */
		shake(amount = MOTION.slamShake.amount, time = MOTION.slamShake.time) {
			if (REDUCED_MOTION || stage !== 'combat') return
			shakeAmt = amount
			shakeDur = shakeT = Math.max(0.01, time)
		},
		/** open a station's panel as if E was pressed (tests, tutorials) */
		interact,
		/** CSS pixel position of a world point on screen, or null when off screen (tests, tutorials) */
		screenPoint(x, y, z) {
			const v = new THREE.Vector3(x, y, z).project(camera)
			if (v.z >= 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1) return null
			const r = renderer.domElement.getBoundingClientRect()
			return {x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height}
		},
		dispose() {
			running = false
			cancelAnimationFrame(raf)
			removeEventListener('keydown', onKeyDown)
			removeEventListener('keyup', onKeyUp)
			removeEventListener('blur', onBlur)
			removeEventListener('resize', resize)
			ro?.disconnect()
			document.removeEventListener('pointerdown', onPointerDown)
			document.removeEventListener('pointerup', onPointerUp)
			document.removeEventListener('pointermove', onPointerMove)
			document.documentElement.classList.remove('ever-world-pick')
			cursorStyle.remove()
			offs.forEach((f) => f())
			ui?.dispose()
			tagLayer.remove()
			disposeIcons()
			const mats = new Set()
			scene.traverse((o) => {
				o.geometry?.dispose?.()
				const m = o.material
				if (Array.isArray(m)) m.forEach((x) => mats.add(x))
				else if (m) mats.add(m)
			})
			// Kit materials are cached and shared; disposing only frees GPU programs (three.js
			// re-uploads them if anything uses them again), so this is safe.
			mats.forEach((m) => m.dispose())
			renderer.renderLists.dispose()
			renderer.dispose()
			renderer.forceContextLoss()
			renderer.domElement.remove()
		},
	}
}
