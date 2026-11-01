#!/usr/bin/env node
// EVER mechanics: CLI for the code-block sandbox (Node only; the browser never imports it).
//   node game/src/mechanics/tools/check-blocks.mjs            check every file in blocks/
//   node game/src/mechanics/tools/check-blocks.mjs a.js b.js  check these files (e.g. a PR diff)
// Exit code 0 = all pass, 1 = violations (printed one per line as file:line message).
// The GitHub Action runs this next to the tests (docs/MECHANICS.md section 7).
//
// Copyright (C) 2026 the EVER contributors.
// SPDX-License-Identifier: AGPL-3.0-or-later

import {readFileSync, readdirSync} from 'node:fs'
import {basename, dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {checkBlockSource, checkIndexSource} from '../sandbox/check.js'

const BLOCKS = resolve(dirname(fileURLToPath(import.meta.url)), '../blocks')

/** @returns {{file: string, errors: {msg: string}[]}[]} */
export function checkBlocksDir(dir = BLOCKS, only = null) {
	const files = readdirSync(dir).filter((f) => f.endsWith('.js'))
	const blockFiles = files.filter((f) => f !== 'index.js')
	const out = []
	for (const f of only ?? files) {
		const name = basename(f)
		const src = readFileSync(only ? resolve(f) : join(dir, f), 'utf8')
		const r = name === 'index.js' ? checkIndexSource(src, blockFiles) : checkBlockSource(src, {file: name})
		out.push({file: name, errors: r.errors})
	}
	return out
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const args = process.argv.slice(2)
	const results = checkBlocksDir(BLOCKS, args.length ? args : null)
	let bad = 0
	for (const r of results) for (const e of r.errors) {
		bad++
		console.error(e.msg.startsWith(r.file) ? e.msg : `${r.file}: ${e.msg}`)
	}
	console.log(bad ? `sandbox: ${bad} violation(s)` : `sandbox: ${results.length} file(s) OK`)
	process.exit(bad ? 1 : 0)
}
