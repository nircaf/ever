// World-change proposals: model output -> the platform wire format (validated by the same
// validateProposal the bot Worker and CI run), GDD_V2 14.4 extras, presets, hostile output.
// Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later
import {describe, expect, it, vi} from 'vitest'
import {validateProposal} from '../../platform/world-schema.js'
import {WORLD_PRESETS} from '../../content-gen/presets.js'
import * as FX from './fixtures.js'
import {AI_LINES} from './lines.js'
import {runWorldProposals, validateWorldProposal} from './world.js'

const RUN = {seed: 'KQ7FM2XB', edition: 3, engine: '0.3.0', bookNo: 2, pages: 9, themes: ['forge', 'crow', 'ash'], won: true}
const fake = (text) => ({enabled: true, call: vi.fn(async () => ({ok: true, text, model: 'm', ms: 1}))})
const ctx = (over = {}) => ({seed: 'WIN1', run: RUN, themes: {primary: 'forge', secondary: 'crow', shadow: 'ash'}, story: {pages: 9, requests: ['make my hammer burn']}, playerNames: ['Pip'], ...over})

const GOOD_RULE = `// EVER code block: damage for each card in your hand.
// SPDX-License-Identifier: AGPL-3.0-or-later
import {clamp} from '../sandbox/lib.js'

export const block = {
	id: 'damageFromHand',
	version: 1,
	enemy: true,
	params: {n: {t: 'int', min: 1, max: 3, def: 1}},
	pp: (p) => 3 * p.n,
	text: (p) => 'Deal ' + p.n + ' damage for each card in your hand',
}

export function run(api, p) {
	api.damage(clamp(api.handSize() * p.n, 0, 30))
}
`

describe('validateWorldProposal', () => {
	it('turns good model proposals into wire proposals the bot validator accepts', () => {
		for (const p of JSON.parse(FX.WORLD_GOOD).proposals) {
			const v = validateWorldProposal(p, ctx())
			expect(v.ok, JSON.stringify(v.errors)).toBe(true)
			expect(v.hash).toMatch(/^[a-z0-9]{8}$/)
			expect(v.title.length).toBeGreaterThan(3) // rendered from data, not model text
			expect(validateProposal(v.proposal).ok).toBe(true) // what the bot will run
			expect(v.proposal.run).toMatchObject({seed: RUN.seed, bookNo: 2})
		}
	})
	it('refuses hostile proposals', () => {
		const [place, line, card, block] = JSON.parse(FX.WORLD_HOSTILE).proposals
		expect(validateWorldProposal(place, ctx()).ok).toBe(false)
		expect(validateWorldProposal(line, ctx()).ok).toBe(false)
		const c = validateWorldProposal(card, ctx())
		expect(c.ok).toBe(false)
		expect(JSON.stringify(c.errors)).toMatch(/0-cost/)
		expect(validateWorldProposal(block, ctx()).errors[0].msg).toMatch(/not open/)
		expect(validateWorldProposal(block, ctx({allowRule: true})).ok).toBe(false)
	})
	it('a new code block passes only through the sandbox checker, and only when the book opened it', () => {
		const p = {kind: 'block', data: {file: 'damage-from-hand.js', source: GOOD_RULE}}
		expect(validateWorldProposal(p, ctx()).ok).toBe(false)
		const v = validateWorldProposal(p, ctx({allowRule: true}))
		expect(v.ok, JSON.stringify(v.errors)).toBe(true)
		expect(v.block.id).toBe('damageFromHand')
		expect(validateWorldProposal(p, ctx({allowRule: true, blockIds: ['damageFromHand']})).ok).toBe(false)
	})
	it('GDD 14.4 extras: no per-turn energy, no player names, kit-only looks, no duplicates', () => {
		const [line, npc, item] = JSON.parse(FX.WORLD_MIXED).proposals
		expect(validateWorldProposal(line, ctx()).ok).toBe(true)
		expect(validateWorldProposal(npc, ctx()).ok).toBe(false)
		expect(validateWorldProposal(item, ctx()).ok).toBe(false)
		const named = {kind: 'line', data: {npc: 'marcus', text: 'Pip came back from the gate once.'}}
		expect(validateWorldProposal(named, ctx()).ok).toBe(false)
		expect(validateWorldProposal(named, ctx({playerNames: []})).ok).toBe(true)
		const good = JSON.parse(FX.WORLD_GOOD).proposals[0]
		const v = validateWorldProposal(good, ctx())
		expect(validateWorldProposal(good, ctx({existingKeys: [v.hash]})).errors[0].code).toBe('duplicate')
		expect(validateWorldProposal(good, ctx({worldNames: ['Banked Hammer']})).ok).toBe(false)
	})
	it('meta talk and shouting never enter the world', () => {
		for (const text of ['As an AI I wrote this line.', 'The JSON says hello.', 'WHAT a night.'])
			expect(validateWorldProposal({kind: 'line', data: {npc: 'keeper', text}}, ctx()).ok, text).toBe(false)
	})
	it('refuses junk without throwing', () => {
		for (const raw of [null, 5, 'x', [], {}, {kind: 'nuke'}, {kind: 'card'}, {kind: 'place', data: {anchor: 'moon', prop: 'tank'}}, {kind: 'path', data: {theme: 'forge', titles: {'../x': 'Hi'}}}, {kind: 'line', data: {npc: 'marcus', text: 'x'.repeat(20000)}}])
			expect(validateWorldProposal(raw, ctx()).ok).toBe(false)
		expect(validateWorldProposal({kind: 'line', data: {npc: 'marcus', text: 'Hello there.'}}, {...ctx(), run: undefined}).ok).toBe(false)
	})
})

describe('runWorldProposals', () => {
	it('AI on and well-behaved: three AI proposals ready for the bot', async () => {
		const t = fake(FX.WORLD_GOOD)
		const r = await runWorldProposals(ctx(), {transport: t})
		expect(r.source).toBe('ai')
		expect(r.proposals).toHaveLength(3)
		for (const p of r.proposals) expect(validateProposal(p.proposal).ok).toBe(true)
		const input = JSON.parse(t.call.mock.calls[0][0].input)
		expect(input.story.requests.untrusted).toBe(true)
	})
	it('hostile answers fall back to presets for the book themes, and a model cannot claim a preset id', async () => {
		const r = await runWorldProposals(ctx(), {transport: fake(FX.WORLD_HOSTILE)})
		expect(r).toMatchObject({source: 'preset', notice: 'invalid', line: AI_LINES.worldOffline})
		expect(r.proposals).toHaveLength(3)
		expect(r.proposals[0].presetId).toMatch(/^forge-/)
		expect(r.proposals[0].proposal.preset).toBe(r.proposals[0].presetId)
	})
	it('one good AI proposal is kept and filled up with presets', async () => {
		const r = await runWorldProposals(ctx(), {transport: fake(FX.WORLD_MIXED)})
		expect(r.source).toBe('mixed')
		expect(r.proposals[0]).toMatchObject({src: 'ai', proposal: {kind: 'line', data: {npc: 'keeper'}}})
		expect(r.proposals[0].proposal.preset).toBeUndefined()
		expect(r.proposals.slice(1).every((p) => p.src === 'preset')).toBe(true)
	})
	it('offline: presets, skipping used ones; all used: nothing but the line; loaded world presets win', async () => {
		const off = await runWorldProposals(ctx())
		expect(off).toMatchObject({source: 'preset', notice: 'off'})
		const used = off.proposals.map((p) => p.presetId)
		const again = await runWorldProposals(ctx({usedPresets: used}))
		expect(again.proposals.some((p) => used.includes(p.presetId))).toBe(false)
		const none = await runWorldProposals(ctx({usedPresets: WORLD_PRESETS.map((p) => p.id)}))
		expect(none.proposals).toEqual([])
		expect(none.line).toBe(AI_LINES.worldAllUsed)
		const loaded = [{id: 'crow-even-birds', themes: ['crow'], proposal: {kind: 'line', data: {npc: 'keeper', when: {theme: 'crow'}, text: 'Birds on the gate. Count them. Never trust an even number.'}}}]
		const fromWorld = await runWorldProposals(ctx({presets: loaded}))
		expect(fromWorld.proposals.map((p) => p.presetId)).toEqual(['crow-even-birds'])
	})
	it('transport errors and junk never throw', async () => {
		const failing = {enabled: true, call: async () => ({ok: false, reason: 'limit'})}
		expect((await runWorldProposals(ctx(), {transport: failing})).notice).toBe('limit')
		for (const text of [FX.NOT_JSON, FX.OVERSIZED, FX.CODE_AND_PROTO, '{"proposals": "all of them"}'])
			expect((await runWorldProposals(ctx(), {transport: fake(text)})).source).toBe('preset')
	})
})
