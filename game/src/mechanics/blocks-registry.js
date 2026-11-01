// EVER mechanics: one lookup for every effect block, built-in (library.js) or
// code-based (game/src/mechanics/blocks/, sandboxed, see docs/MECHANICS.md section 7).
// PURE. Imported by the browser and by server/.
//
// Copyright (C) 2026 the EVER contributors.
// SPDX-License-Identifier: AGPL-3.0-or-later

import {EFFECTS} from './library.js'
import {CODE_BLOCKS} from './blocks/index.js'

const freezeDeep = (o) => {
	if (o && typeof o === 'object' && !Object.isFrozen(o)) {
		Object.freeze(o)
		for (const v of Object.values(o)) freezeDeep(v)
	}
	return o
}

/** id -> {spec, run} for code blocks. Built once; a bad block is skipped, never half-loaded. */
const CODE = new Map()
/** Problems found while loading code blocks (tests assert this stays empty). */
export const CODE_BLOCK_ERRORS = []
const ID_RE = /^[a-z][a-zA-Z0-9]{2,23}$/
const PARAM_TYPES = new Set(['int', 'enum', 'bool'])
for (const mod of CODE_BLOCKS) {
	const spec = mod?.block
	const id = spec?.id
	const fail = (msg) => CODE_BLOCK_ERRORS.push(`${String(id)}: ${msg}`)
	if (!spec || typeof id !== 'string' || !ID_RE.test(id)) fail('block.id must be camelCase, 3-24 chars')
	else if (id in EFFECTS || CODE.has(id)) fail('duplicate id')
	else if (typeof mod.run !== 'function' || typeof spec.pp !== 'function' || typeof spec.text !== 'function') fail('needs run(api, p), block.pp(p) and block.text(p)')
	else if (spec.version !== 1) fail('block.version must be 1')
	else if (spec.enemy !== undefined && typeof spec.enemy !== 'boolean') fail('block.enemy must be true or false (does it act on the enemy?)')
	else if (
		!spec.params ||
		Object.values(spec.params).some(
			(p) => !p || !PARAM_TYPES.has(p.t) || (p.t === 'int' && !(Number.isInteger(p.min) && Number.isInteger(p.max) && p.min <= p.def && p.def <= p.max && p.max <= 100)),
		)
	)
		fail('params must be int (min<=def<=max<=100), enum or bool')
	else CODE.set(id, {spec: freezeDeep({...spec, params: {...spec.params}, code: true}), run: mod.run})
}

/** The spec of an effect block (built-in or code), or undefined. */
export function effectSpec(id) {
	if (typeof id !== 'string') return undefined
	if (Object.hasOwn(EFFECTS, id)) return EFFECTS[id]
	return CODE.get(id)?.spec
}
/** The run(api, params) function of a code block, or undefined for built-ins. */
export const codeBlockRun = (id) => CODE.get(id)?.run
export const isCodeBlock = (id) => CODE.has(id)
export const allEffectIds = () => [...Object.keys(EFFECTS), ...CODE.keys()]
export const codeBlockIds = () => [...CODE.keys()]
