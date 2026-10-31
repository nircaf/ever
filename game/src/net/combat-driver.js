// Co-op CombatDriver: same interface as the solo driver, backed by the room.
// OWNER: network engineer. play() -> MSG.PLAY, endTurn() -> MSG.END, views from
// MSG.COMBAT (each player gets their own viewFor), done resolves on MSG.DONE.
// The room is authoritative: the driver never predicts a result, it only shows what the
// room sends (a play round-trip is one RTT; the UI may dim the card meanwhile).
// Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later

import {MSG} from '../core/contracts.js'

/** GDD 6 combat copy for room errors. */
export const COMBAT_ERROR_TEXT = Object.freeze({
	not_your_turn: 'Waiting for the others...',
	not_in_fight: 'You are not in this fight.',
	not_allowed: "That card can't be played now.",
	energy: 'Not enough energy.',
	unplayable: "Doubt can't be played.",
	server: "Can't reach the room server. Check your connection.",
})

/**
 * @param {ReturnType<typeof import('./client.js').createNetClient>} net
 * @returns {import('../core/contracts.js').CombatDriver & {dispose(): void}}
 */
export function createNetCombatDriver(net) {
	/** @type {any} */
	let view = net.lastCombat?.view ?? null
	const subs = new Set()
	let resolveDone
	/** @type {Promise<import('../core/contracts.js').CombatResult>} */
	const done = new Promise((r) => (resolveDone = r))
	let finished = false

	const offs = [
		net.on(MSG.COMBAT, (m) => {
			if (finished) return
			view = m.view
			for (const fn of [...subs]) fn(view, m.ev || [])
		}),
		net.on(MSG.DONE, (m) => {
			if (finished) return
			finished = true
			net.lastCombat = null
			for (const off of offs) off()
			resolveDone({won: Boolean(m.won), hpLeft: m.hpLeft | 0, turns: m.turns | 0, dead: Boolean(m.dead)})
		}),
		// Lost the room for good (idle close, replaced by another tab): end as a loss without death.
		net.on('closed', () => {
			if (finished) return
			finished = true
			for (const off of offs) off()
			resolveDone({won: false, hpLeft: net.book?.hp ?? 0, turns: view?.round ?? 0, dead: false})
		}),
	]

	const reply = (m) => (m.t === MSG.COMBAT ? {ok: true} : {ok: false, error: m.why || m.code || 'server'})

	return {
		view: () => view,
		onView(fn) {
			subs.add(fn)
			return () => subs.delete(fn)
		},
		async play(cardId, target) {
			if (finished) return {ok: false, error: 'not_in_fight'}
			return reply(await net.request(MSG.PLAY, {cardId: String(cardId), ...(target ? {target} : {})}))
		},
		async endTurn() {
			if (finished) return {ok: false}
			return reply(await net.request(MSG.END, {}))
		},
		done,
		dispose() {
			for (const off of offs) off()
			subs.clear()
		},
	}
}
