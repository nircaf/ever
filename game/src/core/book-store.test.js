// BookStore: save/load of meta, ending a book, death -> new book from page one.
// Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later
import {describe, expect, it} from 'vitest'
import {STARTER_DECK, STORAGE_KEYS, START_HP, createBus, loadMeta, MSG, STATIONS} from './contracts.js'
import {createBookStore} from './book-store.js'

const memory = (init = {}) => {
	const m = new Map(Object.entries(init))
	return {getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m}
}
const make = (storage = memory(), pos = [0, 0]) => {
	const bus = createBus()
	const store = createBookStore({getPos: () => pos, bus, storage, now: () => 5000})
	return {store, bus, storage}
}

describe('meta (the only thing that persists)', () => {
	it('starts at book 1 with no remembered line, and survives garbage storage', () => {
		expect(make().store.getMeta()).toEqual({booksWritten: 0, rememberedLine: ''})
		const bad = memory({[STORAGE_KEYS.meta]: '{not json'})
		expect(loadMeta(bad)).toEqual({booksWritten: 0, rememberedLine: ''})
		const weird = memory({[STORAGE_KEYS.meta]: JSON.stringify({booksWritten: -4, rememberedLine: 9})})
		expect(loadMeta(weird)).toEqual({booksWritten: 0, rememberedLine: ''})
	})
	it('works with storage that throws', () => {
		const boom = {getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') }, removeItem() {}}
		const {store} = make(boom)
		store.openNewBook()
		expect(() => store.finishCombat({won: false, hpLeft: 0, turns: 3})).not.toThrow()
		expect(store.getMeta().booksWritten).toBe(1)
	})
})

describe('death closes the book and the next one starts from page one', () => {
	it('booksWritten +1, remembered line saved, status dead', () => {
		const {store, storage} = make()
		store.openNewBook()
		store.beginFight()
		expect(store.get().status).toBe('fighting')
		const r = store.finishCombat({won: false, hpLeft: 0, turns: 4})
		expect(r.book.status).toBe('dead')
		expect(r.book.hp).toBe(0)
		expect(r.book.stats.turns).toBe(4)
		expect(store.getMeta()).toEqual({booksWritten: 1, rememberedLine: "The Warden's ash settles on an unfinished page."})
		expect(JSON.parse(storage.getItem(STORAGE_KEYS.meta))).toEqual({booksWritten: 1, rememberedLine: "The Warden's ash settles on an unfinished page."})
	})
	it('the new book is fresh: deck, HP, tokens, trust, station uses, Marcus flags all reset', () => {
		const {store, storage} = make(memory(), STATIONS.shrine.pos)
		store.openNewBook()
		// dirty everything we can
		store.dispatch({type: 'shrine.take'})
		expect(store.get().deck).toHaveLength(13)
		store.beginFight()
		store.finishCombat({won: false, hpLeft: 0, turns: 2})
		const old = store.get()
		const next = store.openNewBook()
		expect(next).not.toBe(old)
		expect(next.status).toBe('exploring')
		expect(next.bookNo).toBe(2)
		expect(next.booksWritten).toBe(1)
		expect(next.hp).toBe(START_HP)
		expect(next.deck.map((c) => c.id)).toEqual([...STARTER_DECK])
		expect(next.tokens).toEqual([])
		expect(next.used).toEqual({well: false, lectern: false, grindstone: false, shrine: false})
		expect(next.curses).toEqual({cold: false, struck: false, shrine: 0})
		expect(next.marcus).toMatchObject({trust: 0, beat: 1, upgradesLeft: 0, anvilClosed: false, freeTextGain: 0, said: []})
		expect(next.marcus.flags.met).toBe(false)
		expect(next.visited).toEqual({well: false, marcus: false, grindstone: false, lectern: false, gate: false})
		// and the meta, not the book, is what carried over
		expect(loadMeta(storage).booksWritten).toBe(1)
	})
	it('tokens are spent whatever the outcome', () => {
		const {store} = make(memory(), STATIONS.well.pos)
		store.openNewBook()
		store.dispatch({type: 'well.ward'})
		expect(store.get().tokens).toEqual(['ward'])
		store.beginFight()
		expect(store.get().tokens).toEqual(['ward']) // the driver reads them at the start
		store.finishCombat({won: true, hpLeft: 31, turns: 6})
		expect(store.get().tokens).toEqual([])
		expect(store.get()).toMatchObject({status: 'won', hp: 31})
	})
	it('a win also writes the book, once, with the win line', () => {
		const {store} = make()
		store.openNewBook()
		store.finishCombat({won: true, hpLeft: 20, turns: 5})
		expect(store.getMeta()).toEqual({booksWritten: 1, rememberedLine: 'The gate is quiet. Tobin can rest.'})
		expect(store.closeBook({won: true})).toBeNull() // already closed
		store.closeOnUnload()
		expect(store.getMeta().booksWritten).toBe(1)
	})
	it('"Stay in Ashbrook" keeps the book closed and puts it in the epilogue', () => {
		const {store} = make()
		store.openNewBook()
		store.finishCombat({won: true, hpLeft: 20, turns: 5})
		store.enterEpilogue()
		expect(store.get().status).toBe('epilogue')
		expect(store.getMeta().booksWritten).toBe(1)
		store.closeOnUnload() // reload in the epilogue does not count again
		expect(store.getMeta().booksWritten).toBe(1)
	})
	it('HP from the fight is clamped to a legal value', () => {
		const {store} = make()
		store.openNewBook()
		expect(store.finishCombat({won: true, hpLeft: 9999, turns: 1}).book.hp).toBe(50)
	})
	it('cancelFight puts an unstarted fight back to exploring', () => {
		const {store} = make()
		store.openNewBook()
		store.beginFight()
		store.cancelFight()
		expect(store.get().status).toBe('exploring')
	})
})

describe('refreshing mid-book (GDD 1.1)', () => {
	it('closes the book quietly and counts it as written', () => {
		const {store} = make()
		store.openNewBook()
		store.closeOnUnload()
		expect(store.getMeta().booksWritten).toBe(1)
		store.closeOnUnload()
		expect(store.getMeta().booksWritten).toBe(1)
	})
	it('keeps the previous remembered line when nothing in the book earns a new one', () => {
		const {store} = make(memory({[STORAGE_KEYS.meta]: JSON.stringify({booksWritten: 3, rememberedLine: 'kept'})}))
		store.openNewBook()
		store.closeOnUnload()
		expect(store.getMeta()).toEqual({booksWritten: 4, rememberedLine: 'kept'})
	})
	it('the cover placeholder book never counts', () => {
		const {store} = make()
		store.closeOnUnload()
		expect(store.getMeta().booksWritten).toBe(0)
	})
})

describe('dispatch', () => {
	it('applies rules locally and notifies subscribers once', async () => {
		const {store, bus} = make(memory(), STATIONS.grindstone.pos)
		store.openNewBook()
		const seen = []
		store.subscribe((b) => seen.push(b.tokens.length))
		let events = 0
		bus.on('book:changed', () => events++)
		const r = await store.dispatch({type: 'grindstone.take'})
		expect(r.ok).toBe(true)
		expect(seen).toEqual([1])
		expect(events).toBe(1)
		const r2 = await store.dispatch({type: 'grindstone.take'})
		expect(r2).toMatchObject({ok: false, error: 'used'})
		expect(seen).toEqual([1])
	})
})

describe('co-op: the room owns the book', () => {
	const fakeNet = () => {
		const handlers = new Map()
		return {
			status: 'open',
			on: (t, fn) => (handlers.set(t, fn), () => handlers.delete(t)),
			emit: (t, m) => handlers.get(t)?.(m),
			request: async (t, body) => ({t: MSG.BOOK, book: {}, fx: [{k: 'toast', text: 'hi'}]}),
		}
	}
	it('adopts what the room sends and never edits its own deck', async () => {
		const {store} = make()
		const net = fakeNet()
		store.attachNet(net)
		const room = store.get()
		const sent = JSON.parse(JSON.stringify(room))
		sent.deck.push({uid: 'c10', id: 'Iron Wave', upgraded: false})
		net.emit(MSG.BOOK, {book: sent, fx: []})
		expect(store.get().deck).toHaveLength(11)
		const r = await store.dispatch({type: 'lectern.take', id: 'Iron Wave'})
		expect(r.ok).toBe(true)
		expect(r.effects).toEqual([{k: 'toast', text: 'hi'}])
		expect(store.get().deck).toHaveLength(11) // untouched: only the room's BOOK frame changes it
	})
	it('a different book arriving (you died in the party fight) closes the old one exactly once', () => {
		const {store} = make()
		const net = fakeNet()
		store.attachNet(net)
		const dead = JSON.parse(JSON.stringify(store.get()))
		const fresh = {...dead, seed: dead.seed + 1, bookNo: dead.bookNo + 1}
		net.emit(MSG.BOOK, {book: fresh, fx: []})
		expect(store.getMeta().booksWritten).toBe(1)
		expect(store.closeBook({won: false, dead: true}, dead)).toBeNull() // the DONE frame arrives later: no double count
		expect(store.getMeta().booksWritten).toBe(1)
		store.closeOnUnload() // co-op never counts a reload here
		expect(store.getMeta().booksWritten).toBe(1)
	})
	it('only unsolicited BOOK frames carry effects to subscribers', () => {
		const {store} = make()
		const net = fakeNet()
		store.attachNet(net)
		const got = []
		store.subscribe((b, fx) => got.push(fx.length))
		net.emit(MSG.BOOK, {book: store.get(), fx: [{k: 'toast', text: 'x'}]})
		net.emit(MSG.BOOK, {ref: 3, book: store.get(), fx: [{k: 'toast', text: 'x'}]})
		expect(got).toEqual([1, 0])
	})
	it('a failed act surfaces the error code', async () => {
		const {store} = make()
		const net = fakeNet()
		net.request = async () => ({t: MSG.ERROR, code: 'too_far'})
		store.attachNet(net)
		expect(await store.dispatch({type: 'well.ward'})).toMatchObject({ok: false, error: 'too_far'})
	})
})
