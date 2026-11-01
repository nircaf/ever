// Tests: seeded PRNG, run content registry (pinning, ids, serialization, re-validation on
// load) and the offline generator. Pure, runs in Node. AGPL-3.0-or-later.
import {describe, expect, it} from 'vitest'
import {
	MECHANICS_VERSION, MECH_SCHEMA_VERSION, RUN_CONTENT_VERSION, SIZE_LIMITS, addContent, balanceCheck, canonicalJson, contentId, createRunContent, generateContent,
	getDef, hash32, hashId, isValidGenId, parseRunContent, pick, pickWeighted, randInt, removeContent, rng, rulesText, serializeRunContent, shuffle, validateContent,
} from './index.js'

const card = (name, n = 6) => validateContent({kind: 'card', name, type: 'attack', energy: 1, effects: [{do: 'damage', n}]}, {rarity: 'common'}).def

describe('prng', () => {
	it('named streams are reproducible and independent', () => {
		const a = rng('KQ7F-M2XB', 'path')
		const b = rng('KQ7F-M2XB', 'path')
		const xs = Array.from({length: 5}, a)
		expect(Array.from({length: 5}, b)).toEqual(xs)
		expect(Array.from({length: 5}, rng('KQ7F-M2XB', 'offers'))).not.toEqual(xs)
		expect(Array.from({length: 5}, rng('KQ7F-M2XC', 'path'))).not.toEqual(xs)
		for (const x of xs) expect(x >= 0 && x < 1).toBe(true)
	})
	it('helpers are deterministic and in range', () => {
		const r = rng(1, 'h')
		for (let i = 0; i < 200; i++) {
			const v = randInt(r, 2, 4)
			expect(v >= 2 && v <= 4 && Number.isInteger(v)).toBe(true)
		}
		expect(shuffle([1, 2, 3, 4, 5], rng(1, 's'))).toEqual(shuffle([1, 2, 3, 4, 5], rng(1, 's')))
		expect(shuffle([1, 2, 3, 4, 5], rng(1, 's')).sort()).toEqual([1, 2, 3, 4, 5])
		expect(['a', 'b']).toContain(pick(rng(2, 'p'), ['a', 'b']))
		expect(pickWeighted(rng(3, 'w'), [['x', 0], ['y', 1]])).toBe('y')
		expect(hash32('abc')).toBe(hash32('abc'))
		expect(hashId('abc')).toMatch(/^[0-9a-z]{6}$/)
	})
	it('canonical JSON sorts keys at every depth', () => {
		expect(canonicalJson({b: 1, a: {d: [2, {z: 1, y: 2}], c: undefined}})).toBe('{"a":{"d":[2,{"y":2,"z":1}]},"b":1}')
	})
})

describe('run content registry', () => {
	it('pins engine, world edition and seed; versions are exported', () => {
		const rc = createRunContent({engine: '0.3.0', world: 14, seed: 'KQ7FM2XB'})
		expect(rc).toMatchObject({v: RUN_CONTENT_VERSION, schema: MECH_SCHEMA_VERSION, engine: '0.3.0', world: 14, seed: 'KQ7FM2XB', defs: {}, order: []})
		expect(MECHANICS_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
	})
	it('ids are deterministic, content-addressed and deduplicated', () => {
		const d = card('Quenched Edge')
		const id = contentId(d)
		expect(isValidGenId(id)).toBe(true)
		expect(id).toMatch(/^g:c-/)
		expect(contentId(structuredClone(d))).toBe(id)
		const rc0 = createRunContent()
		const a = addContent(rc0, d, {offer: 'gift', src: 'ai', page: 2})
		expect(a).toMatchObject({id, added: true})
		expect(rc0.order).toEqual([]) // pure
		const b = addContent(a.rc, structuredClone(d))
		expect(b).toMatchObject({id, added: false})
		expect(b.rc.order).toEqual([id])
		expect(getDef(b.rc, id)).toEqual(d)
		expect(a.rc.meta[id]).toEqual({offer: 'gift', src: 'ai', page: 2})
	})
	it('a hash collision gets a suffix, never overwrites', () => {
		const d1 = card('First Edge')
		const d2 = card('Second Edge')
		// Pretend d1 already sits under d2's id (a hash collision).
		const rc = {...createRunContent(), defs: {[contentId(d2)]: d1}, meta: {[contentId(d2)]: {}}, order: [contentId(d2)]}
		const collide = addContent(rc, d2)
		expect(collide.id).toBe(`${contentId(d2)}-2`)
	})
	it('serializes compactly and stably; round-trips through parse with re-validation', () => {
		let rc = createRunContent({engine: '0.3.0', world: 14, seed: 'KQ7FM2XB'})
		const ids = []
		for (const [i, n] of ['Edge One', 'Edge Two', 'Edge Three'].entries()) {
			const r = addContent(rc, card(n, 5 + i), {page: i + 1})
			rc = r.rc
			ids.push(r.id)
		}
		const item = validateContent({kind: 'item', name: 'Smith Apron', slot: 'body', triggers: [{on: 'fightStart', effects: [{do: 'block', n: 8}]}]}, {rarity: 'common'}).def
		rc = addContent(rc, item).rc
		const curse = validateContent({kind: 'curse', name: 'Slag', triggers: [{on: 'turnEnd', effects: [{do: 'loseHp', n: 1}]}]}, {offer: 'curse'}).def
		rc = addContent(rc, curse, {offer: 'curse'}).rc
		const text = serializeRunContent(rc)
		expect(serializeRunContent(JSON.parse(text))).toBe(text)
		expect(text.length).toBeLessThan(2500)
		const back = parseRunContent(text)
		expect(back.ok).toBe(true)
		expect(back.dropped).toEqual([])
		expect(back.rc).toEqual(rc)
	})
	it('parse drops tampered, invalid or smuggled defs and reports why', () => {
		let rc = createRunContent()
		const r = addContent(rc, card('Honest Edge'))
		rc = r.rc
		const evil = structuredClone(rc)
		evil.defs[r.id].effects[0].n = 30 // edited after the fact: id no longer matches / over budget
		expect(parseRunContent(evil).dropped[0].id).toBe(r.id)
		const curseAsGift = structuredClone(rc)
		const curse = validateContent({kind: 'curse', name: 'Slag', triggers: [{on: 'turnEnd', effects: [{do: 'loseHp', n: 1}]}]}, {offer: 'curse'}).def
		const cid = contentId(curse)
		curseAsGift.defs[cid] = curse
		curseAsGift.meta[cid] = {offer: 'gift'}
		curseAsGift.order.push(cid)
		expect(parseRunContent(curseAsGift).dropped.map((d) => d.id)).toEqual([cid])
		const badId = structuredClone(rc)
		badId.order.push('g:c-<script>')
		badId.defs['g:c-<script>'] = card('Other Edge')
		expect(parseRunContent(badId).dropped[0].reason).toBe('bad id')
		expect(parseRunContent('nope').error).toBe('not_json')
		expect(parseRunContent({v: 99}).error).toBe('version')
		expect(parseRunContent('x'.repeat(SIZE_LIMITS.registryBytes * 3)).error).toBe('too_big')
	})
	it('remove is pure and size limits are enforced', () => {
		let rc = createRunContent()
		const r = addContent(rc, card('Lone Edge'))
		expect(removeContent(r.rc, r.id).order).toEqual([])
		expect(r.rc.order).toEqual([r.id])
		rc = createRunContent()
		expect(() => {
			for (let i = 0; i < 60; i++) rc = addContent(rc, generateContent('FILL', `f${i}`, {kind: 'card', rarity: 'rare'})).rc
		}).toThrow(/at most|bytes/)
	})
})

describe('offline generator', () => {
	it('same seed and label => same def; always valid; names unique', () => {
		const a = generateContent('KQ7FM2XB', 'offer:3:1', {kind: 'card', rarity: 'uncommon'})
		expect(generateContent('KQ7FM2XB', 'offer:3:1', {kind: 'card', rarity: 'uncommon'})).toEqual(a)
		expect(generateContent('KQ7FM2XB', 'offer:3:2', {kind: 'card', rarity: 'uncommon'})).not.toEqual(a)
		expect(generateContent('X', 'y', {kind: 'card', existingNames: [a.name], theme: a.theme}).name).not.toBe(a.name)
	})
	it('fuzz: 200 seeds x every kind stay inside the validator and render text', () => {
		const kinds = ['card', 'item', 'curse', 'token']
		const rar = ['common', 'uncommon', 'rare']
		for (let i = 0; i < 200; i++) {
			const kind = kinds[i % 4]
			const d = generateContent(`F${i}`, 'fuzz', {kind, rarity: rar[i % 3]})
			const offer = kind === 'curse' ? 'curse' : 'gift'
			const v = validateContent(d, {offer, rarity: kind === 'card' || kind === 'item' ? rar[i % 3] : undefined})
			expect(v.errors, `${kind} ${i}`).toEqual([])
			expect(rulesText(d).length).toBeGreaterThan(5)
		}
	})
	it('with sim: true the offers also pass the balance check', () => {
		for (let i = 0; i < 8; i++) {
			const kind = ['card', 'item', 'curse', 'token'][i % 4]
			const d = generateContent(`S${i}`, 'sim', {kind, rarity: 'uncommon', sim: true})
			expect(balanceCheck(d, {offer: kind === 'curse' ? 'curse' : 'gift'}).ok, `${kind} ${d.name}`).toBe(true)
		}
	})
})
