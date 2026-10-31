// Solo CombatDriver: runs the pure combat rules in the browser as a party of one (seat 0).
// Same interface as the co-op NetCombatDriver (contracts.js section 6), so the combat UI
// never knows which one it has. No DOM here; testable in Node.
// OWNER: combat engineer.
// Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later

import {ENEMIES, combatStep, createPartyCombat, ensureEngine, outcome, tickTimers, viewFor} from './rules/index.js'

const SEAT = 0

/**
 * @param {{book: import('../core/contracts.js').Book, enemyId?: string, name?: string,
 *   tokens?: string[], seed?: number, now?: () => number}} opts
 *   tokens: the list spendTokensForCombat() returned; defaults to book.tokens.
 *   The book is only read. Combat never changes the deck.
 * @returns {import('../core/contracts.js').CombatDriver & {pc: () => any}}
 */
export function createLocalCombatDriver({book, enemyId = 'ashWarden', name = 'You', tokens, seed, now = () => Date.now()}) {
	ensureEngine()
	if (!ENEMIES[enemyId]) throw new RangeError(`unknown enemy ${enemyId}`)
	let pc = createPartyCombat({fighters: [{seat: SEAT, book, name, tokens}], enemyId, seed, now: now()})
	const subs = new Set()
	let startDelivered = false
	let finished = false
	/** @type {(r: import('../core/contracts.js').CombatResult) => void} */
	let resolveDone
	const done = new Promise((r) => (resolveDone = r))

	const settle = () => {
		const o = outcome(pc)
		if (!o || finished) return
		finished = true
		const me = o.bySeat[SEAT]
		resolveDone({won: o.won, hpLeft: o.won ? me.hpLeft : 0, turns: o.rounds, dead: me.dead})
	}
	const emit = (events) => {
		const v = viewFor(pc, SEAT)
		for (const fn of [...subs]) {
			try {
				fn(v, events)
			} catch (e) {
				console.error('[combat] view listener', e)
			}
		}
		settle()
	}
	const apply = (action) => {
		if (finished) return {ok: false, error: 'over'}
		const r = combatStep(pc, SEAT, action, now())
		if (r.error) return {ok: false, error: r.error}
		pc = r.pc
		emit(r.events)
		return {ok: true}
	}

	return {
		view: () => viewFor(pc, SEAT),
		onView(fn) {
			subs.add(fn)
			// The first listener also gets the start-of-fight events (round 1, token lines).
			if (!startDelivered) {
				startDelivered = true
				const ev = pc.startEvents ?? []
				queueMicrotask(() => subs.has(fn) && fn(viewFor(pc, SEAT), ev))
			}
			return () => subs.delete(fn)
		},
		async play(cardId, target) {
			return apply({type: 'play', cardId, target})
		},
		async endTurn() {
			const r = apply({type: 'end'})
			// A party of one never waits on the 60 s timer, but keep the call for symmetry.
			const t = tickTimers(pc, now())
			if (t.pc !== pc) {
				pc = t.pc
				emit(t.events)
			}
			return r
		},
		done,
		/** Debug/test only: the current PartyCombat. */
		pc: () => pc,
	}
}
