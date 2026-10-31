// Solo CombatDriver tests (Node, no DOM). AGPL-3.0-or-later.
import {describe, expect, it} from 'vitest'
import * as C from '../core/contracts.js'
import {createLocalCombatDriver} from './driver.js'

const tick = () => new Promise((r) => setTimeout(r, 0))

describe('createLocalCombatDriver', () => {
	it('implements the CombatDriver contract and never changes the book', async () => {
		const book = C.addToken(C.addCurse(C.newBook({seed: 5, now: 0}), 'cold'), 'ember')
		const snap = JSON.stringify(book)
		const d = createLocalCombatDriver({book, enemyId: 'ashWarden', seed: 2})
		const seen = []
		d.onView((v, ev) => seen.push({v, ev}))
		await tick()
		expect(seen[0].ev.map((e) => e.k)).toEqual(['round', 'token'])
		expect(d.view().fighters[0].energy).toBe(4)
		const card = d.view().hand.find((c) => c.playable)
		expect(await d.play(card.id)).toEqual({ok: true})
		expect(seen.at(-1).ev[0]).toMatchObject({k: 'play'})
		expect(await d.play('nope')).toEqual({ok: false, error: 'no_card'})
		await d.endTurn()
		expect(d.view().round).toBe(2)
		expect(JSON.stringify(book)).toBe(snap)
		expect(book.tokens).toEqual(['ember'])
	})

	it('resolves done with {won, hpLeft, turns, dead}', async () => {
		const d = createLocalCombatDriver({book: {...C.newBook({seed: 1, now: 0}), hp: 30}, seed: 4})
		d.pc().warden.hp = 1
		const atk = d.view().hand.find((c) => c.type === 'attack' && c.playable)
		if (atk) await d.play(atk.id)
		else {
			// a hand of five Defends: survive a turn and try again
			await d.endTurn()
			d.pc().warden.hp = 1
			await d.play(d.view().hand.find((c) => c.type === 'attack').id)
		}
		const r = await d.done
		expect(r.won).toBe(true)
		expect(r.dead).toBe(false)
		expect(r.hpLeft).toBeGreaterThan(0)
		expect(r.turns).toBeGreaterThanOrEqual(1)
		expect(await d.endTurn()).toEqual({ok: false, error: 'over'})
	})

	it('a death resolves as {won: false, hpLeft: 0, dead: true}', async () => {
		const d = createLocalCombatDriver({book: {...C.newBook({seed: 1, now: 0}), hp: 3}})
		await d.endTurn()
		expect(await d.done).toEqual({won: false, hpLeft: 0, turns: 1, dead: true})
	})

	it('a whole fight with a village-built deck (upgrade, gain, curses, all tokens) leaves the book untouched', async () => {
		let book = C.newBook({seed: 9, now: 0})
		book = C.upgradeCard(book, book.deck.find((c) => c.id === 'Bash').uid)
		book = C.addCard(book, 'Pommel Strike')
		book = C.addCard(book, 'Bludgeon')
		book = C.addCurse(book, 'shrine', 2)
		for (const t of ['ember', 'ward', 'whetstone']) book = C.addToken(book, t)
		const snap = JSON.stringify(book)
		const d = createLocalCombatDriver({book, seed: 11})
		const v0 = d.view()
		expect(v0.fighters[0]).toMatchObject({energy: 4, block: 8})
		expect(v0.warden.powers.vulnerable).toBe(2)
		// greedy bot: play whatever is playable (cheapest last), then end the turn
		for (let guard = 0; guard < 60 && !d.view().over; guard++) {
			let card
			while (!d.view().over && (card = d.view().hand.filter((c) => c.playable && c.energy <= d.view().fighters[0].energy).sort((a, b) => b.energy - a.energy)[0])) {
				expect((await d.play(card.id)).ok).toBe(true)
			}
			if (!d.view().over) await d.endTurn()
		}
		const r = await d.done
		expect(typeof r.won).toBe('boolean')
		expect(JSON.stringify(book)).toBe(snap)
		// the engine's piles never hold more cards than the book's deck
		const f = d.pc().fighters[0].s
		expect(f.hand.length + f.drawPile.length + f.discardPile.length + f.exhaustPile.length).toBeLessThanOrEqual(book.deck.length)
	})

	it('rejects unknown enemies', () => {
		expect(() => createLocalCombatDriver({book: C.newBook(), enemyId: 'dragon'})).toThrow(RangeError)
	})
})
