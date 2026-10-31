// Tests for the EVER combat adapter (pure, runs in Node). AGPL-3.0-or-later.
import {describe, expect, it} from 'vitest'
import * as C from '../../core/contracts.js'
import {createCard} from '../../../../vendor/slaytheweb/src/game/cards.js'
import {cards} from '../../../../vendor/slaytheweb/src/content/cards.js'
import {combatStep, createPartyCombat, engineCard, intentLabel, intentStep, outcome, tickTimers, viewFor} from './index.js'

const book = (fn = (b) => b, seed = 7) => fn(C.newBook({seed, now: 0}))
const solo = (b = book(), extra = {}) => createPartyCombat({fighters: [{seat: 0, book: b, name: 'Ana', ...extra}], enemyId: 'ashWarden', seed: 1, now: 0})

/** Put specific cards (by name) into a fighter's hand, taken from any pile. */
function setHand(pc, seat, names) {
	const f = pc.fighters.find((x) => x.seat === seat)
	const all = [...f.s.hand, ...f.s.drawPile, ...f.s.discardPile]
	const hand = []
	for (const n of names) {
		const i = all.findIndex((c) => c.name === n)
		if (i < 0) throw new Error('no ' + n)
		hand.push(all.splice(i, 1)[0])
	}
	f.s.hand = hand
	f.s.drawPile = all
	f.s.discardPile = []
	return hand
}
const play = (pc, seat, name, now = 0) => {
	const card = pc.fighters.find((x) => x.seat === seat).s.hand.find((c) => c.name === name)
	return combatStep(pc, seat, {type: 'play', cardId: card.id}, now)
}
const fighter = (pc, seat) => pc.fighters.find((x) => x.seat === seat)

describe('engine content fixes', () => {
	it('Pommel Strike draws 1 and Intimidate applies 1 Weak; upgrades do not leak into bases', () => {
		createCard('Pommel Strike', true)
		createCard('Intimidate', true)
		expect(cards.find((c) => c.name === 'Pommel Strike').actions[0].parameter.amount).toBe(1)
		expect(cards.find((c) => c.name === 'Intimidate').powers.weak).toBe(1)
		expect(createCard('Pommel Strike', true).actions[0].parameter.amount).toBe(2)
		expect(createCard('Intimidate', true).powers.weak).toBe(2)
	})
	it('engine cards use the book uid as instance id and keep the + name for upgrades', () => {
		const c = engineCard({uid: 'c4', id: 'Strike', upgraded: true})
		expect(c).toMatchObject({id: 'c4', name: 'Strike+', damage: 9, upgraded: true})
		expect(engineCard({uid: 'c9', id: 'Doubt', upgraded: false})).toMatchObject({type: 'curse', energy: 0})
	})
	it('intent steps and labels follow GDD 4 / 7.3', () => {
		expect([1, 2, 3, 4, 5].map((r) => intentStep(r, 0))).toEqual([1, 2, 3, 4, 1])
		expect(intentStep(1, 1)).toBe(2)
		expect(intentLabel({step: 2, damage: 8, block: 10})).toBe('Brace 8, Block 10')
		expect(intentLabel({step: 3, damage: 6, weak: 1})).toBe('Smother 6, Weak')
		expect(intentLabel({step: 4, damage: 20})).toBe('Ember Slam 20')
	})
})

describe('solo fight', () => {
	it('starts with the GDD numbers and does not touch the book', () => {
		const b = book()
		const snap = JSON.stringify(b)
		const pc = solo(b)
		const v = viewFor(pc, 0)
		expect(v.warden).toMatchObject({hp: 82, maxHp: 82, block: 0})
		expect(v.warden.intents).toEqual([expect.objectContaining({seat: 0, step: 1, damage: 12, label: 'Cleave 12'})])
		expect(v.fighters[0]).toMatchObject({hp: 50, maxHp: 50, energy: 3, block: 0, handCount: 5, drawCount: 5, discardCount: 0})
		expect(v.hand).toHaveLength(5)
		const pc2 = play(pc, 0, pc.fighters[0].s.hand[0].name).pc
		expect(pc2).not.toBe(pc)
		expect(JSON.stringify(b)).toBe(snap)
		expect(pc.warden.hp).toBe(82) // step does not mutate its input
	})

	it('uses the book HP and upgraded cards', () => {
		const b = book((x) => C.upgradeCard({...x, hp: 31}, 'c0'))
		const pc = solo(b)
		expect(fighter(pc, 0).s.player.currentHealth).toBe(31)
		setHand(pc, 0, ['Strike+'])
		const r = play(pc, 0, 'Strike+')
		expect(r.pc.warden.hp).toBe(82 - 9)
		expect(viewFor(pc, 0).hand[0]).toMatchObject({name: 'Strike', upgraded: true})
	})

	it('applies tokens at the start (Ember, Ward, Whetstone)', () => {
		const b = book((x) => C.addToken(C.addToken(C.addToken(x, 'ember'), 'ward'), 'whetstone'))
		const pc = solo(b)
		expect(fighter(pc, 0).s.player.currentEnergy).toBe(4)
		expect(fighter(pc, 0).s.player.block).toBe(8)
		expect(pc.warden.powers.vulnerable).toBe(2)
		expect(pc.startEvents.filter((e) => e.k === 'token').map((e) => e.text)).toEqual([
			'Ember burns: +1 Energy.',
			'Ward holds: 8 Block.',
			'Whetstone: the Warden is Vulnerable.',
		])
		// explicit spent list wins over book.tokens (room spends first, then passes the list)
		const pc2 = solo(book(), {tokens: ['ward']})
		expect(fighter(pc2, 0).s.player.block).toBe(8)
		expect(fighter(pc2, 0).s.player.currentEnergy).toBe(3)
	})

	it('plays cards through the engine: damage, energy, piles, Vulnerable', () => {
		const pc = solo()
		setHand(pc, 0, ['Bash', 'Strike', 'Defend'])
		let r = play(pc, 0, 'Bash')
		expect(r.error).toBeUndefined()
		expect(r.pc.warden.hp).toBe(74)
		expect(r.pc.warden.powers.vulnerable).toBe(2)
		expect(fighter(r.pc, 0).s.player.currentEnergy).toBe(1)
		expect(fighter(r.pc, 0).s.discardPile.map((c) => c.name)).toEqual(['Bash'])
		expect(r.events).toEqual(expect.arrayContaining([expect.objectContaining({k: 'play', text: 'Bash'}), expect.objectContaining({k: 'damage', seat: -1, amount: 8})]))
		r = play(r.pc, 0, 'Strike')
		expect(r.pc.warden.hp).toBe(74 - 9) // 6 * 1.5
		const denied = play(r.pc, 0, 'Defend')
		expect(denied.error).toBe('energy')
		expect(denied.pc).toBe(r.pc)
	})

	it('rejects Doubt, unknown cards, bad targets and plays after End turn', () => {
		const pc = solo(book((x) => C.addCurse(x, 'cold')))
		setHand(pc, 0, ['Doubt', 'Strike'])
		expect(play(pc, 0, 'Doubt').error).toBe('unplayable')
		expect(viewFor(pc, 0).hand[0]).toMatchObject({name: 'Doubt', unplayable: true, playable: false})
		expect(combatStep(pc, 0, {type: 'play', cardId: 'nope'}).error).toBe('no_card')
		const strike = fighter(pc, 0).s.hand[1]
		expect(combatStep(pc, 0, {type: 'play', cardId: strike.id, target: 'player'}).error).toBe('bad_target')
		expect(combatStep(pc, 3, {type: 'end'}).error).toBe('not_in_fight')
		expect(combatStep(pc, 0, {type: 'fly'}).error).toBe('bad_action')
	})

	it('End turn: Doubt tick ignores block, then the Warden acts, then a new round', () => {
		const pc = solo(book((x) => C.addCurse(x, 'shrine', 2)))
		setHand(pc, 0, ['Doubt', 'Doubt', 'Defend', 'Defend'])
		let r = play(pc, 0, 'Defend')
		r = play(r.pc, 0, 'Defend')
		r = combatStep(r.pc, 0, {type: 'end'})
		const f = fighter(r.pc, 0)
		// 50 - 4 (two Doubts, through block) - (12 Cleave - 10 block) = 44
		expect(f.s.player.currentHealth).toBe(44)
		expect(r.events.find((e) => e.k === 'doubt')).toMatchObject({amount: 4})
		expect(r.events.find((e) => e.k === 'intent')).toMatchObject({seat: 0, step: 1, amount: 2, blocked: 10})
		expect(r.pc.round).toBe(2)
		expect(f.s.hand).toHaveLength(5)
		expect(f.s.player).toMatchObject({currentEnergy: 3, block: 0})
		expect(f.ended).toBe(false)
		expect(viewFor(r.pc, 0).warden.intents[0]).toMatchObject({step: 2, label: 'Brace 8, Block 10'})
		// round 2: Brace gives the Warden 10 block that lasts into round 3
		r = combatStep(r.pc, 0, {type: 'end'})
		expect(r.pc.warden.block).toBe(10)
		expect(r.pc.round).toBe(3)
		// round 3: Smother applies Weak to the player (engine: 1 + 1 stacks, then ticks to 1)
		r = combatStep(r.pc, 0, {type: 'end'})
		expect(fighter(r.pc, 0).s.player.powers.weak).toBe(1)
		expect(r.pc.warden.block).toBe(0)
	})

	it('death at HP < 1 (0 HP is dead), and the outcome reports it', () => {
		const pc = solo(book((x) => ({...x, hp: 12})))
		setHand(pc, 0, ['Strike'])
		const r = combatStep(pc, 0, {type: 'end'})
		expect(fighter(r.pc, 0).s.player.currentHealth).toBe(0)
		expect(r.events.map((e) => e.k)).toEqual(expect.arrayContaining(['death', 'lose']))
		expect(outcome(r.pc)).toEqual({won: false, rounds: 1, bySeat: {0: {hpLeft: 0, dead: true, removed: false}}})
		expect(combatStep(r.pc, 0, {type: 'end'}).error).toBe('over')
	})

	it('a Doubt tick can kill before the Warden acts', () => {
		const pc = solo(book((x) => C.addCurse({...x, hp: 2}, 'cold')))
		setHand(pc, 0, ['Doubt'])
		const r = combatStep(pc, 0, {type: 'end'})
		expect(r.events.map((e) => e.k)).toEqual(['doubt', 'death', 'end', 'lose'])
	})

	it('win when the Warden falls; outcome carries hpLeft', () => {
		const pc = solo(book((x) => ({...x, hp: 40})))
		pc.warden.hp = 5
		setHand(pc, 0, ['Strike'])
		const r = play(pc, 0, 'Strike')
		expect(r.pc.over).toEqual({won: true})
		expect(r.events.at(-1)).toEqual({k: 'win'})
		expect(outcome(r.pc)).toMatchObject({won: true, rounds: 1, bySeat: {0: {hpLeft: 40, dead: false}}})
		expect(viewFor(r.pc, 0).hand.every((c) => !c.playable)).toBe(true)
	})

	it('Body Slam with 0 Block does not crash; Pommel Strike draws one card', () => {
		const pc = solo(book((x) => C.addCard(C.addCard(x, 'Body Slam'), 'Pommel Strike')))
		setHand(pc, 0, ['Body Slam', 'Pommel Strike'])
		let r = play(pc, 0, 'Body Slam')
		expect(r.error).toBeUndefined()
		expect(r.pc.warden.hp).toBe(82)
		r = play(r.pc, 0, 'Pommel Strike')
		expect(fighter(r.pc, 0).s.hand).toHaveLength(1)
		expect(r.pc.warden.hp).toBe(73)
	})

	it('PartyCombat survives a JSON round trip (the room stores it)', () => {
		let pc = JSON.parse(JSON.stringify(solo()))
		const name = fighter(pc, 0).s.hand.find((c) => c.energy <= 1).name
		pc = JSON.parse(JSON.stringify(play(pc, 0, name).pc))
		expect(combatStep(pc, 0, {type: 'end'}).error).toBeUndefined()
	})

	it('a simple bot always finishes the starter fight, and usually wins', () => {
		let wins = 0
		const N = 80
		for (let i = 0; i < N; i++) {
			let pc = createPartyCombat({fighters: [{seat: 0, book: C.newBook({seed: i, now: 0})}], seed: i + 1, now: 0})
			let guard = 0
			while (!pc.over && guard++ < 400) {
				const v = viewFor(pc, 0)
				const intent = v.warden.intents[0]
				const needBlock = intent && intent.damage - v.fighters[0].block > 6
				const pick = v.hand.filter((c) => c.playable).sort((a, b) => (needBlock ? (b.type === 'skill') - (a.type === 'skill') : (a.type === 'skill') - (b.type === 'skill')) || b.energy - a.energy)[0]
				pc = pick ? combatStep(pc, 0, {type: 'play', cardId: pick.id}).pc : combatStep(pc, 0, {type: 'end'}).pc
			}
			expect(pc.over).not.toBeNull()
			if (pc.over.won) wins++
		}
		expect(wins / N).toBeGreaterThan(0.4)
	}, 30_000)
})

describe('co-op fight (GDD 7.3)', () => {
	const duo = () =>
		createPartyCombat({
			fighters: [
				{seat: 2, book: book(undefined, 9), name: 'Bo'},
				{seat: 0, book: book(undefined, 8), name: 'Ana'},
			],
			seed: 3,
			now: 0,
		})

	it('scales Warden HP, offsets intents by seat order, hides other hands', () => {
		const pc = duo()
		expect(pc.warden.maxHp).toBe(184)
		expect(pc.fighters.map((f) => f.seat)).toEqual([0, 2])
		const v = viewFor(pc, 2)
		expect(v.warden.intents.map((i) => [i.seat, i.step, i.name])).toEqual([
			[0, 1, 'Ana'],
			[2, 2, 'Bo'],
		])
		expect(v.you).toBe(2)
		expect(v.hand.map((c) => c.id)).toEqual(fighter(pc, 2).s.hand.map((c) => c.id))
		expect(viewFor(pc, 1)).toMatchObject({you: -1, hand: []})
		const four = createPartyCombat({fighters: [0, 1, 2, 3].map((seat) => ({seat, book: book()})), now: 0})
		expect(four.warden.maxHp).toBe(374)
		expect(viewFor(four, 0).warden.intents.map((i) => i.step)).toEqual([1, 2, 3, 4])
	})

	it('shares the Warden: one Bash makes it Vulnerable for everyone', () => {
		let pc = duo()
		setHand(pc, 0, ['Bash'])
		setHand(pc, 2, ['Strike'])
		pc = play(pc, 0, 'Bash').pc
		const r = play(pc, 2, 'Strike')
		expect(r.pc.warden.hp).toBe(184 - 8 - 9)
	})

	it('waits for everyone, starts the 60 s timer on the first End turn, then resolves', () => {
		let pc = duo()
		const [strike] = setHand(pc, 0, ['Strike'])
		setHand(pc, 2, ['Defend'])
		let r = combatStep(pc, 0, {type: 'end'}, 1000)
		expect(r.pc.timerEndsAt).toBe(1000 + C.TURN_TIMER_MS)
		expect(r.pc.round).toBe(1)
		expect(combatStep(r.pc, 0, {type: 'play', cardId: strike.id}).error).toBe('not_your_turn')
		expect(combatStep(r.pc, 0, {type: 'end'}).error).toBe('not_your_turn')
		r = play(r.pc, 2, 'Defend', 2000)
		expect(r.error).toBeUndefined()
		expect(tickTimers(r.pc, 30_000).pc).toBe(r.pc)
		const t = tickTimers(r.pc, 61_000 + 1000)
		expect(t.events.map((e) => e.k)).toEqual(expect.arrayContaining(['end', 'intent', 'round']))
		expect(t.pc.round).toBe(2)
		// Cleave 12 on Ana (no block), Brace 8 on Bo (5 block) + 10 shared Warden block
		expect(fighter(t.pc, 0).s.player.currentHealth).toBe(38)
		expect(fighter(t.pc, 2).s.player.currentHealth).toBe(47)
		expect(t.pc.warden.block).toBe(10)
		expect(t.pc.timerEndsAt).toBeNull()
		expect(viewFor(t.pc, 0).warden.intents.map((i) => i.step)).toEqual([2, 3])
	})

	it('a dead fighter leaves the fight; the others play on; HP stays', () => {
		let pc = duo()
		fighter(pc, 0).s.player.currentHealth = 5
		pc = combatStep(pc, 0, {type: 'end'}).pc
		const r = combatStep(pc, 2, {type: 'end'})
		expect(fighter(r.pc, 0).dead).toBe(true)
		expect(r.pc.over).toBeNull()
		expect(r.pc.warden.maxHp).toBe(184)
		const v = viewFor(r.pc, 2)
		expect(v.warden.intents.map((i) => [i.seat, i.step])).toEqual([[2, 2]]) // slot gone, offsets recomputed
		expect(combatStep(r.pc, 0, {type: 'end'}).error).toBe('not_in_fight')
		expect(outcome(r.pc)).toBeNull()
	})

	it('disconnected fighters auto-end, are skipped by the Warden, and get their hand back', () => {
		let pc = duo()
		const handBefore = fighter(pc, 2).s.hand.map((c) => c.id)
		pc = combatStep(pc, 2, {type: 'disconnect'}).pc
		const r = combatStep(pc, 0, {type: 'end'})
		expect(r.pc.round).toBe(2)
		expect(fighter(r.pc, 2).s.player.currentHealth).toBe(50) // skipped
		expect(fighter(r.pc, 2).s.hand.map((c) => c.id)).toEqual(handBefore)
		expect(fighter(r.pc, 2).ended).toBe(true)
		const back = combatStep(r.pc, 2, {type: 'reconnect'})
		expect(fighter(back.pc, 2).ended).toBe(false)
		expect(viewFor(back.pc, 2).hand.some((c) => c.playable)).toBe(true)
	})

	it('everyone away: the round waits; removing all fighters loses the fight', () => {
		let pc = duo()
		pc = combatStep(pc, 0, {type: 'disconnect'}).pc
		pc = combatStep(pc, 2, {type: 'disconnect'}).pc
		expect(pc.round).toBe(1)
		pc = combatStep(pc, 0, {type: 'remove'}).pc
		const r = combatStep(pc, 2, {type: 'remove'})
		expect(r.pc.over).toEqual({won: false})
		expect(outcome(r.pc).bySeat[0]).toMatchObject({dead: false, removed: true})
	})
})
