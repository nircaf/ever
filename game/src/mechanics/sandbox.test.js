// Tests: the code-block sandbox contract (static checker, registry format, runtime API).
// Every file in blocks/ must pass; known escapes must fail. AGPL-3.0-or-later.
import {readFileSync, readdirSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'
import {checkBlockSource, checkIndexSource, MAX_LINES} from './sandbox/check.js'
import {checkBlocksDir} from './tools/check-blocks.mjs'
import {CODE_BLOCK_ERRORS, codeBlockIds, effectSpec, normalizeContent, rulesText, validateContent} from './index.js'
import {newMech, resolveEffects} from './runtime.js'

const BLOCKS = join(dirname(fileURLToPath(import.meta.url)), 'blocks')

const OK = `import {clamp} from '../sandbox/lib.js'
export const block = {
	id: 'okBlock',
	version: 1,
	params: {n: {t: 'int', min: 1, max: 10, def: 2}},
	pp: (p) => p.n,
	text: (p) => 'Gain ' + p.n + ' Block',
}
export function run(api, p) {
	const k = clamp(p.n, 1, 10)
	if (api.handSize() > 2) api.block(k)
	api.repeat(2, (i) => api.damage(i + 1))
}
`
const bad = (body) => checkBlockSource(OK.replace('\tconst k = clamp(p.n, 1, 10)', `\tconst k = clamp(p.n, 1, 10)\n${body}`))

describe('every shipped block passes the sandbox', () => {
	it('static checker: each file in blocks/, and the registry format', () => {
		const files = readdirSync(BLOCKS).filter((f) => f.endsWith('.js'))
		expect(files).toContain('index.js')
		for (const f of files) {
			const src = readFileSync(join(BLOCKS, f), 'utf8')
			const r = f === 'index.js' ? checkIndexSource(src, files.filter((x) => x !== 'index.js')) : checkBlockSource(src, {file: f})
			expect(r.errors, f).toEqual([])
		}
		expect(checkBlocksDir().every((r) => r.errors.length === 0)).toBe(true)
	})
	it('loads every block into the library without errors', () => {
		expect(CODE_BLOCK_ERRORS).toEqual([])
		expect(codeBlockIds()).toContain('damageFromBlock')
		expect(effectSpec('damageFromBlock').code).toBe(true)
	})
	it('a code block is usable as data: validated, priced, rendered and run through the API', () => {
		const v = validateContent({kind: 'card', name: 'Shield Bash', type: 'skill', energy: 1, target: 'enemy', effects: [{do: 'block', n: 5}, {do: 'damageFromBlock', n: 50}]}, {rarity: 'uncommon'})
		expect(v.errors).toEqual([])
		expect(rulesText(v.def)).toBe('Gain 5 Block. Deal damage equal to 50% of your Block.')
		const s = {turn: 1, hand: [], drawPile: [], discardPile: [], exhaustPile: [], player: {currentHealth: 50, maxHealth: 50, block: 0, currentEnergy: 3, powers: {}}}
		const enemy = {hp: 40, maxHp: 40, block: 0, powers: {}}
		const H = {s, enemy, mech: newMech({seed: 1})}
		resolveEffects(H, v.def.effects, 'k')
		expect(enemy.hp).toBe(40 - 2)
		expect(normalizeContent({kind: 'card', name: 'X Y', type: 'skill', energy: 1, effects: [{do: 'damageFromBlock', n: 500}]}).def.effects[0].n).toBe(100)
	})
})

describe('the static checker rejects escapes', () => {
	it('accepts the reference good block', () => {
		expect(checkBlockSource(OK).errors).toEqual([])
	})
	const cases = {
		'eval': `\teval('1')`,
		'Function': `\tconst f = Function('return 1')`,
		'globalThis': `\tglobalThis.x = 1`,
		'window': `\twindow.alert(1)`,
		'document': `\tdocument.title = 'x'`,
		'fetch': `\tfetch('http://x')`,
		'localStorage': `\tlocalStorage.setItem('a', 'b')`,
		'setTimeout': `\tsetTimeout(() => 1, 1)`,
		'dynamic import': `\tconst m = import('./x.js')`,
		'import.meta': `\tconst u = import.meta.url`,
		'constructor escape': `\tconst f = api.damage.constructor`,
		'computed member': `\tconst f = api['dam' + 'age']`,
		'computed key var': `\tconst key = 'x'\n\tconst f = p[key]`,
		'prototype': `\tconst x = p.__proto__`,
		'template literal': '\tconst s = `x${1}`',
		'regex literal': `\tconst r = /a+/.test('a')`,
		'new': `\tconst d = new Date()`,
		'this': `\tconst t = this`,
		'loop': `\tfor (let i = 0; i < 9; i++) api.block(1)`,
		'while': `\twhile (true) api.block(1)`,
		'class': `\tclass A {}`,
		'async': `\tconst f = async () => 1`,
		'undeclared global': `\tconst x = someGlobal + 1`,
		'Math.random': `\tconst x = Math.random()`,
		'arguments': `\tconst a = arguments`,
		'process': `\tprocess.exit(1)`,
		'require': `\tconst fs = require('fs')`,
		'JSON': `\tconst o = JSON.parse('{}')`,
		'Reflect/Proxy': `\tconst o = Reflect.ownKeys(p)`,
		'call/apply': `\tconst o = api.block.call(null, 1)`,
	}
	for (const [name, body] of Object.entries(cases)) {
		it(name, () => {
			const r = bad(body)
			expect(r.ok, JSON.stringify(r.errors)).toBe(false)
		})
	}
	it('imports only from the allowlist, named only', () => {
		expect(checkBlockSource(OK.replace("'../sandbox/lib.js'", "'../runtime.js'")).ok).toBe(false)
		expect(checkBlockSource(`import fs from 'node:fs'\n${OK}`).ok).toBe(false)
		expect(checkBlockSource(`import * as lib from '../sandbox/lib.js'\n${OK}`).ok).toBe(false)
	})
	it('exports exactly block and run', () => {
		expect(checkBlockSource(OK.replace('export function run', 'function run')).ok).toBe(false)
		expect(checkBlockSource(`${OK}\nexport const extra = 1\n`).ok).toBe(false)
		expect(checkBlockSource(`${OK}\nexport default run\n`).ok).toBe(false)
	})
	it('size limits', () => {
		expect(checkBlockSource(OK + '\n'.repeat(MAX_LINES)).ok).toBe(false)
	})
	it('the registry file has a fixed format and must list every block file', () => {
		const good = "import * as a from './a.js'\nexport const CODE_BLOCKS = [a]\n"
		expect(checkIndexSource(good, ['a.js']).ok).toBe(true)
		expect(checkIndexSource(good, ['a.js', 'b.js']).ok).toBe(false)
		expect(checkIndexSource(`${good}fetch('x')\n`, ['a.js']).ok).toBe(false)
		expect(checkIndexSource("import * as a from '../runtime.js'\nexport const CODE_BLOCKS = [a]\n", []).ok).toBe(false)
	})
})

describe('runtime guard', () => {
	it('the API is frozen, clamps numbers and stops runaway blocks', () => {
		const s = {turn: 1, hand: [], drawPile: [], discardPile: [], exhaustPile: [], player: {currentHealth: 50, maxHealth: 50, block: 0, currentEnergy: 3, powers: {}}}
		const enemy = {hp: 40, maxHp: 40, block: 0, powers: {}}
		const H = {s, enemy, mech: newMech({seed: 1})}
		// damageFromBlock clamps to 30 even with a huge Block.
		s.player.block = 1000
		resolveEffects(H, [{do: 'damageFromBlock', n: 100}], 'k')
		expect(enemy.hp).toBe(10)
	})
})
