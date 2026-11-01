#!/usr/bin/env node
// EVER platform (Node only): measure the production bundle in public/ (run after npm run build).
//
//   node game/src/platform/tools/bundle-report.mjs [dir=public] [--budget-kb 260] [--sources] [--json]
//
// First load = index.html + its entry script + every <link rel=modulepreload> + CSS.
// Lazy = every other JS chunk. Sizes are raw and gzip (level 9). --sources attributes the
// first-load JS to source folders through the source maps. --budget-kb fails (exit 1) when
// the first-load gzip total is over the budget.
//
// Copyright (C) 2026 the EVER contributors.
// SPDX-License-Identifier: AGPL-3.0-or-later

import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs'
import {join, relative, resolve, sep} from 'node:path'
import {fileURLToPath} from 'node:url'
import {gzipSync} from 'node:zlib'

const kb = (n) => (n / 1024).toFixed(1)

function walk(dir) {
	const out = []
	for (const f of readdirSync(dir)) {
		const p = join(dir, f)
		if (statSync(p).isDirectory()) out.push(...walk(p))
		else out.push(p)
	}
	return out
}

/** @returns {{first: object[], lazy: object[], other: object[], totals: object, sources: Record<string, number>|null}} */
export function bundleReport(dir, {sources = false} = {}) {
	const html = readFileSync(join(dir, 'index.html'), 'utf8')
	const refs = new Set([...html.matchAll(/(?:src|href)="\.?\/?([^"]+\.(?:js|css))"/g)].map((m) => m[1]))
	const files = walk(dir).filter((p) => !p.endsWith('.map'))
	const row = (p) => {
		const buf = readFileSync(p)
		return {file: relative(dir, p).split(sep).join('/'), bytes: buf.length, gzip: gzipSync(buf, {level: 9}).length}
	}
	const first = [row(join(dir, 'index.html'))]
	const lazy = []
	const other = []
	for (const p of files) {
		const rel = relative(dir, p).split(sep).join('/')
		if (rel === 'index.html') continue
		if (refs.has(rel)) first.push(row(p))
		else if (rel.endsWith('.js')) lazy.push(row(p))
		else other.push(row(p))
	}
	const sum = (list, k) => list.reduce((a, r) => a + r[k], 0)
	const totals = {firstBytes: sum(first, 'bytes'), firstGzip: sum(first, 'gzip'), lazyBytes: sum(lazy, 'bytes'), lazyGzip: sum(lazy, 'gzip'), lazyCount: lazy.length}
	let src = null
	if (sources) {
		src = {}
		for (const r of first.filter((x) => x.file.endsWith('.js'))) {
			const mapPath = join(dir, r.file + '.map')
			if (!existsSync(mapPath)) continue
			const map = JSON.parse(readFileSync(mapPath, 'utf8'))
			;(map.sources ?? []).forEach((s, i) => {
				const len = map.sourcesContent?.[i]?.length ?? 0
				const at = Math.max(s.lastIndexOf('node_modules/'), s.indexOf('game/src/'), s.indexOf('vendor/'))
				const key = (at > 0 ? s.slice(at) : s.replace(/^(\.\.\/)+/, '')).replace(/^node_modules\/([^/]+)\/.*/, 'npm:$1').replace(/^(game\/src\/[^/]+|vendor\/[^/]+\/src\/[^/]+)\/.*/, '$1')
				src[key] = (src[key] ?? 0) + len
			})
		}
	}
	return {first: first.sort((a, b) => b.bytes - a.bytes), lazy: lazy.sort((a, b) => b.bytes - a.bytes), other, totals, sources: src}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const args = process.argv.slice(2)
	const bi = args.indexOf('--budget-kb')
	const budget = bi >= 0 ? Number(args[bi + 1]) : null
	const dir = resolve(args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--budget-kb') ?? 'public')
	const r = bundleReport(dir, {sources: args.includes('--sources')})
	if (args.includes('--json')) console.log(JSON.stringify(r, null, 2))
	else {
		console.log('first load (raw KB / gzip KB):')
		for (const x of r.first) console.log(`  ${x.file.padEnd(48)} ${kb(x.bytes).padStart(8)} ${kb(x.gzip).padStart(8)}`)
		console.log(`  ${'TOTAL'.padEnd(48)} ${kb(r.totals.firstBytes).padStart(8)} ${kb(r.totals.firstGzip).padStart(8)}`)
		console.log(`lazy chunks: ${r.totals.lazyCount}, ${kb(r.totals.lazyBytes)} KB raw, ${kb(r.totals.lazyGzip)} KB gzip`)
		for (const x of r.lazy.slice(0, 8)) console.log(`  ${x.file.padEnd(48)} ${kb(x.bytes).padStart(8)} ${kb(x.gzip).padStart(8)}`)
		const world = r.other.filter((x) => x.file.startsWith('world/') || x.file === 'version.json')
		if (world.length) console.log(`world data: ${world.length} file(s), ${kb(world.reduce((a, x) => a + x.bytes, 0))} KB raw; manifest ${kb(world.find((x) => x.file === 'world/manifest.json')?.bytes ?? 0)} KB`)
		if (r.sources) {
			console.log('first-load JS by source (unminified chars):')
			for (const [k, v] of Object.entries(r.sources).sort((a, b) => b[1] - a[1]).slice(0, 14)) console.log(`  ${k.padEnd(48)} ${kb(v).padStart(8)}`)
		}
	}
	if (budget !== null && r.totals.firstGzip / 1024 > budget) {
		console.error(`bundle: first load ${kb(r.totals.firstGzip)} KB gzip is over the ${budget} KB budget`)
		process.exit(1)
	}
}
