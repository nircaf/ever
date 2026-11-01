// Tests: the fast balance simulator. (1) Single plays match the real shared combat rules
// exactly; (2) results are deterministic; (3) outliers are rejected; (4) it is fast.
// Pure, runs in Node. AGPL-3.0-or-later.
import {describe, expect, it} from 'vitest'
import * as C from '../core/contracts.js'
import {ENEMIES, combatStep, createPartyCombat} from '../combat/rules/index.js'
import {KEEPSAKES, SIM_ENEMIES, addContent, balanceCheck, createRunContent, deckCards, generateContent, normalizeContent, simulateFight, validateContent, wardenHpForPages} from './index.js'
import {simPlay} from './sim.js'

const def = (raw) => {
	const n = normalizeContent(raw)
	if (!n.def) throw new Error(n.errors.map((e) => e.msg).join('; '))
	return n.def
}

describe('parity with the real engine (one play)', () => {
	const PROBES = [
		{kind: 'card', name: 'Flurry', type: 'attack', energy: 1, effects: [{do: 'damage', n: 3, hits: 3}, {do: 'power', kind: 'vulnerable', n: 1}]},
		{kind: 'card', name: 'Crow Ledger', type: 'attack', energy: 2, effects: [{do: 'damage', n: 6}, {do: 'damage', n: 0, scale: {per: 'enemyDebuff', each: 4, cap: 3}}]},
		{kind: 'card', name: 'Lamp Round', type: 'skill', energy: 1, exhaust: true, effects: [{do: 'energy', n: 1}, {do: 'draw', n: 2}, {do: 'loseHp', n: 2}]},
		{kind: 'card', name: 'Call for Help', type: 'skill', energy: 0, effects: [{do: 'addCard', card: 'Strike', pile: 'draw'}, {do: 'discard', n: 1}, {do: 'exhaust', n: 1}]},
		{kind: 'card', name: 'Quiet Vow', type: 'skill', energy: 1, effects: [{do: 'block', n: 4}, {do: 'block', n: 5, if: 'enemyIntendsAttack'}, {do: 'heal', n: 3}, {do: 'power', kind: 'strength', n: 1, target: 'self'}]},
		{kind: 'card', name: 'Sweep', type: 'attack', energy: 1, target: 'allEnemies', effects: [{do: 'damage', n: 5, target: 'allEnemies'}, {do: 'power', kind: 'poison', n: 3, target: 'allEnemies'}]},
		{kind: 'card', name: 'Banked Fire', type: 'power', energy: 1, effects: [], triggers: [{on: 'onPlay', type: 'attack', effects: [{do: 'block', n: 1}]}]},
	]
	it('simPlay leaves exactly the state combatStep leaves', () => {
		let rc = createRunContent()
		const ids = []
		for (const p of PROBES) {
			const r = addContent(rc, def(p))
			rc = r.rc
			ids.push(r.id)
		}
		const engineNames = ['Strike', 'Bash', 'Iron Wave', 'Thunderclap', 'Sucker Punch', 'Defend', 'Pommel Strike']
		const all = [...ids.map((id) => ({id})), ...engineNames.map((id) => ({id}))]
		for (let k = 0; k < all.length; k++) {
			const book = C.newBook({seed: 7, now: 0})
			book.deck = [all[k], ...all.filter((_, j) => j !== k)].map((d, i) => ({uid: `u${i}`, upgraded: false, ...d}))
			book.content = rc
			const pc = createPartyCombat({fighters: [{seat: 0, book, name: 'A'}], enemyId: 'ashWarden', seed: 1, now: 0})
			const f = pc.fighters[0]
			const pool = [...f.s.hand, ...f.s.drawPile]
			f.s.hand = ['u0', 'u1', 'u2', 'u3'].map((u) => pool.find((c) => c.id === u))
			f.s.drawPile = pool.filter((c) => !f.s.hand.includes(c))
			f.s.player.currentHealth = 40
			pc.warden.powers = {weak: 1}
			// Sim on a copy of the same starting state.
			const simPc = {warden: structuredClone(pc.warden), fighters: [structuredClone(f)]}
			simPlay(simPc, simPc.fighters[0], simPc.fighters[0].s.hand[0])
			const real = combatStep(pc, 0, {type: 'play', cardId: 'u0'}, 0).pc
			const rf = real.fighters[0].s
			const sf = simPc.fighters[0].s
			const name = all[k].id
			expect({hp: simPc.warden.hp, block: simPc.warden.block, powers: simPc.warden.powers}, name).toEqual({hp: real.warden.hp, block: real.warden.block, powers: real.warden.powers})
			expect(sf.player, name).toEqual(rf.player)
			for (const pile of ['hand', 'drawPile', 'discardPile', 'exhaustPile']) expect(sf[pile].map((c) => c.name), `${name} ${pile}`).toEqual(rf[pile].map((c) => c.name))
		}
	})
	it('the sim enemies match the combat rules where both exist', () => {
		expect(SIM_ENEMIES.ashWarden.hp).toBe(ENEMIES.ashWarden.hpByParty[0])
		expect(SIM_ENEMIES.ashWarden.intents.map(({damage, block, weak}) => ({damage, block, weak}))).toEqual(
			ENEMIES.ashWarden.intents.map(({damage, block, weak}) => ({damage, block, weak})),
		)
		expect(wardenHpForPages(9)).toBe(120)
		expect(wardenHpForPages(8)).toBe(112)
	})
})

describe('simulateFight', () => {
	it('every keepsake wins the first fight on its own (GDD_V2 4)', () => {
		for (const k of KEEPSAKES) {
			const cards = deckCards([{def: k}])
			let wins = 0
			for (let i = 0; i < 10; i++) wins += simulateFight({cards, enemy: SIM_ENEMIES.motes, seed: i}).won ? 1 : 0
			expect(wins, k.name).toBeGreaterThanOrEqual(9)
		}
	})
	it('is deterministic for a seed and varies across seeds', () => {
		const cards = deckCards([{id: 'Strike'}, {id: 'Defend'}, {id: 'Bash'}, {id: 'Strike'}, {id: 'Defend'}, {id: 'Iron Wave'}, {id: 'Defend'}])
		const a = simulateFight({cards, enemy: SIM_ENEMIES.husk, seed: 'x'})
		expect(simulateFight({cards, enemy: SIM_ENEMIES.husk, seed: 'x'})).toEqual(a)
		const all = new Set(Array.from({length: 12}, (_, i) => JSON.stringify(simulateFight({cards, enemy: SIM_ENEMIES.husk, seed: i}))))
		expect(all.size).toBeGreaterThan(1)
	})
	it('items and tokens play through the same hooks', () => {
		const cards = deckCards([{id: 'Strike'}, {id: 'Strike'}, {id: 'Defend'}])
		const apron = def({kind: 'item', name: 'Smith Apron', slot: 'body', triggers: [{on: 'fightStart', effects: [{do: 'block', n: 8}]}]})
		const enemy = {name: 'Dummy', hp: 200, intents: [{damage: 10}]}
		const bare = simulateFight({cards, enemy, seed: 1})
		const geared = simulateFight({cards, enemy, seed: 1, items: [{id: 'g:i-aaaaaa', def: apron}]})
		expect(geared.rounds > bare.rounds || geared.hpLeft > bare.hpLeft).toBe(true)
	})
})

describe('balanceCheck', () => {
	const fair = def({kind: 'card', name: 'Plain Cut', type: 'attack', rarity: 'common', energy: 1, effects: [{do: 'damage', n: 7}]})
	it('accepts a fair common, rejects an outlier with a reason', () => {
		expect(balanceCheck(fair).ok).toBe(true)
		const op = def({kind: 'card', name: 'Big One', type: 'attack', rarity: 'rare', energy: 0, effects: [{do: 'damage', n: 30}, {do: 'power', kind: 'strength', n: 3, target: 'self', fight: true}]})
		const r = balanceCheck(op)
		expect(r.ok).toBe(false)
		expect(r.reasons.join()).toMatch(/power moves \+/)
	})
	it('curses must hurt, but within the curse band', () => {
		const mild = def({kind: 'curse', name: 'Slag', triggers: [{on: 'turnEnd', effects: [{do: 'loseHp', n: 1}]}]})
		const r = balanceCheck(mild, {offer: 'curse'})
		expect(r.ok).toBe(true)
		expect(r.deltaPower).toBeLessThan(0)
		const brutal = def({kind: 'curse', name: 'Heavy', triggers: [{on: 'turnEnd', effects: [{do: 'loseHp', n: 2}]}, {on: 'onDraw', effects: [{do: 'loseEnergy', n: 2}]}]})
		expect(balanceCheck(brutal, {offer: 'curse'}).ok).toBe(false)
	})
	it('a stronger version of a card never scores lower', () => {
		const strong = def({kind: 'card', name: 'Heavy Cut', type: 'attack', rarity: 'common', energy: 1, effects: [{do: 'damage', n: 12}]})
		expect(balanceCheck(strong).deltaPower).toBeGreaterThan(balanceCheck(fair).deltaPower)
	})
	it('is deterministic and reports per deck', () => {
		const a = balanceCheck(fair, {seed: 's1'})
		const b = balanceCheck(fair, {seed: 's1'})
		expect({...a, ms: 0}).toEqual({...b, ms: 0})
		expect(a.perDeck.map((p) => p.deck)).toEqual(['forge-late', 'crow-late', 'oath-late'])
		expect(balanceCheck(fair, {stage: 'early'}).perDeck[0].deck).toBe('forge-early')
	})
	it('accepts a custom final enemy (the run decides it) and an HP-for-pages Warden', () => {
		expect(balanceCheck(fair, {enemy: 'husk'}).ok).toBe(true)
		expect(balanceCheck(fair, {pages: 8}).ok).toBe(true)
	})
	it('validateContent runs it on request and turns failures into errors', () => {
		const v = validateContent({kind: 'card', name: 'Plain Cut', type: 'attack', energy: 1, effects: [{do: 'damage', n: 7}]}, {rarity: 'common', sim: true})
		expect(v.ok).toBe(true)
		expect(v.sim.fights).toBeGreaterThan(0)
	})
	it('is fast: a quick check stays well under 200 ms (warm)', () => {
		balanceCheck(fair) // warm the JIT and the baseline cache
		const times = []
		for (let i = 0; i < 9; i++) {
			const d = generateContent('SPEED', `t${i}`, {kind: ['card', 'item', 'token'][i % 3], rarity: 'uncommon'})
			const t0 = performance.now()
			balanceCheck(d, {seed: 'speed'})
			times.push(performance.now() - t0)
		}
		times.sort((a, b) => a - b)
		expect(times[4]).toBeLessThan(100) // median
		expect(times[8]).toBeLessThan(200)
	})
})
