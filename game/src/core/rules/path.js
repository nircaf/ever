// EVER v2: what a seed decides (GDD_V2 3.2, 4, 5, 6, 13). PURE: the room server imports it.
//   planBook(seed, {seat}) -> {seed, themes, keepsake, L, pages, hearthRemove, ...}
// Every decision reads its own named stream rng(seed, label), so changing how one thing
// is picked never shifts another. The plan is saved inside the book (pinning, GDD_V2 16):
// a later deploy that changes this file never changes a book in progress.
// OWNER: systems engineer (path, sites data); the world draws the sites (world/sites.js).
// Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later

import {KEEPSAKES} from '../../mechanics/reference.js'
import {THEMES} from '../../mechanics/library.js'
import {pick, pickWeighted, rng, shuffle} from '../../mechanics/prng.js'
import {STATIONS} from '../contracts.js'

export {THEMES}
export const PATH_VERSION = 1

/** GDD_V2 6.1 node types. */
export const NODE = Object.freeze({marcus: 'marcus', moment: 'moment', station: 'station', skirmish: 'skirmish', elite: 'elite', hearth: 'hearth', final: 'final'})
export const FIGHT_TYPES = Object.freeze(['skirmish', 'elite', 'final'])
export const isFight = (type) => FIGHT_TYPES.includes(type)
/** Pages a reader may skip ("Walk on" / "Turn the page"). */
export const SKIPPABLE = Object.freeze(['moment', 'station', 'hearth'])

/**
 * Named sites (GDD_V2 6.3). x east, z south, origin at the well. MVP stations keep their
 * contracts.js positions; the new sites were moved from the GDD proposals where the
 * camera or the houses needed it (rings must leave room for the fight shot south of them).
 */
export const SITES = Object.freeze({
	forge: {pos: STATIONS.marcus.pos, radius: STATIONS.marcus.radius, station: 'marcus'},
	lectern: {pos: STATIONS.lectern.pos, radius: STATIONS.lectern.radius, station: 'lectern'},
	well: {pos: STATIONS.well.pos, radius: STATIONS.well.radius, station: 'well'},
	grindstone: {pos: STATIONS.grindstone.pos, radius: STATIONS.grindstone.radius, station: 'grindstone'},
	shrine: {pos: STATIONS.shrine.pos, radius: STATIONS.shrine.radius, station: 'shrine'},
	gate: {pos: STATIONS.gate.pos, radius: STATIONS.gate.radius, station: 'gate'},
	roadfire: {pos: [4.5, 15.5], radius: 2.6},
	cart: {pos: [-4.5, 10.5], radius: 2.8},
	bench: {pos: [6.5, -9.5], radius: 2.5},
	ringS: {pos: [-14, 17], radius: 3.0},
	ringE: {pos: [21, 9], radius: 3.0},
	ringW: {pos: [-19, -8], radius: 3.0},
	ringNE: {pos: [11, -18], radius: 3.0},
})
export const RING_SITES = Object.freeze(['ringS', 'ringE', 'ringW', 'ringNE'])
/** Extra tolerance the room adds to a site radius (same as STATION_TOLERANCE). */
export const SITE_TOLERANCE = 1

export function inSiteRange(site, x, z, tolerance = SITE_TOLERANCE) {
	const s = SITES[site]
	if (!s || !Number.isFinite(x) || !Number.isFinite(z)) return false
	return Math.hypot(x - s.pos[0], z - s.pos[1]) <= s.radius + tolerance
}

/** The site whose radius contains (x, z), nearest first (client side: tolerance 0). */
export function siteAt(x, z, {tolerance = 0, only = Object.keys(SITES)} = {}) {
	let best = null
	let bestD = Infinity
	for (const id of only) {
		const s = SITES[id]
		const d = Math.hypot(x - s.pos[0], z - s.pos[1])
		if (d <= s.radius + tolerance && d < bestD) {
			best = id
			bestD = d
		}
	}
	return best
}

/** "north", "south-east"... from (x, z) to a site (z grows to the south). */
export function directionTo(x, z, site) {
	const s = SITES[site]
	if (!s) return ''
	const dx = s.pos[0] - x
	const dz = s.pos[1] - z
	if (Math.hypot(dx, dz) < 4) return 'here'
	const a = (Math.atan2(dx, -dz) * 180) / Math.PI // 0 = north, 90 = east
	const names = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west']
	return names[Math.round((((a % 360) + 360) % 360) / 45) % 8]
}

// ---------------------------------------------------------------------------------------
// Themes, keepsakes, archetypes, enemies
// ---------------------------------------------------------------------------------------

export const THEME_NAMES = Object.freeze({forge: 'Forge', well: 'Well', briar: 'Briar', ash: 'Ash', lantern: 'Lantern', crow: 'Crow', oath: 'Oath', bargain: 'Bargain'})

/** GDD_V2 19 chapter setup lines by primary theme. */
export const SETUP_LINES = Object.freeze({
	forge: 'In Ashbrook the forge has gone cold, and something waits at the north gate.',
	well: 'The well in Ashbrook remembers everyone who looks in.',
	briar: "The wood has crept to Ashbrook's wall, and something waits at the north gate.",
	ash: 'Ash lies on every step in Ashbrook. Someone is still grieving.',
	lantern: 'One lantern is lit in Ashbrook tonight. Follow it.',
	crow: 'Crows sit on the north gate and count the people who pass.',
	oath: 'In Ashbrook, people still keep their word. Mostly.',
	bargain: 'Everything in Ashbrook has a price tonight.',
})

/** GDD_V2 5: Warden aspect (primary) and twist (shadow), display names only. */
export const WARDEN_ASPECT = Object.freeze({forge: 'Heart-coal', well: 'Undertow', briar: 'Thorned', ash: 'Shroud', lantern: 'Glare', crow: 'Omen', oath: 'Vowbound', bargain: 'Collector'})

export const ARCHETYPES = Object.freeze({
	wayfarer: {names: ['Ferrin', 'Oda', 'Tamsin', 'Bram', 'Ilse', 'Corwin', 'Mabry', 'Juno'], site: 'cart', title: 'A Cart on the Road'},
	keeper: {names: ['Wren', 'Agnes', 'Hollis', 'Maud', 'Edda', 'Osric'], site: 'bench', title: 'The Lamp-Keeper'},
})

/** Combat enemy ids per fight kind (combat/rules ENEMIES). */
export const ENEMY_OF = Object.freeze({motes: 'ashMotes', hound: 'cinderHound', husk: 'ironHusk', warden: 'wardenV2'})

/** Keepsake defs of a theme (authored content; mechanics/reference.js holds the data). */
export const keepsakesOf = (theme) => KEEPSAKES.filter((k) => k.theme === theme)

/** GDD_V2 3.2 `themes`: primary, secondary, shadow (3 different of 8). */
export function themesFor(seed) {
	return shuffle([...THEMES], rng(seed, 'themes')).slice(0, 3)
}

/**
 * GDD_V2 4 and 17.1: seat 0 gets the seed's keepsake; seat 1 the primary theme's other
 * one; seats 2 and 3 the secondary theme's two.
 */
export function keepsakeFor(seed, seat = 0, themes = themesFor(seed)) {
	const [primary, secondary] = themes
	const own = keepsakesOf(primary)
	const first = Math.floor(rng(seed, 'keepsake')() * own.length)
	if (seat <= 0) return own[first]
	if (seat === 1) return own[(first + 1) % own.length]
	const sec = keepsakesOf(secondary)
	return sec[(seat - 2) % sec.length]
}

// ---------------------------------------------------------------------------------------
// The path (GDD_V2 6.2)
// ---------------------------------------------------------------------------------------

const OPTIONAL_STATIONS = ['well', 'grindstone', 'shrine']

/** One attempt at filling the grammar. Returns a node list (no sites yet) or null. */
function tryGrammar(rand, L, {shrineAllowed}) {
	const pool = shuffle(OPTIONAL_STATIONS.filter((s) => s !== 'shrine' || shrineAllowed), rand)
	const archetypes = shuffle(['wayfarer', 'keeper'], rand)
	const actI = [{type: 'marcus'}, ...shuffle([{type: 'station', station: 'lectern'}, {type: 'skirmish'}], rand)]
	if (rand() < 0.5 && pool.length) actI.push({type: 'station', station: pool.shift()})
	const turn = [{type: 'moment', archetype: archetypes[0]}]
	const midParts = []
	if (rand() < 0.55) midParts.push({type: 'skirmish'})
	if (pool.length) midParts.push({type: 'station', station: pool.shift()})
	if (rand() < 0.5) midParts.push({type: 'moment', archetype: archetypes[1]})
	const actII = [...shuffle(midParts, rand), {type: 'elite'}]
	const nodes = [...actI, ...turn, ...actII, {type: 'hearth'}, {type: 'final'}]
	return nodes.length === L ? nodes : null
}

/** The GDD_V2 6.2 constraints (tests run them over many seeds). Returns '' or the broken rule. */
export function checkPath(nodes) {
	const L = nodes.length
	if (L < 8 || L > 10) return 'length'
	if (nodes[0].type !== 'marcus') return 'marcus first'
	const lectern = nodes.findIndex((n) => n.station === 'lectern')
	if (lectern < 1 || lectern > 2) return 'lectern page'
	const firstSkirmish = nodes.findIndex((n) => n.type === 'skirmish')
	if (firstSkirmish < 1 || firstSkirmish > 3) return 'first skirmish page'
	for (let i = 1; i < L; i++) if (isFight(nodes[i].type) && isFight(nodes[i - 1].type) && !(nodes[i].type === 'final' && nodes[i - 1].type === 'hearth')) return 'adjacent fights'
	if (nodes[L - 1].type !== 'final' || nodes[L - 2].type !== 'hearth' || nodes[L - 3].type !== 'elite') return 'ending'
	const count = (t) => nodes.filter((n) => n.type === t).length
	if (count('elite') !== 1 || count('final') !== 1) return 'fights'
	if (count('skirmish') < 1 || count('skirmish') > 2) return 'skirmishes'
	const arche = nodes.filter((n) => n.type === 'moment').map((n) => n.archetype)
	if (arche.length < 1 || arche.length > 2 || new Set(arche).size !== arche.length) return 'moments'
	const stations = nodes.filter((n) => n.type === 'station').map((n) => n.station)
	if (new Set(stations).size !== stations.length || !stations.includes('lectern')) return 'stations'
	if (count('hearth') !== 1) return 'hearth'
	return ''
}

const TITLES = Object.freeze({
	marcus: 'The Cold Forge',
	lectern: 'The Margin Stone',
	well: 'The Well',
	grindstone: 'The Grindstone',
	shrine: 'The Crooked Shrine',
	hearth: 'The Road Fire',
	hearthLit: 'The Lit Forge',
	skirmish: ['Ash on the Road', 'Teeth in the Meadow'],
	elite: 'The Iron Husk',
	wayfarer: 'A Cart on the Road',
	keeper: 'The Lamp-Keeper',
	final: 'The Ash Gate',
})

/**
 * Everything the seed decides about one book.
 * @param {string} seed  seed code
 * @param {{seat?: number}} [o]
 */
export function planBook(seed, {seat = 0} = {}) {
	const themes = themesFor(seed)
	const keepsake = keepsakeFor(seed, seat, themes)
	const pr = rng(seed, 'path')
	const L = pickWeighted(pr, [[8, 30], [9, 45], [10, 25]])
	const shrineAllowed = themes.includes('bargain') || themes.includes('ash') || pr() < 0.25
	let nodes = null
	for (let i = 0; i < 400 && !nodes; i++) {
		const n = tryGrammar(pr, L, {shrineAllowed})
		if (n && !checkPath(n)) nodes = n
	}
	// Practically unreachable; a fixed fallback that satisfies every rule for each L.
	if (!nodes) {
		const base = [{type: 'marcus'}, {type: 'station', station: 'lectern'}, {type: 'skirmish'}, {type: 'moment', archetype: 'keeper'}]
		const mid = L === 8 ? [] : L === 9 ? [{type: 'station', station: 'well'}] : [{type: 'station', station: 'well'}, {type: 'moment', archetype: 'wayfarer'}]
		nodes = [...base, ...mid, {type: 'elite'}, {type: 'hearth'}, {type: 'final'}]
	}
	// Sites, enemies, names, titles.
	const rings = shuffle(['ringS', 'ringE', 'ringW'], rng(seed, 'site:rings'))
	let skirmishes = 0
	const titleRand = rng(seed, 'titles')
	const pages = nodes.map((n, i) => {
		const p = {type: n.type}
		if (n.type === 'marcus') Object.assign(p, {site: 'forge', npc: 'marcus', title: TITLES.marcus})
		else if (n.type === 'station') Object.assign(p, {station: n.station, site: n.station, title: TITLES[n.station]})
		else if (n.type === 'moment') {
			const a = ARCHETYPES[n.archetype]
			Object.assign(p, {archetype: n.archetype, site: a.site, npc: pick(rng(seed, `npc:${i}`), a.names), title: a.title})
		} else if (n.type === 'skirmish') {
			const kind = skirmishes === 0 ? 'motes' : 'hound'
			Object.assign(p, {site: rings[skirmishes % rings.length], foe: kind, enemy: ENEMY_OF[kind], title: TITLES.skirmish[skirmishes ? 1 : Math.floor(titleRand() * 2) % 2]})
			skirmishes++
		} else if (n.type === 'elite') Object.assign(p, {site: rng(seed, `site:${i}`)() < 0.5 ? 'ringW' : 'ringNE', foe: 'husk', enemy: ENEMY_OF.husk, title: TITLES.elite})
		else if (n.type === 'hearth') Object.assign(p, {site: 'roadfire', title: TITLES.hearth})
		else if (n.type === 'final') Object.assign(p, {site: 'gate', foe: 'warden', enemy: ENEMY_OF.warden, title: TITLES.final})
		return p
	})
	// The elite never shares a ring with a skirmish on this path.
	const used = new Set(pages.filter((p) => p.type === 'skirmish').map((p) => p.site))
	for (const p of pages) if (p.type === 'elite' && used.has(p.site)) p.site = ['ringNE', 'ringW', 'ringE', 'ringS'].find((r) => !used.has(r))
	const hasWell = pages.some((p) => p.station === 'well')
	const hasKeeper = pages.some((p) => p.archetype === 'keeper')
	return {
		v: PATH_VERSION,
		seed,
		themes,
		keepsake: keepsake.name,
		L,
		pages,
		// GDD_V2 6.2 rule 7: removal guarantee
		keeperRemoves: !hasWell && hasKeeper,
		hearthRemove: !hasWell && !hasKeeper,
		minutes: estimateMinutes(pages),
	}
}

/** GDD_V2 6.4 time budget. */
export function estimateMinutes(pages) {
	const per = {marcus: 2, moment: 1.5, station: 0.5, skirmish: 1.25 + 0.3, elite: 2.5 + 0.3, hearth: 0.5, final: 4}
	return Math.round(0.75 + pages.reduce((a, p) => a + (per[p.type] ?? 0.5) + 0.25, 0))
}

/** Preview for the New book screen: keepsake, themes, page count. */
export function previewSeed(seed) {
	const plan = planBook(seed)
	return {keepsake: plan.keepsake, themes: plan.themes, L: plan.L, minutes: plan.minutes}
}

/** Warden v2 HP for the path (GDD_V2 13): 120 at 9 pages, +-8 per page. */
export const wardenHpFor = (L) => 120 + 8 * (L - 9)
