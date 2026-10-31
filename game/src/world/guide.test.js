// Exploration copy / view-model tests (pure). Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later
import {describe, expect, it, vi} from 'vitest'
import {addCurse, addToken, newBook, upgradeCard} from '../core/contracts.js'
import {
	HINTS,
	dialogueReduce,
	dialogueStart,
	effectToasts,
	gatePanel,
	groupDeck,
	hintFor,
	pickerPanel,
	promptFor,
	proposeFreeText,
	stationPanel,
	tokenSlots,
} from './guide.js'

const fresh = (patch = {}) => ({...newBook({seed: 7, now: 1000}), ...patch})

describe('prompts and hints', () => {
	it('prompt copy follows GDD 6', () => {
		const b = fresh()
		expect(promptFor('marcus', b)).toBe('Talk to Marcus')
		expect(promptFor('well', b)).toBe('Look into the well')
		expect(promptFor('gate', {...b, status: 'epilogue'})).toBe(null)
		expect(promptFor('well', {...b, status: 'fighting'})).toBe(null)
	})
	it('hint follows the discovery order of GDD 5', () => {
		const b = fresh()
		expect(hintFor(b, 2000)).toBe(HINTS.start)
		const v1 = {...b, visited: {...b.visited, well: true}}
		expect(hintFor(v1, 2000)).toBe(HINTS.forge)
		const v2 = {...v1, marcus: {...b.marcus, beat: 3, flags: {...b.marcus.flags, promised: true}}}
		expect(hintFor(v2, 2000)).toBe(HINTS.look)
		const all = {...v2, visited: {well: true, marcus: true, grindstone: true, lectern: true, gate: false}}
		expect(hintFor(all, 2000)).toBe(HINTS.gate)
		expect(hintFor(b, 1000 + 6 * 60_000)).toBe(HINTS.gate) // 6 minutes passed
		expect(hintFor({...b, status: 'epilogue'})).toBe(null)
	})
})

describe('station panels', () => {
	it('well offers remove or Ward, then goes still', () => {
		const b = fresh()
		const p = stationPanel('well', b)
		expect(p.title).toBe('The Well')
		expect(p.buttons.map((x) => x.label)).toEqual(['Drop a card in', 'Draw up the Ward', 'Leave'])
		expect(p.buttons[0].do).toEqual({picker: 'well'})
		expect(p.buttons[1].do).toEqual({act: {type: 'well.ward'}})
		expect(stationPanel('well', {...b, used: {...b.used, well: true}}).text).toBe('The well is still.')
	})
	it('lectern shows the seeded offer as card choices', () => {
		const b = fresh()
		const p = stationPanel('lectern', b)
		expect(p.cards.map((c) => c.id)).toEqual(b.lecternOffer)
		expect(p.cards[0].do).toEqual({act: {type: 'lectern.take', id: b.lecternOffer[0]}})
		expect(p.buttons[0].do).toEqual({act: {type: 'lectern.leave'}})
	})
	it('grindstone and shrine', () => {
		const b = fresh()
		expect(stationPanel('grindstone', b).buttons[0]).toMatchObject({label: 'Sharpen (take Whetstone)', do: {act: {type: 'grindstone.take'}}})
		const s = stationPanel('shrine', b)
		expect(s.small).toBe('Gain Bludgeon. Two Doubts are written into your deck.')
		expect(s.buttons[0]).toMatchObject({kind: 'doubt', do: {act: {type: 'shrine.take'}}})
		expect(stationPanel('shrine', {...b, used: {...b.used, shrine: true}}).text).toBe('The shrine is dark.')
	})
	it('every station is spent in the epilogue', () => {
		const b = fresh({status: 'epilogue'})
		expect(stationPanel('well', b).text).toBe('The well is still.')
		expect(stationPanel('gate', b)).toBe(null)
	})
	it('solo gate: Fight / Not yet; co-op gate: lobby', () => {
		const b = fresh()
		expect(gatePanel(b).buttons.map((x) => x.label)).toEqual(['Fight', 'Not yet'])
		const room = {warden: {state: 'dormant', round: 0}, seats: [{seat: 0, ready: false}, {seat: 1, ready: true}], lobby: {ready: 1, of: 2, startsAt: 31_000}}
		const p = gatePanel(b, {coop: true, room, seat: 0, now: 1000})
		expect(p.text).toBe('1/2 ready at the gate The fight starts in 30s.')
		expect(p.buttons[0]).toMatchObject({label: 'Ready', do: {ready: true}})
		expect(gatePanel(b, {coop: true, room, seat: 1}).buttons[0].label).toBe('Not ready')
		const fighting = {...room, warden: {state: 'fighting', round: 3}, seats: [{seat: 0, inFight: false}]}
		expect(gatePanel(b, {coop: true, room: fighting, seat: 0}).text).toBe('Your party is fighting the Warden. Round 3.')
	})
	it('anvil picker lists only upgradable cards', () => {
		let b = fresh()
		b = upgradeCard(b, 'c9')
		b = addCurse(b, 'cold')
		const p = pickerPanel('anvil', b)
		expect(p.pick.some((c) => c.id === 'Doubt' || c.upgraded)).toBe(false)
		expect(p.pick).toHaveLength(9)
		expect(p.pick[0].do).toEqual({act: {type: 'anvil.upgrade', uid: p.pick[0].uid}})
		expect(pickerPanel('well', b).pick).toHaveLength(11) // the well takes anything, Doubt too
	})
})

describe('deck and HUD', () => {
	it('groups the deck with counts, curses last', () => {
		let b = addCurse(upgradeCard(fresh(), 'c0'), 'shrine', 2)
		const g = groupDeck(b.deck)
		expect(g.map((x) => `${x.id}${x.upgraded ? '+' : ''} x${x.count}`)).toEqual(['Bash x1', 'Defend x4', 'Strike+ x1', 'Strike x4', 'Doubt x2'])
	})
	it('three token slots in fixed order', () => {
		const b = addToken(fresh(), 'whetstone')
		expect(tokenSlots(b).map((s) => [s.kind, s.full])).toEqual([['ember', false], ['ward', false], ['whetstone', true]])
	})
})

describe('effects', () => {
	it('toasts: rules toasts win, otherwise GDD lines', () => {
		expect(effectToasts([{k: 'toast', text: 'Bludgeon added. Two Doubts are written into your deck.'}, {k: 'card', op: 'add', id: 'Bludgeon'}])).toEqual([
			{text: 'Bludgeon added. Two Doubts are written into your deck.', tone: 'bad'},
		])
		expect(effectToasts([{k: 'card', op: 'add', id: 'Iron Wave'}]).map((t) => t.text)).toEqual(['Card gained: Iron Wave'])
		expect(effectToasts([{k: 'card', op: 'upgrade', id: 'Bash'}]).map((t) => t.text)).toEqual(['Upgraded: Bash+'])
		expect(effectToasts([{k: 'token', kind: 'ward'}]).map((t) => t.text)).toEqual(['Token gained: Ward'])
		expect(effectToasts([{k: 'card', op: 'add', id: 'Doubt'}]).map((t) => t.text)).toEqual(['A Doubt is written into your deck.'])
	})
	it('dialogue reducer folds says, options, trust and close', () => {
		let v = dialogueStart()
		v = dialogueReduce(v, [{k: 'say', who: 'marcus', text: 'Forge is cold.'}, {k: 'options', options: [{id: 'a', text: 'A'}, {id: 'bad'}]}])
		expect(v.lines).toEqual(['Forge is cold.'])
		expect(v.options).toEqual([{id: 'a', text: 'A'}]) // malformed option dropped
		v = dialogueReduce(v, [{k: 'trust', delta: 1, trust: 1}])
		expect(v.lines).toEqual(['Forge is cold.']) // no new say: keep the line
		expect(v.note).toBe('Marcus trusts you more.')
		v = dialogueReduce(v, [{k: 'say', who: 'marcus', text: 'Get out of my forge.'}, {k: 'trust', delta: -2, trust: -1}, {k: 'close'}])
		expect(v).toMatchObject({closed: true, options: [], note: 'Marcus trusts you less.'})
		expect(dialogueReduce(v, [{k: 'picker', purpose: 'anvil'}]).picker).toBe('anvil')
	})
})

describe('free text', () => {
	const book = fresh()
	it('offline never calls the bridge', async () => {
		const bridge = {enabled: false, ask: vi.fn()}
		const r = await proposeFreeText({book, text: '  I help him\u0007 sweep  ', bridge, ai: {on: true}})
		expect(r.action).toEqual({type: 'marcus.free', text: 'I help him sweep'})
		expect(bridge.ask).not.toHaveBeenCalled()
	})
	it('passes a validated AI proposal through', async () => {
		const proposal = {reply: 'Hm.', intent: 'help', trust: 1}
		const bridge = {enabled: true, ask: vi.fn(async () => ({ok: true, proposal}))}
		const r = await proposeFreeText({book, text: 'x'.repeat(300), bridge, ai: {on: true}})
		expect(r.action.ai).toEqual(proposal)
		expect(r.action.text).toHaveLength(120)
		expect(JSON.parse(bridge.ask.mock.calls[0][0]).player.says).toHaveLength(120)
	})
	it('falls back to the local script with a one-time toast', async () => {
		const bridge = {enabled: true, ask: async () => ({ok: false, reason: 'invalid'})}
		const a = await proposeFreeText({book, text: 'hello', bridge, ai: {on: true, warned: false}})
		expect(a.action.ai).toBeUndefined()
		expect(a.toast).toBe('AI unavailable, using the local script.')
		const b = await proposeFreeText({book, text: 'hello', bridge, ai: {on: true, warned: true}})
		expect(b.toast).toBeUndefined()
		const lim = await proposeFreeText({book, text: 'hello', bridge: {enabled: true, ask: async () => ({ok: false, reason: 'limit'})}, ai: {on: true}})
		expect(lim).toMatchObject({toast: 'AI usage limit reached. Using the local script.', disableAi: true})
		const thrown = await proposeFreeText({book, text: 'hello', bridge: {enabled: true, ask: async () => Promise.reject(new Error('x'))}, ai: {on: true}})
		expect(thrown.action).toEqual({type: 'marcus.free', text: 'hello'})
	})
	it('respects a disabled AI (429 earlier this book)', async () => {
		const bridge = {enabled: true, ask: vi.fn()}
		await proposeFreeText({book, text: 'hi', bridge, ai: {on: true, disabled: true}})
		await proposeFreeText({book: {...book, marcus: {...book.marcus, aiDisabled: true}}, text: 'hi', bridge, ai: {on: true}})
		expect(bridge.ask).not.toHaveBeenCalled()
	})
})
