// EVER mechanics sandbox: a dependency-free static checker for code blocks
// (game/src/mechanics/blocks/*.js). A code block is a pure function over a provided API.
// This checker is the enforcement (tests + the GitHub Action run it); eslint.sandbox.js
// carries the same rules for editors.
//
// Rules for a block file:
//   - imports: only `import {names} from '../sandbox/lib.js'` (static, named)
//   - exports: exactly `export const block = {...}` and `export function run(api, p) {...}`
//   - no globals except Math (not Math.random), Number, Boolean, isFinite, isNaN, parseInt,
//     parseFloat, undefined, NaN, Infinity; every other identifier must be declared in the file
//   - banned anywhere (also as property names): eval, Function, globalThis, window, document,
//     fetch, storage, timers, constructor, prototype, __proto__, ... (BANNED below)
//   - no this / new / class / async / await / yield / with / debugger / loops (for, while,
//     do; use api.repeat), no template literals, no regex literals, no dynamic import,
//     no import.meta, no computed member access except a number literal (x[0]); use lib.at
//   - at most 120 lines and 4 KB
// The registry file blocks/index.js has its own fixed format (checkIndexSource).
// PURE: string in, report out. Runs in Node and in the browser.
//
// Copyright (C) 2026 the EVER contributors.
// SPDX-License-Identifier: AGPL-3.0-or-later

export const SANDBOX_VERSION = 1
export const MAX_LINES = 120
export const MAX_BYTES = 4096
export const IMPORT_ALLOWLIST = Object.freeze(['../sandbox/lib.js'])
export const ALLOWED_GLOBALS = Object.freeze(['Math', 'Number', 'Boolean', 'isFinite', 'isNaN', 'parseInt', 'parseFloat', 'undefined', 'NaN', 'Infinity'])
export const BANNED = Object.freeze([
	'eval', 'Function', 'AsyncFunction', 'GeneratorFunction', 'globalThis', 'window', 'self', 'global', 'frames', 'parent', 'top',
	'document', 'navigator', 'location', 'history', 'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'Request', 'Response',
	'localStorage', 'sessionStorage', 'indexedDB', 'caches', 'cookieStore', 'crypto', 'setTimeout', 'setInterval', 'setImmediate',
	'clearTimeout', 'clearInterval', 'requestAnimationFrame', 'requestIdleCallback', 'queueMicrotask', 'require', 'process',
	'module', 'exports', 'Deno', 'Bun', 'importScripts', 'postMessage', 'Worker', 'SharedArrayBuffer', 'Atomics', 'WebAssembly',
	'Proxy', 'Reflect', 'Symbol', 'Object', 'Array', 'String', 'Promise', 'Date', 'performance', 'console', 'alert', 'JSON',
	'constructor', 'prototype', '__proto__', '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__',
	'caller', 'callee', 'arguments', 'bind', 'call', 'apply', 'toString', 'valueOf',
])
const BANNED_KEYWORDS = Object.freeze(['this', 'new', 'class', 'async', 'await', 'yield', 'with', 'debugger', 'for', 'while', 'do', 'super', 'extends', 'delete', 'void', 'in', 'instanceof'])
const KEYWORDS = new Set([
	'break', 'case', 'catch', 'const', 'continue', 'default', 'else', 'export', 'false', 'finally', 'from', 'function', 'if',
	'import', 'let', 'null', 'of', 'return', 'switch', 'throw', 'true', 'try', 'typeof', 'var', 'as', ...BANNED_KEYWORDS,
])
const BANNED_SET = new Set(BANNED)
const ALLOWED_SET = new Set(ALLOWED_GLOBALS)

/**
 * Tokenize JS source (comments dropped). Template literals and regex literals become
 * error tokens: the sandbox does not allow them.
 * @returns {{t: 'id'|'num'|'str'|'p'|'bad', v: string, line: number}[]}
 */
export function tokenize(src) {
	const out = []
	let i = 0
	let line = 1
	const n = src.length
	const prevSignificant = () => out[out.length - 1]
	while (i < n) {
		const c = src[i]
		if (c === '\n') {
			line++
			i++
			continue
		}
		if (c === ' ' || c === '\t' || c === '\r') {
			i++
			continue
		}
		if (c === '/' && src[i + 1] === '/') {
			while (i < n && src[i] !== '\n') i++
			continue
		}
		if (c === '/' && src[i + 1] === '*') {
			const end = src.indexOf('*/', i + 2)
			const stop = end < 0 ? n : end + 2
			for (let k = i; k < stop; k++) if (src[k] === '\n') line++
			i = stop
			continue
		}
		if (c === '`') {
			out.push({t: 'bad', v: 'template literal', line})
			const end = src.indexOf('`', i + 1)
			i = end < 0 ? n : end + 1
			continue
		}
		if (c === '"' || c === "'") {
			let j = i + 1
			let v = ''
			while (j < n && src[j] !== c) {
				if (src[j] === '\\') {
					v += src[j + 1] ?? ''
					j += 2
					continue
				}
				if (src[j] === '\n') break
				v += src[j++]
			}
			out.push({t: 'str', v, line})
			i = j + 1
			continue
		}
		if (/[A-Za-z_$]/.test(c) || c.charCodeAt(0) > 127) {
			let j = i
			while (j < n && (/[A-Za-z0-9_$]/.test(src[j]) || src.charCodeAt(j) > 127)) j++
			out.push({t: 'id', v: src.slice(i, j), line})
			i = j
			continue
		}
		if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
			let j = i
			while (j < n && /[0-9A-Za-z_.]/.test(src[j])) j++
			out.push({t: 'num', v: src.slice(i, j), line})
			i = j
			continue
		}
		if (c === '/') {
			const p = prevSignificant()
			const division = p && (p.t === 'id' || p.t === 'num' || p.t === 'str' || (p.t === 'p' && (p.v === ')' || p.v === ']' || p.v === '}')))
			if (!division || (p.t === 'id' && KEYWORDS.has(p.v) && p.v !== 'this')) {
				out.push({t: 'bad', v: 'regex literal', line})
				let j = i + 1
				while (j < n && src[j] !== '/' && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1
				i = j + 1
				continue
			}
		}
		const three = src.slice(i, i + 3)
		const two = src.slice(i, i + 2)
		const p3 = ['===', '!==', '...', '**=', '<<=', '>>=', '&&=', '||=', '??='].includes(three) ? three : null
		const p2 = ['=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '%=', '**', '<<', '>>'].includes(two) ? two : null
		const v = p3 ?? p2 ?? c
		out.push({t: 'p', v, line})
		i += v.length
	}
	return out
}

const isP = (tok, v) => tok && tok.t === 'p' && tok.v === v

/** Matching close index for an open bracket at i. */
function matchClose(toks, i) {
	const open = toks[i].v
	const close = {'(': ')', '[': ']', '{': '}'}[open]
	let d = 0
	for (let k = i; k < toks.length; k++) {
		if (isP(toks[k], open)) d++
		else if (isP(toks[k], close) && --d === 0) return k
	}
	return toks.length - 1
}

/** Identifiers bound by a pattern/param list in toks[a..b] (exclusive b). */
function bindings(toks, a, b, out) {
	let depth = 0
	let inDefault = false
	let defaultDepth = 0
	for (let k = a; k < b; k++) {
		const t = toks[k]
		if (t.t === 'p') {
			if (t.v === '(' || t.v === '[' || t.v === '{') depth++
			else if (t.v === ')' || t.v === ']' || t.v === '}') {
				depth--
				if (inDefault && depth < defaultDepth) inDefault = false
			} else if (t.v === '=' && !inDefault) {
				inDefault = true
				defaultDepth = depth
			} else if (t.v === ',' && inDefault && depth === defaultDepth) inDefault = false
			continue
		}
		if (t.t !== 'id' || inDefault || KEYWORDS.has(t.v)) continue
		if (isP(toks[k + 1], ':')) continue // key in a destructuring pattern
		if (isP(toks[k - 1], '.')) continue
		out.add(t.v)
	}
}

function collectDeclared(toks) {
	const declared = new Set()
	for (let i = 0; i < toks.length; i++) {
		const t = toks[i]
		if (t.t === 'id' && (t.v === 'const' || t.v === 'let' || t.v === 'var')) {
			// declarators until ';' / end of statement at depth 0
			let k = i + 1
			while (k < toks.length) {
				const start = k
				if (isP(toks[k], '{') || isP(toks[k], '[')) {
					const close = matchClose(toks, k)
					bindings(toks, k, close + 1, declared)
					k = close + 1
				} else if (toks[k]?.t === 'id') {
					declared.add(toks[k].v)
					k++
				}
				if (k === start) break
				// skip initializer
				if (isP(toks[k], '=')) {
					let d = 0
					k++
					for (; k < toks.length; k++) {
						const x = toks[k]
						if (x.t === 'p' && '([{'.includes(x.v)) d++
						else if (x.t === 'p' && ')]}'.includes(x.v)) {
							if (d === 0) break
							d--
						} else if (d === 0 && (isP(x, ',') || isP(x, ';'))) break
						else if (d === 0 && x.t === 'id' && ['const', 'let', 'var', 'export', 'function', 'return', 'if'].includes(x.v) && x.line !== toks[k - 1].line) break
					}
				}
				if (isP(toks[k], ',')) {
					k++
					continue
				}
				break
			}
		} else if (t.t === 'id' && t.v === 'function') {
			let k = i + 1
			if (toks[k]?.t === 'id') declared.add(toks[k++].v)
			if (isP(toks[k], '(')) bindings(toks, k + 1, matchClose(toks, k), declared)
		} else if (t.t === 'id' && t.v === 'catch' && isP(toks[i + 1], '(')) {
			bindings(toks, i + 2, matchClose(toks, i + 1), declared)
		} else if (isP(t, '(')) {
			const close = matchClose(toks, i)
			const prev = toks[i - 1]
			const arrow = isP(toks[close + 1], '=>')
			const method = isP(toks[close + 1], '{') && prev?.t === 'id' && !['if', 'switch', 'catch', 'function', 'for', 'while', 'with'].includes(prev.v)
			if (arrow || method) bindings(toks, i + 1, close, declared)
		} else if (t.t === 'id' && isP(toks[i + 1], '=>')) declared.add(t.v)
		else if (t.t === 'id' && t.v === 'import') {
			// import {a, b as c} from '...'
			const open = toks.findIndex((x, k) => k > i && isP(x, '{'))
			if (open > i) {
				const close = matchClose(toks, open)
				for (let k = open + 1; k < close; k++) {
					if (toks[k].t !== 'id') continue
					if (isP(toks[k + 1], ',') || isP(toks[k + 1], '}')) declared.add(toks[k].v)
				}
			}
		}
	}
	return declared
}

/**
 * Check one code-block source file.
 * @param {string} src
 * @param {{file?: string}} [o]
 * @returns {{ok: boolean, errors: {line: number, rule: string, msg: string}[]}}
 */
export function checkBlockSource(src, {file = 'block.js'} = {}) {
	const errors = []
	const err = (line, rule, msg) => errors.push({line, rule, msg: `${file}:${line} ${msg}`})
	if (typeof src !== 'string') return {ok: false, errors: [{line: 0, rule: 'input', msg: 'not text'}]}
	const lines = src.split('\n').length
	if (lines > MAX_LINES) err(lines, 'size', `${lines} lines (max ${MAX_LINES})`)
	if (new TextEncoder().encode(src).length > MAX_BYTES) err(0, 'size', `over ${MAX_BYTES} bytes`)
	const toks = tokenize(src)
	const declared = collectDeclared(toks)
	let exportsBlock = 0
	let exportsRun = 0
	for (let i = 0; i < toks.length; i++) {
		const t = toks[i]
		const prev = toks[i - 1]
		const next = toks[i + 1]
		if (t.t === 'bad') {
			err(t.line, 'syntax', `${t.v}s are not allowed`)
			continue
		}
		if (t.t === 'p') {
			if (t.v === '[' && prev && (prev.t === 'id' && !KEYWORDS.has(prev.v) || isP(prev, ')') || isP(prev, ']'))) {
				const close = matchClose(toks, i)
				if (!(close === i + 2 && toks[i + 1].t === 'num')) err(t.line, 'computed', 'computed member access is not allowed (use lib.at)')
			}
			continue
		}
		if (t.t !== 'id') continue
		const v = t.v
		if (BANNED_SET.has(v)) {
			err(t.line, 'banned', `"${v}" is not allowed`)
			continue
		}
		if (BANNED_KEYWORDS.includes(v)) {
			err(t.line, 'keyword', `"${v}" is not allowed`)
			continue
		}
		if (v === 'function' && isP(next, '*')) err(t.line, 'keyword', 'generators are not allowed')
		if (v === 'random' && isP(prev, '.') && toks[i - 2]?.v === 'Math') err(t.line, 'banned', 'Math.random is not allowed (use api.random)')
		if (v === 'import') {
			if (isP(next, '(') || isP(next, '.')) {
				err(t.line, 'import', 'dynamic import and import.meta are not allowed')
				continue
			}
			if (!isP(next, '{')) {
				err(t.line, 'import', 'only named imports are allowed')
				continue
			}
			const close = matchClose(toks, i + 1)
			const from = toks[close + 1]
			const source = toks[close + 2]
			if (from?.v !== 'from' || source?.t !== 'str' || !IMPORT_ALLOWLIST.includes(source.v)) err(t.line, 'import', `imports only from ${IMPORT_ALLOWLIST.join(', ')}`)
			i = close + 2
			continue
		}
		if (v === 'export') {
			if (next?.v === 'const' && toks[i + 2]?.v === 'block' && isP(toks[i + 3], '=')) exportsBlock++
			else if (next?.v === 'function' && toks[i + 2]?.v === 'run' && isP(toks[i + 3], '(')) exportsRun++
			else err(t.line, 'export', 'only `export const block` and `export function run` are allowed')
			continue
		}
		if (KEYWORDS.has(v)) continue
		if (isP(prev, '.') || isP(prev, '?.')) continue // property name
		if (isP(next, ':') && (isP(prev, '{') || isP(prev, ','))) continue // object key
		if (!declared.has(v) && !ALLOWED_SET.has(v)) err(t.line, 'global', `"${v}" is not declared here (globals are not allowed)`)
	}
	if (exportsBlock !== 1) err(0, 'export', 'needs exactly one `export const block = {...}`')
	if (exportsRun !== 1) err(0, 'export', 'needs exactly one `export function run(api, p) {...}`')
	return {ok: errors.length === 0, errors}
}

const IMPORT_LINE = /^import \* as ([A-Za-z][A-Za-z0-9]*) from '\.\/([a-z0-9][a-z0-9-]*)\.js'$/
/**
 * Check blocks/index.js: comments, blank lines, `import * as x from './x.js'` lines and
 * one `export const CODE_BLOCKS = [x, y]` line, nothing else. Every block file must be listed.
 * @param {string} src
 * @param {string[]} [blockFiles]  file names in the folder (to check they are all listed)
 */
export function checkIndexSource(src, blockFiles) {
	const errors = []
	const names = new Map()
	let list = null
	src.split('\n').forEach((raw, k) => {
		const line = raw.trim()
		if (!line || line.startsWith('//')) return
		const m = IMPORT_LINE.exec(line)
		if (m) {
			names.set(m[1], `${m[2]}.js`)
			return
		}
		const e = /^export const CODE_BLOCKS = \[([A-Za-z0-9, ]*)\]$/.exec(line)
		if (e && list === null) {
			list = e[1].split(',').map((s) => s.trim()).filter(Boolean)
			return
		}
		errors.push({line: k + 1, rule: 'index', msg: `index.js:${k + 1} unexpected line`})
	})
	if (!list) errors.push({line: 0, rule: 'index', msg: 'index.js needs `export const CODE_BLOCKS = [...]`'})
	for (const x of list ?? []) if (!names.has(x)) errors.push({line: 0, rule: 'index', msg: `index.js lists ${x} but does not import it`})
	for (const x of names.keys()) if (!(list ?? []).includes(x)) errors.push({line: 0, rule: 'index', msg: `index.js imports ${x} but does not list it`})
	if (blockFiles) {
		const imported = new Set(names.values())
		for (const f of blockFiles) if (!imported.has(f)) errors.push({line: 0, rule: 'index', msg: `${f} is not registered in index.js`})
		for (const f of imported) if (!blockFiles.includes(f)) errors.push({line: 0, rule: 'index', msg: `index.js imports missing file ${f}`})
	}
	return {ok: errors.length === 0, errors}
}
