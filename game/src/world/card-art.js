// Card + token icon cache for the exploration UI (deck viewer, pickers, HUD slots).
// Renders kit props (style.js makeCardIcon / makeToken) to PNG data URLs once, then
// frees the extra WebGL context after a short idle so exploration keeps one context.
// OWNER: world engineer.
// Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later

import {createIconRenderer, makeCardIcon} from '../shared/style.js'

const cache = new Map()
let renderer = null
let idle = 0

function freeGeometry(obj) {
	obj.traverse((o) => o.geometry?.dispose?.()) // materials are the kit's shared cache: keep them
}

/** PNG data URL for a card (by STW base name) or a token kind; '' if WebGL is unavailable. */
export function iconUrl(name, type = 'attack') {
	const key = name + '|' + type
	if (cache.has(key)) return cache.get(key)
	let url = ''
	try {
		renderer ||= createIconRenderer({size: 128})
		const obj = makeCardIcon(name, type)
		url = renderer.render(obj)
		freeGeometry(obj)
	} catch {
		url = ''
	}
	cache.set(key, url)
	clearTimeout(idle)
	idle = setTimeout(disposeIcons, 1500)
	return url
}

/** Free the offscreen renderer (the cache of data URLs stays). */
export function disposeIcons() {
	clearTimeout(idle)
	try {
		renderer?.dispose()
	} catch {}
	renderer = null
}
