// EVER world bot: the WorldBot Durable Object (one global instance, "bot"). A thin shell
// around WorldBotCore (world-bot-core.js): storage, the GitHub client from secrets, and an
// alarm that follows the open pull request. One instance = one serial queue, so rate
// limits, dedupe and "one open bot PR at a time" need no locks.
//
// Internal routes (reached only through the Worker or another Durable Object, never directly):
//   POST https://bot/submit   {proposal, source: 'client'|'room', ip?, room?}
//   GET  https://bot/status/<id>
//   POST https://bot/tick
//
// Secrets (wrangler secret put ...): GH_APP_ID, GH_APP_PRIVATE_KEY, GH_APP_INSTALLATION_ID, BOT_IP_SALT.
// Vars (wrangler.toml): WORLD_BOT_ENABLED, GH_OWNER, GH_REPO, GH_BASE, WORLD_REQUIRE_REPLAY.
//
// Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later

import {createGitHub} from './github.js'
import {WorldBotCore} from './world-bot-core.js'

const json = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json', 'cache-control': 'no-store'}})

/** Build the GitHub client from env, or null when the bot is not configured. */
export function githubFromEnv(env, fetchFn) {
	if (!env.GH_APP_ID || !env.GH_APP_PRIVATE_KEY || !env.GH_APP_INSTALLATION_ID) return null
	return createGitHub({
		appId: env.GH_APP_ID,
		privateKey: env.GH_APP_PRIVATE_KEY,
		installationId: env.GH_APP_INSTALLATION_ID,
		owner: env.GH_OWNER || 'nircaf',
		repo: env.GH_REPO || 'ever',
		base: env.GH_BASE || 'main',
		...(fetchFn ? {fetchFn} : {}),
	})
}

export class WorldBot {
	/** @param {DurableObjectState} state @param {any} env */
	constructor(state, env) {
		this.state = state
		this.core = new WorldBotCore({
			storage: state.storage,
			gh: githubFromEnv(env),
			enabled: env.WORLD_BOT_ENABLED === 'true',
			requireReplay: env.WORLD_REQUIRE_REPLAY === 'true',
			salt: env.BOT_IP_SALT || '',
			log: (m) => console.log(m),
		})
	}

	async schedule() {
		const at = await this.core.nextWake()
		if (at && !(await this.state.storage.getAlarm())) await this.state.storage.setAlarm(at)
	}

	/** @param {Request} req */
	async fetch(req) {
		const url = new URL(req.url)
		try {
			if (req.method === 'POST' && url.pathname === '/submit') {
				const {proposal, source, ip, room} = await req.json()
				const r = await this.core.submit({proposal, source, ip, room})
				await this.schedule()
				return json(r.body, r.http)
			}
			const m = url.pathname.match(/^\/status\/([a-z0-9]{6,16})$/)
			if (req.method === 'GET' && m) {
				const r = await this.core.status(m[1])
				return json(r.body, r.http)
			}
			if (req.method === 'POST' && url.pathname === '/tick') {
				const out = await this.core.tick()
				await this.schedule()
				return json(out)
			}
		} catch (e) {
			console.log(`world bot error: ${e.message}`)
			return json({status: 'offline', error: 'server'}, 500)
		}
		return json({error: 'not_found'}, 404)
	}

	async alarm() {
		try {
			await this.core.tick()
		} catch (e) {
			console.log(`world bot alarm: ${e.message}`)
		}
		await this.schedule()
	}
}

/**
 * For the Room Durable Object (co-op wins, GDD_V2 17.7): submit the party's final decision
 * server to server. `proposal.run.room` must be the room code and `proposal.run.winId` unique per win.
 * @returns {Promise<{http: number, body: object}>}
 */
export async function submitFromRoom(env, proposal, room) {
	if (!env.WORLD_BOT) return {http: 503, body: {status: 'offline', error: 'bot_off'}}
	const stub = env.WORLD_BOT.get(env.WORLD_BOT.idFromName('bot'))
	const r = await stub.fetch('https://bot/submit', {method: 'POST', body: JSON.stringify({proposal, source: 'room', room})})
	return {http: r.status, body: await r.json()}
}
