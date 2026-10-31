// Glue between the room client and the world's peer avatars. OWNER: network engineer.
// main.js (systems) calls attachPeers(net, world) after hostGame/joinGame resolves. Each
// animation frame it draws every other seat at its interpolated position through
// WorldApi.upsertPeer, removes seats that left, sends our own position (throttled by
// net.sendMove) and applies server corrections ("fix") with world.teleport.
// Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later

import {MSG} from '../core/contracts.js'

/**
 * @param {ReturnType<typeof import('./client.js').createNetClient>} net
 * @param {import('../core/contracts.js').WorldApi} world
 * @param {{raf?: (fn: FrameRequestCallback) => number, caf?: (id: number) => void, isWalking?: () => boolean}} [opts]
 * @returns {() => void} detach
 */
export function attachPeers(net, world, opts = {}) {
	const raf = opts.raf ?? ((fn) => requestAnimationFrame(fn))
	const caf = opts.caf ?? ((id) => cancelAnimationFrame(id))
	const shown = new Set()
	let last = null
	let id = 0
	let alive = true

	const offFix = net.on(MSG.PEERS, (m) => {
		if (Array.isArray(m.fix)) {
			world.teleport(m.fix[0], m.fix[1])
			last = null
		}
	})

	const frame = () => {
		if (!alive) return
		const room = net.room
		const names = new Map((room?.seats ?? []).map((s) => [s.seat, s.name]))
		const fighting = new Set((room?.seats ?? []).filter((s) => s.inFight).map((s) => s.seat))
		const seen = new Set()
		for (const seat of net.peerSeats()) {
			if (seat === net.seat || !names.has(seat)) continue
			const p = net.peerAt(seat)
			if (!p) continue
			seen.add(seat)
			shown.add(seat)
			world.upsertPeer(seat, {...p, name: names.get(seat) ?? ''})
		}
		for (const seat of [...shown]) {
			if (!seen.has(seat)) {
				shown.delete(seat)
				world.removePeer(seat)
			}
		}
		// Our own position, only while not staged in a fight.
		if (net.seat !== null && !fighting.has(net.seat) && net.status === 'open') {
			const me = world.getPlayerPos()
			const walking = opts.isWalking ? opts.isWalking() : Boolean(last && (Math.abs(me.x - last.x) > 1e-3 || Math.abs(me.z - last.z) > 1e-3))
			net.sendMove(me.x, me.z, me.yaw, walking)
			last = me
		}
		id = raf(frame)
	}
	id = raf(frame)

	return () => {
		alive = false
		caf(id)
		offFix()
		for (const seat of shown) world.removePeer(seat)
		shown.clear()
	}
}
