// EVER platform: the world/ manifest (editions, content hashes, ledger).
//
// world/manifest.json
//   {v: 1, edition: 14, updated: 'YYYY-MM-DD',
//    files:  [{path: 'cards/banked-hammer-1a2b3c4d.json', type: 'card', hash: '<16 hex>', bytes: 612, since: 3}],
//    names:  ['Banked Hammer', ...],                 // world card/item/npc names (uniqueness)
//    ledger: [{edition, type, title, book, at}],     // last 20 changes, newest first (GDD_V2 14.6)
//    retired?: ['1a2b3c4d']}                        // content keys rolled back; the bot refuses them
//
// The world only grows (GDD_V2 14.4), so edition E is exactly the files with since <= E:
// every older edition stays loadable from the latest deploy, and a book pinned to E sees the
// same world forever. `hash` = first 16 hex of SHA-256 over the file's exact bytes; the build
// serves each file at world/f/<hash>.json (immutable) and CI checks the hashes.
// PURE (WebCrypto only).
//
// Copyright (C) 2026 the EVER contributors.
// SPDX-License-Identifier: AGPL-3.0-or-later

import {WORLD_TYPES, sha256Hex} from './world-schema.js'

export const MANIFEST_VERSION = 1
export const LEDGER_MAX = 20
export const MANIFEST_MAX_BYTES = 65536

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x)
const PATH_RE = /^(cards|items|lines|npcs|places|paths|presets)\/[a-z0-9][a-z0-9-]{0,48}\.json$/

/** First 16 hex of SHA-256 of a file's exact text. */
export const fileHash = async (text) => (await sha256Hex(text)).slice(0, 16)

export function emptyManifest() {
	return {v: MANIFEST_VERSION, edition: 0, updated: '', files: [], names: [], ledger: []}
}

/**
 * Shape check (no file contents). Returns the list of problems; empty = ok.
 * @param {any} m
 * @returns {string[]}
 */
export function checkManifest(m) {
	const errs = []
	if (!isObj(m)) return ['manifest is not an object']
	if (m.v !== MANIFEST_VERSION) errs.push(`v must be ${MANIFEST_VERSION}`)
	if (!Number.isInteger(m.edition) || m.edition < 0) errs.push('edition must be a non-negative integer')
	if (!Array.isArray(m.files)) return [...errs, 'files must be a list']
	const seen = new Set()
	for (const [i, f] of m.files.entries()) {
		if (!isObj(f)) {
			errs.push(`files[${i}] is not an object`)
			continue
		}
		if (typeof f.path !== 'string' || !PATH_RE.test(f.path)) errs.push(`files[${i}].path ${JSON.stringify(f.path)} is not a world data path`)
		else if (WORLD_TYPES[f.type] !== f.path.split('/')[0]) errs.push(`files[${i}].type ${f.type} does not match its folder`)
		if (seen.has(f.path)) errs.push(`files[${i}].path repeats`)
		seen.add(f.path)
		if (typeof f.hash !== 'string' || !/^[0-9a-f]{16}$/.test(f.hash)) errs.push(`files[${i}].hash must be 16 hex`)
		if (!Number.isInteger(f.bytes) || f.bytes < 2) errs.push(`files[${i}].bytes must be a positive integer`)
		if (!Number.isInteger(f.since) || f.since < 1 || f.since > m.edition) errs.push(`files[${i}].since must be 1..edition`)
	}
	if (!Array.isArray(m.names) || m.names.some((n) => typeof n !== 'string')) errs.push('names must be a list of strings')
	else if (new Set(m.names.map((n) => n.toLowerCase())).size !== m.names.length) errs.push('names repeat')
	if (!Array.isArray(m.ledger) || m.ledger.length > LEDGER_MAX) errs.push(`ledger must be a list of at most ${LEDGER_MAX}`)
	if (m.retired !== undefined && (!Array.isArray(m.retired) || m.retired.some((k) => typeof k !== 'string' || !/^[0-9a-f]{8}$/.test(k)))) errs.push('retired must be a list of 8-hex content keys')
	return errs
}

/** Files that belong to edition `edition` (the world only grows). */
export function filesForEdition(m, edition = m.edition) {
	return m.files.filter((f) => f.since <= edition)
}

/** Does the manifest already hold an entry with this content key (path suffix)? */
export const hasKey = (m, key) => m.files.some((f) => f.path.endsWith(`-${key}.json`)) || (m.retired ?? []).includes(key)

/**
 * Add one file and bump the edition (pure; the bot and the world-add tool use it).
 * @param {object} m  current manifest
 * @param {{path: string, type: string, text: string, name?: string|null, title: string, book?: number, at: string}} add
 */
export async function addToManifest(m, add) {
	const edition = m.edition + 1
	const hash = await fileHash(add.text)
	const bytes = new TextEncoder().encode(add.text).length
	const files = [...m.files.filter((f) => f.path !== add.path), {path: add.path, type: add.type, hash, bytes, since: edition}]
	const names = add.name && !m.names.some((n) => n.toLowerCase() === add.name.toLowerCase()) ? [...m.names, add.name] : m.names
	const ledger = add.type === 'preset' ? m.ledger : [{edition, type: add.type, title: add.title, ...(add.book ? {book: add.book} : {}), at: add.at}, ...m.ledger].slice(0, LEDGER_MAX)
	return {v: MANIFEST_VERSION, edition, updated: add.at, files, names, ledger, ...(m.retired ? {retired: m.retired} : {})}
}

/** The exact bytes manifest.json is stored with. */
export const serializeManifest = (m) => JSON.stringify(m, null, '\t') + '\n'
