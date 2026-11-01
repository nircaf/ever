// EVER world bot: the public HTTP route on the Worker (game.dreamz.rest/world/proposals*).
//   POST /world/proposals        body: a world-change proposal (docs/PLATFORM.md 3)  -> 202 {status, id, position?}
//   GET  /world/proposals/<id>   -> {status: queued|open|merged|rejected|duplicate, pr?, edition?}
// The origin check and CORS happen in index.js. Client-supplied headers never reach the
// Durable Object: it gets a fresh request with the proposal, the IP and source 'client'.
//
// Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later

import {BOT_LIMITS} from './world-bot-core.js'

/**
 * @param {Request} req
 * @param {any} env
 * @param {URL} url
 * @param {string|null} origin
 * @param {(body: any, status: number, origin: string|null) => Response} json
 */
export async function handleWorld(req, env, url, origin, json) {
	if (!env.WORLD_BOT) return json({status: 'offline', error: 'bot_off'}, 503, origin)
	const stub = env.WORLD_BOT.get(env.WORLD_BOT.idFromName('bot'))

	if (url.pathname === '/world/proposals' && req.method === 'POST') {
		if (!/^application\/json\b/.test(req.headers.get('content-type') ?? '')) return json({status: 'rejected', error: 'content_type'}, 415, origin)
		const len = Number(req.headers.get('content-length') ?? 0)
		if (len > BOT_LIMITS.bodyBytes) return json({status: 'rejected', error: 'size'}, 413, origin)
		const text = await req.text()
		if (new TextEncoder().encode(text).length > BOT_LIMITS.bodyBytes) return json({status: 'rejected', error: 'size'}, 413, origin)
		let proposal
		try {
			proposal = JSON.parse(text)
		} catch {
			return json({status: 'rejected', error: 'json'}, 400, origin)
		}
		const ip = req.headers.get('cf-connecting-ip') || 'unknown'
		const r = await stub.fetch('https://bot/submit', {method: 'POST', body: JSON.stringify({proposal, source: 'client', ip})})
		return json(await r.json(), r.status, origin)
	}

	const m = url.pathname.match(/^\/world\/proposals\/([a-z0-9]{6,16})$/)
	if (m && req.method === 'GET') {
		const r = await stub.fetch(`https://bot/status/${m[1]}`)
		return json(await r.json(), r.status, origin)
	}
	return json({error: 'not_found'}, 404, origin)
}
