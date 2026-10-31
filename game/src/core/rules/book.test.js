// Book rules: stations, deck changes with validation, Marcus beats, free text, shared memory.
// Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later
import {describe, expect, it} from 'vitest'
import {STATIONS, STARTER_DECK, newBook, upgradableCards} from '../contracts.js'
import {applyBookAction, hintFor, marcusOptionIds, metaAfterBook, rememberedLineFor} from './book.js'
import {classifyFreeText} from './marcus.js'

const at = (station) => ({pos: [...STATIONS[station].pos], now: 1_000_000})
const book0 = (o = {}) => newBook({seed: 7, now: 1_000_000, ...o})
const ok = (book, action, station = 'marcus') => {
	const r = applyBookAction(book, action, at(station))
	expect(r.ok, JSON.stringify(r)).toBe(true)
	return r
}
const say = (r) => r.effects.filter((e) => e.k === 'say').map((e) => e.text)
const opt = (b, option) => ok(b, {type: 'marcus.option', option})

/** Marcus at the first talk, ready to pick an option. */
const talked = (b = book0()) => ok(b, {type: 'marcus.talk'}).book

describe('range and status', () => {
	it('refuses actions that are too far away', () => {
		const b = book0()
		const r = applyBookAction(b, {type: 'grindstone.take'}, {pos: [0, 22], now: 1})
		expect(r).toMatchObject({ok: false, error: 'too_far'})
		expect(r.book).toBe(b)
	})
	it('allows the server tolerance of 1 unit beyond the radius', () => {
		const [x, z] = STATIONS.well.pos
		const edge = STATIONS.well.radius + 0.9
		expect(applyBookAction(book0(), {type: 'well.ward'}, {pos: [x + edge, z], now: 1}).ok).toBe(true)
		expect(applyBookAction(book0(), {type: 'well.ward'}, {pos: [x + edge + 0.5, z], now: 1}).ok).toBe(false)
	})
	it('never mutates the book it is given', () => {
		const b = book0()
		const snap = JSON.stringify(b)
		ok(b, {type: 'shrine.take'}, 'shrine')
		ok(b, {type: 'marcus.talk'})
		expect(JSON.stringify(b)).toBe(snap)
	})
	it('rejects unknown actions, clients faking friendStruck is handled by the room, and fights', () => {
		expect(applyBookAction(book0(), {type: 'nope'}, at('well')).error).toBe('bad_action')
		const fighting = {...book0(), status: 'fighting'}
		expect(applyBookAction(fighting, {type: 'well.ward'}, at('well')).error).toBe('not_allowed')
	})
})

describe('deck changes', () => {
	it('well: removing a card works once and cannot remove the same card twice', () => {
		const b0 = book0()
		const b1 = ok(b0, {type: 'well.remove', uid: 'c0'}, 'well').book
		expect(b1.deck).toHaveLength(9)
		expect(b1.used.well).toBe(true)
		expect(applyBookAction(b1, {type: 'well.remove', uid: 'c1'}, at('well')).error).toBe('used')
		expect(applyBookAction(b0, {type: 'well.remove', uid: 'c99'}, at('well')).error).toBe('bad_card')
	})
	it('well: the Ward token OR a removal, not both', () => {
		const b1 = ok(book0(), {type: 'well.ward'}, 'well').book
		expect(b1.tokens).toEqual(['ward'])
		expect(applyBookAction(b1, {type: 'well.remove', uid: 'c0'}, at('well')).error).toBe('used')
		expect(applyBookAction(b1, {type: 'well.ward'}, at('well')).error).toBe('used')
	})
	it('well can drop a Doubt too', () => {
		let b = ok(book0(), {type: 'shrine.take'}, 'shrine').book
		const doubt = b.deck.find((c) => c.id === 'Doubt')
		b = ok(b, {type: 'well.remove', uid: doubt.uid}, 'well').book
		expect(b.deck.filter((c) => c.id === 'Doubt')).toHaveLength(1)
	})
	it('lectern: only a card from the seeded offer, once', () => {
		const b0 = book0()
		expect(applyBookAction(b0, {type: 'lectern.take', id: 'Strike'}, at('lectern')).error).toBe('bad_card')
		const pick = b0.lecternOffer[1]
		const b1 = ok(b0, {type: 'lectern.take', id: pick}, 'lectern').book
		expect(b1.deck.filter((c) => c.id === pick)).toHaveLength(1)
		expect(b1.deck).toHaveLength(11)
		expect(applyBookAction(b1, {type: 'lectern.take', id: b0.lecternOffer[0]}, at('lectern')).error).toBe('used')
	})
	it('lectern: leaving does not spend the stone', () => {
		const r = ok(book0(), {type: 'lectern.leave'}, 'lectern')
		expect(r.book.used.lectern).toBe(false)
		expect(r.effects).toContainEqual({k: 'close'})
	})
	it('grindstone gives one Whetstone, once', () => {
		const b1 = ok(book0(), {type: 'grindstone.take'}, 'grindstone').book
		expect(b1.tokens).toEqual(['whetstone'])
		expect(applyBookAction(b1, {type: 'grindstone.take'}, at('grindstone')).error).toBe('used')
	})
	it('shrine: Bludgeon plus two Doubts, once, with the right toast', () => {
		const r = ok(book0(), {type: 'shrine.take'}, 'shrine')
		expect(r.book.deck.map((c) => c.id).filter((id) => id === 'Doubt')).toHaveLength(2)
		expect(r.book.deck.some((c) => c.id === 'Bludgeon')).toBe(true)
		expect(r.book.curses.shrine).toBe(2)
		expect(r.effects).toContainEqual({k: 'toast', text: 'Bludgeon added. Two Doubts are written into your deck.'})
		expect(applyBookAction(r.book, {type: 'shrine.take'}, at('shrine')).error).toBe('used')
	})
	it('tokens never exceed one of each kind (max 3)', () => {
		let b = ok(book0(), {type: 'well.ward'}, 'well').book
		b = ok(b, {type: 'grindstone.take'}, 'grindstone').book
		expect(b.tokens).toEqual(['ward', 'whetstone'])
		expect(new Set(b.tokens).size).toBe(b.tokens.length)
		expect(b.tokens.length).toBeLessThanOrEqual(3)
	})
	it('anvil: upgrade needs trust, only upgradable cards, one per grant', () => {
		let b = talked()
		expect(applyBookAction(b, {type: 'anvil.upgrade', uid: 'c0'}, at('marcus')).error).toBe('not_allowed') // no trust yet
		b = opt(b, 'b1.sorry').book // +1
		expect(b.marcus.upgradesLeft).toBe(1)
		expect(applyBookAction(b, {type: 'anvil.upgrade', uid: 'nope'}, at('marcus')).error).toBe('bad_card')
		const r = ok(b, {type: 'anvil.upgrade', uid: 'c9'})
		expect(r.book.deck.find((c) => c.uid === 'c9').upgraded).toBe(true)
		expect(r.book.marcus.upgradesLeft).toBe(0)
		expect(applyBookAction(r.book, {type: 'anvil.upgrade', uid: 'c8'}, at('marcus')).error).toBe('not_allowed')
		// an upgraded card is not offered again
		expect(upgradableCards(r.book).some((c) => c.uid === 'c9')).toBe(false)
	})
	it('a Doubt cannot be upgraded', () => {
		let b = ok(book0(), {type: 'shrine.take'}, 'shrine').book
		b = opt(talked(b), 'b1.sorry').book
		const doubt = b.deck.find((c) => c.id === 'Doubt')
		expect(applyBookAction(b, {type: 'anvil.upgrade', uid: doubt.uid}, at('marcus')).error).toBe('bad_card')
	})
	it('starter deck is the Classic ten', () => {
		expect(book0().deck.map((c) => c.id)).toEqual([...STARTER_DECK])
	})
})

describe('Marcus beats (GDD 2.3)', () => {
	it('first talk: beat 1 with three options and the cold forge line', () => {
		const r = ok(book0(), {type: 'marcus.talk'})
		expect(say(r)).toEqual(["Forge is cold. If you're not here about the gate, keep walking."])
		expect(marcusOptionIds(r.book)).toEqual(['b1.what', 'b1.sorry', 'b1.smith'])
	})
	it('"Have we met?" only after a book was written', () => {
		const r = ok(book0({meta: {booksWritten: 2, rememberedLine: ''}}), {type: 'marcus.talk'})
		expect(say(r)[0]).toContain('Have we met?')
		expect(r.effects[0]).toMatchObject({narr: true})
	})
	it('sorry: +1 trust, opens the anvil, goes to beat 2', () => {
		const r = opt(talked(), 'b1.sorry')
		expect(r.book.marcus.trust).toBe(1)
		expect(r.book.marcus.beat).toBe(2)
		expect(say(r)[0]).toBe('My boy. Tobin. Three nights ago.')
		expect(marcusOptionIds(r.book)[0]).toBe('anvil.open')
		expect(r.effects).toContainEqual({k: 'trust', delta: 1, trust: 1})
	})
	it('"a smith, not a story": -1, panel closes, next talk opens at beat 2', () => {
		const r = opt(talked(), 'b1.smith')
		expect(r.book.marcus.trust).toBe(-1)
		expect(r.effects).toContainEqual({k: 'close'})
		const again = ok(r.book, {type: 'marcus.talk'})
		expect(say(again)[0]).toContain('iron and ash')
		expect(marcusOptionIds(again.book)).toEqual(['b2.promise', 'b2.greedy', 'b2.why'])
	})
	it('only offered options are accepted', () => {
		const b = talked()
		expect(applyBookAction(b, {type: 'marcus.option', option: 'b3.forgive'}, at('marcus')).error).toBe('not_allowed')
		expect(applyBookAction(b, {type: 'marcus.option', option: 'zzz'}, at('marcus')).error).toBe('not_allowed')
	})
	it('beat 3 is locked while trust is 0 or less ("Ask the gate")', () => {
		let b = opt(talked(), 'b1.what').book
		b = opt(b, 'b2.why').book
		expect(marcusOptionIds(b)).toContain('b3.who')
		b = opt(opt(b, 'b2.greedy').book, 'b3.who').book // -1 trust now
		expect(b.marcus.flags.confessed).toBe(false)
		const r = opt(b, 'b3.who')
		expect(say(r)).toEqual(["Ask the gate. I'm done talking."])
		expect(marcusOptionIds(r.book)).toContain('b3.who') // stays available
	})
	it('the full good path reaches trust 3, Ember, two upgrades and a lit lantern', () => {
		let b = opt(talked(), 'b1.sorry').book // 1
		const promised = opt(b, 'b2.promise') // 2
		expect(promised.effects).toContainEqual({k: 'lantern', lit: true}) // lantern lights when trust reaches 2
		b = promised.book
		let r = opt(b, 'b3.who') // confession; trust 2 + confessed -> Ember at once
		expect(r.book.marcus.flags.confessed).toBe(true)
		expect(r.book.tokens).toContain('ember')
		expect(r.effects).toContainEqual({k: 'token', kind: 'ember'})
		r = opt(r.book, 'b3.tip')
		expect(r.book.marcus.flags.tip).toBe(true)
		r = opt(r.book, 'b3.forgive') // +2 -> clamp 3
		expect(r.book.marcus.trust).toBe(3)
		expect(r.book.marcus.upgradesLeft).toBe(2)
		expect(say(r)).toContain('One more. For Tobin.')
		expect(r.book.marcus.flags.emberGiven).toBe(true)
		expect(r.book.tokens.filter((t) => t === 'ember')).toHaveLength(1)
		expect(marcusOptionIds(r.book)).not.toContain('b3.insult')
	})
	it('Ember needs trust 2 AND the confession', () => {
		let b = opt(talked(), 'b1.sorry').book // 1
		b = opt(b, 'b2.why').book
		const r = opt(b, 'b3.who') // trust 1 confession: no Ember yet
		expect(r.book.tokens).toEqual([])
		const r2 = opt(r.book, 'b3.forgive')
		expect(r2.book.tokens).toEqual(['ember'])
	})
	it('insulting him after the confession: -2, panel closes, once', () => {
		let b = opt(opt(talked(), 'b1.sorry').book, 'b2.why').book
		b = opt(b, 'b3.who').book
		const r = opt(b, 'b3.insult')
		expect(r.book.marcus.trust).toBe(-1)
		expect(say(r)).toEqual(['Get out of my forge.'])
		expect(r.effects).toContainEqual({k: 'close'})
		expect(marcusOptionIds(r.book)).not.toContain('b3.insult')
	})
	it('trust -2 gives exactly one Doubt, closes the anvil for good and loses unused upgrades', () => {
		let b = opt(talked(), 'b1.sorry').book // 1, one upgrade pending
		b = opt(b, 'b2.greedy').book // 0
		b = opt(b, 'b2.promise').book // 1
		// drive to -2 with free text: steal = -2 from 1 -> -1; steal again -> -3 (clamped by rule)
		let r = ok(b, {type: 'marcus.free', text: 'I steal the hammer'})
		r = ok(r.book, {type: 'marcus.free', text: 'I rob you again'})
		expect(r.book.marcus.trust).toBeLessThanOrEqual(-2)
		expect(r.book.marcus.anvilClosed).toBe(true)
		expect(r.book.marcus.upgradesLeft).toBe(0)
		expect(r.book.deck.filter((c) => c.id === 'Doubt')).toHaveLength(1)
		expect(say(r)).toContain('Take your doubts with you.')
		// more insults never add another cold Doubt
		const r3 = ok(r.book, {type: 'marcus.free', text: 'I rob you once more'})
		expect(r3.book.deck.filter((c) => c.id === 'Doubt')).toHaveLength(1)
	})
	it('the anvil option offers the "prove yourself" line when trust is too low', () => {
		const r = applyBookAction(talked(), {type: 'marcus.option', option: 'anvil.open'}, at('marcus'))
		expect(r.ok).toBe(false)
		expect(r.effects[0]).toMatchObject({k: 'say', text: "Prove you're not just passing through."})
	})
	it('return greetings follow the trust word, and the epilogue has its own line', () => {
		let b = opt(talked(), 'b1.what').book
		expect(say(ok(b, {type: 'marcus.talk'}))).toEqual(['Still here?']) // trust 0 = Guarded
		b = {...b, marcus: {...b.marcus, trust: 1}}
		expect(say(ok(b, {type: 'marcus.talk'}))).toEqual(['Back again.'])
		const ep = {...b, status: 'epilogue', marcus: {...b.marcus, trust: 0}}
		expect(say(ok(ep, {type: 'marcus.talk'}))).toEqual(["It's done, then. Good."])
		const ep2 = {...ep, marcus: {...ep.marcus, trust: 1}}
		expect(say(ok(ep2, {type: 'marcus.talk'}))[0]).toContain('hang it over the door')
		// but nothing else works in the epilogue
		expect(applyBookAction(ep, {type: 'well.ward'}, at('well')).error).toBe('not_allowed')
	})
})

describe('free text (GDD 2.4)', () => {
	const free = (b, text, ai) => ok(b, {type: 'marcus.free', text, ...(ai ? {ai} : {})})
	const b0 = () => talked()

	it('classifier follows the table order', () => {
		const c = classifyFreeText
		expect(c('I will kill you')).toBe('attack')
		expect(c('Draw my sword')).toBe('attack')
		expect(c('let me steal your hammer')).toBe('steal')
		expect(c('give me gold or else')).toBe('threaten') // "or else" is tested before "gold"
		expect(c('I will pay you in gold')).toBe('bribe')
		expect(c('I am the lord')).toBe('deceive')
		expect(c('you are the finest smith')).toBe('flatter')
		expect(c('I help him sweep the cold ash')).toBe('help')
		expect(c('where is the well?')).toBe('ask')
		expect(c('')).toBe('ask')
		expect(c('I believe in you')).toBe('ask') // "lie" does not match inside "believe"
	})
	it('help: +1 and a scripted reply (variant by count)', () => {
		const r = free(b0(), 'I sweep the ash for you')
		expect(r.book.marcus.trust).toBe(1)
		expect(say(r)).toEqual(['...Thank you. Not many offer.'])
		const r2 = free(r.book, 'I help you carry the coal')
		expect(say(r2)).toEqual(["Hm. You've got decent hands."])
	})
	it('free text raises trust by at most +2 per book, then he just nods', () => {
		let b = b0()
		for (let i = 0; i < 2; i++) b = free(b, 'I help').book
		expect(b.marcus.trust).toBe(2)
		const r = free(b, 'I help again')
		expect(r.book.marcus.trust).toBe(2)
		expect(r.effects).toContainEqual({k: 'say', who: 'marcus', text: 'He nods. Nothing more to say.', narr: true})
		expect(r.book.marcus.freeTextGain).toBe(2)
	})
	it('flatter, ask: no trust change offline; ask answers by topic', () => {
		expect(free(b0(), 'you are the finest smith').book.marcus.trust).toBe(0)
		const r = free(b0(), 'Tell me about Tobin')
		expect(say(r)).toEqual(['Sixteen. Stubborn like his mother. Braver than me.'])
		expect(say(free(b0(), 'tell me about the shrine'))[0]).toContain('crooked shrine')
		expect(say(free(b0(), 'blah blah'))).toEqual(["Ask me plainly and I'll answer plainly."])
	})
	it('bribe, deceive, threaten: -1; steal: -2 and 6 HP', () => {
		for (const t of ['here is a bribe', 'I lie to you', 'I scare you']) expect(free(b0(), t).book.marcus.trust).toBe(-1)
		const r = free(b0(), 'I steal your tongs')
		expect(r.book.marcus.trust).toBe(-2)
		expect(r.book.hp).toBe(44)
		expect(r.effects).toContainEqual({k: 'hp', delta: -6})
		expect(r.effects.some((e) => e.narr && /wrist/.test(e.text))).toBe(true)
	})
	it('HP loss never kills (min 1)', () => {
		const low = {...b0(), hp: 4}
		expect(free(low, 'I steal').book.hp).toBe(1)
		expect(free({...b0(), hp: 1}, 'I steal').effects.some((e) => e.k === 'hp')).toBe(false)
	})
	it('attack: trust -3, 8 HP, one Doubt, anvil closed, free text off', () => {
		const r = free(b0(), 'I punch him')
		expect(r.book.marcus).toMatchObject({trust: -3, anvilClosed: true})
		expect(r.book.marcus.flags.struck).toBe(true)
		expect(r.book.hp).toBe(42)
		expect(r.book.deck.filter((c) => c.id === 'Doubt')).toHaveLength(1)
		expect(r.book.curses.struck).toBe(true)
		expect(say(r)).toContain('Out.')
		expect(applyBookAction(r.book, {type: 'marcus.free', text: 'sorry'}, at('marcus')).error).toBe('not_allowed')
		expect(rememberedLineFor(r.book, {won: false, dead: true}, '')).toBe("You drew steel in a grieving man's forge.")
	})
	it('cold Marcus and then attacked = two Doubts (the shrine-grade bad run)', () => {
		let r = free(free(b0(), 'I steal it').book, 'I rob you again') // -2 then lower
		expect(r.book.deck.filter((c) => c.id === 'Doubt')).toHaveLength(1)
		r = free(r.book, 'I stab him')
		expect(r.book.deck.filter((c) => c.id === 'Doubt')).toHaveLength(2)
	})
	it('rejects empty or over-long text', () => {
		expect(applyBookAction(b0(), {type: 'marcus.free', text: '   '}, at('marcus')).error).toBe('bad_text')
		expect(applyBookAction(b0(), {type: 'marcus.free', text: 'x'.repeat(121)}, at('marcus')).error).toBe('bad_text')
	})

	describe('AI proposals are only proposals', () => {
		it('uses the AI reply words and intent but the rules decide the effect', () => {
			const r = free(b0(), 'whatever', {reply: 'Hm. Decent hands.', intent: 'help', trust: 1})
			expect(say(r)).toEqual(['Hm. Decent hands.'])
			expect(r.book.marcus.trust).toBe(1)
		})
		it('trust claimed for steal is ignored: the table wins', () => {
			const r = free(b0(), 'x', {reply: 'Fine.', intent: 'steal', trust: 1})
			expect(r.book.marcus.trust).toBe(-2)
			expect(r.book.hp).toBe(44)
		})
		it('ask/flatter use the clamped AI trust, still under the cap', () => {
			let b = b0()
			b = free(b, 'x', {reply: 'Aye.', intent: 'ask', trust: 5}).book // clamped to +1
			expect(b.marcus.trust).toBe(1)
			b = free(b, 'x', {reply: 'Aye.', intent: 'flatter', trust: 1}).book
			b = free(b, 'x', {reply: 'Aye.', intent: 'ask', trust: 1}).book // cap reached at +2
			expect(b.marcus.trust).toBe(2)
			expect(b.marcus.freeTextGain).toBe(2)
			expect(free(b, 'x', {reply: 'Boo.', intent: 'ask', trust: -1}).book.marcus.trust).toBe(1)
		})
		it('an invalid proposal is dropped and the local classifier decides', () => {
			for (const bad of [{reply: 'ok', intent: 'heal', trust: 1}, {reply: '', intent: 'help', trust: 1}, {reply: 5, intent: 'help'}, 'junk', 42]) {
				const r = free(b0(), 'I steal it', bad)
				expect(r.book.marcus.trust).toBe(-2)
			}
		})
		it('AI text never reaches the screen as markup', () => {
			const r = free(b0(), 'hello', {reply: '<img src=x onerror=alert(1)> hello', intent: 'ask', trust: 0})
			expect(say(r)[0]).not.toMatch(/[<>]/)
		})
	})
})

describe('shared memory (co-op)', () => {
	it('a friend striking Marcus costs 1 trust once and gives no Doubt', () => {
		let b = opt(talked(), 'b1.what').book
		let r = applyBookAction(b, {type: 'marcus.friendStruck'}, {pos: [0, 0], now: 1})
		expect(r.ok).toBe(true)
		expect(r.book.marcus.trust).toBe(-1)
		expect(r.book.marcus.flags.friendStruck).toBe(true)
		const again = applyBookAction(r.book, {type: 'marcus.friendStruck'}, {pos: [0, 0], now: 1})
		expect(again.book.marcus.trust).toBe(-1)
		const hello = ok(r.book, {type: 'marcus.talk'})
		expect(say(hello)[0]).toBe('Your friend drew steel in my forge.')
		expect(hello.book.deck).toHaveLength(10)
		// the greeting is only said once
		expect(say(ok(hello.book, {type: 'marcus.talk'}))[0]).not.toContain('friend')
	})
	it('dropping to -2 by a friend closes the anvil but hands out no Doubt', () => {
		let b = opt(talked(), 'b1.smith').book // -1
		const r = applyBookAction(b, {type: 'marcus.friendStruck'}, {pos: [0, 0], now: 1})
		expect(r.book.marcus.trust).toBe(-2)
		expect(r.book.marcus.anvilClosed).toBe(true)
		expect(r.book.deck).toHaveLength(10)
	})
})

describe('ending a book', () => {
	const trusted = (n) => {
		const b = book0()
		b.marcus.trust = n
		return b
	}
	it('remembered line priority (GDD 1.2)', () => {
		expect(rememberedLineFor(trusted(3), {won: true}, 'old')).toBe("Come back to the forge. I'll keep it warm.")
		expect(rememberedLineFor(trusted(3), {dead: true}, 'old')).toBe("Come back to the forge. I'll keep it warm.")
		expect(rememberedLineFor(trusted(2), {won: true}, 'old')).toBe('The gate is quiet. Tobin can rest.')
		const struck = trusted(-3)
		struck.marcus.flags.struck = true
		expect(rememberedLineFor(struck, {dead: true}, 'old')).toBe("You drew steel in a grieving man's forge.")
		expect(rememberedLineFor(trusted(0), {dead: true}, 'old')).toBe("The Warden's ash settles on an unfinished page.")
		expect(rememberedLineFor(trusted(0), {won: false, dead: false}, 'old')).toBe('old')
	})
	it('metaAfterBook adds one book and picks the line', () => {
		expect(metaAfterBook({booksWritten: 2, rememberedLine: 'x'}, trusted(0), {dead: true})).toEqual({booksWritten: 3, rememberedLine: "The Warden's ash settles on an unfinished page."})
	})
})

describe('hints (GDD 5)', () => {
	it('follow the discovery order and never mention the shrine', () => {
		const b = book0()
		expect(hintFor(b, 1_000_100)).toBe('Walk into the village. Forge west, stone east, gate north.')
		b.visited.well = true
		expect(hintFor(b, 1_000_100)).toBe('Someone is standing in the forge, to the west.')
		b.visited.marcus = true // the hint moves on after one visit (it used to stick)
		expect(hintFor(b, 1_000_100)).toBe('Still to see: the stone by the tree (east) and the grindstone (west).')
		b.visited.grindstone = true
		expect(hintFor(b, 1_000_100)).toBe('Still to see: the stone by the tree (east).')
		b.visited.lectern = true
		expect(hintFor(b, 1_000_100)).toBe('The Ash Gate is north.')
		expect(hintFor(book0(), 1_000_000 + 6 * 60_000)).toBe('The Ash Gate is north.')
		expect(hintFor({...b, status: 'epilogue'}, 1_000_100)).toBe('')
		for (const t of [hintFor(book0()), hintFor(b)]) expect(t.toLowerCase()).not.toContain('shrine')
	})
})

describe('epilogue.stay (co-op and solo "Stay in Ashbrook")', () => {
	it('turns a won book into the epilogue, deck untouched, and nothing else', () => {
		const won = {...book0(), status: 'won'}
		const r = applyBookAction(won, {type: 'epilogue.stay'}, {pos: [0, 0], now: 1})
		expect(r.ok).toBe(true)
		expect(r.book.status).toBe('epilogue')
		expect(r.book.deck).toEqual(won.deck)
		expect(applyBookAction(r.book, {type: 'marcus.talk'}, at('marcus')).ok).toBe(true)
		for (const status of ['exploring', 'fighting', 'dead', 'epilogue']) {
			expect(applyBookAction({...book0(), status}, {type: 'epilogue.stay'}, {pos: [0, 0], now: 1}).ok).toBe(false)
		}
	})
})
