// EVER mechanics: the building-block library (GDD_V2 section 8).
// The ONLY vocabulary that AI proposals, the offline generator and world/ data may use.
// Every block declares: its parameters (ranges and enums), its power-point cost, and its
// rules text. Rules text is always rendered by the game from data, never by the model.
// PURE: no DOM. Imported by the browser and by server/.
//
// Copyright (C) 2026 the EVER contributors.
// SPDX-License-Identifier: AGPL-3.0-or-later

// -------------------------------------------------------------------------------------
// Enums
// -------------------------------------------------------------------------------------

export const CONTENT_KINDS = Object.freeze(['card', 'item', 'curse', 'token'])
export const CARD_TYPES = Object.freeze(['attack', 'skill', 'power'])
export const RARITIES = Object.freeze(['common', 'uncommon', 'rare'])
/** Rarities a card may carry; keepsake/special are only set by authored content (world/), never by the AI. */
export const CARD_RARITIES = Object.freeze([...RARITIES, 'keepsake', 'special'])
export const CARD_TARGETS = Object.freeze(['enemy', 'allEnemies', 'self'])
export const ITEM_SLOTS = Object.freeze(['hand', 'body', 'charm'])
export const THEMES = Object.freeze(['forge', 'well', 'briar', 'ash', 'lantern', 'crow', 'oath', 'bargain'])
/** Piles a created card can go to. */
export const PILES = Object.freeze(['hand', 'draw', 'discard'])

/** Palette keys (game/src/shared/style.js PALETTE + WORLD). A test keeps this list in sync. */
export const ART_TINTS = Object.freeze([
	'paper', 'ink', 'ember', 'slate', 'moss', 'dusk', 'gold', 'doubt', 'ward', 'haze',
	'pine', 'ash', 'stone', 'wood', 'roof', 'window', 'apron', 'rust', 'iron',
])
/** Icon props the kit's icon renderer knows (existing kit props + the GDD_V2 18/ART list). */
export const ART_PROPS = Object.freeze([
	'sword', 'shield', 'hammer', 'token', 'ember', 'ward', 'whetstone', 'doubt', 'bolt',
	'coal', 'drop', 'thorn', 'leaf', 'feather', 'bell', 'coin', 'ring', 'apple', 'bucket',
	'rope', 'lantern', 'book', 'apron', 'cloud', 'wave', 'beak', 'spark',
])

/**
 * Statuses ("powers"). vulnerable/weak/strength are the engine's own; regen, poison and
 * thorns tick in the mechanics hooks (engine.js), because the party combat never calls the
 * engine's endTurn. `debuff` decides which side it is good for.
 */
// pp(n, fight): `fight` = "for the rest of the fight" (the stacks never decay below n), so a
// decaying power is then worth about n per turn of an average fight instead of n(n+1)/2.
const decaying = (n, fight) => Math.max(((n * (n + 1)) / 2) * 0.8, fight ? n * 6 * 0.8 : 0)
export const POWERS = Object.freeze({
	vulnerable: Object.freeze({label: 'Vulnerable', debuff: true, pp: (n, fight) => (fight ? 6 : 3) * n}),
	weak: Object.freeze({label: 'Weak', debuff: true, pp: (n, fight) => (fight ? 5 : 3) * n}),
	strength: Object.freeze({label: 'Strength', debuff: false, pp: (n, fight) => (fight ? 5 : 3) * n}),
	regen: Object.freeze({label: 'Regen', debuff: false, pp: decaying}),
	poison: Object.freeze({label: 'Poison', debuff: true, pp: decaying}),
	thorns: Object.freeze({label: 'Thorns', debuff: false, pp: (n, fight) => (fight ? 5 : 2) * n}),
})
export const POWER_KINDS = Object.freeze(Object.keys(POWERS))

/**
 * Engine card names an `addCard` effect may reference, with their PP value
 * (as if played once). Generated cards are referenced by their run id ("g:c-xxxxxx").
 */
export const ENGINE_CARD_REFS = Object.freeze({
	Strike: 6,
	Defend: 5,
	Doubt: -6,
})

// -------------------------------------------------------------------------------------
// Parameter specs
// -------------------------------------------------------------------------------------

const int = (min, max, def) => Object.freeze({t: 'int', min, max, def})
const oneOf = (of, def) => Object.freeze({t: 'enum', of: Object.freeze([...of]), def})
const bool = (def = false) => Object.freeze({t: 'bool', def})
const ref = () => Object.freeze({t: 'ref'})

const n1 = (n) => (n === 1 ? 'a' : String(n))
const plural = (n, one, many = one + 's') => (n === 1 ? one : many)
const powerLabel = (k) => POWERS[k]?.label ?? k

// -------------------------------------------------------------------------------------
// Effects (what happens). pp(p, ctx) is the value of ONE resolution, before conditions,
// scaling, delay and exhaust multipliers (budget.js applies those).
// -------------------------------------------------------------------------------------

export const EFFECTS = Object.freeze({
	damage: Object.freeze({
		params: {n: int(0, 30, 6), hits: int(1, 3, 1), target: oneOf(['enemy', 'allEnemies'], 'enemy')},
		scalable: true,
		pp: (p) => p.n * p.hits + (p.hits - 1),
		text: (p, amt) => `Deal ${amt} damage${p.hits > 1 ? ` ${p.hits} times` : ''}${p.target === 'allEnemies' ? ' to all enemies' : ''}`,
	}),
	block: Object.freeze({
		params: {n: int(0, 25, 5)},
		scalable: true,
		pp: (p) => p.n,
		text: (p, amt) => `Gain ${amt} Block`,
	}),
	draw: Object.freeze({
		params: {n: int(1, 3, 1)},
		pp: (p) => 3 * p.n,
		text: (p) => `Draw ${n1(p.n)} ${plural(p.n, 'card')}`,
	}),
	energy: Object.freeze({
		params: {n: int(1, 2, 1)},
		pp: (p) => 5 * p.n,
		text: (p) => `Gain ${p.n} Energy`,
	}),
	loseEnergy: Object.freeze({
		params: {n: int(1, 2, 1)},
		pp: (p) => -4 * p.n,
		text: (p) => `Lose ${p.n} Energy`,
	}),
	heal: Object.freeze({
		params: {n: int(0, 15, 3)},
		scalable: true,
		pp: (p) => 1.5 * p.n,
		text: (p, amt) => `Heal ${amt} HP`,
	}),
	loseHp: Object.freeze({
		params: {n: int(1, 10, 1)},
		pp: (p) => -p.n,
		text: (p) => `Lose ${p.n} HP`,
	}),
	power: Object.freeze({
		params: {kind: oneOf(POWER_KINDS, 'weak'), n: int(1, 5, 1), target: oneOf(['enemy', 'allEnemies', 'self'], 'enemy'), fight: bool(false)},
		pp: (p) => {
			const def = POWERS[p.kind]
			const v = def.pp(p.n, p.fight)
			const onEnemy = p.target !== 'self'
			// A debuff is good on the enemy and bad on you; a buff the other way round.
			return def.debuff === onEnemy ? v : -v
		},
		text: (p) => {
			const label = powerLabel(p.kind)
			const lasting = p.fight ? ' for the rest of the fight' : ''
			if (p.target === 'self') return `Gain ${p.n} ${label}${lasting}`
			return `Apply ${p.n} ${label}${p.target === 'allEnemies' ? ' to all enemies' : ''}${lasting}`
		},
	}),
	removePower: Object.freeze({
		params: {kind: oneOf([...POWER_KINDS, 'debuffs', 'buffs'], 'debuffs'), target: oneOf(['self', 'enemy'], 'self')},
		pp: (p) => {
			const good = p.target === 'self' ? p.kind === 'debuffs' || POWERS[p.kind]?.debuff : p.kind === 'buffs' || POWERS[p.kind]?.debuff === false
			return good ? 3 : -2
		},
		text: (p) => {
			const what = p.kind === 'debuffs' ? 'debuffs' : p.kind === 'buffs' ? 'buffs' : powerLabel(p.kind)
			return p.target === 'self' ? `Remove your ${what}` : `Remove the enemy's ${what}`
		},
	}),
	exhaust: Object.freeze({
		params: {n: int(1, 2, 1), pick: oneOf(['random', 'curse'], 'random')},
		pp: (p) => (p.pick === 'curse' ? 2 * p.n : -1 * p.n),
		text: (p) => (p.pick === 'curse' ? `Exhaust ${n1(p.n)} ${plural(p.n, 'curse')} in your hand` : `Exhaust ${n1(p.n)} random ${plural(p.n, 'card')} in your hand`),
	}),
	discard: Object.freeze({
		params: {n: int(1, 2, 1)},
		pp: (p) => -1.5 * p.n,
		text: (p) => `Discard ${n1(p.n)} random ${plural(p.n, 'card')}`,
	}),
	addCard: Object.freeze({
		params: {card: ref(), pile: oneOf(PILES, 'discard'), n: int(1, 2, 1)},
		// value of the referenced card; resolved by budget.js (curses negative)
		pp: (p, ctx) => p.n * (ctx?.refValue?.(p.card) ?? ENGINE_CARD_REFS[p.card] ?? 0),
		text: (p, _amt, ctx) => {
			const name = ctx?.refName?.(p.card) ?? p.card
			const where = p.pile === 'hand' ? 'your hand' : p.pile === 'draw' ? 'your draw pile' : 'your discard pile'
			return `Add ${p.n === 1 ? (/^[AEIOU]/i.test(name) ? 'an' : 'a') : p.n} ${name} to ${where}`
		},
	}),
	// Out of combat (only inside a `fightWon` trigger): heal the book's HP after a won fight.
	healNow: Object.freeze({
		params: {n: int(1, 15, 3)},
		outOfCombat: true,
		pp: (p) => 0.5 * p.n,
		text: (p) => `Heal ${p.n} HP`,
	}),
})
export const EFFECT_IDS = Object.freeze(Object.keys(EFFECTS))
/** Effects that may never appear on an onDraw/onPlay trigger (no loops, GDD 8.2). */
export const LOOP_EFFECTS = Object.freeze(['draw', 'addCard'])

// -------------------------------------------------------------------------------------
// Conditions (effect-level `if`). likelihood() is the first-guess share of resolutions
// where the condition holds (GDD 8.2); the sim measures the real thing.
// -------------------------------------------------------------------------------------

export const CONDITIONS = Object.freeze({
	hpBelow: Object.freeze({params: {pct: int(10, 90, 50)}, likelihood: (p) => Math.min(0.9, p.pct / 125), text: (p) => `If your HP is below ${p.pct}%`}),
	handSizeAtLeast: Object.freeze({params: {n: int(1, 10, 4)}, likelihood: (p) => Math.max(0.1, 1 - p.n * 0.15), text: (p) => `If you have ${p.n} or more cards in hand`}),
	handSizeAtMost: Object.freeze({params: {n: int(0, 9, 2)}, likelihood: (p) => Math.min(0.9, 0.2 + p.n * 0.15), text: (p) => `If you have ${p.n} or fewer cards in hand`}),
	enemyIntendsAttack: Object.freeze({params: {}, likelihood: () => 0.75, text: () => 'If the enemy intends to attack'}),
	enemyHas: Object.freeze({params: {kind: oneOf(POWER_KINDS, 'vulnerable')}, likelihood: () => 0.4, text: (p) => `If the enemy has ${powerLabel(p.kind)}`}),
	handHasCurse: Object.freeze({params: {}, likelihood: () => 0.3, text: () => 'If you hold a curse'}),
	cardsPlayedAtLeast: Object.freeze({params: {n: int(1, 5, 2)}, likelihood: (p) => Math.max(0.1, 0.85 - p.n * 0.2), text: (p) => `If you played ${p.n} or more cards this turn`}),
	turnAtLeast: Object.freeze({params: {n: int(2, 6, 3)}, likelihood: (p) => Math.max(0.15, (7 - p.n) / 6), text: (p) => `From turn ${p.n} on`}),
	turnIs: Object.freeze({params: {n: int(1, 6, 1)}, likelihood: () => 0.2, text: (p) => `On turn ${p.n}`}),
	energyLeftAtLeast: Object.freeze({params: {n: int(1, 3, 1)}, likelihood: (p) => Math.max(0.1, 0.6 - p.n * 0.15), text: (p) => `If you have ${p.n} or more Energy left`}),
	noAttackThisTurn: Object.freeze({params: {}, likelihood: () => 0.35, text: () => "If you haven't played an attack this turn"}),
	notDamagedThisFight: Object.freeze({params: {}, likelihood: () => 0.3, text: () => "If you haven't lost HP this fight"}),
	firstTimeThisFight: Object.freeze({params: {}, likelihood: () => 0.5, text: () => 'The first time you play this each fight'}),
	deckSizeAtMost: Object.freeze({params: {n: int(3, 20, 6)}, likelihood: (p) => Math.min(0.9, p.n / 10), text: (p) => `If your deck has ${p.n} or fewer cards`}),
})
export const CONDITION_IDS = Object.freeze(Object.keys(CONDITIONS))

// -------------------------------------------------------------------------------------
// Scaling (effect-level `scale: {per, each, cap}`): amount = n + each * min(count, cap).
// expected(ctx) is the planning guess for the count.
// -------------------------------------------------------------------------------------

export const SCALINGS = Object.freeze({
	cardInHand: Object.freeze({expected: () => 3, text: 'for each card in your hand'}),
	curseInDeck: Object.freeze({expected: (ctx) => ctx?.curses ?? 1, text: 'for each curse in your deck'}),
	turn: Object.freeze({expected: () => 3, text: 'for each turn this fight'}),
	cardPlayedThisTurn: Object.freeze({expected: () => 1.5, text: 'for each card you played this turn'}),
	missingHp10: Object.freeze({expected: () => 1.5, text: 'for each 10 HP you are missing'}),
	enemyDebuff: Object.freeze({expected: () => 1.5, text: 'for each Weak, Vulnerable and Poison on the enemy'}),
	item: Object.freeze({expected: (ctx) => ctx?.items ?? 1, text: 'for each item you carry'}),
})
export const SCALING_IDS = Object.freeze(Object.keys(SCALINGS))
export const SCALE_CAP = 5

// -------------------------------------------------------------------------------------
// Triggers (items, curses, power cards, tokens). count() = expected firings in an average
// fight of 6 turns (GDD 8.2 item budget is "per average fight").
// zone: where a CARD with this trigger must be for it to fire (items/powers ignore it).
// -------------------------------------------------------------------------------------

export const AVG_FIGHT_TURNS = 6
export const TRIGGERS = Object.freeze({
	fightStart: Object.freeze({params: {}, count: () => 1, zone: 'deck', text: () => 'At the start of each fight'}),
	turnStart: Object.freeze({params: {}, count: () => AVG_FIGHT_TURNS, zone: 'deck', text: () => 'At the start of your turn'}),
	turnEnd: Object.freeze({params: {}, count: () => AVG_FIGHT_TURNS, zone: 'hand', text: (p, card) => (card ? 'At the end of your turn, if this is in your hand' : 'At the end of your turn')}),
	onPlay: Object.freeze({
		params: {type: oneOf(['attack', 'skill', 'power', 'any'], 'attack')},
		count: (p) => ({attack: 9, skill: 6, power: 1, any: 16})[p.type],
		zone: 'hand',
		text: (p) => (p.type === 'any' ? 'Whenever you play a card' : `Whenever you play ${p.type === 'attack' ? 'an' : 'a'} ${p.type}`),
	}),
	firstCardEachTurn: Object.freeze({params: {}, count: () => AVG_FIGHT_TURNS * 0.9, zone: 'hand', text: () => 'The first time you play a card each turn'}),
	onDraw: Object.freeze({params: {}, count: () => 4, zone: 'self', text: () => 'When you draw this'}),
	onHpLoss: Object.freeze({params: {}, count: () => 4, zone: 'deck', text: () => 'Whenever you lose HP'}),
	everyNthTurn: Object.freeze({params: {n: int(2, 4, 2)}, count: (p) => AVG_FIGHT_TURNS / p.n, zone: 'deck', text: (p) => `Every ${p.n === 2 ? 'second' : p.n === 3 ? 'third' : 'fourth'} turn`}),
	onKill: Object.freeze({params: {}, count: () => 0.5, zone: 'deck', text: () => 'When the enemy dies'}),
	fightWon: Object.freeze({params: {}, count: () => 1, zone: 'deck', outOfCombat: true, text: () => 'After you win a fight'}),
})
export const TRIGGER_IDS = Object.freeze(Object.keys(TRIGGERS))
/** Aliases accepted on input and normalized away (requirement wording vs GDD wording). */
export const TRIGGER_ALIASES = Object.freeze({combatStart: 'fightStart', onDamageTaken: 'onHpLoss', onDamaged: 'onHpLoss', onPlayType: 'onPlay', turnBegin: 'turnStart'})

// -------------------------------------------------------------------------------------
// Budgets and hard caps (GDD_V2 8.2)
// -------------------------------------------------------------------------------------

export const CARD_BUDGET = Object.freeze({
	common: (e) => (e === 0 ? 2 : 6 * e + 1),
	uncommon: (e) => (e === 0 ? 4 : 6 * e + 3),
	rare: (e) => (e === 0 ? 6 : 6 * e + 5),
	// GDD_V2 4 says "about 10 PP"; the 16 authored keepsakes measure 7.4 to 12.4 PP here.
	keepsake: () => 12,
	special: (e) => (e === 0 ? 6 : 6 * e + 5),
})
export const ITEM_BUDGET = Object.freeze({common: 8, uncommon: 12, rare: 16})
export const TOKEN_BUDGET = Object.freeze({min: 4, max: 10})
export const CURSE_BUDGET = Object.freeze({min: -10, max: -3})
export const UPGRADE_BUDGET = 3
/** Slack on top of a band before a card is "over budget" (rounding of 1-PP blocks). */
export const BUDGET_SLACK = 0.5

export const HARD_CAPS = Object.freeze({
	damagePerCard: 30,
	blockPerCard: 25,
	drawPerCard: 3,
	energyPerCard: 2,
	powerStacksPerCard: 3,
	/** Poison and Regen decay by 1 a turn, so they may go to 5 (GDD_V2 4 / 18.1 use 4). */
	decayingStacksPerCard: 5,
	curseTickPerTurn: 2,
	maxHpDelta: 10,
	effectsPerList: 6,
	triggersPerThing: 3,
	effectsPerTrigger: 4,
})

/** Size limits for one content definition (bytes of canonical JSON) and text fields. */
export const SIZE_LIMITS = Object.freeze({
	defBytes: 2048,
	nameMin: 2,
	nameMax: 24,
	nameWords: 4,
	flavorMax: 90,
	registryBytes: 6144,
	registryDefs: 40,
})

/**
 * Compact description of the library for the AI `input.library` field (GDD_V2 10.5).
 * Only ids and parameter ranges: no costs (the game decides costs).
 */
export function describeLibrary() {
	const params = (ps) =>
		Object.fromEntries(
			Object.entries(ps).map(([k, s]) => [k, s.t === 'int' ? [s.min, s.max] : s.t === 'enum' ? s.of : s.t === 'bool' ? 'bool' : 'cardRef']),
		)
	return {
		kinds: CONTENT_KINDS,
		cardTypes: CARD_TYPES,
		targets: CARD_TARGETS,
		slots: ITEM_SLOTS,
		effects: Object.fromEntries(Object.entries(EFFECTS).map(([k, e]) => [k, params(e.params)])),
		conditions: Object.fromEntries(Object.entries(CONDITIONS).map(([k, c]) => [k, params(c.params)])),
		triggers: Object.fromEntries(Object.entries(TRIGGERS).map(([k, t]) => [k, params(t.params)])),
		scalings: SCALING_IDS,
		powers: POWER_KINDS,
		cardRefs: Object.keys(ENGINE_CARD_REFS),
		iconProps: ART_PROPS,
		tints: ART_TINTS,
	}
}
