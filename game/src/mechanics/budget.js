// EVER mechanics: power points (PP) and hard caps (GDD_V2 8.2).
// The GAME computes PP; any PP a proposal claims is ignored.
// PURE. Imported by the browser and by server/.
//
// Copyright (C) 2026 the EVER contributors.
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
	BUDGET_SLACK, CARD_BUDGET, CONDITIONS, CURSE_BUDGET, HARD_CAPS, ITEM_BUDGET, LOOP_EFFECTS, POWERS, SCALINGS,
	TOKEN_BUDGET, TRIGGERS, UPGRADE_BUDGET,
} from './library.js'
import {effectSpec} from './blocks-registry.js'

/** Share of a fight a power card's triggers are active for (played around turn 2 of 6). */
export const POWER_ACTIVE_SHARE = 0.65
/** Chance a given card is in hand at a "zone: hand" moment (5 drawn from a ~8-card deck). */
export const IN_HAND_SHARE = 0.6
/** Value lost per card slot a dead card takes (a curse in the deck). */
export const DEAD_SLOT_PP = 3
/** Exhaust multiplies the positive part of a card (GDD 8.1 exhaustSelf). */
export const EXHAUST_MULT = 0.75
export const RETAIN_PP = 1
export const DELAY_MULT = 0.8
export const MAX_HP_PP = 2

const round1 = (x) => Math.round(x * 10) / 10

/** Amount an effect resolves for at its planning count (scaled effects use expected counts). */
export function plannedN(e, ctx) {
	if (!e.scale) return e.n
	const exp = SCALINGS[e.scale.per].expected(ctx)
	return e.n + e.scale.each * Math.min(exp, e.scale.cap)
}
/** Amount at its worst case (scaling at cap) for hard caps. */
export const maxN = (e) => (e.scale ? e.n + e.scale.each * e.scale.cap : e.n)

/**
 * PP of one effect resolution, including condition likelihood, scaling and delay.
 * @param {object} e  canonical effect
 * @param {object} [ctx]  {curses, items, refValue(ref)}
 */
export function effectPP(e, ctx) {
	const spec = effectSpec(e.do)
	if (!spec) return 0
	const p = 'n' in e ? {...e, n: plannedN(e, ctx)} : e
	let v = spec.pp(p, ctx)
	if (!Number.isFinite(v)) v = 0
	if (e.if) v *= CONDITIONS[e.if.is]?.likelihood(e.if) ?? 0.5
	if (e.when === 'nextTurn') v *= DELAY_MULT
	return v
}

/** {pos, neg} of a list of effects. */
export function effectsPP(effects = [], ctx) {
	let pos = 0
	let neg = 0
	for (const e of effects) {
		const v = effectPP(e, ctx)
		if (v >= 0) pos += v
		else neg += v
	}
	return {pos, neg}
}

/** Expected PP of a trigger per fight. `onCard` = the trigger sits on a card (zones matter). */
export function triggerPP(t, ctx, {onCard = false} = {}) {
	const spec = TRIGGERS[t.on]
	if (!spec) return {pos: 0, neg: 0}
	let count = spec.count(t)
	if (onCard && spec.zone === 'hand') count *= IN_HAND_SHARE
	const like = t.if ? CONDITIONS[t.if.is]?.likelihood(t.if) ?? 0.5 : 1
	const {pos, neg} = effectsPP(t.effects, ctx)
	return {pos: pos * count * like, neg: neg * count * like}
}

/** Budget (max PP) for a card of a rarity at an energy cost. */
export const cardBudget = (rarity, energy) => (CARD_BUDGET[rarity] ?? CARD_BUDGET.common)(energy)

/**
 * PP breakdown of any content def.
 * Cards are scored as written; validate.js scores the upgraded variant separately
 * (`upgradePP` = upgraded PP + 6 per Energy saved) and passes it to checkBudget.
 * @returns {{pp: number, pos: number, neg: number, budget: number|null, min: number|null, upgradePP?: number}}
 */
export function scoreContent(def, ctx = {}) {
	if (def.kind === 'card') {
		let {pos, neg} = effectsPP(def.effects, ctx)
		for (const t of def.triggers ?? []) {
			const v = triggerPP(t, ctx)
			pos += v.pos * POWER_ACTIVE_SHARE
			neg += v.neg * POWER_ACTIVE_SHARE
		}
		if (def.exhaust) pos *= EXHAUST_MULT
		if (def.retain) pos += RETAIN_PP
		const budget = cardBudget(def.rarity, def.energy)
		return {pp: round1(pos + neg), pos: round1(pos), neg: round1(neg), budget, min: null}
	}
	if (def.kind === 'item') {
		let pos = 0
		let neg = 0
		for (const t of def.triggers) {
			const v = triggerPP(t, ctx)
			pos += v.pos
			neg += v.neg
		}
		const m = def.stats?.maxHp ?? 0
		if (m > 0) pos += MAX_HP_PP * m
		else neg += MAX_HP_PP * m
		return {pp: round1(pos + neg), pos: round1(pos), neg: round1(neg), budget: ITEM_BUDGET[def.rarity], min: null}
	}
	if (def.kind === 'curse') {
		let pos = 0
		let neg = def.exhaust ? -DEAD_SLOT_PP / 2 : -DEAD_SLOT_PP
		if (def.energy !== null) {
			const v = effectsPP(def.effects, ctx)
			pos += v.pos
			neg += v.neg - 2 * def.energy
		}
		for (const t of def.triggers) {
			const v = triggerPP(t, ctx, {onCard: true})
			pos += v.pos
			neg += v.neg
		}
		return {pp: round1(pos + neg), pos: round1(pos), neg: round1(neg), budget: CURSE_BUDGET.max, min: CURSE_BUDGET.min}
	}
	if (def.kind === 'token') {
		const {pos, neg} = effectsPP(def.effects, ctx)
		return {pp: round1(pos + neg), pos: round1(pos), neg: round1(neg), budget: TOKEN_BUDGET.max, min: TOKEN_BUDGET.min}
	}
	return {pp: 0, pos: 0, neg: 0, budget: null, min: null}
}

/**
 * Budget band check. offer: 'gift' (default) | 'bargain' | 'curse' | 'sealed'.
 * @returns {{code: string, path: string, msg: string}[]}
 */
export function checkBudget(def, score, {offer = 'gift'} = {}) {
	const out = []
	const e = (msg) => out.push({code: 'budget', path: '', msg})
	if (def.kind === 'curse') {
		if (score.pp > CURSE_BUDGET.max + BUDGET_SLACK) e(`a curse must cost at least ${-CURSE_BUDGET.max} PP per fight (this one: ${score.pp})`)
		if (score.pp < CURSE_BUDGET.min - BUDGET_SLACK) e(`a curse may cost at most ${-CURSE_BUDGET.min} PP per fight (this one: ${score.pp})`)
		return out
	}
	if (def.kind === 'token') {
		if (score.pp > TOKEN_BUDGET.max + BUDGET_SLACK) e(`a token is worth at most ${TOKEN_BUDGET.max} PP (this one: ${score.pp})`)
		if (score.pp < TOKEN_BUDGET.min - BUDGET_SLACK && offer !== 'bargain') e(`a token is worth at least ${TOKEN_BUDGET.min} PP (this one: ${score.pp})`)
		return out
	}
	const band = score.budget
	if (offer === 'bargain') {
		if (score.pos > 1.5 * band + BUDGET_SLACK) e(`a bargain's good part is at most 1.5 x ${band} PP (this one: ${score.pos})`)
		const excess = Math.max(0, score.pos - band)
		if (-score.neg + BUDGET_SLACK < excess / 2) e(`a bargain's cost must take back half of the ${round1(excess)} PP excess`)
	} else if (score.pp > band + BUDGET_SLACK) e(`${score.pp} PP is over the ${def.rarity} budget of ${band}`)
	if (score.pp <= 0 && offer === 'gift') e(`a gift must be worth something (this one: ${score.pp} PP)`)
	if (def.kind === 'card' && score.upgradePP !== undefined) {
		if (score.upgradePP > band + UPGRADE_BUDGET + (offer === 'bargain' ? band / 2 : 0) + BUDGET_SLACK) e(`the upgrade (${score.upgradePP} PP) is over budget + ${UPGRADE_BUDGET}`)
		if (score.upgradePP + BUDGET_SLACK < score.pp) e('the upgrade is worse than the card')
	}
	return out
}

/** Damage/Block/draw/energy/power totals of an effect list at worst-case scaling. */
function totals(effects = []) {
	const t = {damage: 0, block: 0, draw: 0, energy: 0, powers: {}}
	for (const e of effects) {
		if (e.do === 'damage') t.damage += maxN(e) * e.hits
		else if (e.do === 'block') t.block += maxN(e)
		else if (e.do === 'draw') t.draw += e.n
		else if (e.do === 'energy') t.energy += e.n
		else if (e.do === 'power') t.powers[e.kind] = (t.powers[e.kind] ?? 0) + e.n
	}
	return t
}

/**
 * Hard caps (GDD 8.2), checked before the budget and the sim, no exceptions.
 * @returns {{code: string, path: string, msg: string}[]}
 */
export function checkCaps(def) {
	const out = []
	const e = (path, msg) => out.push({code: 'cap', path, msg})
	const cardLike = (effects, path) => {
		const t = totals(effects)
		for (const x of effects) if (x.do === 'damage' && x.n === 0 && !x.scale) e(path, 'damage 0 needs a scale')
		if (t.damage > HARD_CAPS.damagePerCard) e(path, `at most ${HARD_CAPS.damagePerCard} damage per card (${t.damage})`)
		if (t.block > HARD_CAPS.blockPerCard) e(path, `at most ${HARD_CAPS.blockPerCard} Block per card (${t.block})`)
		if (t.draw > HARD_CAPS.drawPerCard) e(path, `at most ${HARD_CAPS.drawPerCard} draw per card`)
		if (t.energy > HARD_CAPS.energyPerCard) e(path, `at most ${HARD_CAPS.energyPerCard} Energy per card`)
		for (const [k, n] of Object.entries(t.powers)) {
			const cap = k === 'poison' || k === 'regen' ? HARD_CAPS.decayingStacksPerCard : HARD_CAPS.powerStacksPerCard
			if (n > cap) e(path, `at most ${cap} ${POWERS[k].label} per card`)
		}
		return t
	}
	const triggerRules = (triggers, path, {item = false, curse = false} = {}) => {
		triggers.forEach((t, i) => {
			const p = `${path}[${i}]`
			if ((t.on === 'onPlay' || t.on === 'onDraw' || t.on === 'firstCardEachTurn') && t.effects.some((x) => LOOP_EFFECTS.includes(x.do) && (x.do === 'draw' || x.pile === 'hand')))
				e(p, `no draw or add-to-hand on ${t.on} (loops)`)
			if (t.on === 'onHpLoss' && t.effects.some((x) => x.do === 'loseHp')) e(p, 'no Lose HP on onHpLoss (loops)')
			if (t.on === 'onKill' && t.effects.some((x) => x.do !== 'heal' && x.do !== 'block' && x.do !== 'power')) e(p, 'onKill may only heal, block or apply powers')
			const tt = cardLike(t.effects, `${p}.effects`)
			if (curse) {
				const tick = t.effects.filter((x) => x.do === 'loseHp').reduce((a, x) => a + x.n, 0)
				if (tick > HARD_CAPS.curseTickPerTurn) e(p, `curse tick damage at most ${HARD_CAPS.curseTickPerTurn}`)
			}
			if (item && tt.energy > 0 && (t.on === 'turnStart' || t.on === 'everyNthTurn' && t.n <= 2) && !(def.rarity === 'rare' && scoreContent(def).neg < 0))
				e(p, 'energy every turn only on a rare item with a drawback')
		})
	}
	if (def.kind === 'card') {
		const t = cardLike(def.effects, 'effects')
		if (t.energy > 0 && t.draw > 0 && !def.exhaust) e('exhaust', 'a card that gives Energy and draw must exhaust')
		if (def.type === 'attack' && !def.effects.some((x) => x.do === 'damage' && x.target === 'enemy' && !x.if && !x.scale && !x.when))
			e('type', 'an attack needs a plain "deal damage" effect (otherwise make it a skill)')
		if (def.type !== 'attack' && def.target === 'enemy' && !def.effects.some((x) => x.do === 'damage' || (x.do === 'power' && x.target !== 'self') || effectSpec(x.do)?.enemy))
			e('target', 'targets the enemy but does nothing to it')
		if (def.upgrade?.effects) {
			const u = cardLike(def.upgrade.effects, 'upgrade.effects')
			if (u.energy > 0 && u.draw > 0 && !def.exhaust) e('upgrade', 'a card that gives Energy and draw must exhaust')
		}
		triggerRules(def.triggers ?? [], 'triggers')
		if (def.effects.some((x) => x.do === 'addCard' && x.pile === 'hand' && x.card === 'self')) e('effects', 'a card may not copy itself to hand')
	} else if (def.kind === 'item') {
		triggerRules(def.triggers, 'triggers', {item: true})
	} else if (def.kind === 'curse') {
		cardLike(def.effects, 'effects')
		triggerRules(def.triggers, 'triggers', {curse: true})
	} else if (def.kind === 'token') {
		cardLike(def.effects, 'effects')
	}
	return out
}
