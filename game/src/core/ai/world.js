// EVER AI: world-change proposals after a won book (GDD_V2 14). The AI (or the offline
// presets) proposes up to 3 small, permanent changes to Ashbrook; the reader picks one; the
// client (solo) or the room (co-op) sends it to the bot endpoint.
// The wire format and its validator are the platform's (game/src/platform/world-schema.js
// validateProposal: the same function the bot Worker and CI run), so a proposal that passes
// here passes there. This file adds what is specific to model output: parsing, the GDD_V2
// 14.4 extras (no player names, no 0-cost damage + draw, no per-turn energy, no meta talk),
// the "new rule" gate, dedupe, and the preset fallback.
// Model output is hostile data. Player free text never enters the world verbatim.
// PURE (except the transport call).
//
// Copyright (C) 2026 the EVER contributors.
// SPDX-License-Identifier: AGPL-3.0-or-later

import {canonicalJson, hashId, rng} from '../../mechanics/index.js'
import {PROPOSAL_KINDS, entryKey, entrySummary, entryTitle, validateProposal} from '../../platform/world-schema.js'
import {WORLD_PRESETS, presetWorldChanges} from '../../content-gen/presets.js'
import {extractJsonObject, isPlainObject} from './json.js'
import {AI_LINES} from './lines.js'
import {buildWorldInput, worldInstructions} from './prompts.js'
import {cleanWorldText} from './text.js'

export const WORLD_CHANGE_VERSION = 1
/** Kinds the AI may propose (the platform's PROPOSAL_KINDS; `block` = new code, gated). */
export const WORLD_KINDS = PROPOSAL_KINDS

/**
 * @typedef {object} WorldCtx
 * @prop {{seed: string, edition: number, engine: string, bookNo: number, pages?: number, themes?: string[], won: true, room?: string}} run
 * @prop {string[]} [worldNames]      card/item/NPC names already in the world (no repeats)
 * @prop {Iterable<string>} [existingKeys]  hashes (worldHash) of entries already in the world
 * @prop {string[]} [playerNames]     names of the players in this book/room (never enter the world)
 * @prop {string[]} [blocklist]
 * @prop {boolean} [allowRule]        a new code block may be proposed (AI only, rare: GDD_V2 14.2 kind 7)
 * @prop {string[]} [blockIds]        ids of existing code blocks
 * @prop {string[]} [blockFiles]      file names in game/src/mechanics/blocks/
 * @prop {false|true|object} [sim]    balance check for card/item proposals (CI passes {fights: 200})
 */

/** All human-readable strings of an entry (for the extra text checks). */
function textsOf(entry) {
	const out = []
	if (entry.text) out.push(entry.text)
	if (entry.inscription) out.push(entry.inscription)
	if (entry.name) out.push(entry.name)
	for (const t of entry.titles ?? []) out.push(t)
	for (const l of Object.values(entry.openings ?? {})) out.push(l)
	if (entry.def) out.push(entry.def.name, entry.def.flavor ?? '')
	return out.filter(Boolean)
}

/** Content hash of an entry: what it changes, not where it came from. */
export const worldHash = (entry) => hashId(entryKey(entry), 8)

/**
 * Validate one proposal from the model (`{kind, data}`) or a full wire proposal. Never throws.
 * @param {unknown} raw
 * @param {WorldCtx} ctx
 * @returns {{ok: true, proposal: object, entry?: object, block?: object, title: string, summary: string, hash: string} |
 *   {ok: false, errors: {code?: string, path: string, msg: string}[]}}
 */
export function validateWorldProposal(raw, ctx) {
	const fail = (path, msg, code = 'world') => ({ok: false, errors: [{code, path, msg}]})
	if (!isPlainObject(raw)) return fail('', 'a proposal is one object')
	if (!PROPOSAL_KINDS.includes(raw.kind)) return fail('kind', `kind must be one of ${PROPOSAL_KINDS.join(', ')}`)
	if (raw.kind === 'block' && !ctx?.allowRule) return fail('kind', 'a new rule is not open for this book')
	const names = (ctx?.playerNames ?? []).filter((n) => typeof n === 'string' && n.trim().length >= 2)
	// The caller's run goes out as given (the bot re-validates it); validateProposal only checks it.
	const wire = {v: 1, kind: raw.kind, data: raw.data, run: isPlainObject(ctx?.run) ? {...ctx.run} : undefined, ...(typeof raw.preset === 'string' ? {preset: raw.preset} : {})}
	let r
	try {
		r = validateProposal(wire, {names: ctx?.worldNames ?? [], blocklist: [...(ctx?.blocklist ?? []), ...names], sim: ctx?.sim ?? false, blockIds: ctx?.blockIds, blockFiles: ctx?.blockFiles})
	} catch {
		return fail('', 'not a valid proposal')
	}
	if (!r.ok) return {ok: false, errors: r.errors}

	if (r.kind === 'block') {
		const hash = hashId(canonicalJson(r.block), 8)
		return {ok: true, proposal: {v: 1, kind: 'block', data: {file: r.block.file, source: r.block.source}, run: wire.run}, block: r.block, title: r.title, summary: r.summary, hash}
	}
	const entry = r.entry
	// GDD_V2 14.4 extras on top of the platform schema.
	for (const t of textsOf(entry)) {
		const lower = t.toLowerCase()
		if (names.some((n) => lower.includes(n.toLowerCase()))) return fail('data', 'player names never enter the world')
		const c = cleanWorldText(t.replace(/[.?]+$/, '') + '.', {max: 400, sentences: 9})
		if (!c.ok && /fiction|shouting|blocked/.test(c.reason)) return fail('data', `text ${c.reason}`)
	}
	if (entry.def) {
		const d = entry.def
		const fx = d.effects ?? []
		if (d.kind === 'card' && d.energy === 0 && fx.some((e) => e.do === 'damage') && fx.some((e) => e.do === 'draw')) return fail('data.def', 'a 0-cost card may not deal damage and draw')
		if ((d.triggers ?? []).some((t) => t.on !== 'fightStart' && t.effects.some((e) => e.do === 'energy' || e.do === 'loseEnergy'))) return fail('data.def', 'no card or item may change energy per turn')
	}
	const hash = worldHash(entry)
	if (new Set(ctx?.existingKeys ?? []).has(hash)) return fail('', 'Ashbrook already has this', 'duplicate')
	const {v: _v, type: _t, origin: _o, ...data} = entry
	return {ok: true, proposal: {v: 1, kind: r.kind, data, run: wire.run, ...(wire.preset ? {preset: wire.preset} : {})}, entry, title: entryTitle(entry), summary: entrySummary(entry), hash}
}

/**
 * Proposals for the Last Page: AI proposals that validate, filled up to 3 with presets;
 * presets only when the AI is off or answers badly. Never throws.
 * Each item's `proposal` is the exact wire object for the bot endpoint (bot-client.js).
 * @param {WorldCtx & {seed: string|number, themes: {primary: string, secondary: string, shadow: string}, story?: object,
 *   usedPresets?: string[], presets?: readonly {id: string, themes: string[], proposal: object}[], kinds?: string[]}} ctx
 *   presets: the loaded world's presets (platform world-loader), default: content-gen WORLD_PRESETS
 * @param {{transport?: any, active?: boolean, signal?: AbortSignal}} [o]
 */
export async function runWorldProposals(ctx, {transport = null, active = true, signal} = {}) {
	const kinds = (ctx.kinds ?? ['card', 'item', 'line', 'place', 'path', 'npc']).filter((k) => PROPOSAL_KINDS.includes(k) && (k !== 'block' || ctx.allowRule))
	const presets = () =>
		presetWorldChanges({themes: ctx.themes, used: ctx.usedPresets ?? [], seed: ctx.seed, list: ctx.presets ?? WORLD_PRESETS})
			.map((p) => ({v: validateWorldProposal({kind: p.proposal.kind, data: p.proposal.data, preset: p.id}, {...ctx, allowRule: false}), id: p.id}))
			.filter((x) => x.v.ok)
			.map(({v, id}) => ({...v, src: /** @type {'preset'} */ ('preset'), presetId: id}))
	const offline = (notice) => {
		const list = presets().slice(0, 3)
		return {proposals: list, source: /** @type {'preset'} */ ('preset'), notice, line: list.length ? AI_LINES.worldOffline : AI_LINES.worldAllUsed}
	}
	if (!transport?.enabled || !active) return offline('off')
	let res
	try {
		res = await transport.call({instructions: worldInstructions({kinds}), input: buildWorldInput({...(ctx.story ?? {}), themes: ctx.themes, worldNames: ctx.worldNames, allowRule: Boolean(ctx.allowRule)}), signal})
	} catch {
		res = {ok: false, reason: 'error'}
	}
	if (!res.ok) return offline(res.reason)
	const j = extractJsonObject(res.text)
	const raw = j.ok && Array.isArray(j.value.proposals) ? j.value.proposals.slice(0, 3) : []
	const seen = new Set()
	const ai = []
	for (const p of raw) {
		if (!isPlainObject(p) || !kinds.includes(p.kind)) continue
		const {preset: _drop, ...clean} = p // the model cannot claim to be a preset
		const v = validateWorldProposal(clean, ctx)
		if (v.ok && !seen.has(v.hash)) {
			seen.add(v.hash)
			ai.push({...v, src: /** @type {'ai'} */ ('ai')})
		}
	}
	if (!ai.length) return offline('invalid')
	const fill = presets().filter((p) => !seen.has(p.hash))
	const r = rng(ctx.seed, 'world:fill')
	while (ai.length < 3 && fill.length) ai.push(fill.splice(Math.floor(r() * fill.length), 1)[0])
	return {proposals: ai, source: ai.every((p) => p.src === 'ai') ? 'ai' : 'mixed', notice: null, line: null}
}
