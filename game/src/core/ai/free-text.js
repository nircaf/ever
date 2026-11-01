// EVER AI: the MVP free-text pipeline for Marcus (moved from core/ai.js): bridge AI when
// available, offline rules always.
// OWNER: systems engineer. The model only PROPOSES (reply words, an intent from a fixed
// list, a clamped trust); core/rules/book.js decides every effect and re-validates.
// Nothing here touches the network unless the page is served by the local bridge.
// Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later

import {FREE_TEXT_MAX, buildAiInput, createBridgeClient} from '../contracts.js'
import {createAiTransport} from './bridge.js'

/**
 * @typedef {object} ProposeResult
 * @prop {string} text                   the player's text, trimmed to FREE_TEXT_MAX
 * @prop {import('../contracts.js').AiProposal} [ai]   a VALIDATED proposal (absent = use the local rules)
 * @prop {'unavailable'|'limit'|'auth'} [notice]       why the AI was skipped, if it failed (not when it was simply off)
 */

/**
 * The pipeline the dialogue UI calls (contracts.js section 8).
 * Never throws and never returns an unvalidated proposal.
 * @param {import('../contracts.js').Book} book
 * @param {string} text
 * @param {ReturnType<typeof createBridgeClient>|null} bridge
 * @param {{active?: boolean}} [opts]  active=false skips the call (not signed in, or blocked for this book)
 * @returns {Promise<ProposeResult>}
 */
export async function proposeFreeText(book, text, bridge, {active = true} = {}) {
	const clean = String(text ?? '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, FREE_TEXT_MAX)
	if (!bridge?.enabled || !active || !clean) return {text: clean}
	let r
	try {
		r = await bridge.ask(buildAiInput(book, clean))
	} catch {
		r = {ok: false, reason: 'error'}
	}
	if (r?.ok && r.proposal) return {text: clean, ai: r.proposal}
	const reason = r?.reason
	return {text: clean, notice: reason === 'limit' ? 'limit' : reason === 'auth' ? 'auth' : 'unavailable'}
}

/**
 * Per-page AI state: is the bridge there, is the player signed in, is it blocked for this
 * book (HTTP 429 -> local script for the rest of the book, GDD 2.5 step 7).
 * @param {{origin: string, fetch?: typeof fetch, onChange?: () => void, toast?: (text: string) => void, texts: {unavailable: string, limit: string}}} opts
 */
export function createAiController({origin, fetch: f, onChange = () => {}, toast = () => {}, texts}) {
	const bridge = createBridgeClient({origin, fetch: f})
	// v2: the generic transport for NPC moments and world proposals (same origin rule).
	const transport = createAiTransport({origin, fetch: f})
	const st = {enabled: bridge.enabled, signedIn: false, email: '', planUse: false, blockedBookNo: null, warnedUnavailable: false, connecting: false}
	let pollTimer = null

	async function refresh() {
		if (!bridge.enabled) return st
		const s = await bridge.status()
		st.signedIn = Boolean(s?.signedIn)
		st.planUse = Boolean(s?.planUse)
		st.email = typeof s?.email === 'string' ? s.email : ''
		onChange()
		return st
	}

	/** Shared reaction to an AI failure: 429 blocks the AI for this book, 401/403 re-checks sign-in. */
	function handleNotice(book, notice) {
		if (notice === 'limit') {
			st.blockedBookNo = book.bookNo
			toast(texts.limit)
		} else if (notice === 'auth') {
			refresh()
			toast(texts.unavailable)
		} else if (notice === 'unavailable' && !st.warnedUnavailable) {
			st.warnedUnavailable = true
			toast(texts.unavailable)
		}
	}

	return {
		bridge,
		transport,
		handleNotice,
		state: st,
		get enabled() {
			return bridge.enabled
		},
		/** True when a free-text submission for this book would call the model. */
		isActive: (book) => st.enabled && st.signedIn && st.planUse && st.blockedBookNo !== book.bookNo,
		refresh,
		/** "Connect AI": POST /api/login, then poll /api/status until signed in (max 2 minutes). */
		async connect() {
			if (!bridge.enabled || st.connecting) return
			st.connecting = true
			onChange()
			let ok = false
			try {
				ok = await bridge.login()
			} catch {}
			if (!ok) {
				st.connecting = false
				onChange()
				return
			}
			const t0 = Date.now()
			clearInterval(pollTimer)
			pollTimer = setInterval(async () => {
				await refresh()
				if ((st.signedIn && st.planUse) || Date.now() - t0 > 120_000) {
					clearInterval(pollTimer)
					st.connecting = false
					onChange()
				}
			}, 1500)
		},
		async propose(book, text) {
			const res = await proposeFreeText(book, text, bridge, {active: this.isActive(book)})
			handleNotice(book, res.notice)
			return res
		},
		dispose() {
			clearInterval(pollTimer)
		},
	}
}
