// EVER platform: browser client for the world bot endpoint (solo wins; co-op rooms submit
// server to server). POST /world/proposals, GET /world/proposals/<id>.
// The caller shows BOT_STATUS_COPY lines (GDD_V2 19 "The last page"); nothing is sent
// unless the player pressed "Write it into the world".
//
// Copyright (C) 2026 the EVER contributors.
// SPDX-License-Identifier: AGPL-3.0-or-later

export const BOT_STATUS_COPY = Object.freeze({
	sending: 'Sending...',
	queued: 'Waiting in line.',
	open: 'Sent. The world is checking it.',
	merged: 'Ashbrook remembers. Edition {E} is out.',
	rejected: 'The world did not take this mark. Your book is still complete.',
	rate: 'Too many marks today. Your book is still complete; try again tomorrow.',
	offline: "Can't reach the world right now. Your book is still complete.",
	link: 'See the page being written',
})

/** Map an endpoint reply to {state, copy, pr?, edition?}. */
export function statusLine(reply) {
	const s = reply?.status
	if (s === 'merged') return {state: s, copy: BOT_STATUS_COPY.merged.replace('{E}', String(reply.edition ?? '')), pr: reply.pr ?? null, edition: reply.edition ?? null}
	if (s === 'queued') return {state: s, copy: BOT_STATUS_COPY.queued, pr: null}
	if (s === 'open') return {state: s, copy: BOT_STATUS_COPY.open, pr: reply.pr ?? null}
	if (s === 'rate') return {state: s, copy: BOT_STATUS_COPY.rate}
	if (s === 'offline') return {state: s, copy: BOT_STATUS_COPY.offline}
	return {state: 'rejected', copy: BOT_STATUS_COPY.rejected}
}

/**
 * @param {{base?: string, fetchFn?: typeof fetch}} [opts]  base: origin of the bot route ('' = same origin)
 */
export function createWorldBotClient({base = '', fetchFn = globalThis.fetch?.bind(globalThis)} = {}) {
	async function call(path, init) {
		try {
			const r = await fetchFn(`${base}/world/proposals${path}`, {...init, headers: {'content-type': 'application/json', ...(init?.headers ?? {})}})
			const body = await r.json().catch(() => ({}))
			if (r.status === 429) return {status: 'rate', ...body}
			if (r.status >= 500 && !body.status) return {status: 'offline'}
			return body
		} catch {
			return {status: 'offline'}
		}
	}
	return {
		/** @returns {Promise<{status: string, id?: string, errors?: object[]}>} */
		submit: (proposal) => call('', {method: 'POST', body: JSON.stringify(proposal)}),
		status: (id) => call(`/${encodeURIComponent(id)}`, {method: 'GET'}),
		statusLine,
	}
}
