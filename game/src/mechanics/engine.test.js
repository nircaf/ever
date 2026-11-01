// Tests: compiled generated content playing through the shared combat rules (the same code
// the room server runs). Pure, runs in Node. AGPL-3.0-or-later.
import {describe, expect, it} from 'vitest'
import * as C from '../core/contracts.js'
import {combatStep, createPartyCombat, engineCard, viewFor} from '../combat/rules/index.js'
import {addContent, afterFight, compileCard, compileDeckCard, createRunContent, upgradedCard, validateContent} from './index.js'

/** Validate (no sim) and add to a run; returns [rc, id]. */
function add(rc, raw, opts = {}) {
	const v = validateContent(raw, {rarity: raw.kind === 'card' || raw.kind === 'item' ? 'rare' : undefined, ...opts})
	if (!v.ok) throw new Error(`${raw.name}: ${v.errors.map((e) => e.msg).join('; ')}`)
	const r = addContent(rc, v.def, {offer: opts.offer})
	return [r.rc, r.id]
}

/** A one-fighter fight with a fixed small deck; `hand` = uids forced into the opening hand. */
function fight({deck, content, items = [], tokens = [], hand, enemyId = 'ashWarden'}) {
	const book = C.newBook({seed: 7, now: 0})
	book.deck = deck.map((d, i) => ({uid: `u${i}`, upgraded: false, ...d}))
	book.content = content
	book.items = items
	book.tokens = tokens
	const pc = createPartyCombat({fighters: [{seat: 0, book, name: 'Ana'}], enemyId, seed: 3, now: 0})
	if (hand) {
		const f = pc.fighters[0]
		const all = [...f.s.hand, ...f.s.drawPile, ...f.s.discardPile]
		f.s.hand = hand.map((uid) => all.find((c) => c.id === uid))
		f.s.drawPile = all.filter((c) => !hand.includes(c.id))
		f.s.discardPile = []
	}
	return pc
}
const play = (pc, uid, target) => {
	const r = combatStep(pc, 0, {type: 'play', cardId: uid, ...(target ? {target} : {})}, 0)
	if (r.error) throw new Error(`play ${uid}: ${r.error}`)
	return r
}
const end = (pc) => combatStep(pc, 0, {type: 'end'}, 0)
const me = (pc) => pc.fighters[0]
const strikes = (n) => Array.from({length: n}, () => ({id: 'Strike'}))

describe('compiler', () => {
	it('an attack lowers its first plain hit into the engine damage field; the rest is everOps', () => {
		const def = validateContent({kind: 'card', name: 'Twin Fang', type: 'attack', energy: 1, effects: [{do: 'damage', n: 3, hits: 2}, {do: 'power', kind: 'weak', n: 1}]}, {rarity: 'rare'}).def
		const c = compileCard(def)
		expect(c).toMatchObject({name: 'Twin Fang', type: 'attack', energy: 1, target: 'enemy', damage: 3, description: 'Deal 3 damage 2 times. Apply 1 Weak.'})
		expect(c.actions).toEqual([{type: 'everOps', parameter: {ops: [{do: 'damage', n: 3, hits: 1, target: 'enemy'}, {do: 'power', kind: 'weak', n: 1, target: 'enemy', fight: false}]}}])
		expect(JSON.parse(JSON.stringify(c))).toEqual(c) // plain data, no functions
		const up = compileCard(def, {upgraded: true})
		expect(up.name).toBe('Twin Fang+')
		expect(up.description).not.toBe(c.description)
	})
	it('skills target the player; curses are unplayable engine curses', () => {
		const sk = validateContent({kind: 'card', name: 'Hush', type: 'skill', energy: 1, effects: [{do: 'block', n: 6}]}, {rarity: 'common'}).def
		expect(compileCard(sk)).toMatchObject({target: 'player', damage: 0})
		const cu = validateContent({kind: 'curse', name: 'Slag', triggers: [{on: 'turnEnd', effects: [{do: 'loseHp', n: 1}]}]}, {offer: 'curse'}).def
		expect(compileCard(cu)).toMatchObject({type: 'curse', conditions: [{type: 'unplayable'}], everCurse: true, everTriggers: [{on: 'turnEnd'}]})
	})
	it('engineCard compiles generated deck entries and inline defs, leaves engine names alone', () => {
		let rc = createRunContent()
		let id
		;[rc, id] = add(rc, {kind: 'card', name: 'Quenched Edge', type: 'attack', energy: 1, effects: [{do: 'damage', n: 8}]})
		expect(engineCard({uid: 'c3', id, upgraded: false}, rc)).toMatchObject({id: 'c3', name: 'Quenched Edge', damage: 8, everGen: id})
		expect(compileDeckCard({uid: 'c4', id: 'x', def: {kind: 'card', name: 'Inline Cut', type: 'attack', energy: 1, effects: [{do: 'damage', n: 5}]}})).toMatchObject({id: 'c4', damage: 5})
		expect(() => compileDeckCard({uid: 'c5', id: 'x', def: {kind: 'card', effects: [{do: 'nuke'}]}})).toThrow(/invalid/)
		expect(engineCard({uid: 'c6', id: 'Strike', upgraded: false}, rc)).toMatchObject({id: 'c6', name: 'Strike', damage: 6})
	})
	it('upgrades are deterministic and never stored', () => {
		const def = validateContent({kind: 'card', name: 'Hot Rivet', type: 'attack', energy: 1, effects: [{do: 'damage', n: 6}]}, {rarity: 'common'}).def
		expect(upgradedCard(def)).toEqual(upgradedCard(def))
		expect(upgradedCard(def).effects[0].n).toBe(8)
	})
})

describe('generated content in a real party fight', () => {
	it('a generated attack hits through the engine (Strength, Vulnerable apply) and runs its ops', () => {
		let rc = createRunContent()
		let id
		;[rc, id] = add(rc, {kind: 'card', name: 'Crow Ledger', type: 'attack', energy: 2, effects: [{do: 'damage', n: 6}, {do: 'power', kind: 'vulnerable', n: 2}, {do: 'block', n: 3}]})
		const pc = fight({deck: [{id}, ...strikes(4)], content: rc, hand: ['u0', 'u1', 'u2', 'u3', 'u4']})
		const r1 = play(pc, 'u0')
		expect(r1.pc.warden.hp).toBe(82 - 6)
		expect(r1.pc.warden.powers.vulnerable).toBe(2)
		expect(me(r1.pc).s.player.block).toBe(3)
		const r2 = play(r1.pc, 'u1') // Strike into Vulnerable: 6 * 1.5
		expect(r2.pc.warden.hp).toBe(82 - 6 - 9)
		const view = viewFor(r2.pc, 0)
		expect(view.hand.every((c) => typeof c.description === 'string')).toBe(true)
	})
	it('multi-hit, draw, energy, heal, lose HP, discard, exhaust and add-card ops resolve', () => {
		let rc = createRunContent()
		let a, b, c
		;[rc, a] = add(rc, {kind: 'card', name: 'Flurry', type: 'attack', energy: 1, effects: [{do: 'damage', n: 3, hits: 3}]})
		;[rc, b] = add(rc, {kind: 'card', name: 'Lamp Round', type: 'skill', energy: 1, exhaust: true, effects: [{do: 'energy', n: 1}, {do: 'draw', n: 2}, {do: 'loseHp', n: 2}]})
		;[rc, c] = add(rc, {kind: 'card', name: 'Call for Help', type: 'skill', energy: 0, effects: [{do: 'addCard', card: 'Strike', pile: 'hand'}, {do: 'discard', n: 1}]})
		const pc = fight({deck: [{id: a}, {id: b}, {id: c}, ...strikes(6)], content: rc, hand: ['u0', 'u1', 'u2']})
		const r1 = play(pc, 'u0')
		expect(r1.pc.warden.hp).toBe(82 - 9)
		const before = me(r1.pc).s
		const r2 = play(r1.pc, 'u1')
		const s = me(r2.pc).s
		expect(s.player.currentEnergy).toBe(before.player.currentEnergy - 1 + 1)
		expect(s.player.currentHealth).toBe(before.player.currentHealth - 2)
		expect(s.hand.length).toBe(before.hand.length - 1 + 2)
		expect(s.exhaustPile.map((x) => x.id)).toContain('u1')
		const r3 = play(r2.pc, 'u2') // add a Strike to hand, then discard a random card
		const s3 = me(r3.pc).s
		expect(s3.hand.length).toBe(s.hand.length - 1 + 1 - 1)
		expect([...s3.hand, ...s3.discardPile].some((x) => x.name === 'Strike' && /^m0x/.test(x.id))).toBe(true)
		expect(s3.discardPile.length).toBe(s.discardPile.length + 2)
	})
	it('conditions: hpBelow, enemyIntendsAttack, firstTimeThisFight', () => {
		let rc = createRunContent()
		let a
		;[rc, a] = add(rc, {kind: 'card', name: 'Watchful Ward', type: 'skill', energy: 1, effects: [{do: 'block', n: 4}, {do: 'block', n: 5, if: 'enemyIntendsAttack'}, {do: 'block', n: 7, if: {hpBelow: 20}}]})
		const pc = fight({deck: [{id: a}, ...strikes(4)], content: rc, hand: ['u0']})
		expect(me(play(pc, 'u0').pc).s.player.block).toBe(9) // the Warden opens with Cleave
		pc.fighters[0].s.player.currentHealth = 5
		expect(me(play(pc, 'u0').pc).s.player.block).toBe(16)
	})
	it('scaling counts cards in hand, capped', () => {
		let rc = createRunContent()
		let a
		;[rc, a] = add(rc, {kind: 'card', name: 'Crowd Shield', type: 'skill', energy: 1, effects: [{do: 'block', n: 2, scale: {per: 'cardInHand', each: 2, cap: 3}}]})
		const pc = fight({deck: [{id: a}, ...strikes(6)], content: rc, hand: ['u0', 'u1', 'u2', 'u3', 'u4', 'u5']})
		expect(me(play(pc, 'u0').pc).s.player.block).toBe(2 + 2 * 3) // 5 left in hand, cap 3
	})
	it('retain keeps a card through the end of turn; nextTurn effects land next turn', () => {
		let rc = createRunContent()
		let a, b
		;[rc, a] = add(rc, {kind: 'card', name: 'Kept Vow', type: 'skill', energy: 1, retain: true, effects: [{do: 'block', n: 5}]})
		;[rc, b] = add(rc, {kind: 'card', name: 'Patient Spark', type: 'skill', energy: 1, effects: [{do: 'block', n: 3}, {do: 'block', n: 6, when: 'nextTurn'}]})
		const pc = fight({deck: [{id: a}, {id: b}, ...strikes(8)], content: rc, hand: ['u0', 'u1', 'u2']})
		const r1 = play(pc, 'u1')
		const r2 = end(r1.pc)
		const s = me(r2.pc).s
		expect(r2.pc.round).toBe(2)
		expect(s.hand.map((c) => c.id)).toContain('u0')
		expect(s.player.block).toBe(6) // block reset at the new turn, then the delayed 6
	})
	it('power cards register triggers for the rest of the fight', () => {
		let rc = createRunContent()
		let a
		;[rc, a] = add(rc, {kind: 'card', name: 'Banked Fire', type: 'power', energy: 2, effects: [], triggers: [{on: 'turnStart', effects: [{do: 'block', n: 2}]}, {on: 'onPlay', type: 'attack', effects: [{do: 'damage', n: 1}]}]})
		const pc = fight({deck: [{id: a}, ...strikes(8)], content: rc, hand: ['u0', 'u1']})
		const r1 = play(pc, 'u0')
		const r2 = play(r1.pc, 'u1') // Strike 6 + trigger 1
		expect(r2.pc.warden.hp).toBe(82 - 7)
		expect(r2.events.some((e) => e.k === 'mech' && /Banked Fire/.test(e.text))).toBe(true)
		const r3 = end(r2.pc)
		expect(me(r3.pc).s.player.block).toBe(2)
	})
	it('items fire on fightStart, onPlay, onHpLoss; Thorns returns damage; stats are data', () => {
		let rc = createRunContent()
		let apron, ring, coat
		;[rc, apron] = add(rc, {kind: 'item', name: 'Smith Apron', slot: 'body', triggers: [{on: 'combatStart', effects: [{do: 'block', n: 8}]}]})
		;[rc, ring] = add(rc, {kind: 'item', name: 'Briar Ring', slot: 'hand', triggers: [{on: 'onPlay', type: 'attack', effects: [{do: 'power', kind: 'poison', n: 1}]}]})
		;[rc, coat] = add(rc, {kind: 'item', name: 'Thorn Coat', slot: 'charm', triggers: [{on: 'fightStart', effects: [{do: 'power', kind: 'thorns', n: 2, target: 'self', fight: true}]}, {on: 'onDamageTaken', effects: [{do: 'block', n: 1}]}]})
		const pc = fight({deck: strikes(6), content: rc, items: [apron, ring, coat], hand: ['u0', 'u1', 'u2', 'u3', 'u4']})
		expect(me(pc).s.player.block).toBe(8)
		expect(pc.startEvents.filter((e) => e.k === 'mech').map((e) => e.text)).toEqual(['Smith Apron.', 'Thorn Coat.'])
		const r1 = play(pc, 'u0')
		expect(r1.pc.warden.powers.poison).toBe(1)
		const r2 = end(r1.pc) // Warden: Cleave 12 into 8 Block -> 4 HP lost; Thorns 2; Poison 1 ticks first
		expect(r2.pc.warden.hp).toBe(82 - 6 - 1 - 2)
		expect(me(r2.pc).s.player.currentHealth).toBe(50 - 4)
		expect(me(r2.pc).s.player.powers.thorns).toBe(2) // "rest of the fight" survives the decay
	})
	it('curses tick at turn end and fire when drawn; generated tokens resolve at fight start', () => {
		let rc = createRunContent()
		let slag, undertow, tok
		;[rc, slag] = add(rc, {kind: 'curse', name: 'Slag', triggers: [{on: 'turnEnd', effects: [{do: 'loseHp', n: 2}]}]}, {offer: 'curse'})
		;[rc, undertow] = add(rc, {kind: 'curse', name: 'Undertow', triggers: [{on: 'onDraw', effects: [{do: 'discard', n: 1}]}]}, {offer: 'curse'})
		;[rc, tok] = add(rc, {kind: 'token', name: 'Lucky Coal', effects: [{do: 'power', kind: 'strength', n: 1, target: 'self', fight: true}, {do: 'block', n: 2}]})
		const pc = fight({deck: [{id: slag}, {id: undertow}, ...strikes(3)], content: rc, tokens: [tok]})
		const s = me(pc).s
		expect(s.hand.length).toBe(4) // Undertow drawn in the opening hand discards one
		expect(s.discardPile.length).toBe(1)
		expect(s.player.powers.strength).toBe(1)
		expect(s.player.block).toBe(2)
		expect(play(pc, s.hand.find((c) => c.name === 'Strike').id).pc.warden.hp).toBe(82 - 7)
		expect(combatStep(pc, 0, {type: 'play', cardId: s.hand.find((c) => c.name === 'Slag').id}, 0).error).toBe('unplayable')
		const r = end(pc)
		const hpLoss = r.events.filter((e) => e.k === 'intent')[0]
		expect(me(r.pc).s.player.currentHealth).toBe(50 - 2 - hpLoss.amount)
	})
	it('Lose HP can kill the player mid-turn and ends the fight', () => {
		let rc = createRunContent()
		let a
		;[rc, a] = add(rc, {kind: 'card', name: 'Last Price', type: 'attack', energy: 1, effects: [{do: 'damage', n: 14}, {do: 'loseHp', n: 6}]}, {offer: 'bargain'})
		const pc = fight({deck: [{id: a}, ...strikes(4)], content: rc, hand: ['u0']})
		pc.fighters[0].s.player.currentHealth = 3
		const r = play(pc, 'u0')
		expect(r.pc.over).toEqual({won: false})
	})
	it('onKill triggers and fightWon healing (book-side, out of combat)', () => {
		let rc = createRunContent()
		let ring
		;[rc, ring] = add(rc, {kind: 'item', name: 'Vigil Ring', slot: 'charm', triggers: [{on: 'onKill', effects: [{do: 'block', n: 3}]}, {on: 'fightWon', effects: [{do: 'healNow', n: 4}]}]})
		const pc = fight({deck: strikes(5), content: rc, items: [ring], hand: ['u0']})
		pc.warden.hp = 3
		const r = play(pc, 'u0')
		expect(r.pc.over).toEqual({won: true})
		expect(r.events.some((e) => e.k === 'mech' && e.text === 'Vigil Ring.')).toBe(true)
		expect(afterFight({itemDefs: [rc.defs[ring]], won: true})).toEqual({heal: 4})
		expect(afterFight({itemDefs: [rc.defs[ring]], won: false})).toEqual({heal: 0})
	})
	it('the fight state stays plain JSON (the room persists it)', () => {
		let rc = createRunContent()
		let a, ring
		;[rc, a] = add(rc, {kind: 'card', name: 'Flurry', type: 'attack', energy: 1, effects: [{do: 'damage', n: 3, hits: 3}]})
		;[rc, ring] = add(rc, {kind: 'item', name: 'Smith Apron', slot: 'body', triggers: [{on: 'fightStart', effects: [{do: 'block', n: 8}]}]})
		let pc = fight({deck: [{id: a}, ...strikes(6)], content: rc, items: [ring]})
		for (let i = 0; i < 4 && !pc.over; i++) {
			const c = me(pc).s.hand.find((x) => x.energy <= me(pc).s.player.currentEnergy)
			pc = (c ? play(pc, c.id) : end(pc)).pc
		}
		expect(JSON.parse(JSON.stringify(pc))).toEqual(pc)
	})
	it('two fighters keep separate mechanics state', () => {
		let rc = createRunContent()
		let ring
		;[rc, ring] = add(rc, {kind: 'item', name: 'Smith Apron', slot: 'body', triggers: [{on: 'fightStart', effects: [{do: 'block', n: 8}]}]})
		const b1 = C.newBook({seed: 1, now: 0})
		const b2 = C.newBook({seed: 2, now: 0})
		const pc = createPartyCombat({fighters: [{seat: 0, book: {...b1, content: rc, items: [ring]}, name: 'A'}, {seat: 1, book: b2, name: 'B'}], enemyId: 'ashWarden', seed: 1, now: 0})
		expect(pc.fighters[0].s.player.block).toBe(8)
		expect(pc.fighters[1].s.player.block).toBe(0)
		expect(pc.fighters[1].s.mech.items).toEqual([])
	})
})
