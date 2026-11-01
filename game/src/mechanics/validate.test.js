// Tests: schema, validator, budget, text. Pure, runs in Node. AGPL-3.0-or-later.
import {describe, expect, it} from 'vitest'
import {
	KEEPSAKES, allEffectIds, buildJsonSchema, checkCaps, cleanFlavor, cleanName, describeLibrary, normalizeContent, rulesText,
	scoreContent, upgradedCard, validateContent, MECH_SCHEMA_VERSION, CONDITION_IDS, TRIGGER_IDS,
} from './index.js'

const card = (o) => ({kind: 'card', name: 'Test Card', type: 'attack', energy: 1, effects: [{do: 'damage', n: 6}], ...o})
const codes = (v) => v.errors.map((e) => e.code)

// --- a tiny JSON Schema checker for the subset buildJsonSchema() uses -------------------
function jsonValid(schema, root, x) {
	if (schema.$ref) return jsonValid(root.$defs[schema.$ref.split('/').pop()], root, x)
	if (schema.oneOf) return schema.oneOf.filter((s) => jsonValid(s, root, x)).length === 1
	if (schema.const !== undefined && x !== schema.const) return false
	if (schema.enum && !schema.enum.includes(x)) return false
	const types = schema.type ? [].concat(schema.type) : null
	if (types) {
		const t = x === null ? 'null' : Array.isArray(x) ? 'array' : Number.isInteger(x) ? 'integer' : typeof x
		if (!types.includes(t) && !(t === 'integer' && types.includes('number'))) return false
	}
	if (typeof x === 'number') {
		if (schema.minimum !== undefined && x < schema.minimum) return false
		if (schema.maximum !== undefined && x > schema.maximum) return false
	}
	if (typeof x === 'string') {
		if (schema.minLength !== undefined && x.length < schema.minLength) return false
		if (schema.maxLength !== undefined && x.length > schema.maxLength) return false
	}
	if (Array.isArray(x)) {
		if (schema.minItems !== undefined && x.length < schema.minItems) return false
		if (schema.maxItems !== undefined && x.length > schema.maxItems) return false
		if (schema.items && !x.every((y) => jsonValid(schema.items, root, y))) return false
	}
	if (x && typeof x === 'object' && !Array.isArray(x)) {
		for (const r of schema.required ?? []) if (!(r in x)) return false
		for (const [k, v] of Object.entries(x)) {
			const ps = schema.properties?.[k]
			if (!ps) {
				if (schema.additionalProperties === false) return false
				continue
			}
			if (!jsonValid(ps, root, v)) return false
		}
	}
	return true
}

describe('schema: normalizeContent', () => {
	it('accepts the flat form and the GDD 10.5 nested form, same result', () => {
		const flat = normalizeContent(card({name: 'Banked Hammer', effects: [{do: 'damage', n: 6}, {do: 'block', n: 2}]}))
		const nested = normalizeContent({kind: 'card', name: 'Banked Hammer', card: {type: 'attack', energy: 1, target: 'enemy', effects: [{do: 'damage', n: 6}, {do: 'block', n: 2}]}})
		expect(flat.errors).toEqual([])
		expect(nested.def).toEqual(flat.def)
		expect(flat.def.v).toBe(MECH_SCHEMA_VERSION)
	})
	it('drops unknown fields everywhere and never keeps a claimed PP or rules text', () => {
		const {def} = normalizeContent(card({pp: 1, description: 'Deal 99', evil: '<script>', effects: [{do: 'damage', n: 6, extra: 1, code: 'x'}], art: {prop: 'sword', tint: 'ember', url: 'http://x'}}))
		expect(def.pp).toBeUndefined()
		expect(def.description).toBeUndefined()
		expect(def.evil).toBeUndefined()
		expect(def.effects[0]).toEqual({do: 'damage', n: 6, hits: 1, target: 'enemy'})
		expect(def.art).toEqual({prop: 'sword', tint: 'ember'})
	})
	it('rounds and clamps numbers to block ranges with a warning', () => {
		const r = normalizeContent(card({effects: [{do: 'damage', n: 99.7, hits: 9}]}))
		expect(r.def.effects[0]).toMatchObject({n: 30, hits: 3})
		expect(r.warnings.map((w) => w.code)).toContain('clamped')
	})
	it('rejects unknown blocks, enums, kinds and versions with paths', () => {
		expect(normalizeContent(card({effects: [{do: 'nuke', n: 1}]})).errors[0]).toMatchObject({code: 'effect', path: 'effects[0].do'})
		expect(normalizeContent(card({type: 'ritual'})).errors[0].code).toBe('enum')
		expect(normalizeContent({kind: 'spell'}).errors[0].code).toBe('kind')
		expect(normalizeContent({...card(), v: 2}).errors[0].code).toBe('version')
		expect(normalizeContent('not json').errors[0].code).toBe('not_object')
		expect(normalizeContent([card()]).errors[0].code).toBe('not_object')
		expect(normalizeContent(card({effects: [{do: 'damage', n: 3, if: {is: 'moonIsFull'}}]})).errors[0].code).toBe('condition')
		expect(normalizeContent(card({effects: [{do: 'draw', n: 1, scale: {per: 'turn'}}]})).errors[0].code).toBe('scale')
		expect(normalizeContent(card({effects: [{do: 'addCard', card: 'Bludgeon'}]})).errors[0].code).toBe('ref')
	})
	it('accepts the condition shorthands and trigger aliases', () => {
		const a = normalizeContent(card({effects: [{do: 'damage', n: 6}, {do: 'block', n: 3, if: {hpBelow: 40}}, {do: 'block', n: 2, if: 'enemyIntendsAttack'}, {do: 'block', n: 1, if: {firstTimeThisFight: true}}]}))
		expect(a.def.effects.slice(1).map((e) => e.if)).toEqual([{is: 'hpBelow', pct: 40}, {is: 'enemyIntendsAttack'}, {is: 'firstTimeThisFight'}])
		const i = normalizeContent({kind: 'item', name: 'Cloak', slot: 'body', triggers: [{on: 'onDamageTaken', effects: [{do: 'block', n: 2}]}, {on: 'combatStart', effects: [{do: 'block', n: 2}]}]})
		expect(i.def.triggers.map((t) => t.on)).toEqual(['onHpLoss', 'fightStart'])
	})
	it("puts an attack's plain hit first (the engine resolves it first)", () => {
		const {def} = normalizeContent(card({effects: [{do: 'loseHp', n: 1}, {do: 'damage', n: 11}]}))
		expect(def.effects.map((e) => e.do)).toEqual(['damage', 'loseHp'])
	})
	it('curses are always doubt violet; unplayable is energy null', () => {
		const {def} = normalizeContent({kind: 'curse', name: 'Slag', energy: null, art: {prop: 'coal', tint: 'gold'}, triggers: [{on: 'turnEnd', effects: [{do: 'loseHp', n: 1}]}]})
		expect(def.art.tint).toBe('doubt')
		expect(def.energy).toBeNull()
	})
	it('is safe against prototype tricks', () => {
		const r = normalizeContent('{"kind":"card","name":"Proto","type":"attack","energy":1,"effects":[{"do":"damage","n":6}],"__proto__":{"polluted":1},"constructor":{"prototype":{"x":1}}}')
		expect(r.def).toBeTruthy()
		expect({}.polluted).toBeUndefined()
		expect(Object.prototype.x).toBeUndefined()
		expect(normalizeContent(card({effects: [{do: 'constructor'}, {do: '__proto__'}, {do: 'toString'}]})).errors.every((e) => e.code === 'effect')).toBe(true)
	})
})

describe('JSON Schema', () => {
	const schema = buildJsonSchema()
	it('lists every block, condition and trigger', () => {
		expect(schema.$defs.effect.oneOf.length).toBe(allEffectIds().length)
		expect(schema.$defs.condition.oneOf.length).toBe(CONDITION_IDS.length)
		expect(schema.$defs.trigger.oneOf.length).toBe(TRIGGER_IDS.length)
		expect(JSON.parse(JSON.stringify(schema))).toEqual(schema)
	})
	it('accepts every canonical def the normalizer makes, and rejects junk', () => {
		for (const k of KEEPSAKES) {
			const {def} = normalizeContent(k)
			expect(jsonValid(schema, schema, def), k.name).toBe(true)
		}
		const item = normalizeContent({kind: 'item', name: 'Crow Eye', slot: 'charm', rarity: 'uncommon', triggers: [{on: 'fightStart', effects: [{do: 'power', kind: 'vulnerable', n: 2}]}]}).def
		expect(jsonValid(schema, schema, item)).toBe(true)
		expect(jsonValid(schema, schema, {...item, evil: 1})).toBe(false)
		expect(jsonValid(schema, schema, {...item, slot: 'head'})).toBe(false)
		expect(jsonValid(schema, schema, {kind: 'card', name: 'X', type: 'attack', energy: 1, effects: [{do: 'nuke'}]})).toBe(false)
	})
})

describe('validateContent', () => {
	it('accepts all 16 GDD keepsakes as authored content and renders their text', () => {
		for (const k of KEEPSAKES) {
			const v = validateContent(k, {authored: true})
			expect(v.errors, k.name).toEqual([])
			expect(rulesText(v.def)).toMatch(/damage/)
		}
		expect(rulesText(validateContent(KEEPSAKES[0], {authored: true}).def)).toBe('Deal 7 damage. Gain 3 Block.')
	})
	it('keepsake and special rarities are never accepted from a proposal', () => {
		expect(codes(validateContent(KEEPSAKES[0]))).toContain('rarity')
	})
	it('the game sets rarity; a proposal cannot buy a bigger budget', () => {
		const v = validateContent(card({rarity: 'rare', effects: [{do: 'damage', n: 11}]}), {rarity: 'common'})
		expect(v.ok).toBe(false)
		expect(v.errors[0].msg).toMatch(/over the common budget of 7/)
	})
	it('GDD 18.1 examples pass with their rarity and offer kind', () => {
		const ok = (raw, o) => {
			const v = validateContent(raw, o)
			expect(v.errors, raw.name).toEqual([])
			return v
		}
		ok(card({name: 'Bucket Line', type: 'skill', effects: [{do: 'block', n: 4}, {do: 'draw', n: 1}]}), {rarity: 'common'})
		ok(card({name: 'Bramble Knot', type: 'skill', target: 'enemy', effects: [{do: 'power', kind: 'poison', n: 4}]}), {rarity: 'uncommon'})
		ok(card({name: "Tobin's Promise", effects: [{do: 'damage', n: 6}, {do: 'damage', n: 6, if: {notDamagedThisFight: true}}]}), {rarity: 'uncommon'})
		ok(card({name: 'Ash Offering', energy: 0, exhaust: true, effects: [{do: 'loseHp', n: 3}, {do: 'damage', n: 9}]}), {rarity: 'uncommon'})
		ok(card({name: "Lamplighter's Round", type: 'skill', exhaust: true, effects: [{do: 'energy', n: 1}, {do: 'draw', n: 2}]}), {rarity: 'rare'})
		ok(card({name: "Crow's Ledger", energy: 2, effects: [{do: 'damage', n: 6}, {do: 'damage', n: 0, scale: {per: 'enemyDebuff', each: 4, cap: 3}}]}), {rarity: 'rare'})
		ok(card({name: 'Pawned Courage', type: 'skill', energy: 0, exhaust: true, effects: [{do: 'power', kind: 'strength', n: 2, target: 'self'}, {do: 'addCard', card: 'Doubt', pile: 'discard'}]}), {rarity: 'uncommon', offer: 'bargain'})
		ok({kind: 'curse', name: 'Undertow', triggers: [{on: 'onDraw', effects: [{do: 'discard', n: 1}]}]}, {offer: 'curse'})
		ok({kind: 'item', name: "Tobin's Apron", slot: 'body', on: 'fightStart', effects: [{do: 'block', n: 8}]}, {rarity: 'common'})
		ok({kind: 'item', name: 'Ash-Choked Bell', slot: 'charm', bound: true, triggers: [{on: 'fightStart', effects: [{do: 'addCard', card: 'Doubt', pile: 'draw'}]}]}, {offer: 'curse'})
	})
	it('hard caps reject with clear reasons', () => {
		const r = (o, opt) => validateContent(card(o), opt).errors.map((e) => e.msg).join(' | ')
		expect(r({type: 'skill', energy: 2, rarity: 'rare', effects: [{do: 'energy', n: 1}, {do: 'draw', n: 1}]}, {rarity: 'rare'})).toMatch(/must exhaust/)
		expect(r({type: 'attack', effects: [{do: 'block', n: 5}]})).toMatch(/attack needs a plain/)
		expect(r({energy: 3, effects: [{do: 'damage', n: 20}, {do: 'damage', n: 15}]}, {rarity: 'rare'})).toMatch(/at most 30 damage/)
		expect(r({type: 'skill', target: 'enemy', effects: [{do: 'power', kind: 'weak', n: 2}, {do: 'power', kind: 'weak', n: 2}]})).toMatch(/at most 3 Weak/)
		expect(r({effects: [{do: 'damage', n: 0}]})).toMatch(/damage 0 needs a scale/)
		const loop = validateContent({kind: 'item', name: 'Loop Ring', slot: 'charm', triggers: [{on: 'onPlay', type: 'any', effects: [{do: 'draw', n: 1}]}]})
		expect(loop.errors.map((e) => e.msg).join()).toMatch(/loops/)
		const hp = validateContent({kind: 'item', name: 'Bad Ring', slot: 'charm', triggers: [{on: 'onHpLoss', effects: [{do: 'loseHp', n: 1}]}]}, {offer: 'bargain'})
		expect(hp.errors.map((e) => e.msg).join()).toMatch(/loops/)
		const tick = validateContent({kind: 'curse', name: 'Big Tick', triggers: [{on: 'turnEnd', effects: [{do: 'loseHp', n: 3}]}]}, {offer: 'curse'})
		expect(tick.errors.map((e) => e.msg).join()).toMatch(/tick damage at most 2/)
		const energy = validateContent({kind: 'item', name: 'Sun Stone', slot: 'charm', rarity: 'uncommon', triggers: [{on: 'turnStart', effects: [{do: 'energy', n: 1}]}]}, {rarity: 'uncommon'})
		expect(energy.errors.map((e) => e.msg).join()).toMatch(/energy every turn/)
	})
	it('budget: over-budget, bargains and upgrades', () => {
		expect(validateContent(card({effects: [{do: 'damage', n: 8}]}), {rarity: 'common'}).errors[0].msg).toMatch(/8 PP is over the common budget of 7/)
		// A bargain may go to 1.5x if its cost takes back half the excess.
		const bargain = card({name: 'Heavy Price', effects: [{do: 'damage', n: 10}, {do: 'loseHp', n: 2}]})
		expect(validateContent(bargain, {rarity: 'common'}).ok).toBe(false)
		expect(validateContent(bargain, {rarity: 'common', offer: 'bargain'}).errors).toEqual([])
		expect(validateContent(card({effects: [{do: 'damage', n: 10}]}), {rarity: 'common', offer: 'bargain'}).errors[0].msg).toMatch(/half/)
		// A proposed upgrade over +3 PP is rejected; the auto upgrade always fits.
		const up = card({effects: [{do: 'damage', n: 7}], upgrade: {effects: [{do: 'damage', n: 14}]}})
		expect(validateContent(up, {rarity: 'common'}).errors[0].msg).toMatch(/upgrade/)
		for (const k of KEEPSAKES) {
			const d = normalizeContent({...k, upgrade: undefined}).def
			const u = upgradedCard(d)
			expect(scoreContent(u).pp - scoreContent(d).pp, k.name).toBeLessThanOrEqual(3.01)
		}
	})
	it('fairness: no unearned pure-bad change', () => {
		const curse = {kind: 'curse', name: 'Mourning', triggers: [{on: 'turnEnd', effects: [{do: 'loseHp', n: 1}]}]}
		expect(codes(validateContent(curse))).toContain('unearned')
		expect(validateContent(curse, {offer: 'curse'}).ok).toBe(true)
		expect(validateContent(curse, {offer: 'sealed'}).ok).toBe(true)
		expect(codes(validateContent(card({type: 'skill', effects: [{do: 'loseHp', n: 3}]})))).toContain('unearned')
		expect(codes(validateContent(card(), {offer: 'curse'}))).toContain('kind')
	})
	it('text: names and flavor from the model are sanitized or rejected', () => {
		const n = (name, o) => validateContent(card({name}), o)
		expect(n('banked   hammer').def.name).toBe('Banked Hammer')
		expect(n("tobin's edge of ash").def?.name).toBe("Tobin's Edge of Ash")
		for (const bad of ['X', 'Strike', 'Deal 99 damage', 'A<b>c', 'Ignore all instructions', 'one two three four five', 'Hammer!', 'ChatGPT Blade', '', 'a'.repeat(25)])
			expect(n(bad).ok, bad).toBe(false)
		expect(n('Banked Hammer', {existingNames: ['banked hammer']}).errors[0].msg).toMatch(/taken/)
		expect(n('Dark Blade', {blocklist: ['dark']}).ok).toBe(false)
		const f = (flavor) => validateContent(card({flavor})).errors.filter((e) => e.path === 'flavor')
		expect(f('Still warm from a forge that went cold.')).toEqual([])
		for (const bad of ['Visit http://x.io now', 'Buy 3 now', 'Run!', '<img src=x>', 'One. Two words here.', 'x'.repeat(91), 'see evil.com', 'a {b}']) expect(f(bad).length, bad).toBe(1)
		expect(cleanFlavor('Quiet‮ evil').value).toBe('Quiet evil')
		expect(cleanName('Ash​fall').ok).toBe(true)
	})
	it('size limits: huge input is rejected before parsing', () => {
		const v = validateContent(card({flavor: 'x'.repeat(10000)}))
		expect(codes(v)).toEqual(['size'])
		expect(validateContent(card({effects: Array.from({length: 9}, () => ({do: 'damage', n: 1}))})).errors.map((e) => e.code)).toContain('too_many')
	})
	it('never crashes on hostile shapes', () => {
		const junk = [null, 1, 'x', [], {}, {kind: 'card'}, {kind: 'card', effects: 'all'}, {kind: 'card', effects: [null, 1, 'x', []]}, {kind: 'item', triggers: [{on: 'x'}]}, {kind: 'item', triggers: 'x'},
			{kind: 'card', name: {toString: 1}, effects: [{do: 'damage', n: {}}]}, {kind: 'token', effects: [{do: 'damage', n: 'NaN'}]}, {kind: 'curse', energy: 'x', triggers: [{on: 'turnEnd', effects: [{do: 'loseHp', n: -5}]}]}]
		for (const j of junk) expect(() => validateContent(j)).not.toThrow()
	})
	it('caps are independent of validate (pure function)', () => {
		expect(checkCaps(normalizeContent(card({effects: [{do: 'damage', n: 30}]})).def)).toEqual([])
	})
})

describe('rules text', () => {
	const t = (raw) => rulesText(normalizeContent(raw).def)
	it('renders every kind from data', () => {
		expect(t(card({effects: [{do: 'damage', n: 4, hits: 2}, {do: 'power', kind: 'vulnerable', n: 1}]}))).toBe('Deal 4 damage 2 times. Apply 1 Vulnerable.')
		expect(t(card({type: 'skill', exhaust: true, retain: true, effects: [{do: 'block', n: 5}, {do: 'draw', n: 1, when: 'nextTurn'}]}))).toBe('Gain 5 Block. Next turn, draw a card. Retain. Exhaust.')
		expect(t({kind: 'curse', name: 'Undertow', triggers: [{on: 'onDraw', effects: [{do: 'discard', n: 1}]}]})).toBe('Unplayable. When you draw this, discard a random card.')
		expect(t({kind: 'item', name: 'Apron', slot: 'body', bound: true, stats: {maxHp: 5}, triggers: [{on: 'fightStart', effects: [{do: 'block', n: 8}]}]})).toBe('Bound. At the start of each fight, gain 8 Block. +5 max HP.')
		expect(t({kind: 'token', name: 'Ember Two', effects: [{do: 'energy', n: 1}]})).toBe('Next fight: Gain 1 Energy.')
		expect(t(card({type: 'power', effects: [], triggers: [{on: 'turnStart', effects: [{do: 'block', n: 3}]}]}))).toBe('At the start of your turn, gain 3 Block.')
		expect(t(card({effects: [{do: 'damage', n: 6}, {do: 'damage', n: 2, scale: {per: 'cardInHand', each: 1, cap: 4}}]}))).toBe('Deal 6 damage. Deal 2 damage, plus 1 more for each card in your hand (up to 4 times).')
	})
	it('the AI-facing library lists ids and ranges, never costs', () => {
		const lib = describeLibrary()
		expect(lib.effects.damage).toEqual({n: [0, 30], hits: [1, 3], target: ['enemy', 'allEnemies']})
		expect(JSON.stringify(lib)).not.toMatch(/"pp"|budget|cost/i)
		expect(JSON.stringify(lib).length).toBeLessThan(4000)
	})
})
