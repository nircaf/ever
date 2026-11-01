// EVER platform: engine + world versions, book pinning and the "new edition" check.
//
// - ENGINE_VERSION: '<package version>+<commit>' baked in at build time (vite.config.js
//   defines __EVER_ENGINE__). 'dev' in tests and the dev server.
// - Each book records {engine, edition} when it starts (pinFor) and is played to the end on
//   that edition (world/ only grows, so the latest deploy still serves every older edition).
// - checkPin(book, now) decides what a reload does with a saved book.
// - createVersionWatcher polls version.json (tiny, no-cache) and tells the UI when a new
//   edition or engine is live, without interrupting anything (GDD_V2 16 and 19 copy).
// Browser-safe; no DOM access at module top level.
//
// Copyright (C) 2026 the EVER contributors.
// SPDX-License-Identifier: AGPL-3.0-or-later

/* global __EVER_ENGINE__ */
export const ENGINE_VERSION = typeof __EVER_ENGINE__ === 'string' ? __EVER_ENGINE__ : 'dev'

/**
 * Engine "book compatibility" major: bump ENGINE_BOOK_COMPAT (and package.json's major)
 * when a saved book can no longer be continued by newer code. Books from an older major
 * close as "unfinished" (GDD_V2 16).
 */
export const ENGINE_BOOK_COMPAT = 1

/** How long old editions stay playable (days); world/ is append-only so this is a policy, not storage. */
export const EDITION_KEEP_DAYS = 14

/** GDD_V2 19 "Versions" copy. {E} is replaced by the edition number. */
export const VERSION_COPY = Object.freeze({
	olderEdition: "This book began in edition {E}. Ashbrook has changed since; you'll see the new Ashbrook in your next book.",
	unavailable: "This book's edition is no longer kept. It closes here, unfinished. It still counts as written.",
	newEdition: 'Ashbrook has changed. New books will see edition {E}.',
	newEngine: 'A new version of EVER is ready. It will load with your next book.',
	edition: 'Ashbrook, edition {E}',
})
export const fillCopy = (s, vars) => s.replace(/\{(\w+)\}/g, (_m, k) => String(vars[k] ?? ''))

export const engineMajor = (v) => {
	const m = /^(\d+)\./.exec(String(v ?? ''))
	return m ? Number(m[1]) : null
}

/** The pin a new book stores: {engine, edition}. */
export function pinFor({edition, engine = ENGINE_VERSION}) {
	return {engine, edition: Number.isInteger(edition) ? edition : 0}
}

/**
 * What to do with a saved book on load.
 * @param {{engine?: string, edition?: number}} pin  stored with the book
 * @param {{engine?: string, latestEdition?: number|null, oldestEdition?: number}} now
 * @returns {{ok: boolean, state: 'current'|'older_edition'|'unavailable', copy: string|null}}
 */
export function checkPin(pin, {engine = ENGINE_VERSION, latestEdition = null, oldestEdition = 0} = {}) {
	const e = pin?.edition
	if (!Number.isInteger(e) || e < 0) return {ok: false, state: 'unavailable', copy: VERSION_COPY.unavailable}
	const pinnedMajor = engineMajor(pin.engine)
	const curMajor = engineMajor(engine)
	if (pinnedMajor !== null && curMajor !== null && pinnedMajor !== curMajor) return {ok: false, state: 'unavailable', copy: VERSION_COPY.unavailable}
	if (e < oldestEdition || (latestEdition !== null && e > latestEdition)) return {ok: false, state: 'unavailable', copy: VERSION_COPY.unavailable}
	if (latestEdition !== null && e < latestEdition) return {ok: true, state: 'older_edition', copy: fillCopy(VERSION_COPY.olderEdition, {E: e})}
	return {ok: true, state: 'current', copy: null}
}

/**
 * Poll version.json and report changes once each. Never reloads anything itself.
 * @param {{current: {engine: string, edition: number}, onChange: (c: {kind: 'edition'|'engine', edition: number, engine: string, copy: string}) => void,
 *          url?: string, fetchFn?: typeof fetch, intervalMs?: number, doc?: Document|null}} opts
 */
export function createVersionWatcher({current, onChange, url = './version.json', fetchFn = globalThis.fetch?.bind(globalThis), intervalMs = 10 * 60 * 1000, doc = globalThis.document ?? null}) {
	let seenEdition = current.edition
	let seenEngine = current.engine
	let timer = null
	let busy = false
	async function check() {
		if (busy) return null
		busy = true
		try {
			const r = await fetchFn(url, {cache: 'no-store'})
			if (!r.ok) return null
			const v = await r.json()
			if (Number.isInteger(v.edition) && v.edition > seenEdition) {
				seenEdition = v.edition
				onChange({kind: 'edition', edition: v.edition, engine: v.engine, copy: fillCopy(VERSION_COPY.newEdition, {E: v.edition})})
			}
			if (typeof v.engine === 'string' && v.engine !== seenEngine && seenEngine !== 'dev') {
				seenEngine = v.engine
				onChange({kind: 'engine', edition: v.edition, engine: v.engine, copy: VERSION_COPY.newEngine})
			}
			return v
		} catch {
			return null
		} finally {
			busy = false
		}
	}
	const onVis = () => {
		if (doc?.visibilityState === 'visible') check()
	}
	if (intervalMs > 0) timer = setInterval(check, intervalMs)
	doc?.addEventListener?.('visibilitychange', onVis)
	return {
		check,
		stop() {
			if (timer) clearInterval(timer)
			doc?.removeEventListener?.('visibilitychange', onVis)
		},
	}
}

/**
 * A redeploy replaces hashed chunks; a long-open tab that lazy-loads an old chunk name gets a
 * 404. Vite fires `vite:preloadError` for that. Call once at startup: the handler gets the
 * error and should offer a reload (the saved book survives a reload).
 */
export function installChunkErrorGuard(onError, win = globalThis.window ?? null) {
	if (!win?.addEventListener) return () => {}
	const h = (ev) => {
		ev.preventDefault?.()
		onError(ev.payload ?? ev)
	}
	win.addEventListener('vite:preloadError', h)
	return () => win.removeEventListener('vite:preloadError', h)
}

/** Warm lazy chunks while idle so a later redeploy cannot strand this tab (call after the cover is up). */
export function prefetchChunks(loaders, win = globalThis.window ?? null) {
	const run = () => {
		for (const load of loaders) load().catch(() => {})
	}
	if (win?.requestIdleCallback) win.requestIdleCallback(run, {timeout: 5000})
	else setTimeout(run, 2000)
}
