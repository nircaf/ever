#!/usr/bin/env node
// EVER platform (Node only): validate world/ for CI and before a commit.
//
//   node game/src/platform/tools/check-world.mjs                       schema + hashes, no sim
//   node game/src/platform/tools/check-world.mjs --sim-all --fights 200  + full balance sim on every card/item
//   node game/src/platform/tools/check-world.mjs --base <sha> --fights 200 [--bot]
//        + full sim on files changed since <sha>; --bot = those files must be run-made (no studio content)
//
// Checks: manifest shape, every data file listed and every listed file present, hash and
// bytes match, each file is a canonical world entry (schema, text, mechanics validator, the
// stricter global sim band), its path carries its content key, names unique, presets valid.
// Exit 0 = OK, 1 = problems (one per line).
//
// Copyright (C) 2026 the EVER contributors.
// SPDX-License-Identifier: AGPL-3.0-or-later

import {execFileSync} from 'node:child_process'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {checkManifest, fileHash} from '../world-manifest.js'
import {entryName, entryPath, serializeEntry, validateWorldEntry} from '../world-schema.js'
import {REPO_ROOT, WORLD_DIR, listWorldFiles, readManifest, readWorldFile} from './world-fs.mjs'

/**
 * @param {{dir?: string, changed?: string[]|null, simAll?: boolean, fights?: number, bot?: boolean}} [opts]
 *   changed: world-relative paths that get the full sim (and the bot rules); null = none
 * @returns {Promise<{errors: string[], notes: string[]}>}
 */
export async function checkWorld({dir = WORLD_DIR, changed = null, simAll = false, fights = 200, bot = false} = {}) {
	const errors = []
	const notes = []
	let m
	try {
		m = readManifest(dir)
	} catch (e) {
		return {errors: [`world/manifest.json: ${e.message}`], notes}
	}
	for (const e of checkManifest(m)) errors.push(`world/manifest.json: ${e}`)
	if (errors.length) return {errors, notes}

	const onDisk = listWorldFiles(dir)
	const listed = new Map(m.files.map((f) => [f.path, f]))
	for (const p of onDisk) if (!listed.has(p)) errors.push(`world/${p}: not in manifest.json (run world-add.mjs)`)

	const entries = []
	for (const f of m.files) {
		let text
		try {
			text = readWorldFile(f.path, dir)
		} catch {
			errors.push(`world/${f.path}: listed in manifest.json but missing`)
			continue
		}
		const hash = await fileHash(text)
		if (hash !== f.hash) errors.push(`world/${f.path}: hash ${hash} does not match manifest ${f.hash} (run world-add.mjs --rehash)`)
		if (new TextEncoder().encode(text).length !== f.bytes) errors.push(`world/${f.path}: bytes do not match manifest`)
		let raw
		try {
			raw = JSON.parse(text)
		} catch (e) {
			errors.push(`world/${f.path}: not JSON (${e.message})`)
			continue
		}
		entries.push({f, raw, text})
	}

	const allNames = entries.map(({raw}) => (raw.type === 'card' || raw.type === 'item' ? raw.def?.name : raw.type === 'npc' ? raw.name : null)).filter(Boolean)
	const presetIds = new Set()
	for (const {f, raw, text} of entries) {
		const isChanged = simAll || (changed ?? []).includes(f.path)
		const own = raw.type === 'card' || raw.type === 'item' ? raw.def?.name : raw.type === 'npc' ? raw.name : null
		const names = raw.type === 'preset' ? [] : allNames.filter((n) => n !== own)
		const t0 = Date.now()
		const v = validateWorldEntry(raw, {names, bot: bot && isChanged, sim: isChanged && (raw.type === 'card' || raw.type === 'item' || raw.type === 'preset') ? {fights} : false})
		if (!v.ok) {
			for (const e of v.errors) errors.push(`world/${f.path}: ${e.path ? e.path + ': ' : ''}${e.msg}`)
			continue
		}
		if (v.sim) notes.push(`world/${f.path}: sim ${fights} fights, win ${v.sim.deltaWin >= 0 ? '+' : ''}${v.sim.deltaWin}, power ${v.sim.deltaPower}, ${Date.now() - t0} ms`)
		if (serializeEntry(v.entry) !== text) errors.push(`world/${f.path}: not in canonical form (unknown fields or formatting; run world-add.mjs on it)`)
		if (v.entry.type !== f.type) errors.push(`world/${f.path}: manifest type ${f.type} but file type ${v.entry.type}`)
		const {path} = await entryPath(v.entry)
		if (path !== f.path) errors.push(`world/${f.path}: path should be ${path} (the suffix is the content key)`)
		if (v.entry.type === 'preset') {
			if (presetIds.has(v.entry.id)) errors.push(`world/${f.path}: preset id ${v.entry.id} repeats`)
			presetIds.add(v.entry.id)
		}
	}
	const expectNames = entries.map(({raw}) => entryName({...raw})).filter(Boolean)
	const a = [...expectNames].map((n) => n.toLowerCase()).sort().join('|')
	const b = [...m.names].map((n) => n.toLowerCase()).sort().join('|')
	if (a !== b) errors.push('world/manifest.json: names do not match the card/item/npc files')
	notes.push(`world: edition ${m.edition}, ${m.files.length} file(s)`)
	return {errors, notes}
}

/** World-relative paths changed between a git base and HEAD. */
export function changedSince(base, cwd = REPO_ROOT) {
	const out = execFileSync('git', ['diff', '--name-only', '--diff-filter=AM', base, 'HEAD', '--', 'world/'], {cwd, encoding: 'utf8'})
	return out
		.split('\n')
		.map((s) => s.trim())
		.filter((s) => s.startsWith('world/') && s !== 'world/manifest.json')
		.map((s) => s.slice('world/'.length))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const args = process.argv.slice(2)
	const val = (k) => {
		const i = args.indexOf(k)
		return i >= 0 ? args[i + 1] : undefined
	}
	const base = val('--base')
	const fights = Number(val('--fights') ?? 200)
	const changed = base ? changedSince(base) : null
	const {errors, notes} = await checkWorld({changed, simAll: args.includes('--sim-all'), fights, bot: args.includes('--bot')})
	for (const n of notes) console.log(n)
	for (const e of errors) console.error(e)
	console.log(errors.length ? `world: ${errors.length} problem(s)` : 'world: OK')
	process.exit(errors.length ? 1 : 0)
}
