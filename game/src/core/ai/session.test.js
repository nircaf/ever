// Latency: thinking state, the 20 s deadline (offline offers win), prefetch while walking.
// Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach, describe, expect, it, vi} from 'vitest'
import * as FX from './fixtures.js'
import {createMomentSession, momentKey} from './session.js'
import {offlineMoment} from './moment.js'

afterEach(() => vi.useRealTimers())

const ctx = (over = {}) => ({
	seed: 'PREFETCH',
	page: 3,
	themes: {primary: 'lantern', secondary: 'crow', shadow: 'bargain'},
	npc: {id: 'marcus', name: 'Marcus Hale'},
	trust: 1,
	deck: [{uid: 'c1', name: "Tobin's Hammer", keepsake: true}],
	existingNames: ["Tobin's Hammer"],
	...over,
})
/** A transport whose answer arrives when the test says so. */
function slowTransport(text = FX.GOOD_MARCUS) {
	const pending = []
	return {
		enabled: true,
		calls: pending,
		call: vi.fn(
			({signal}) =>
				new Promise((resolve) => {
					const p = {resolve: () => resolve({ok: true, text, model: 'm', ms: 1})}
					signal?.addEventListener('abort', () => resolve({ok: false, reason: 'aborted', ms: 1}))
					pending.push(p)
				}),
		),
	}
}

describe('createMomentSession', () => {
	it('shows thinking, then checking, then ready', async () => {
		const t = slowTransport()
		const s = createMomentSession({transport: t})
		const seen = []
		s.subscribe((st) => seen.push(st))
		const p = s.request(ctx())
		expect(s.state).toBe('thinking')
		await vi.waitFor(() => expect(t.calls).toHaveLength(1))
		t.calls[0].resolve()
		const r = await p
		expect(r.source).toBe('ai')
		expect(seen).toEqual(['thinking', 'checking', 'ready'])
	})

	it('after the deadline the offline offers stand in and the late answer is dropped', async () => {
		vi.useFakeTimers()
		const t = slowTransport()
		const s = createMomentSession({transport: t, timeoutMs: 20_000})
		const p = s.request(ctx())
		await vi.advanceTimersByTimeAsync(20_001)
		const r = await p
		expect(r).toMatchObject({source: 'offline', notice: 'timeout', fallbackNote: true})
		expect(r.offers).toEqual(offlineMoment(ctx()).offers)
		expect(s.state).toBe('ready')
	})

	it('a prefetch made while walking is reused: one model call', async () => {
		const t = slowTransport()
		const s = createMomentSession({transport: t})
		s.prefetch(ctx())
		expect(s.has(ctx())).toBe(true)
		s.prefetch(ctx()) // same key: no second call
		await vi.waitFor(() => expect(t.calls).toHaveLength(1))
		t.calls[0].resolve()
		const r = await s.request(ctx())
		expect(r.source).toBe('ai')
		expect(t.call).toHaveBeenCalledTimes(1)
	})

	it('a typed request makes the prefetch stale: it is aborted and a new call made', async () => {
		const t = slowTransport()
		const s = createMomentSession({transport: t})
		s.prefetch(ctx())
		const withRequest = ctx({request: 'can you make my lantern burn brighter'})
		expect(momentKey(withRequest)).not.toBe(momentKey(ctx()))
		const p = s.request(withRequest)
		await vi.waitFor(() => expect(t.calls).toHaveLength(2))
		t.calls[1].resolve()
		expect((await p).source).toBe('ai')
		expect(t.call).toHaveBeenCalledTimes(2)
	})

	it('does nothing in the background when the AI is off, and still answers offline', async () => {
		const t = slowTransport()
		const s = createMomentSession({transport: {...t, enabled: false}})
		s.prefetch(ctx())
		expect(s.has(ctx())).toBe(false)
		const r = await s.request(ctx())
		expect(r.source).toBe('offline')
		expect(t.call).not.toHaveBeenCalled()
		expect(s.active()).toBe(false)
		expect(createMomentSession({transport: t}).active()).toBe(true)
		const s2 = createMomentSession({transport: t, isActive: () => false})
		expect(s2.active()).toBe(false)
		s2.prefetch(ctx())
		expect((await s2.request(ctx())).notice).toBe('off')
		expect(t.call).not.toHaveBeenCalled()
	})

	it('cancel aborts the flight and returns to idle', async () => {
		const t = slowTransport()
		const s = createMomentSession({transport: t})
		s.prefetch(ctx())
		s.cancel()
		expect(s.state).toBe('idle')
		expect(s.has(ctx())).toBe(false)
	})

	it('the key follows what decides the offers', () => {
		const a = momentKey(ctx())
		expect(momentKey(ctx())).toBe(a)
		expect(momentKey(ctx({trust: 2}))).not.toBe(a)
		expect(momentKey(ctx({deck: [{uid: 'c1', name: "Tobin's Hammer", upgraded: true}]}))).not.toBe(a)
		expect(momentKey(ctx({says: 'hello'}))).not.toBe(a)
	})
})
