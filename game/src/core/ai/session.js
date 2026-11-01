// EVER AI: latency. One moment session per page view keeps the Offer panel snappy:
//   - prefetch(ctx): while the player walks to the next page, ask for that page's offers
//     (no player text yet). If the player then just asks "What can you offer me?", the
//     answer is usually ready.
//   - request(ctx): the real ask. Reuses a matching prefetch, else aborts it and asks anew.
//   - a hard deadline (20 s, AI_TIMEOUT_MS): the offline offers win the race, the late
//     AI answer is dropped, and the UI gets AI_LINES.slow.
//   - state: 'idle' | 'thinking' | 'checking' | 'ready', for "{name} thinks it over..." and
//     "{name} weighs it in their hands...". Partial model output is never shown: the bridge
//     streams internally and we only ever render validated offers ("stream-safe").
// No DOM. Timers come in through `timers` so tests can drive them.
//
// Copyright (C) 2026 the EVER contributors.
// SPDX-License-Identifier: AGPL-3.0-or-later

import {canonicalJson, hash32} from '../../mechanics/index.js'
import {AI_TIMEOUT_MS} from '../contracts.js'
import {offlineMoment, runMoment} from './moment.js'

/**
 * What decides a moment's offers: two contexts with the same key get the same plan, so a
 * prefetched answer may be reused. Free text (`says`/`request`) is part of the key.
 */
export function momentKey(ctx) {
	return hash32(
		canonicalJson({
			seed: String(ctx.seed),
			page: ctx.page,
			npc: ctx.npc?.id,
			trust: ctx.trust ?? 0,
			says: ctx.says ?? '',
			request: ctx.request ?? '',
			deck: (ctx.deck ?? []).map((c) => [c.uid, c.upgraded ? 1 : 0, c.curse ? 1 : 0]),
			names: (ctx.existingNames ?? []).length,
			earned: Boolean(ctx.earned),
			hostile: Boolean(ctx.hostile),
		}),
	).toString(36)
}

/**
 * @param {{transport?: any, isActive?: () => boolean, timeoutMs?: number,
 *   timers?: {setTimeout: typeof setTimeout, clearTimeout: typeof clearTimeout}, run?: typeof runMoment}} o
 */
export function createMomentSession({transport = null, isActive = () => true, timeoutMs = AI_TIMEOUT_MS, timers = globalThis, run = runMoment} = {}) {
	/** @type {{key: string, promise: Promise<any>, ac: AbortController, done: boolean, prefetch: boolean} | null} */
	let flight = null
	let state = 'idle'
	const subs = new Set()
	const set = (s) => {
		if (state === s) return
		state = s
		for (const fn of subs) {
			try {
				fn(s)
			} catch {}
		}
	}

	function start(ctx, {prefetch}) {
		const key = momentKey(ctx)
		const ac = new AbortController()
		const f = {key, ac, done: false, prefetch, promise: null}
		f.promise = run(ctx, {
			transport,
			active: isActive(),
			signal: ac.signal,
			onState: (s) => {
				if (flight === f && !f.prefetch) set(s)
			},
		})
			.catch(() => offlineMoment(ctx, {notice: 'error', expectAi: true}))
			.then((r) => {
				f.done = true
				return r
			})
		flight = f
		return f
	}

	return {
		get state() {
			return state
		},
		/** @param {(s: string) => void} fn @returns {() => void} */
		subscribe(fn) {
			subs.add(fn)
			return () => subs.delete(fn)
		},
		/** Start the next page's offer call in the background (no-op if the AI is off). */
		prefetch(ctx) {
			if (!transport?.enabled || !isActive()) return
			const key = momentKey(ctx)
			if (flight?.key === key) return
			flight?.ac.abort()
			start(ctx, {prefetch: true})
		},
		/**
		 * The offers for this moment. Resolves within `timeoutMs` (+ validation) with AI offers,
		 * or with the offline offers and `notice: 'timeout'`. Never rejects.
		 * @returns {Promise<import('./moment.js').MomentResult>}
		 */
		async request(ctx) {
			const key = momentKey(ctx)
			let f = flight?.key === key ? flight : null
			if (!f) {
				flight?.ac.abort()
				f = start(ctx, {prefetch: false})
			}
			f.prefetch = false
			if (!f.done) set('thinking')
			let timer
			const deadline = new Promise((resolve) => {
				timer = timers.setTimeout(() => resolve(null), timeoutMs)
			})
			const r = await Promise.race([f.promise, deadline])
			timers.clearTimeout(timer)
			if (flight === f) flight = null
			if (r) {
				set('ready')
				return r
			}
			f.ac.abort()
			set('ready')
			return offlineMoment(ctx, {notice: 'timeout', expectAi: true})
		},
		/** True when a request would call the model (the Offer panel uses it to pick the thinking copy). */
		active: () => Boolean(transport?.enabled && isActive()),
		/** Drop anything in flight (the player walked away or the page changed). */
		cancel() {
			flight?.ac.abort()
			flight = null
			set('idle')
		},
		/** For tests and the HUD: is a prefetch for this ctx running or ready? */
		has(ctx) {
			return flight?.key === momentKey(ctx)
		},
	}
}
