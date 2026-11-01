#!/usr/bin/env node
// EVER platform (Node only): path allowlist and size limits for world-bot pull requests.
//
//   node game/src/platform/tools/pr-guard.mjs --base <sha> --head <sha> [--bot]
//
// Bot PRs (--bot) may only ADD world data files (world/<folder>/*.json) and modify
// world/manifest.json, OR add one code block (game/src/mechanics/blocks/<name>.js) and
// modify blocks/index.js. Never both, never deletes or renames, at most 3 files,
// at most 8 KB of data, at most 120 lines of code (GDD_V2 14.4). Human PRs only get notes.
// Exit 0 = OK, 1 = violation.
//
// Copyright (C) 2026 the EVER contributors.
// SPDX-License-Identifier: AGPL-3.0-or-later

import {execFileSync} from 'node:child_process'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {LIMITS} from '../world-schema.js'

const DATA_FILE = /^world\/(cards|items|lines|npcs|places|paths)\/[a-z0-9][a-z0-9-]{0,48}\.json$/
const MANIFEST = 'world/manifest.json'
const BLOCK_FILE = /^game\/src\/mechanics\/blocks\/[a-z][a-z0-9-]{2,40}\.js$/
const BLOCK_INDEX = 'game/src/mechanics/blocks/index.js'

/**
 * @typedef {{status: string, path: string, added: number, deleted: number, bytes: number}} Change
 *   status: git name-status letter (A, M, D, R..., C...); bytes: size at head (0 if deleted)
 * @param {Change[]} changes
 * @param {{bot: boolean}} opts
 * @returns {{ok: boolean, errors: string[], notes: string[]}}
 */
export function guardPr(changes, {bot}) {
	const errors = []
	const notes = []
	const touches = (re) => changes.some((c) => (typeof re === 'string' ? c.path === re : re.test(c.path)))
	if (!bot) {
		const world = changes.filter((c) => c.path.startsWith('world/'))
		if (world.length) notes.push(`human PR touches ${world.length} world file(s); check-world validates them`)
		return {ok: true, errors, notes}
	}
	if (!changes.length) errors.push('bot PR changes nothing')
	if (changes.length > LIMITS.prFiles) errors.push(`bot PR changes ${changes.length} files (max ${LIMITS.prFiles})`)
	const data = touches(DATA_FILE) || touches(MANIFEST)
	const code = touches(BLOCK_FILE) || touches(BLOCK_INDEX)
	if (data && code) errors.push('bot PR mixes world data and code (one world change per PR)')
	let dataBytes = 0
	let codeLines = 0
	for (const c of changes) {
		const st = c.status[0]
		if (c.path === MANIFEST || c.path === BLOCK_INDEX) {
			if (st !== 'M') errors.push(`${c.path}: bot may only modify it (status ${c.status})`)
			if (c.path === BLOCK_INDEX && c.deleted > 0) errors.push(`${c.path}: bot may not remove lines`)
			continue
		}
		if (DATA_FILE.test(c.path)) {
			if (st !== 'A') errors.push(`${c.path}: bot may only add world files (the world only grows; status ${c.status})`)
			dataBytes += c.bytes
			continue
		}
		if (BLOCK_FILE.test(c.path)) {
			if (st !== 'A') errors.push(`${c.path}: bot may only add new blocks (status ${c.status})`)
			codeLines += c.added
			if (c.added > LIMITS.blockLines) errors.push(`${c.path}: ${c.added} lines (max ${LIMITS.blockLines})`)
			continue
		}
		errors.push(`${c.path}: outside the bot allowlist (world/** data, game/src/mechanics/blocks/** code)`)
	}
	if (data && !touches(MANIFEST)) errors.push('bot data PR must update world/manifest.json')
	if (code && !touches(BLOCK_INDEX)) errors.push('bot code PR must register the block in blocks/index.js')
	if (dataBytes > LIMITS.prDataBytes) errors.push(`bot PR adds ${dataBytes} bytes of data (max ${LIMITS.prDataBytes})`)
	if (codeLines > LIMITS.blockLines) errors.push(`bot PR adds ${codeLines} lines of code (max ${LIMITS.blockLines})`)
	notes.push(`bot PR: ${changes.length} file(s), ${dataBytes} data bytes, ${codeLines} code lines`)
	return {ok: errors.length === 0, errors, notes}
}

/** Read the PR's changes from git (both commits must be fetched). */
export function gitChanges(base, head, cwd = process.cwd()) {
	const git = (...a) => execFileSync('git', a, {cwd, encoding: 'utf8'})
	const range = [`${base}...${head}`]
	const status = git('diff', '--name-status', '-M', ...range)
		.split('\n')
		.filter(Boolean)
		.map((l) => l.split('\t'))
	const num = new Map(
		git('diff', '--numstat', '-M', ...range)
			.split('\n')
			.filter(Boolean)
			.map((l) => {
				const [a, d, ...p] = l.split('\t')
				return [p[p.length - 1], {added: a === '-' ? 0 : Number(a), deleted: d === '-' ? 0 : Number(d)}]
			}),
	)
	return status.map(([st, ...paths]) => {
		const path = paths[paths.length - 1]
		const n = num.get(path) ?? {added: 0, deleted: 0}
		let bytes = 0
		if (st[0] !== 'D') {
			try {
				bytes = Number(git('cat-file', '-s', `${head}:${path}`).trim())
			} catch {}
		}
		return {status: st, path, ...n, bytes}
	})
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const args = process.argv.slice(2)
	const val = (k) => {
		const i = args.indexOf(k)
		return i >= 0 ? args[i + 1] : undefined
	}
	const base = val('--base')
	const head = val('--head') ?? 'HEAD'
	if (!base) {
		console.error('usage: pr-guard.mjs --base <sha> [--head <sha>] [--bot]')
		process.exit(2)
	}
	const r = guardPr(gitChanges(base, head), {bot: args.includes('--bot')})
	for (const n of r.notes) console.log(n)
	for (const e of r.errors) console.error(e)
	console.log(r.ok ? 'pr-guard: OK' : `pr-guard: ${r.errors.length} violation(s)`)
	process.exit(r.ok ? 0 : 1)
}
