// EVER room server: Worker entry. Routes /room/* and hands sockets to the Room DO.
// OWNER: network engineer. Contract: game/src/core/contracts.js section 7, docs/TECH.md 6.
// Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later

import {PROTOCOL_VERSION, ROOM_ROUTES, isValidRoomCode, makeRoomCode} from '../../game/src/core/contracts.js'
export {Room} from './room.js'
export {WorldBot} from './world-bot.js'
import {handleWorld} from './world-route.js'

const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|[a-z0-9-]+\.localhost)(:\d+)?$/

function allowedOrigin(origin, env) {
	if (!origin) return true // non-browser clients (tests, curl)
	if (LOCAL.test(origin)) return true
	return String(env.ALLOWED_ORIGINS || '')
		.split(',')
		.map((s) => s.trim())
		.includes(origin)
}

function cors(origin) {
	return origin ? {'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type', vary: 'origin'} : {}
}

function json(body, status, origin) {
	return new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json', 'cache-control': 'no-store', ...cors(origin)}})
}

export default {
	/** @param {Request} req @param {{ROOMS: DurableObjectNamespace, ALLOWED_ORIGINS?: string}} env */
	async fetch(req, env) {
		const url = new URL(req.url)
		const origin = req.headers.get('origin')
		if (!allowedOrigin(origin, env)) return json({error: 'origin'}, 403, null)
		if (req.method === 'OPTIONS') return new Response(null, {status: 204, headers: cors(origin)})

		if (url.pathname === ROOM_ROUTES.health) return json({ok: true, v: PROTOCOL_VERSION}, 200, origin)

		// World bot (major changes, docs/PLATFORM.md): POST /world/proposals, GET /world/proposals/<id>
		if (url.pathname.startsWith('/world/proposals')) return handleWorld(req, env, url, origin, json)

		if (url.pathname === ROOM_ROUTES.create && req.method === 'POST') {
			let v = PROTOCOL_VERSION
			try {
				v = (await req.json())?.v ?? v
			} catch {}
			if (v !== PROTOCOL_VERSION) return json({error: 'version', v: PROTOCOL_VERSION}, 426, origin)
			for (let i = 0; i < 8; i++) {
				const code = makeRoomCode(() => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32)
				const stub = env.ROOMS.get(env.ROOMS.idFromName(code))
				const r = await stub.fetch(`https://room/init?code=${code}`, {method: 'POST'})
				if (r.status === 201) return json({code, v: PROTOCOL_VERSION}, 201, origin)
			}
			return json({error: 'server'}, 503, origin)
		}

		const m = url.pathname.match(/^\/room\/([A-Z0-9]{5})$/)
		if (m && isValidRoomCode(m[1])) {
			if (req.headers.get('upgrade') !== 'websocket') return json({error: 'upgrade'}, 426, origin)
			const stub = env.ROOMS.get(env.ROOMS.idFromName(m[1]))
			return stub.fetch(req)
		}
		return json({error: 'not_found'}, 404, origin)
	},
}
