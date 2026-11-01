// BookStore: the UI's only door to the book. OWNER: systems engineer.
// Solo: applyBookAction locally. Co-op: net.request(MSG.ACT, {a}) and adopt the reply.
//
// Book lifecycle (GDD 1): a book ends exactly once (win, death, or abandoned by reload).
// That is when meta changes: booksWritten +1 and the remembered line. `closeBook` is the
// single place that does it, guarded per book so a win seen twice never counts twice.
//
// Subscribers get (book, effects). `effects` is non-empty only for changes the caller did
// not ask for (the room telling you a friend struck Marcus); effects of your own dispatch
// come back in the dispatch result.
//
// Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later

import {EV, MSG, WORLD_EDITION_FALLBACK, bus as appBus, clearBookV2, loadBookV2, loadMetaV2, newBook, saveBookV2, saveMetaV2, spendTokensForCombat} from './contracts.js'
import {applyBookAction, metaAfterBook} from './rules/book.js'
import {echoFromBook, isV2, newBookV2, parseSavedBook} from './rules/run.js'

const keyOf = (b) => `${b.bookNo}:${b.seed}`

/**
 * @param {{net?: import('./contracts.js').NetClient|null, getPos: () => [number, number], bus?: any, storage?: Storage, now?: () => number}} opts
 */
export function createBookStore({net: net0 = null, getPos, bus = appBus, storage, now = () => Date.now()}) {
	let net = null
	let meta = loadMetaV2(storage)
	let book = newBook({meta, now: now()})
	const ended = new Set()
	let active = false // a book the player actually opened (the cover's placeholder never counts)
	const subs = new Set()
	const offs = []

	const set = (b, effects = []) => {
		const prevPage = book?.page
		book = b
		// v2 solo: the book is saved after every change while it is open (GDD_V2 16).
		if (!net && active && isV2(b)) {
			if (b.status === 'exploring' || b.status === 'fighting') saveBookV2(b, storage)
			else clearBookV2(storage)
		}
		for (const fn of [...subs]) fn(book, effects)
		bus.emit(EV.BOOK_CHANGED, {book, effects})
		if (isV2(b) && b.page !== prevPage) bus.emit(EV.PAGE_CHANGED, {page: b.page, L: b.path.L})
	}

	/**
	 * End the current book once. Returns the new meta, or null if this book already ended.
	 * v2: a death leaves an echo for the next book; a win clears it (GDD_V2 15).
	 */
	function closeBook(end, target = book) {
		const k = keyOf(target)
		if (ended.has(k)) return null
		ended.add(k)
		const base = metaAfterBook(meta, target, end)
		meta = {...meta, ...base}
		if (isV2(target)) {
			if (end.dead) meta.echo = echoFromBook(target) ?? meta.echo
			else if (end.won) meta.echo = null
			meta.lastSeed = target.seed
			if (!net) clearBookV2(storage)
		}
		saveMetaV2(meta, storage)
		bus.emit(EV.META_CHANGED, {meta})
		return meta
	}

	function attachNet(client, welcome = null) {
		detachNet()
		net = client
		offs.push(
			net.on(MSG.BOOK, (m) => {
				if (!m.book) return
				const prev = book
				// A different book arriving means the old one ended (death in the party fight,
				// or a new book after a win). The DONE frame may not have been seen yet.
				if (keyOf(prev) !== keyOf(m.book)) closeBook({won: prev.status === 'won' || prev.status === 'epilogue', dead: !(prev.status === 'won' || prev.status === 'epilogue')}, prev)
				set(m.book, m.ref === undefined ? m.fx || [] : [])
			}),
		)
		if (welcome?.book) set(welcome.book)
	}
	function detachNet() {
		for (const off of offs.splice(0)) off()
		net = null
	}
	if (net0) attachNet(net0)

	return {
		get: () => book,
		/** MVP meta shape {booksWritten, rememberedLine}. */
		getMeta: () => ({booksWritten: meta.booksWritten, rememberedLine: meta.rememberedLine}),
		/** v2 meta: + echo, cleanReads, lastSeed (GDD_V2 21). */
		getMetaV2: () => ({...meta}),
		get coop() {
			return Boolean(net)
		},

		async dispatch(a) {
			if (net) {
				try {
					const reply = await net.request(MSG.ACT, {a})
					if (reply?.t === MSG.BOOK) return {ok: true, book, effects: reply.fx || []}
					return {ok: false, book, error: reply?.code || 'server', effects: []}
				} catch {
					return {ok: false, book, error: 'server', effects: []}
				}
			}
			const r = applyBookAction(book, a, {pos: getPos(), now: now()})
			if (r.ok) set(r.book, [])
			return r
		},

		/** Solo, host-side actions (fight results, an unfinished book): never sent by a co-op client. */
		applyInternal(a) {
			if (net) return {ok: false, book, error: 'not_allowed', effects: []}
			const r = applyBookAction(book, a, {pos: getPos(), now: now(), internal: true})
			if (r.ok) set(r.book, [])
			return r
		},

		subscribe(fn) {
			subs.add(fn)
			return () => subs.delete(fn)
		},

		/** Solo: the gate was confirmed. Tokens stay on the book until the fight ends (the driver reads them). */
		beginFight() {
			if (net) return book
			if (isV2(book)) {
				const r = applyBookAction(book, {type: 'fight.begin'}, {pos: getPos(), now: now(), internal: true})
				if (r.ok) set(r.book)
				return book
			}
			const b = structuredClone(book)
			b.status = 'fighting'
			set(b)
			return b
		},

		/** Solo: the fight could not start; back to exploring. */
		cancelFight() {
			if (net || book.status !== 'fighting') return
			const b = structuredClone(book)
			b.status = 'exploring'
			set(b)
		},

		/**
		 * Solo: a fight ended. HP comes from the fight, tokens are spent whatever the outcome,
		 * the book closes (meta updates) and its status becomes 'won' or 'dead'.
		 * @param {{won: boolean, hpLeft: number, turns?: number}} result
		 */
		finishCombat(result) {
			if (net) return null
			if (isV2(book)) {
				const r = applyBookAction(book, {type: 'fight.result', won: Boolean(result.won), hp: result.hpLeft, turns: result.turns ?? 0}, {internal: true, now: now()})
				if (!r.ok) return {book, meta: {booksWritten: meta.booksWritten, rememberedLine: meta.rememberedLine}}
				set(r.book)
				if (r.book.status === 'won' || r.book.status === 'dead') closeBook({won: r.book.status === 'won', dead: r.book.status === 'dead'}, r.book)
				return {book: r.book, meta: {...meta}}
			}
			const {book: spent} = spendTokensForCombat(book)
			spent.hp = Math.max(0, Math.min(spent.maxHp, Math.round(result.hpLeft)))
			spent.status = result.won ? 'won' : 'dead'
			spent.stats = {turns: Math.max(0, Math.round(result.turns ?? spent.stats.turns))}
			set(spent)
			closeBook({won: result.won, dead: !result.won}, spent)
			return {book: spent, meta: {booksWritten: meta.booksWritten, rememberedLine: meta.rememberedLine}}
		},

		/** Solo "Stay in Ashbrook": back to the village in epilogue state (stations spent). */
		enterEpilogue() {
			const b = structuredClone(book)
			b.status = 'epilogue'
			set(b)
		},

		/** Co-op: the room told us how a fight (or the whole chapter) ended for this seat. */
		closeBook(end, snapshot) {
			return closeBook(end, snapshot ?? book)
		},

		/**
		 * Solo: a fresh book from page one; only meta carries over. Co-op: the room owns this.
		 * With a seed code this is a v2 seeded book (GDD_V2); without, the MVP book.
		 * @param {{seed?: string, edition?: number}} [o]
		 */
		openNewBook({seed, edition = WORLD_EDITION_FALLBACK} = {}) {
			if (net) return book
			active = true
			if (seed) {
				meta = {...meta, lastSeed: seed}
				saveMetaV2(meta, storage)
				set(newBookV2({meta, seed, edition, now: now()}))
			} else set(newBook({meta, now: now()}))
			return book
		},

		/** v2: the saved in-progress book, re-checked (null if none or unusable). */
		savedBook() {
			const raw = loadBookV2(storage)
			if (!raw) return null
			const r = parseSavedBook(raw)
			if (!r.ok) return {unusable: true, reason: r.reason, raw}
			return r.book
		},

		/** v2: continue the saved book. Returns it, or null. */
		continueBook() {
			if (net) return null
			const saved = this.savedBook()
			if (!saved || saved.unusable) return null
			active = true
			set(saved)
			return book
		},

		/**
		 * v2: a saved book this build cannot play (engine changed): it closes "unfinished",
		 * counts as written, no death, no echo (GDD_V2 16).
		 */
		closeUnfinished(raw) {
			clearBookV2(storage)
			if (!raw || typeof raw !== 'object') return meta
			const k = `${raw.bookNo}:${raw.seed}`
			if (ended.has(k)) return meta
			ended.add(k)
			meta = {...meta, booksWritten: meta.booksWritten + 1}
			saveMetaV2(meta, storage)
			bus.emit(EV.META_CHANGED, {meta})
			return meta
		},

		/** v2 settings kept in meta: clean reads (no echoes). */
		setCleanReads(on) {
			meta = {...meta, cleanReads: Boolean(on)}
			saveMetaV2(meta, storage)
		},

		/** pagehide: refreshing mid-book in solo closes the book quietly (GDD 1.1). v2 books are saved instead. */
		closeOnUnload() {
			if (isV2(book)) return
			if (net || !active) return
			if (book.status === 'exploring' || book.status === 'fighting') closeBook({won: false, dead: false})
		},

		attachNet,
		detachNet,
	}
}
