// EVER platform (Node only): Vite plugin that ships world/ and version.json.
//
// Build (public/):
//   world/manifest.json      the manifest as committed (short cache, see game/static/_headers)
//   world/f/<hash>.json      every world file, content-addressed (immutable cache)
//   version.json             {engine, edition, built} for the "new edition" check (no-cache)
// Dev (vite / vite preview): the same URLs are served straight from world/.
// The build FAILS if a file's hash does not match the manifest (run world-add.mjs --rehash).
// Also defines __EVER_ENGINE__ = '<package version>+<commit>'.
//
// Copyright (C) 2026 the EVER contributors.
// SPDX-License-Identifier: AGPL-3.0-or-later

import {execFileSync} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {checkManifest, fileHash} from '../world-manifest.js'
import {REPO_ROOT, WORLD_DIR, readManifest, readWorldFile} from './world-fs.mjs'

export function engineVersion(root = REPO_ROOT) {
	const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
	let sha = process.env.CF_PAGES_COMMIT_SHA || process.env.GITHUB_SHA || ''
	if (!sha) {
		try {
			sha = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim()
		} catch {}
	}
	return `${pkg.version}+${(sha || 'local').slice(0, 7)}`
}

/** Read and verify the world: {manifest, byHash: Map<hash, text>}. Throws on any mismatch. */
export async function loadWorldForBuild(dir = WORLD_DIR) {
	const manifest = readManifest(dir)
	const problems = checkManifest(manifest)
	if (problems.length) throw new Error(`world/manifest.json: ${problems.join('; ')}`)
	const byHash = new Map()
	for (const f of manifest.files) {
		const text = readWorldFile(f.path, dir)
		const h = await fileHash(text)
		if (h !== f.hash) throw new Error(`world/${f.path}: hash ${h} does not match manifest ${f.hash}. Run: node game/src/platform/tools/world-add.mjs --rehash`)
		byHash.set(h, text)
	}
	return {manifest, byHash}
}

/** @returns {import('vite').Plugin} */
export function everWorld({dir = WORLD_DIR} = {}) {
	const engine = engineVersion()
	const built = new Date().toISOString()
	return {
		name: 'ever-world',
		config: () => ({define: {__EVER_ENGINE__: JSON.stringify(engine)}}),
		async generateBundle() {
			const {manifest, byHash} = await loadWorldForBuild(dir)
			this.emitFile({type: 'asset', fileName: 'world/manifest.json', source: readFileSync(join(dir, 'manifest.json'), 'utf8')})
			for (const [h, text] of byHash) this.emitFile({type: 'asset', fileName: `world/f/${h}.json`, source: text})
			this.emitFile({type: 'asset', fileName: 'version.json', source: JSON.stringify({engine, edition: manifest.edition, built}) + '\n'})
		},
		configureServer(server) {
			server.middlewares.use(middleware)
		},
		configurePreviewServer(server) {
			server.middlewares.use(middleware)
		},
	}
	async function middleware(req, res, next) {
		const url = (req.url ?? '').split('?')[0]
		const send = (body) => {
			res.setHeader('content-type', 'application/json')
			res.setHeader('cache-control', 'no-store')
			res.end(body)
		}
		try {
			if (url === '/world/manifest.json') return send(readFileSync(join(dir, 'manifest.json'), 'utf8'))
			if (url === '/version.json') return send(JSON.stringify({engine, edition: readManifest(dir).edition, built}))
			const m = /^\/world\/f\/([0-9a-f]{16})\.json$/.exec(url)
			if (m) {
				const {byHash} = await loadWorldForBuild(dir)
				if (byHash.has(m[1])) return send(byHash.get(m[1]))
				res.statusCode = 404
				return send('{"error":"not_found"}')
			}
		} catch (e) {
			res.statusCode = 500
			return send(JSON.stringify({error: String(e.message)}))
		}
		next()
	}
}
