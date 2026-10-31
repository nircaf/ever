// EVER entry point: mounts the three layers and wires modules through the contracts.
// OWNER: systems engineer. Keep it thin: screens and flow live in core/, the village in
// world/, cards in combat/, rooms in net/.
// Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later

import './shared/style.css'
import './core/ui/core.css'
import {applyCssTokens} from './shared/style.js'
import {bus, createModeController} from './core/contracts.js'
import {createBookStore} from './core/book-store.js'
import {createGame} from './core/game.js'
import {createWorld} from './world/index.js'
import {createCombat, createLocalCombatDriver} from './combat/index.js'

applyCssTokens()

// Non-blocking web fonts (ART_BIBLE 9). Failure is fine: style.css has offline fallbacks.
document.head.append(
	Object.assign(document.createElement('link'), {
		rel: 'stylesheet',
		href: 'https://fonts.googleapis.com/css2?family=Figtree:wght@400;600;800&family=Young+Serif&display=swap',
	}),
)

const els = {
	world: /** @type {HTMLElement} */ (document.getElementById('world')),
	combat: /** @type {HTMLElement} */ (document.getElementById('combat')),
	ui: /** @type {HTMLElement} */ (document.getElementById('ui')),
}

// Co-op state shared with core/game.js: set while you are in a room.
const session = {net: null, makeNetDriver: null}

// ui: 'core' -> core/game.js draws the HUD and panels; the world only walks and renders.
const worldCtx = {bus, ui: 'core', store: null}
const world = createWorld(els.world, worldCtx)
const store = createBookStore({
	getPos: () => {
		const p = world.getPlayerPos()
		return [p.x, p.z]
	},
})
worldCtx.store = store
const combat = createCombat(els.combat, {bus, world})
const modes = createModeController({
	world,
	combat,
	// Solo: the local driver runs the combat rules in the browser. Co-op: the room runs them.
	makeDriver: ({enemyId}) => (session.net && session.makeNetDriver ? session.makeNetDriver(session.net) : createLocalCombatDriver({book: store.get(), enemyId})),
})

world.show()
const game = createGame({els, world, modes, store, bus, session})

// The static "Opening the book..." card (index.html) bridges the first blank frames.
// Drop it once the cover screen is mounted and a frame or two have been drawn.
const boot = document.getElementById('ever-boot')
if (boot) {
	const gone = () => {
		boot.classList.add('is-gone')
		setTimeout(() => boot.remove(), 350)
	}
	requestAnimationFrame(() => requestAnimationFrame(gone))
	setTimeout(gone, 4000) // a background tab draws no frames: never leave it up
}

// Debug handle for engineers (not a public API): dev builds, or a production build opened
// with ?debug in the URL (QA on the local bridge). Nothing in the game reads it.
if (import.meta.env.DEV || new URLSearchParams(location.search).has('debug')) {
	Object.assign(globalThis, {__ever: {bus, store, world, modes, game, session}})
}
