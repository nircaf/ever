// The real shared rules the room runs (TECH 1: one rules codebase, two hosts).
// OWNER: network engineer. Pure re-export so vitest and the Durable Object use the same set.
// Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later

import {applyBookAction} from '../../game/src/core/rules/book.js'
import * as combat from '../../game/src/combat/rules/index.js'

combat.ensureEngine()

/** @type {import('./room-core.js').RoomRules} */
export const RULES = Object.freeze({
	applyBookAction,
	createPartyCombat: combat.createPartyCombat,
	combatStep: combat.combatStep,
	tickTimers: combat.tickTimers,
	viewFor: combat.viewFor,
	outcome: combat.outcome,
})
