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

import {EV, MSG, bus as appBus, loadMeta, newBook, saveMeta, spendTokensForCombat} from './contracts.js'
import {applyBookAction, metaAfterBook} from './rules/book.js'

const keyOf = (b) => `${b.bookNo}:${b.seed}`

/**
 * @param {{net?: import('./contracts.js').NetClient|null, getPos: () => [number, number], bus?: any, storage?: Storage, now?: () => number}} opts
 */
export function createBookStore({net: net0 = null, getPos, bus = appBus, storage, now = () => Date.now()}) {
	let net = null
	let meta = loadMeta(storage)
	let book = newBook({meta, now: now()})
	const ended = new Set()
	let active = false // a book the player actually opened (the cover's placeholder never counts)
	const subs = new Set()
	const offs = []

	const set = (b, effects = []) => {
		book = b
		for (const fn of [...subs]) fn(book, effects)
		bus.emit(EV.BOOK_CHANGED, {book, effects})
	}

	/** End the current book once. Returns the new meta, or null if this book already ended. */
	function closeBook(end, target = book) {
		const k = keyOf(target)
		if (ended.has(k)) return null
		ended.add(k)
		meta = metaAfterBook(meta, target, end)
		saveMeta(meta, storage)
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
		getMeta: () => ({...meta}),
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

		subscribe(fn) {
			subs.add(fn)
			return () => subs.delete(fn)
		},

		/** Solo: the gate was confirmed. Tokens stay on the book until the fight ends (the driver reads them). */
		beginFight() {
			if (net) return book
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
			const {book: spent} = spendTokensForCombat(book)
			spent.hp = Math.max(0, Math.min(spent.maxHp, Math.round(result.hpLeft)))
			spent.status = result.won ? 'won' : 'dead'
			spent.stats = {turns: Math.max(0, Math.round(result.turns ?? spent.stats.turns))}
			set(spent)
			closeBook({won: result.won, dead: !result.won}, spent)
			return {book: spent, meta: {...meta}}
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

		/** Solo: a fresh book from page one; only meta carries over. Co-op: the room owns this. */
		openNewBook() {
			if (net) return book
			active = true
			set(newBook({meta, now: now()}))
			return book
		},

		/** pagehide: refreshing mid-book in solo closes the book quietly (GDD 1.1). */
		closeOnUnload() {
			if (net || !active) return
			if (book.status === 'exploring' || book.status === 'fighting') closeBook({won: false, dead: false})
		},

		attachNet,
		detachNet,
	}
}
