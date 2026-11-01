// EVER platform: load the shared world (world/ data) for a book, pinned to an edition.
//
//   const loader = createWorldLoader()                 // browser defaults: fetch + localStorage
//   const m = await loader.manifest()                  // cover: edition + ledger (a few KB)
//   const w = await loader.load({edition: book.edition ?? m.edition})
//   w.world.cards / items / lines / npcs / places / paths / presets / names
//
// - Files are fetched by content hash (world/f/<hash>.json, immutable HTTP cache) and the
//   text is re-hashed before use, so a stale cache can never mix editions.
// - Each loaded edition is kept as a snapshot in storage (ever.v2.world.e<E>), so a reload
//   mid-book needs no network and survives a redeploy or a rollback.
// - Every file is re-validated with the world schema (no sim: CI ran it); a bad file is
//   skipped and reported in `skipped`, never thrown.
// - The hard-coded MVP content (engine cards, Marcus, stations, copy.js) is the base layer;
//   this module only returns what the world adds on top of it.
// Browser-safe, also runs in Node (tests) with injected fetch/storage.
//
// Copyright (C) 2026 the EVER contributors.
// SPDX-License-Identifier: AGPL-3.0-or-later

import {fileHash, filesForEdition} from './world-manifest.js'
import {validateWorldEntry} from './world-schema.js'

export const WORLD_SNAPSHOT_KEY = (e) => `ever.v2.world.e${e}`
const SNAPSHOT_INDEX = 'ever.v2.world.pins'
const KEEP_SNAPSHOTS = 3

function defaultStorage() {
	try {
		return globalThis.localStorage ?? null
	} catch {
		return null
	}
}

/**
 * @param {{base?: string, fetchFn?: typeof fetch, storage?: Storage|null, validate?: boolean}} [opts]
 *   base: URL prefix of the deployed world folder (default './world/', relative to the page)
 */
export function createWorldLoader({base = './world/', fetchFn = globalThis.fetch?.bind(globalThis), storage = defaultStorage(), validate = true} = {}) {
	let manifestCache = null
	const files = new Map() // hash -> parsed entry (memory cache for this tab)

	const sget = (k) => {
		try {
			const s = storage?.getItem(k)
			return s ? JSON.parse(s) : null
		} catch {
			return null
		}
	}
	const sset = (k, v) => {
		try {
			storage?.setItem(k, JSON.stringify(v))
			return true
		} catch {
			return false
		}
	}
	const sdel = (k) => {
		try {
			storage?.removeItem(k)
		} catch {}
	}

	/** The latest manifest. `fresh` bypasses the in-tab cache (version checks). */
	async function manifest({fresh = false} = {}) {
		if (manifestCache && !fresh) return manifestCache
		const r = await fetchFn(`${base}manifest.json`, {cache: 'no-cache'})
		if (!r.ok) throw new Error(`world manifest ${r.status}`)
		manifestCache = await r.json()
		return manifestCache
	}

	async function fetchFile(f) {
		if (files.has(f.hash)) return files.get(f.hash)
		const r = await fetchFn(`${base}f/${f.hash}.json`)
		if (!r.ok) return {missing: true}
		const text = await r.text()
		if ((await fileHash(text)) !== f.hash) return {missing: true, reason: 'hash'}
		let raw
		try {
			raw = JSON.parse(text)
		} catch {
			return {missing: true, reason: 'json'}
		}
		files.set(f.hash, {raw})
		return {raw}
	}

	function remember(edition, snapshot) {
		const pins = (sget(SNAPSHOT_INDEX) ?? []).filter((e) => e !== edition)
		pins.unshift(edition)
		for (const old of pins.splice(KEEP_SNAPSHOTS)) sdel(WORLD_SNAPSHOT_KEY(old))
		if (sset(WORLD_SNAPSHOT_KEY(edition), snapshot)) sset(SNAPSHOT_INDEX, pins)
	}

	/**
	 * Load one edition (default: the latest). Never throws for content problems.
	 * @returns {Promise<{ok: boolean, edition: number, latest: number|null, world: ReturnType<typeof resolveWorld>, missing: string[], skipped: {path: string, errors: string[]}[], fromSnapshot: boolean}>}
	 */
	async function load({edition} = {}) {
		if (Number.isInteger(edition)) {
			const snap = sget(WORLD_SNAPSHOT_KEY(edition))
			if (snap && snap.edition === edition && Array.isArray(snap.entries)) {
				return {ok: true, edition, latest: manifestCache?.edition ?? null, world: resolveWorld(snap.entries, edition), missing: [], skipped: [], fromSnapshot: true}
			}
		}
		let m
		try {
			m = await manifest()
		} catch {
			return {ok: false, edition: edition ?? 0, latest: null, world: resolveWorld([], edition ?? 0), missing: ['manifest'], skipped: [], fromSnapshot: false}
		}
		const e = Number.isInteger(edition) ? Math.min(edition, m.edition) : m.edition
		const list = filesForEdition(m, e)
		const got = await Promise.all(list.map((f) => fetchFile(f).catch(() => ({missing: true}))))
		const entries = []
		const missing = []
		const skipped = []
		got.forEach((g, i) => {
			const f = list[i]
			if (g.missing) return missing.push(f.path)
			if (!validate) return entries.push({...g.raw, since: f.since, path: f.path})
			// names: a file's own name is already in the manifest, so check against the others
			const v = validateWorldEntry(g.raw, {names: [], sim: false})
			if (!v.ok) skipped.push({path: f.path, errors: v.errors.map((x) => `${x.path}: ${x.msg}`)})
			else entries.push({...v.entry, since: f.since, path: f.path})
		})
		const ok = missing.length === 0
		if (ok) remember(e, {edition: e, entries})
		return {ok, edition: e, latest: m.edition, world: resolveWorld(entries, e), missing, skipped, fromSnapshot: false}
	}

	return {manifest, load}
}

/**
 * Turn loaded entries into what the game uses. Pure.
 * places: one prop per anchor, the newest wins (GDD_V2 14.2). presets: only those not merged yet.
 */
export function resolveWorld(entries, edition) {
	const by = (t) => entries.filter((e) => e.type === t)
	const places = {}
	for (const p of [...by('place')].sort((a, b) => (a.since ?? 0) - (b.since ?? 0))) places[p.anchor] = {prop: p.prop, ...(p.inscription ? {inscription: p.inscription} : {}), book: p.origin?.book ?? null, since: p.since}
	const lines = {}
	for (const l of by('line')) (lines[l.npc] ??= []).push({when: l.when ?? {}, text: l.text, book: l.origin?.book ?? null})
	const paths = {}
	for (const p of by('path')) (paths[p.theme] ??= []).push(p.titles)
	const used = new Set(entries.map((e) => e.origin?.preset).filter(Boolean))
	const presets = by('preset').filter((p) => !used.has(p.id))
	const cards = by('card').map((e) => ({def: e.def, book: e.origin?.book ?? null, since: e.since}))
	const items = by('item').map((e) => ({def: e.def, book: e.origin?.book ?? null, since: e.since}))
	const npcs = by('npc').map(({v: _v, type: _t, path: _p, ...n}) => n)
	const names = [...cards.map((c) => c.def.name), ...items.map((c) => c.def.name), ...npcs.map((n) => n.name)]
	return {edition, cards, items, lines, npcs, places, paths, presets, names}
}

/** World lines for an NPC that match the moment (theme, trust word, echo). */
export function linesFor(world, npc, {themes = [], trust, echo = false} = {}) {
	return (world.lines[npc] ?? []).filter((l) => (!l.when.theme || themes.includes(l.when.theme)) && (!l.when.trust || l.when.trust === trust) && (l.when.echo === undefined || l.when.echo === echo))
}

/**
 * Offline Last Page (GDD_V2 14.5): up to 3 unused presets matching the book's themes,
 * then other themes' presets. Deterministic for a seed.
 */
export function presetsFor(world, themes = [], {count = 3, rand = Math.random} = {}) {
	const fits = world.presets.filter((p) => p.themes.some((t) => themes.includes(t)))
	const rest = world.presets.filter((p) => !fits.includes(p))
	const shuffled = (list) => {
		const a = [...list]
		for (let i = a.length - 1; i > 0; i--) {
			const j = Math.floor(rand() * (i + 1))
			;[a[i], a[j]] = [a[j], a[i]]
		}
		return a
	}
	return [...shuffled(fits), ...shuffled(rest)].slice(0, count)
}

/** Build the proposal a client sends for a chosen preset. */
export function proposalFromPreset(preset, run) {
	return {v: 1, kind: preset.proposal.kind, preset: preset.id, data: preset.proposal.data, run}
}
