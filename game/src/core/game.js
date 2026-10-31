// The game flow: cover -> chapter page -> Ashbrook -> gate -> combat -> win / death -> new
// book, solo or in a co-op room. Wires the screens, HUD and panels to the BookStore, the
// world and the combat UI through the contracts. OWNER: systems engineer.
//
// Authority: this file only RENDERS and SENDS. Every deck change is store.dispatch(...);
// in co-op the room decides and we adopt what it sends back.
//
// Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later

import {CLOSE, EV, MSG, SPAWN, STATIONS, cleanName, inStationRange, loadName, saveName} from './contracts.js'
import {createAiController} from './ai.js'
import {COPY} from './copy.js'
import {hintFor} from './rules/book.js'
import {createToaster, h, sleep} from './ui/dom.js'
import {createHud} from './ui/hud.js'
import {createPanels} from './ui/panels.js'
import {chapterScreen, coverScreen, creditsModal, deathScreen, hostScreen, joinScreen, winScreen} from './ui/screens.js'

const TALK_STATIONS = ['marcus', 'well', 'grindstone', 'lectern', 'shrine']
const ALIASES = {forge: 'marcus', anvil: 'marcus'}
const KEYS_TO_IGNORE = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/** Map a rejection from the net client to GDD 6 copy. */
export function roomErrorText(e) {
	const raw = e?.code ?? e?.message ?? e
	const E = COPY.mp.errors
	if (raw === 'no_room' || raw === CLOSE.NO_ROOM) return E.no_room
	if (raw === 'full' || raw === CLOSE.FULL) return E.full
	if (raw === 'version' || raw === CLOSE.VERSION) return E.version
	if (raw === 'name') return E.name
	return E.network
}

/**
 * @param {{els: {world: HTMLElement, combat: HTMLElement, ui: HTMLElement}, world: import('./contracts.js').WorldApi, modes: ReturnType<typeof import('./contracts.js').createModeController>, store: ReturnType<typeof import('./book-store.js').createBookStore>, bus: ReturnType<typeof import('./contracts.js').createBus>, session: {net: any, makeNetDriver: null | ((net: any) => any)}}} deps
 */
export function createGame({els, world, modes, store, bus, session}) {
	// ---- layers -------------------------------------------------------------------
	const slot = (cls) => els.ui.appendChild(h('div', {class: `ever-slot ever-slot--${cls}`}))
	const hudSlot = slot('hud')
	const screenSlot = slot('screen')
	const panelSlot = slot('panel')
	const toast = createToaster(els.ui)
	const fadeEl = document.body.appendChild(h('div', {class: 'ever-fadeout', 'aria-hidden': 'true'}))

	let coverCtl = null
	const ai = createAiController({
		origin: location.origin,
		onChange: () => coverCtl?.paintAi(),
		toast: (t) => toast(t),
		texts: {unavailable: COPY.toasts.aiUnavailable, limit: COPY.toasts.aiLimit},
	})
	const panels = createPanels({root: panelSlot, store, ai, toast})
	const hud = createHud(hudSlot, {
		onDeck: () => panels.openDeck(),
		onPrompt: () => interact(near),
		onCopyCode: copyCode,
		onLeave: () => leaveCoop(),
	})

	const setScreen = (el) => screenSlot.replaceChildren(...(el ? [el] : []))
	const fadeTo = async (on) => {
		fadeEl.classList.toggle('is-on', on)
		await sleep(220)
	}
	/** Short fade around a mode switch. */
	async function transition(fn) {
		await fadeTo(true)
		await fn()
		await fadeTo(false)
	}

	// ---- state --------------------------------------------------------------------
	let near = null // station id in range (for the prompt)
	let wasInGate = false
	const visitedSent = new Set()
	let loop = null
	let combatRunning = false
	let bookKey = ''
	// co-op
	let mySeat = null
	let room = null
	let gateCtl = null
	let winCtl = null
	let winShown = false
	let coopWon = false
	let prevPhase = null
	const peerSeats = new Set()
	let lastSent = null
	let unsubs = []

	const isCoop = () => Boolean(session.net)

	// ---- helpers ------------------------------------------------------------------
	async function copyCode(code) {
		if (!code) return
		try {
			await navigator.clipboard.writeText(code)
			toast(COPY.hud.roomCopied, 'good')
		} catch {
			toast(code)
		}
	}
	const refreshHud = () => {
		const book = store.get()
		hud.update(book)
		hud.setHint(hintFor(book, Date.now()))
	}
	const keyOf = (b) => `${b.bookNo}:${b.seed}`

	store.subscribe((book, effects) => {
		hud.update(book)
		hud.setHint(hintFor(book, Date.now()))
		try {
			world.syncBook(book)
		} catch (err) {
			console.error(err)
		}
		for (const e of effects || []) if (e.k === 'toast') toast(e.text)
		const k = keyOf(book)
		if (k !== bookKey) {
			bookKey = k
			visitedSent.clear()
			if (isCoop() && coopWon) {
				coopWon = false
				winShown = false
				winCtl = null
				startBookFlow({fresh: true}) // the room reset the village: everyone starts a new book
			}
		}
	})
	bookKey = keyOf(store.get())

	// ---- cover --------------------------------------------------------------------
	function showCover() {
		panels.close()
		hud.hide()
		stopLoop()
		world.show()
		world.setCover?.(true) // the closed 3D book on its table (ART_BIBLE 5)
		const cover = coverScreen({
			meta: store.getMeta(),
			ai,
			onSolo: startSolo,
			onHost: showHost,
			onJoin: showJoin,
			onCredits: () => {
				const m = creditsModal({onClose: () => m.remove()})
				panelSlot.append(m)
			},
		})
		coverCtl = cover
		setScreen(cover.el)
		if (ai.enabled) ai.refresh()
	}

	function playChapterPage() {
		return new Promise((resolve) => {
			const ch = chapterScreen({
				onDone: () => {
					setScreen(null)
					resolve()
				},
			})
			setScreen(ch.el)
		})
	}

	// ---- books --------------------------------------------------------------------
	async function startSolo() {
		session.net = null
		store.openNewBook()
		await startBookFlow({fresh: true, chapter: true})
	}

	/** Chapter page (optional) then the village. */
	async function startBookFlow({fresh = true, chapter = true} = {}) {
		panels.close()
		setScreen(null)
		await world.openBook?.() // the cover opens (no-op when the cover is not up)
		if (chapter) await playChapterPage()
		await enterVillage({fresh})
	}

	async function enterVillage({fresh = true} = {}) {
		if (fresh) world.teleport(SPAWN[0], SPAWN[1])
		world.syncBook(store.get())
		visitedSent.clear()
		wasInGate = fresh ? false : true // after "Stay" we stand near the gate: don't re-trigger
		await transition(() => {
			world.setCover?.(false)
			modes.showWorld()
		})
		hud.show()
		refreshHud()
		startLoop()
	}

	// ---- loops: range, prompts, visits, movement ------------------------------------
	function startLoop() {
		stopLoop()
		loop = setInterval(tick, 100)
	}
	function stopLoop() {
		clearInterval(loop)
		loop = null
		near = null
		hud.setPrompt(null)
	}

	let tickN = 0
	function tick() {
		if (modes.mode !== 'world') return
		tickN++
		const p = world.getPlayerPos()
		const book = store.get()

		// nearest interactable in range
		let best = null
		let bestD = Infinity
		for (const id of TALK_STATIONS) {
			if (!inStationRange(id, p.x, p.z, 0)) continue
			const d = Math.hypot(p.x - STATIONS[id].pos[0], p.z - STATIONS[id].pos[1])
			if (d < bestD) (best = id), (bestD = d)
		}
		if (best !== near) near = best
		const canPrompt = near && !panels.isOpen && (book.status === 'exploring' || (book.status === 'epilogue' && near === 'marcus'))
		hud.setPrompt(canPrompt ? COPY.prompts[near] : null)

		// first arrival at a place counts as a visit (hint progression)
		if (book.status === 'exploring') {
			for (const id of ['well', 'marcus', 'grindstone', 'lectern']) {
				if (!visitedSent.has(id) && inStationRange(id, p.x, p.z, 0)) {
					visitedSent.add(id)
					store.dispatch({type: 'visit', place: id})
				}
			}
		}

		// a panel closes when you walk away from its station
		if (panels.isOpen && panels.station && panels.station !== 'gate' && !inStationRange(panels.station, p.x, p.z, 1.5)) panels.close()

		// the gate circle
		const inGate = inStationRange('gate', p.x, p.z, 0)
		if (inGate && !wasInGate && book.status === 'exploring' && !combatRunning && !panels.isOpen) onEnterGate(p)
		if (!inGate && wasInGate && panels.station === 'gate') panels.close()
		wasInGate = inGate
		if (inGate && book.status === 'exploring' && !visitedSent.has('gate')) {
			visitedSent.add('gate')
			store.dispatch({type: 'visit', place: 'gate'})
		}

		if (tickN % 10 === 0) {
			hud.setHint(hintFor(book, Date.now()))
			if (isCoop() && room?.phase === 'epilogue') updateVotes() // e.g. a vote came in while a page was up
		}

		// co-op: share my position (the client throttles to 10 Hz; only send changes)
		if (session.net && session.net.status === 'open') {
			const moved = !lastSent || Math.hypot(p.x - lastSent.x, p.z - lastSent.z) > 0.02 || Math.abs(p.yaw - lastSent.yaw) > 0.02
			const walking = Boolean(lastSent) && Math.hypot(p.x - lastSent.x, p.z - lastSent.z) > 0.02
			if (moved || (lastSent && lastSent.walking && !walking)) {
				session.net.sendMove(p.x, p.z, p.yaw, walking)
				lastSent = {x: p.x, z: p.z, yaw: p.yaw, walking}
			}
		}
	}

	function interact(id) {
		id = ALIASES[id] || id
		if (!id || modes.mode !== 'world' || panels.isOpen) return
		if (id === 'gate') return
		const p = world.getPlayerPos()
		if (!TALK_STATIONS.includes(id) || !inStationRange(id, p.x, p.z, 1)) return
		const book = store.get()
		if (book.status !== 'exploring' && !(book.status === 'epilogue' && id === 'marcus')) return
		hud.setPrompt(null)
		panels.openStation(id)
	}
	bus.on(EV.INTERACT, (e) => interact(e?.station))

	addEventListener('keydown', (e) => {
		if (e.target instanceof Element && KEYS_TO_IGNORE.has(e.target.tagName)) return
		if (e.metaKey || e.ctrlKey || e.altKey) return
		if (e.key === 'e' || e.key === 'E') {
			if (near) interact(near)
		} else if (e.key === 'Tab' && modes.mode === 'world' && !panels.isOpen) {
			e.preventDefault()
			panels.openDeck()
		} else if (e.key === 'Escape' && panels.isOpen) panels.close()
	})

	// ---- the gate and the fight -----------------------------------------------------
	function onEnterGate(p) {
		if (isCoop()) {
			gateCtl = panels.openGateCoop({
				onReady: (ready) => session.net?.send(MSG.GATE, {ready}),
				onLeave: () => {
					gateCtl = null
				},
			})
			if (room) gateCtl.refresh(room, mySeat)
			return
		}
		panels.openGateSolo({
			onFight: startSoloFight,
			onNotYet: () => {
				const q = world.getPlayerPos()
				const [gx, gz] = STATIONS.gate.pos
				world.teleport(q.x, Math.max(q.z + 2, gz + STATIONS.gate.radius + 0.6))
			},
		})
	}

	async function runCombat() {
		combatRunning = true
		stopLoop()
		hud.hide()
		panels.close()
		try {
			await fadeTo(true)
			const p = modes.startCombat({enemyId: 'ashWarden'})
			p.catch(() => {}) // surfaced below, when awaited
			await sleep(60)
			fadeTo(false)
			return await p
		} finally {
			combatRunning = false
		}
	}

	/** After a fight: back to the village scene under the end screen. */
	async function backToVillage(screenEl) {
		await fadeTo(true)
		modes.showWorld()
		setScreen(screenEl)
		await fadeTo(false)
	}

	async function startSoloFight() {
		store.beginFight()
		const fought = store.get()
		let result
		try {
			result = await runCombat()
		} catch (err) {
			console.error(err)
			store.cancelFight()
			toast(COPY.errors.generic, 'bad')
			await fadeTo(false)
			modes.showWorld()
			hud.show()
			startLoop()
			return
		}
		store.finishCombat(result)
		if (result.won) await showWin({fought, result, coop: false})
		else await showDeath({fought, result, coop: false})
	}

	async function startCoopFight() {
		const fought = store.get()
		let result
		try {
			result = await runCombat()
		} catch (err) {
			console.error(err)
			toast(COPY.errors.generic, 'bad')
			await fadeTo(false)
			modes.showWorld()
			hud.show()
			startLoop()
			return
		}
		if (!session.net && !result.won && !result.dead) {
			// The room connection was lost for good mid-fight (leaveCoop already closed the
			// book). Not a death: back to the cover with the network line.
			await backToVillage(null)
			showCover()
			toast(roomErrorText('network'), 'bad')
			return
		}
		store.closeBook({won: result.won, dead: result.dead ?? !result.won}, fought)
		if (result.won) await showWin({fought, result, coop: true})
		else await showDeath({fought, result, coop: true})
	}

	async function showWin({fought, result, coop}) {
		const hp = result.hpLeft ?? store.get().hp
		const turns = result.turns ?? store.get().stats.turns
		winShown = true
		coopWon = coop
		const ctl = winScreen({
			bookNo: fought.bookNo,
			turns,
			hp,
			coop,
			onNew: () => {
				if (coop && session.net) session.net.send(MSG.VOTE, {newBook: true})
				else {
					setScreen(null)
					startSolo()
				}
			},
			onStay: () => {
				setScreen(null)
				winCtl = null
				if (coop) {
					// the room keeps the book; "epilogue.stay" lets Marcus be talked to (GDD 1.1)
					if (store.get().status === 'won') store.dispatch({type: 'epilogue.stay'})
					hud.show()
					startLoop()
				} else {
					store.enterEpilogue()
					world.teleport(0, STATIONS.gate.pos[1] + 5)
					enterVillage({fresh: false})
				}
			},
		})
		winCtl = coop ? ctl : null
		if (coop && room) updateVotes()
		await backToVillage(ctl.el)
		if (coop) {
			hud.show()
			hud.update(store.get())
		}
	}

	async function showDeath({fought, result, coop}) {
		const line = store.getMeta().rememberedLine
		const ctl = deathScreen({
			bookNo: fought.bookNo,
			turn: result.turns ?? 1,
			line,
			coop,
			onNew: () => {
				setScreen(null)
				// co-op: the room already gave this seat a fresh book; if the room is gone, solo.
				if (coop && session.net) startBookFlow({fresh: true})
				else startSolo()
			},
		})
		await backToVillage(ctl)
		if (coop) hud.show()
	}

	// ---- multiplayer ----------------------------------------------------------------
	function showHost() {
		setScreen(
			hostScreen({
				name: loadName(),
				onHost: async (name) => {
					const res = await connectCoop('host', {name})
					return res
				},
				onEnter: () => startBookFlow({fresh: true}),
				onBack: showCover,
				onCopy: copyCode,
				errorText: roomErrorText,
				cleanName,
			}),
		)
	}
	function showJoin() {
		setScreen(
			joinScreen({
				name: loadName(),
				onJoin: async (code, name) => {
					await connectCoop('join', {code, name})
					await startBookFlow({fresh: true})
				},
				onBack: showCover,
				errorText: roomErrorText,
				cleanName,
			}),
		)
	}

	async function connectCoop(kind, {name, code}) {
		// The socket code is only loaded when you host or join; solo never touches it.
		const [{createNetClient}, {createNetCombatDriver}] = await Promise.all([import('../net/client.js'), import('../net/combat-driver.js')])
		const net = createNetClient({bus})
		wireNet(net)
		try {
			const res = kind === 'host' ? await net.hostGame({name}) : await net.joinGame(code, {name})
			session.net = net
			world.setNet?.(net)
			session.makeNetDriver = createNetCombatDriver
			mySeat = res?.seat ?? mySeat
			saveName(name)
			if (!store.coop) store.attachNet(net)
			return res
		} catch (err) {
			unwireNet()
			try {
				net.leave()
			} catch {}
			store.detachNet()
			throw err
		}
	}

	const nameOf = (seat) => room?.seats.find((s) => s.seat === seat)?.name ?? `Reader ${seat + 1}`

	function wireNet(net) {
		unwireNet()
		const on = (type, fn) => unsubs.push(net.on(type, fn))
		on(MSG.WELCOME, (m) => {
			mySeat = m.seat
			store.attachNet(net, m)
			room = m.room
			for (const [seat, x, z, yaw, w] of m.peers || []) if (seat !== mySeat) peer(seat, x, z, yaw, w)
			applyRoom(m.room)
		})
		on(MSG.PEERS, (m) => {
			// The room corrected my position (speed clamp, or respawn at page one): snap to it.
			if (Array.isArray(m.fix) && m.fix.length === 2 && m.fix.every(Number.isFinite)) {
				world.teleport(m.fix[0], m.fix[1])
				lastSent = null
			}
			for (const [seat, x, z, yaw, w] of m.m || []) if (seat !== mySeat) peer(seat, x, z, yaw, w)
		})
		on(MSG.PEER, (m) => {
			if (m.seat === mySeat) return
			const n = m.name || nameOf(m.seat)
			if (m.e === 'join') toast(COPY.mp.joined(n))
			else if (m.e === 'left') {
				toast(COPY.mp.left(n))
				dropPeer(m.seat)
			} else if (m.e === 'drop') toast(COPY.mp.dropped(n))
			else if (m.e === 'back') toast(COPY.mp.back2(n))
		})
		unsubs.push(net.onState((r) => applyRoom(r)))
		unsubs.push(
			bus.on(EV.NET_STATUS, ({status}) => {
				if (status === 'reconnecting') toast(COPY.mp.reconnecting)
				else if (status === 'open' && wasReconnecting) toast(COPY.mp.restored, 'good')
				else if (status === 'closed' && session.net) leaveCoop({silent: true})
				wasReconnecting = status === 'reconnecting'
			}),
		)
	}
	let wasReconnecting = false
	function unwireNet() {
		for (const off of unsubs.splice(0)) off()
	}

	function peer(seat, x, z, yaw, w) {
		peerSeats.add(seat)
		world.upsertPeer(seat, {x, z, yaw, walking: Boolean(w), name: nameOf(seat)})
	}
	function dropPeer(seat) {
		peerSeats.delete(seat)
		world.removePeer(seat)
	}

	let seenVotes = 0
	function updateVotes() {
		if (!room) return
		const votes = room.votes?.newBook ?? []
		// I chose "Stay in Ashbrook" and a friend now asks for a new book: bring the
		// "Chapter complete" page back so I can vote too (the vote needs every connected seat).
		if (!winCtl && room.phase === 'epilogue' && votes.length > seenVotes && !votes.includes(mySeat) && !panels.isOpen && modes.mode === 'world' && !screenSlot.firstChild && store.get().status === 'epilogue') {
			const b = store.get()
			panels.close()
			seenVotes = votes.length
			showWin({fought: b, result: {won: true, hpLeft: b.hp, turns: b.stats.turns}, coop: true})
			return
		}
		if (!(panels.isOpen || screenSlot.firstChild) || winCtl) seenVotes = votes.length
		if (!winCtl) return
		const connected = room.seats.filter((s) => s.connected).length
		winCtl.setVotes(room.votes?.newBook?.length ?? 0, connected, room.votes?.newBook?.includes(mySeat))
	}

	/** Everything the room snapshot drives: roster, lobby, fight start, shared win. */
	function applyRoom(r) {
		if (!r) return
		room = r
		hud.setRoom(r, mySeat)
		for (const seat of [...peerSeats]) if (!r.seats.some((s) => s.seat === seat && s.seat !== mySeat)) dropPeer(seat)
		gateCtl?.refresh(r, mySeat)
		updateVotes()

		const mine = r.seats.find((s) => s.seat === mySeat)
		if (r.phase === 'fighting' && mine?.inFight && !combatRunning && modes.mode !== 'combat') startCoopFight()

		if (r.warden?.state === 'dormant') winShown = false
		if (prevPhase === 'fighting' && r.phase === 'village' && r.warden?.state !== 'defeated' && !combatRunning) toast(COPY.death.partyLost)
		if (r.warden?.state === 'defeated' && !winShown && !combatRunning && modes.mode === 'world' && store.get().status !== 'dead') {
			// the party won while I was walking around (or had already fallen): chapter complete for everyone
			const book = store.get()
			store.closeBook({won: true, dead: false})
			panels.close()
			showWin({fought: book, result: {won: true, hpLeft: book.hp, turns: book.stats.turns}, coop: true})
		}
		prevPhase = r.phase
	}

	function leaveCoop({silent = false} = {}) {
		const net = session.net
		if (!net) return
		session.net = null
		world.setNet?.(null)
		unwireNet()
		try {
			net.leave()
		} catch {}
		store.closeBook({won: false, dead: false})
		store.detachNet()
		for (const seat of [...peerSeats]) dropPeer(seat)
		room = null
		mySeat = null
		gateCtl = null
		winCtl = null
		coopWon = false
		winShown = false
		lastSent = null
		hud.setRoom(null, null)
		if (!silent) toast(COPY.mp.left(loadName()))
		combatRunning = false
		showCover()
	}

	// ---- boot ---------------------------------------------------------------------
	addEventListener('pagehide', () => store.closeOnUnload())
	showCover()

	return {showCover, startSolo, ai, panels, hud, toast, get room() {
		return room
	}}
}
