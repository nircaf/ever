// v2 game flow (GDD_V2 2): the seeded book's pages in Ashbrook. core/game.js keeps the
// shell (cover, combat runner, co-op wiring) and hands v2 books to this controller:
// prompts and hints per page, opening the right panel at the right site, fights at the
// rings (solo prompt / co-op lobby), spoils, the Last Page (world change), the echo.
// Authority: this file only RENDERS and SENDS (store.dispatch / net frames).
// OWNER: systems engineer.
// Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later

import {MSG, STORAGE_KEYS, loadFlag, saveFlag} from './contracts.js'
import {COPY2} from './copy-v2.js'
import {SITES, THEME_NAMES, directionTo, isFight, siteAt} from './rules/path.js'
import {currentPage, isV2, pageTitle, siteOf} from './rules/run.js'
import {formatSeed} from './rules/seed.js'
import {artRecipe} from '../content-gen/art.js'
import {recipeIconUrl} from '../world/card-art.js'
import {h} from './ui/dom.js'
import {lastPageScreen} from './ui/run-screens.js'

/** Which site an MVP station id stands for. */
const STATION_SITE = {marcus: 'forge', forge: 'forge', anvil: 'forge', well: 'well', lectern: 'lectern', grindstone: 'grindstone', shrine: 'shrine', gate: 'gate'}
const SITE_NAME = {forge: 'Marcus', cart: 'The Wayfarer', bench: 'The Keeper', well: 'The well', lectern: 'The Margin Stone', grindstone: 'The grindstone', shrine: 'The shrine', roadfire: 'The fire', gate: 'The gate'}

/** Last Page proposal kind label (GDD_V2 19). */
function kindLabel(p) {
	const K = COPY2.last.kinds
	if (p.kind === 'card') return K.card
	if (p.kind === 'item') return K.item
	if (p.kind === 'line') return K.line(p.npc === 'marcus' ? 'Marcus' : p.npc === 'keeper' ? 'the Keeper' : 'the Wayfarer')
	if (p.kind === 'npc') return K.npc
	if (p.kind === 'place') return K.place(String(p.anchor ?? 'the road').replace(/([A-Z])/g, ' $1').toLowerCase())
	if (p.kind === 'path') return K.path
	return K.block
}

/** Map an AI-world proposal (core/ai/world.js) to the platform's bot payload (platform/world-schema.js). */
const ANCHOR_MAP = {wellSide: 'well', keepersBench: 'keeperBench', westWoodEdge: 'westWoodEdge'}
const PROP_MAP = {arrow: 'signpost'}
export function toPlatformProposal({proposal, presetId}, run) {
	const {kind, title, summary, v, ...rest} = proposal
	let data = rest
	if (kind === 'card') data = {def: rest.card ?? rest.def}
	else if (kind === 'item') data = {def: rest.item ?? rest.def}
	else if (kind === 'place') data = {...rest, anchor: ANCHOR_MAP[rest.anchor] ?? rest.anchor, prop: PROP_MAP[rest.prop] ?? rest.prop}
	return {v: 1, kind: kind === 'rule' ? 'block' : kind, ...(presetId ? {preset: presetId} : {}), data, run}
}

/**
 * @param {object} d  game.js internals (see createGame)
 */
export function createRunFlow(d) {
	const {world, store, hud, panels, runPanels, toast, session, ai} = d
	let near = null // site in range
	let inFightSite = false
	let lastHintAt = 0
	let spoilsShownFor = ''

	const isCoop = () => Boolean(session.net)

	/** The site an interactable id stands for (MVP station ids or v2 site ids). */
	const siteOfId = (id) => STATION_SITE[id] ?? (SITES[id] ? id : null)

	function promptFor(book, site) {
		const cur = currentPage(book)
		const mine = siteOf(book)
		if (site !== mine) {
			if (site === 'forge') return COPY2.prompts.cart('Marcus')
			if (site === 'cart' || site === 'bench') return null
			if (site === 'roadfire' || site.startsWith('ring') || site === 'gate') return null
			return d.COPY.prompts[site] ?? null
		}
		if (cur.type === 'marcus') return d.COPY.prompts.marcus
		if (cur.type === 'moment') return COPY2.prompts.cart(cur.npc)
		if (cur.type === 'station') return d.COPY.prompts[cur.station]
		if (cur.type === 'hearth') return site === 'forge' ? COPY2.prompts.forgeHearth : COPY2.prompts.roadfire
		if (cur.type === 'final') return COPY2.prompts.gate
		return COPY2.prompts.ring
	}

	function hint(book, p) {
		if (book.status !== 'exploring') return ''
		if (book.pend) return COPY2.hud.pending
		if (book.page >= book.path.L) return COPY2.hud.done
		const room = d.getRoom?.()
		if (isCoop() && room?.page !== undefined && book.page > room.page) return COPY2.hud.waiting
		return COPY2.hud.next(pageTitle(book), directionTo(p.x, p.z, siteOf(book)))
	}

	/** Called by game.js every 100 ms while in the village with a v2 book. */
	function tick(p, book, {panelsOpen}) {
		const site = siteAt(p.x, p.z)
		near = site
		const exploring = book.status === 'exploring' || (book.status === 'epilogue' && site === 'forge')
		hud.setPrompt(site && exploring && !panelsOpen && !book.pend ? promptFor(book, site) : null)
		if (Date.now() - lastHintAt > 900) {
			lastHintAt = Date.now()
			hud.setHint(hint(book, p))
		}
		// Spoils (and catch-up picks) wait for a choice before anything else.
		if (book.pend && book.status === 'exploring' && !panelsOpen) {
			const k = `${book.bookNo}:${book.page}:${book.pend.kind}:${book.pend.left ?? 0}`
			if (spoilsShownFor !== k) {
				spoilsShownFor = k
				runPanels.openSpoils()
			}
		}
		// Stepping into the current fight's ring (or the gate circle) opens its prompt / lobby.
		const cur = currentPage(book)
		const fightHere = Boolean(cur && isFight(cur.type) && site === siteOf(book) && book.status === 'exploring' && !book.pend)
		if (fightHere && !inFightSite && !panelsOpen && !d.isCombatRunning()) openFight(book)
		if (!fightHere && inFightSite && panels.kind === 'gate') panels.close()
		inFightSite = fightHere
	}

	function openFight(book) {
		if (isCoop()) {
			d.openLobby()
			return
		}
		runPanels.openFightPrompt({onFight: () => d.startSoloFight(), onNotYet: () => {}})
	}

	/** E / tap / click on something. Returns true when handled (v2 book). */
	function interact(id) {
		const book = store.get()
		if (!isV2(book)) return false
		const site = siteOfId(id)
		if (!site) return true
		if (book.status === 'epilogue' && site === 'forge') {
			panels.openStation('marcus')
			return true
		}
		if (book.status !== 'exploring') return true
		if (book.pend) {
			runPanels.openSpoils()
			return true
		}
		if (site !== siteOf(book)) {
			const name = SITE_NAME[site] ?? 'It'
			toast(site === 'forge' || site === 'cart' || site === 'bench' ? COPY2.hud.notYetNpc(site === 'forge' ? 'Marcus' : name) : COPY2.hud.notYetStation(name))
			return true
		}
		const cur = currentPage(book)
		hud.setPrompt(null)
		if (cur.type === 'marcus') panels.openStation('marcus')
		else if (cur.type === 'moment') runPanels.openMoment()
		else if (cur.type === 'hearth') runPanels.openHearth()
		else if (cur.type === 'station') ({lectern: runPanels.openLectern, well: runPanels.openWell, grindstone: runPanels.openGrindstone, shrine: runPanels.openShrine})[cur.station]?.()
		else if (isFight(cur.type)) openFight(book)
		return true
	}

	/** Stage the next fight in the world (its ring and foe); returns the combat enemy id. */
	function stageFight(book) {
		const cur = currentPage(book)
		if (!cur || !isFight(cur.type)) return 'ashWarden'
		world.setFight?.({site: siteOf(book), foe: cur.foe})
		return cur.enemy
	}

	// ---------------------------------------------------------------------------------
	// The Last Page (GDD_V2 14)
	// ---------------------------------------------------------------------------------

	function runInfo(book, extra = {}) {
		return {won: true, seed: book.seed, edition: Number.isInteger(book.edition) ? book.edition : 0, engine: String(book.engine ?? 'dev'), bookNo: book.bookNo, pages: book.path.L, themes: book.path.themes, ...extra}
	}

	/**
	 * Show the Last Page for a won v2 book; resolves when the player continues.
	 * @param {{book: any, coop?: boolean, canSend?: boolean}} o
	 */
	function showLastPage({book, coop = false, canSend = true}) {
		return new Promise((resolve) => {
			const firstTime = !loadFlag(STORAGE_KEYS.consent)
			let list = []
			const [primary, secondary, shadow] = book.path.themes
			const load = async () => {
				let r
				try {
					r = await d.runWorldProposals(
						{
							seed: book.seed,
							themes: {primary, secondary, shadow},
							story: {themes: book.path.themes, deck: book.deck.map((c) => c.id), marcusTrust: book.marcus.trust, pages: book.path.L},
							usedPresets: d.usedPresets?.() ?? [],
							worldNames: d.worldNames?.() ?? [],
						},
						{transport: ai.transport, active: ai.isActive(book)},
					)
				} catch {
					r = {proposals: [], line: COPY2.last.allUsed}
				}
				list = r.proposals ?? []
				return {
					line: r.line ?? null,
					proposals: list.map((x) => {
						const p = x.proposal
						const def = p.card ?? p.item ?? p.def ?? null
						let icon = ''
						try {
							icon = def ? recipeIconUrl(artRecipe(def)) : ''
						} catch {}
						return {kind: kindLabel(p), title: String(p.title ?? ''), summary: String(p.summary ?? ''), icon}
					}),
				}
			}
			const ctl = lastPageScreen({
				load,
				showFine: firstTime,
				canSend,
				note: coop && !canSend ? COPY2.last.coopNote : '',
				onSend: async (i, setStatus) => {
					saveFlag(STORAGE_KEYS.consent, true)
					const payload = toPlatformProposal(list[i], runInfo(book, coop ? {room: d.getRoom?.()?.code} : {}))
					const res = await d.submitWorldChange(payload)
					setStatus(res.copy, res.pr ?? null)
					if (res.watch) res.watch((s) => setStatus(s.copy, s.pr ?? null))
				},
				onKeep: () => {},
				onNext: () => resolve(),
			})
			d.setScreen(ctl.el)
		})
	}

	// ---------------------------------------------------------------------------------
	// Screens' v2 lines
	// ---------------------------------------------------------------------------------

	const winStat = (book, turns, hp) => COPY2.win.stat(book.bookNo, book.path.L, turns, hp, formatSeed(book.seed), book.aiRead)
	const deathStat = (book) => COPY2.death.stat(book.bookNo, Math.min(book.page + 1, book.path.L), book.path.L, formatSeed(book.seed))
	const echoLine = (meta) => (meta.echo ? h('p', {class: 'ever-muted', text: COPY2.death.echo(meta.echo.name)}) : null)
	const chapterThemes = (book) => book.path.themes.map((t) => THEME_NAMES[t])

	return {
		tick,
		interact,
		stageFight,
		showLastPage,
		winStat,
		deathStat,
		echoLine,
		chapterThemes,
		get near() {
			return near
		},
		/** Co-op lobby frame for the current fight (MSG.GATE reused for rings). */
		ready: (on) => session.net?.send(MSG.GATE, {ready: on}),
		reset() {
			near = null
			inFightSite = false
			spoilsShownFor = ''
		},
	}
}
