// EVER platform (Node only): read world/ from disk. Used by check-world, world-add and the
// Vite plugin. Never imported by the browser.
//
// Copyright (C) 2026 the EVER contributors.
// SPDX-License-Identifier: AGPL-3.0-or-later

import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs'
import {dirname, join, relative, resolve, sep} from 'node:path'
import {fileURLToPath} from 'node:url'
import {WORLD_TYPES} from '../world-schema.js'

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
export const WORLD_DIR = join(REPO_ROOT, 'world')

/** Every data file under world/<folder>/ (relative paths with '/'), sorted. */
export function listWorldFiles(dir = WORLD_DIR) {
	const out = []
	for (const folder of Object.values(WORLD_TYPES)) {
		const d = join(dir, folder)
		if (!existsSync(d)) continue
		for (const f of readdirSync(d)) {
			const p = join(d, f)
			if (statSync(p).isFile() && f !== '.gitkeep') out.push(relative(dir, p).split(sep).join('/'))
		}
	}
	return out.sort()
}

export function readManifest(dir = WORLD_DIR) {
	return JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
}

export const readWorldFile = (path, dir = WORLD_DIR) => readFileSync(join(dir, path), 'utf8')
