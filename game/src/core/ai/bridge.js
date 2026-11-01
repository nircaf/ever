// EVER AI: the generic bridge transport (POST /api/ai {instructions, input}, header
// x-ever: 1 -> {text, model}). Only active when the page is served by the local bridge
// (exactly http://127.0.0.1:1455); on the hosted site every call resolves "off" without
// touching the network. 20 s timeout, caller abort, size limits on both directions.
// The transport returns raw TEXT: callers treat it as hostile data (json.js + validators).
//
// Copyright (C) 2026 the EVER contributors.
// SPDX-License-Identifier: AGPL-3.0-or-later

import {AI_TIMEOUT_MS, BRIDGE_ORIGIN} from '../contracts.js'
import {MAX_MODEL_TEXT} from './json.js'

/** bridge.mjs refuses instructions > 8000 chars and input > 4000 chars (HTTP 400). */
export const BRIDGE_LIMITS = Object.freeze({instructions: 8000, input: 4000, response: MAX_MODEL_TEXT})

/**
 * @typedef {{ok: true, text: string, model: string, ms: number} |
 *   {ok: false, reason: 'off'|'limit'|'auth'|'timeout'|'aborted'|'too_large'|'error', ms: number}} AiCallResult
 */

/**
 * @param {{origin: string, fetch?: typeof fetch, timeoutMs?: number, now?: () => number}} env
 */
export function createAiTransport({origin, fetch: f = globalThis.fetch, timeoutMs = AI_TIMEOUT_MS, now = () => Date.now()}) {
	const enabled = origin === BRIDGE_ORIGIN
	return {
		enabled,
		timeoutMs,
		/**
		 * One model call. Never throws.
		 * @param {{instructions: string, input: string, signal?: AbortSignal}} req
		 * @returns {Promise<AiCallResult>}
		 */
		async call({instructions, input, signal}) {
			const t0 = now()
			const done = (r) => ({...r, ms: now() - t0})
			if (!enabled) return done({ok: false, reason: 'off'})
			if (typeof instructions !== 'string' || typeof input !== 'string') return done({ok: false, reason: 'error'})
			if (instructions.length > BRIDGE_LIMITS.instructions || input.length > BRIDGE_LIMITS.input) return done({ok: false, reason: 'too_large'})
			if (signal?.aborted) return done({ok: false, reason: 'aborted'})
			const ac = new AbortController()
			let timedOut = false
			const timer = setTimeout(() => {
				timedOut = true
				ac.abort()
			}, timeoutMs)
			const onAbort = () => ac.abort()
			signal?.addEventListener?.('abort', onAbort, {once: true})
			try {
				const r = await f('/api/ai', {
					method: 'POST',
					headers: {'x-ever': '1', 'content-type': 'application/json'},
					body: JSON.stringify({instructions, input}),
					signal: ac.signal,
				})
				if (r.status === 429) return done({ok: false, reason: 'limit'})
				if (r.status === 401 || r.status === 403) return done({ok: false, reason: 'auth'})
				if (!r.ok) return done({ok: false, reason: 'error'})
				const body = await r.json()
				const text = body?.text
				if (typeof text !== 'string') return done({ok: false, reason: 'error'})
				if (text.length > BRIDGE_LIMITS.response) return done({ok: false, reason: 'too_large'})
				const model = typeof body.model === 'string' ? body.model.replace(/[^\w.:-]/g, '').slice(0, 40) : ''
				return done({ok: true, text, model})
			} catch {
				return done({ok: false, reason: timedOut ? 'timeout' : signal?.aborted ? 'aborted' : 'error'})
			} finally {
				clearTimeout(timer)
				signal?.removeEventListener?.('abort', onAbort)
			}
		},
	}
}
