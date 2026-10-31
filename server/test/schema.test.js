// Message validation tests (server/src/schema.js).
// Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later
import {describe, expect, it} from 'vitest'
import {MSG, PROTOCOL_VERSION, decodeClient, encode} from '../../game/src/core/contracts.js'
import {checkMove, cleanBookAction, cleanClientMsg, createBucket, wrapAngle} from '../src/schema.js'

const parse = (t, body) => {
	const d = decodeClient(encode(t, body))
	return d.ok ? cleanClientMsg(d.msg) : d
}

describe('cleanBookAction', () => {
	it('rebuilds known actions field by field', () => {
		expect(cleanBookAction({type: 'well.remove', uid: 'c3', pos: [0, 0], book: {}})).toEqual({type: 'well.remove', uid: 'c3'})
		expect(cleanBookAction({type: 'visit', place: 'well'})).toEqual({type: 'visit', place: 'well'})
		expect(cleanBookAction({type: 'lectern.take', id: 'Pommel Strike'})).toEqual({type: 'lectern.take', id: 'Pommel Strike'})
		expect(cleanBookAction({type: 'marcus.option', option: 'b1.what'})).toEqual({type: 'marcus.option', option: 'b1.what'})
		expect(cleanBookAction({type: 'shrine.take', extra: 1})).toEqual({type: 'shrine.take'})
	})
	it('refuses bad shapes and the room-internal action', () => {
		expect(cleanBookAction({type: 'marcus.friendStruck'})).toBeNull()
		expect(cleanBookAction({type: 'visit', place: 'castle'})).toBeNull()
		expect(cleanBookAction({type: 'visit', place: '__proto__'})).toBeNull()
		expect(cleanBookAction({type: 'well.remove', uid: '../x'})).toBeNull()
		expect(cleanBookAction({type: 'lectern.take', id: '<img>'})).toBeNull()
		expect(cleanBookAction({type: 'marcus.free', text: ''})).toBeNull()
		expect(cleanBookAction({type: 'marcus.free', text: 'x'.repeat(121)})).toBeNull()
		expect(cleanBookAction({type: 'Bad Type'})).toBeNull()
		expect(cleanBookAction(null)).toBeNull()
		expect(cleanBookAction({type: 'future.thing', a: {deep: 1}})).toBeNull()
		expect(cleanBookAction({type: 'future.thing', a: 1, b: 2, c: 3, d: 4, e: 5})).toBeNull()
		expect(cleanBookAction({type: 'future.thing', n: 2, s: 'ok'})).toEqual({type: 'future.thing', n: 2, s: 'ok'})
	})
	it('re-validates AI proposals (GDD 2.5 steps 1-4)', () => {
		const ok = cleanBookAction({type: 'marcus.free', text: 'hi', ai: {reply: 'Aye.<script>', intent: 'ask', trust: 7}})
		expect(ok.ai).toEqual({reply: 'Aye. script', intent: 'ask', trust: 1})
		expect(cleanBookAction({type: 'marcus.free', text: 'hi', ai: {reply: 'x', intent: 'win'}}).ai).toBeUndefined()
		expect(cleanBookAction({type: 'marcus.free', text: 'hi', ai: '{"intent":"help"}'}).ai).toBeUndefined()
	})
})

describe('cleanClientMsg', () => {
	it('accepts each client type with its fields', () => {
		expect(parse(MSG.HELLO, {name: 'Ana', seatToken: 'abcdefghijklmnopqrstuvwx', booksWritten: 3}).msg).toEqual({t: 'hello', name: 'Ana', seatToken: 'abcdefghijklmnopqrstuvwx', booksWritten: 3})
		expect(parse(MSG.HELLO, {name: 'Ana', seatToken: 'short'}).msg.seatToken).toBeUndefined()
		expect(parse(MSG.MOVE, {p: [1, 2, 7], w: 1}).msg).toEqual({t: 'mv', x: 1, z: 2, yaw: wrapAngle(7), w: 1})
		expect(parse(MSG.PLAY, {ref: 1, cardId: 'c4', target: 'enemy0'}).msg).toEqual({t: 'play', ref: 1, cardId: 'c4', target: 'enemy0'})
		expect(parse(MSG.END, {ref: 2}).msg).toEqual({t: 'end', ref: 2})
		expect(parse(MSG.GATE, {ready: true}).msg.ready).toBe(true)
		expect(parse(MSG.VOTE, {newBook: false}).msg.newBook).toBe(false)
		expect(parse(MSG.PING, {ts: 5}).msg.ts).toBe(5)
		expect(parse(MSG.BYE).ok).toBe(true)
	})
	it('rejects malformed frames', () => {
		expect(parse(MSG.MOVE, {p: [1, 2]}).ok).toBe(false)
		expect(parse(MSG.MOVE, {p: [1e9, 2, 0]}).ok).toBe(false)
		expect(parse(MSG.PLAY, {cardId: 'c 4'}).ok).toBe(false)
		expect(parse(MSG.PLAY, {cardId: 'c4', target: 'all'}).ok).toBe(false)
		expect(parse(MSG.ACT, {a: {type: 'marcus.friendStruck'}}).ok).toBe(false)
		expect(parse(MSG.GATE, {ready: 'yes'}).ok).toBe(false)
		expect(decodeClient(JSON.stringify({v: PROTOCOL_VERSION + 1, t: 'ping'})).error).toBe('version')
		expect(decodeClient(JSON.stringify({v: PROTOCOL_VERSION, t: 'welcome'})).error).toBe('bad_msg')
	})
})

describe('movement and rate limits', () => {
	it('allows walking speed, clamps teleports and the map edge', () => {
		const s = {pos: [0, 22, 0], moveBudget: 0, lastMoveAt: 0}
		const ok = checkMove(s, 0, 21.4, 0, 100)
		expect(ok.clamped).toBe(false)
		expect(ok.pos.slice(0, 2)).toEqual([0, 21.4])
		const tp = checkMove(s, 0, -20, 0, 100)
		expect(tp.clamped).toBe(true)
		expect(tp.pos[1]).toBeCloseTo(22 - 0.9, 5)
		const banked = checkMove({pos: [0, 0, 0], moveBudget: 0, lastMoveAt: 0}, 15, 0, 0, 60_000)
		expect(banked.pos[0]).toBe(15) // 2 s banked at 9 u/s = 18 u after a pause
		const edge = checkMove({pos: [31, 0, 0], moveBudget: 10, lastMoveAt: 0}, 40, 0, 0, 1000)
		expect(edge.pos[0]).toBe(32)
	})
	it('token bucket: 30 burst, 15/s', () => {
		const b = createBucket(0)
		let n = 0
		for (let i = 0; i < 50; i++) if (b.take(0)) n++
		expect(n).toBe(30)
		expect(b.take(1000 / 15)).toBe(true)
		expect(b.take(1000 / 15)).toBe(false)
	})
})
