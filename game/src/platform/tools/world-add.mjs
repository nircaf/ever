#!/usr/bin/env node
// EVER platform (Node only): add studio/hand-made entries to world/ (the bot does the same
// thing through the GitHub API). All files given in one call land in ONE new edition.
//
//   node game/src/platform/tools/world-add.mjs draft1.json [draft2.json ...] [--at 2026-11-01] [--fights 200]
//   node game/src/platform/tools/world-add.mjs --rehash      recompute hashes/bytes/names after a hand edit
//   node game/src/platform/tools/world-add.mjs --remove cards/x-1a2b3c4d.json   roll a change back (new edition)
//
// A draft is a world entry ({v: 1, type, origin: {src: 'studio'}, ...}). It is validated
// (cards/items/presets with the full sim), written in canonical form to
// world/<folder>/<slug>-<key>.json and added to manifest.json.
//
// Copyright (C) 2026 the EVER contributors.
// SPDX-License-Identifier: AGPL-3.0-or-later

import {mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {fileHash, hasKey, serializeManifest} from '../world-manifest.js'
import {entryName, entryPath, entryTitle, serializeEntry, validateWorldEntry} from '../world-schema.js'
import {WORLD_DIR, readManifest, readWorldFile} from './world-fs.mjs'

export async function rehash(dir = WORLD_DIR) {
	const m = readManifest(dir)
	const names = []
	for (const f of m.files) {
		const text = readWorldFile(f.path, dir)
		f.hash = await fileHash(text)
		f.bytes = new TextEncoder().encode(text).length
		const n = entryName(JSON.parse(text))
		if (n) names.push(n)
	}
	m.names = names
	writeFileSync(join(dir, 'manifest.json'), serializeManifest(m))
	return m
}

/**
 * Roll back: delete world files and publish the result as a NEW edition (editions never go
 * backwards, so pinned books stay valid; they keep the removed file in their local snapshot).
 */
export function removeEntries(paths, {dir = WORLD_DIR, at = new Date().toISOString().slice(0, 10)} = {}) {
	const m = readManifest(dir)
	for (const p of paths) {
		const f = m.files.find((x) => x.path === p)
		if (!f) throw new Error(`${p}: not in manifest.json`)
		const n = entryName(JSON.parse(readWorldFile(p, dir)))
		if (n) m.names = m.names.filter((x) => x !== n)
		m.files = m.files.filter((x) => x.path !== p)
		m.retired = [...new Set([...(m.retired ?? []), /-([0-9a-f]{8})\.json$/.exec(p)[1]])] // never accepted again
		rmSync(join(dir, p))
	}
	m.edition += 1
	m.updated = at
	m.ledger = m.ledger.filter((l) => m.files.some((f) => f.since === l.edition))
	writeFileSync(join(dir, 'manifest.json'), serializeManifest(m))
	return {edition: m.edition, removed: paths}
}

/**
 * @param {object[]} drafts
 * @param {{dir?: string, at?: string, fights?: number}} [opts]
 */
export async function addEntries(drafts, {dir = WORLD_DIR, at = new Date().toISOString().slice(0, 10), fights = 200} = {}) {
	const m = readManifest(dir)
	const edition = m.edition + 1
	const added = []
	for (const raw of drafts) {
		const names = [...m.names]
		const v = validateWorldEntry({...raw, origin: {...(raw.origin ?? {src: 'studio'}), at}}, {names: raw.type === 'preset' ? [] : names, sim: {fights}})
		if (!v.ok) throw new Error(`${raw.type} ${raw.id ?? raw.name ?? raw.def?.name ?? ''}: ${v.errors.map((e) => `${e.path}: ${e.msg}`).join('; ')}`)
		const {path, key} = await entryPath(v.entry)
		if (hasKey(m, key)) throw new Error(`${path}: the same content is already in the world`)
		const text = serializeEntry(v.entry)
		mkdirSync(dirname(join(dir, path)), {recursive: true})
		writeFileSync(join(dir, path), text)
		m.files.push({path, type: v.entry.type, hash: await fileHash(text), bytes: new TextEncoder().encode(text).length, since: edition})
		const name = entryName(v.entry)
		if (name) m.names.push(name)
		if (v.entry.type !== 'preset') m.ledger = [{edition, type: v.entry.type, title: entryTitle(v.entry), ...(v.entry.origin.book ? {book: v.entry.origin.book} : {}), at}, ...m.ledger].slice(0, 20)
		added.push(path)
	}
	m.edition = edition
	m.updated = at
	writeFileSync(join(dir, 'manifest.json'), serializeManifest(m))
	return {edition, added}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const args = process.argv.slice(2)
	if (args.includes('--rehash')) {
		const m = await rehash()
		console.log(`world: rehashed ${m.files.length} file(s), edition ${m.edition}`)
		process.exit(0)
	}
	const val = (k) => {
		const i = args.indexOf(k)
		return i >= 0 ? args[i + 1] : undefined
	}
	if (args.includes('--remove')) {
		const r = removeEntries(args.filter((a) => a !== '--remove' && !a.startsWith('--')))
		console.log(`world: edition ${r.edition}\n${r.removed.map((p) => `  - world/${p}`).join('\n')}`)
		process.exit(0)
	}
	const skip = new Set(['--at', val('--at'), '--fights', val('--fights')])
	const files = args.filter((a) => !skip.has(a))
	if (!files.length) {
		console.error('usage: world-add.mjs draft.json [...] [--at YYYY-MM-DD] [--fights N] | --rehash')
		process.exit(2)
	}
	const drafts = files.flatMap((f) => {
		const j = JSON.parse(readFileSync(f, 'utf8'))
		return Array.isArray(j) ? j : [j]
	})
	try {
		const r = await addEntries(drafts, {at: val('--at'), fights: Number(val('--fights') ?? 200)})
		console.log(`world: edition ${r.edition}\n${r.added.map((p) => `  + world/${p}`).join('\n')}`)
	} catch (e) {
		console.error(`world-add: ${e.message}`)
		process.exit(1)
	}
}
