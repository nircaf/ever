// EVER content-gen: words. Theme lexicons (GDD_V2 10.6: adjectives x nouns, flavor lines),
// NPC name lists, themed curse names and the request keyword map. Data only.
// Every string here must pass mechanics/text.js (names: letters, spaces, ' and -, <= 24
// chars, <= 4 words; flavor: <= 90 chars, one sentence, no digits, no "!"). lexicon.test.js
// checks all of them, so a typo cannot ship a name the validator would reject.
// PURE.
//
// Copyright (C) 2026 the EVER contributors.
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @typedef {object} ThemeWords
 * @prop {string[]} adj     20 adjectives
 * @prop {string[]} noun    20 nouns
 * @prop {string[]} flavor  10+ flavor lines for gifts
 * @prop {string[]} dark    flavor lines for curses and bargains (shadow voice)
 * @prop {{prop: string, tint: string, accent: string}} art  default icon spec
 * @prop {string[]} props   icon props this theme likes (ART_PROPS)
 */

/** @type {Readonly<Record<string, ThemeWords>>} */
export const THEME_WORDS = Object.freeze({
	forge: {
		adj: ['Banked', 'Quenched', 'Ringing', 'Tempered', 'Hot', 'Folded', 'Riveted', 'Forged', 'Glowing', 'Hammered', 'Sparking', 'Smithed', 'Annealed', 'Searing', 'Heavy', 'Iron', 'Molten', 'Struck', 'Bellowed', 'Red'],
		noun: ['Edge', 'Coal', 'Anvil', 'Tongs', 'Rivet', 'Bellows', 'Ingot', 'Hammer', 'Chisel', 'Quench', 'Slag', 'Hearth', 'Nail', 'Billet', 'Spark', 'Clamp', 'Horseshoe', 'Chain', 'Blade', 'Flux'],
		flavor: [
			'Still warm from a forge that went cold.',
			'Marcus would say the metal remembers every blow.',
			'Hit it until it agrees with you.',
			'Tobin left his mark on the handle.',
			'The anvil rang for this one, and only once.',
			'Heat first, then patience, then the hammer.',
			'It smells of coal smoke and old promises.',
			'Folded seven ways, and each way a lesson.',
			'Some debts are paid in iron.',
			'Quenched in the trough behind the forge.',
			'A good edge does not need to boast.',
		],
		dark: ['It burns the hand that holds it too long.', 'Slag sticks to everything it touches.', 'The forge takes its share, always.'],
		art: {prop: 'hammer', tint: 'ember', accent: 'iron'},
		props: ['hammer', 'coal', 'ember', 'sword', 'spark', 'whetstone'],
	},
	well: {
		adj: ['Cold', 'Deep', 'Still', 'Drawn', 'Quiet', 'Clear', 'Sunken', 'Mossy', 'Calm', 'Echoing', 'Wet', 'Pale', 'Low', 'Patient', 'Brimming', 'Hushed', 'Lowered', 'Mirrored', 'Slow', 'Drowned'],
		noun: ['Bucket', 'Rope', 'Water', 'Stone', 'Echo', 'Pail', 'Ripple', 'Depth', 'Pulley', 'Rain', 'Spring', 'Mirror', 'Current', 'Tide', 'Basin', 'Drop', 'Pool', 'Ladle', 'Cistern', 'Hollow'],
		flavor: [
			'The well remembers everyone who looks in.',
			'Lower the bucket slowly, and listen.',
			'Cold water wakes the careful.',
			'What sinks here is not lost, only kept.',
			'The rope is older than the village.',
			'Drink, and forget one small thing.',
			'Still water hides a long way down.',
			'Every ripple finds the wall in the end.',
			'Some wishes are heavier than coins.',
			'The stones are worn smooth by hands like yours.',
		],
		dark: ['The undertow pulls at your sleeve.', 'Something below wants it back.', 'Deep water keeps what it takes.'],
		art: {prop: 'drop', tint: 'ward', accent: 'slate'},
		props: ['drop', 'bucket', 'rope', 'wave', 'shield', 'ward'],
	},
	briar: {
		adj: ['Creeping', 'Green', 'Patient', 'Thorned', 'Wild', 'Tangled', 'Rooted', 'Mossed', 'Budding', 'Climbing', 'Bristling', 'Sappy', 'Leafy', 'Barbed', 'Knotted', 'Woven', 'Twining', 'Overgrown', 'Spiny', 'Bitter'],
		noun: ['Sprig', 'Knot', 'Bramble', 'Root', 'Leaf', 'Thorn', 'Vine', 'Burr', 'Hedge', 'Nettle', 'Briar', 'Seed', 'Bark', 'Sap', 'Tendril', 'Thicket', 'Bloom', 'Hawthorn', 'Moss', 'Stem'],
		flavor: [
			'The wood has crept right up to the wall.',
			'Patience is a thorn that grows inward.',
			'It takes root wherever you set it down.',
			'Green things win slowly, and then all at once.',
			'Mind the barbs, they mind you.',
			'The hedge was here before the road.',
			'Every bramble keeps a little blood.',
			'Cut it back and it comes back thicker.',
			'The roots drink what the rain forgets.',
			'Small leaves, long memory.',
		],
		dark: ['It grows into the hand that picks it.', 'The thorns turn inward.', 'Brambles never let go cleanly.'],
		art: {prop: 'thorn', tint: 'moss', accent: 'pine'},
		props: ['thorn', 'leaf', 'apple', 'rope'],
	},
	ash: {
		adj: ['Grey', 'Burnt', 'Mourning', 'Last', 'Hollow', 'Sooted', 'Charred', 'Faded', 'Cinder', 'Smoked', 'Silent', 'Drifting', 'Cooling', 'Spent', 'Ashen', 'Grieving', 'Fallen', 'Lost', 'Scattered', 'Dim'],
		noun: ['Dust', 'Cinder', 'Vigil', 'Pyre', 'Ember', 'Smoke', 'Soot', 'Urn', 'Shroud', 'Lament', 'Wake', 'Haze', 'Remnant', 'Grief', 'Candle', 'Flake', 'Husk', 'Ashes', 'Pall', 'Shade'],
		flavor: [
			'Ash lies on every step in Ashbrook.',
			'Someone is still grieving, and it shows.',
			'What burned down cannot burn again.',
			'Grief is heavy, but it can be thrown.',
			'The smoke remembers the shape of the house.',
			'Give something up, and keep going.',
			'Cold ash, warm hands.',
			'It was a lantern once, before the fire.',
			'Light a candle for the ones at the gate.',
			'Nothing in the ashes is ever quite gone.',
		],
		dark: ['Mourning sits in your chest like a stone.', 'The ash gets into everything.', 'Some losses keep costing.'],
		art: {prop: 'cloud', tint: 'ash', accent: 'haze'},
		props: ['cloud', 'ember', 'sword', 'coal'],
	},
	lantern: {
		adj: ['Bright', 'Guiding', 'Warm', 'Lit', 'Golden', 'Gleaming', 'Shining', 'Hopeful', 'Steady', 'Kindled', 'Glimmering', 'Amber', 'Radiant', 'Waking', 'Clear', 'Beaming', 'Gentle', 'Dawning', 'Hearth', 'Candle'],
		noun: ['Wick', 'Glow', 'Window', 'Spark', 'Beacon', 'Flame', 'Lamp', 'Ray', 'Gleam', 'Torch', 'Halo', 'Dawn', 'Light', 'Shine', 'Glimmer', 'Path', 'Hope', 'Signal', 'Star', 'Lantern'],
		flavor: [
			'One lantern is lit in Ashbrook tonight.',
			'Follow it, and keep your feet on the road.',
			'Light in a window means someone waits.',
			'Hope is a small flame that does not ask permission.',
			'It burns brighter when you are seen.',
			'A lamp for the long road north.',
			'The wick is short, but the night is shorter.',
			'Somebody kept this lit for you.',
			'Even the crows go quiet near it.',
			'Carry it high, so the others find you.',
		],
		dark: ['The flame gutters when you need it most.', 'Light draws eyes, not all of them kind.', 'It burns the oil you meant to save.'],
		art: {prop: 'lantern', tint: 'gold', accent: 'window'},
		props: ['lantern', 'spark', 'bolt', 'book'],
	},
	crow: {
		adj: ['Black', 'Watching', 'Ill', 'Sharp', 'Ink', 'Hooded', 'Cawing', 'Clever', 'Feathered', 'Silent', 'Counting', 'Omened', 'Night', 'Pecking', 'Midnight', 'Shadowed', 'Knowing', 'Hungry', 'Glinting', 'Restless'],
		noun: ['Feather', 'Omen', 'Beak', 'Ledger', 'Wing', 'Talon', 'Eye', 'Caw', 'Rookery', 'Quill', 'Secret', 'Rook', 'Perch', 'Sign', 'Riddle', 'Shadow', 'Gaze', 'Plume', 'Whisper', 'Augury'],
		flavor: [
			'Crows sit on the north gate and count the people who pass.',
			'Never trust an even number of birds.',
			'It saw what you will do before you did.',
			'A feather for every secret kept.',
			'The ledger has your name in it already.',
			'Sharp eyes, sharper beak.',
			'Omens are only warnings told slowly.',
			'The birds know where the Warden sleeps.',
			'Ink dries, but the crow remembers.',
			'Black wings, quiet road.',
		],
		dark: ['An ill omen, and it follows you.', 'The birds have stopped counting you.', 'Something is watching from the gate.'],
		art: {prop: 'feather', tint: 'ink', accent: 'haze'},
		props: ['feather', 'beak', 'book', 'cloud'],
	},
	oath: {
		adj: ['Sworn', 'Kept', 'Honest', 'Bound', 'True', 'Steadfast', 'Loyal', 'Vowed', 'Faithful', 'Plain', 'Spoken', 'Pledged', 'Sealed', 'Upright', 'Earnest', 'Solemn', 'Firm', 'Given', 'Held', 'Ringing'],
		noun: ['Vow', 'Bell', 'Word', 'Promise', 'Seal', 'Pledge', 'Shield', 'Banner', 'Oath', 'Bond', 'Covenant', 'Troth', 'Knot', 'Witness', 'Charter', 'Hand', 'Guard', 'Duty', 'Keep', 'Bulwark'],
		flavor: [
			'In Ashbrook, people still keep their word, mostly.',
			'A promise is a shield you carry for someone else.',
			'The bell rings once for every vow kept.',
			'Say it plainly, then mean it.',
			'Honor is heavy, and it holds.',
			'Kept words outlast kept coins.',
			'Swear it on the old stones.',
			'It only works if you never let go of it.',
			'The vow was simple, keeping it was not.',
			'Stand where you said you would stand.',
		],
		dark: ['A broken vow weighs more than a kept one.', 'The bell rings, and it rings for you.', 'You said you would, and you did not.'],
		art: {prop: 'bell', tint: 'slate', accent: 'paper'},
		props: ['bell', 'shield', 'sword', 'ring'],
	},
	bargain: {
		adj: ['Crooked', 'Fair', 'Pawned', 'Lucky', 'Sealed', 'Borrowed', 'Traded', 'Gilded', 'Weighed', 'Haggled', 'Bartered', 'Owed', 'Dear', 'Cheap', 'Clipped', 'Pocketed', 'Wagered', 'Shiny', 'Second-hand', 'Ledgered'],
		noun: ['Coin', 'Ring', 'Deal', 'Debt', 'Price', 'Purse', 'Wager', 'Scale', 'Token', 'Trinket', 'Bargain', 'Barter', 'Toll', 'Tithe', 'Favor', 'Pawn', 'Receipt', 'Interest', 'Stake', 'Charm'],
		flavor: [
			'Everything in Ashbrook has a price tonight.',
			'A fair deal, if you squint.',
			'Most prices are small, the Wayfarer says.',
			'It was somebody else\'s luck, once.',
			'Weigh it twice before you pay.',
			'The coin is crooked, but it spends.',
			'Nothing is free, but some things are cheap.',
			'The shrine keeps a careful ledger.',
			'Borrowed luck still counts.',
			'Shake on it, and do not look back.',
		],
		dark: ['The debt comes due when you least expect it.', 'It cost more than you thought.', 'The shrine always collects.'],
		art: {prop: 'coin', tint: 'gold', accent: 'dusk'},
		props: ['coin', 'ring', 'bell', 'token'],
	},
})

export const THEME_IDS = Object.freeze(Object.keys(THEME_WORDS))

/**
 * Themed curses (GDD_V2 section 5, "Its curse") as block data. The generator picks the
 * shadow theme's curse and varies the name if the book already holds it.
 */
export const THEMED_CURSES = Object.freeze({
	forge: {name: 'Slag', energy: 1, exhaust: true, effects: [], triggers: [{on: 'turnEnd', effects: [{do: 'loseHp', n: 1}]}], flavor: 'Slag sticks to everything it touches.', art: {prop: 'coal', tint: 'doubt'}},
	well: {name: 'Undertow', energy: null, triggers: [{on: 'onDraw', effects: [{do: 'discard', n: 1}]}], flavor: 'Something below wants it back.', art: {prop: 'wave', tint: 'doubt'}},
	briar: {name: 'Bramble', energy: null, triggers: [{on: 'onPlay', type: 'attack', effects: [{do: 'loseHp', n: 1}]}], flavor: 'It grows into the hand that picks it.', art: {prop: 'thorn', tint: 'doubt'}},
	ash: {name: 'Mourning', energy: null, triggers: [{on: 'turnEnd', effects: [{do: 'loseHp', n: 1}]}], flavor: 'Mourning sits in your chest like a stone.', art: {prop: 'cloud', tint: 'doubt'}},
	// GDD 5 says "when drawn, lose 1 energy"; priced per draw that is -19 PP (over the -10
	// curse floor), so the generated Gutter bites once per fight instead.
	lantern: {name: 'Gutter', energy: null, triggers: [{on: 'fightStart', effects: [{do: 'loseEnergy', n: 1}]}], flavor: 'The flame gutters when you need it most.', art: {prop: 'lantern', tint: 'doubt'}},
	crow: {name: 'Ill Omen', energy: null, triggers: [{on: 'fightStart', effects: [{do: 'power', kind: 'vulnerable', n: 1, target: 'self'}]}, {on: 'turnEnd', effects: [{do: 'loseHp', n: 1}]}], flavor: 'An ill omen, and it follows you.', art: {prop: 'feather', tint: 'doubt'}},
	oath: {name: 'Broken Vow', energy: null, triggers: [{on: 'fightStart', effects: [{do: 'power', kind: 'weak', n: 1, target: 'self'}]}, {on: 'turnEnd', effects: [{do: 'loseHp', n: 1}]}], flavor: 'A broken vow weighs more than a kept one.', art: {prop: 'bell', tint: 'doubt'}},
	bargain: {name: 'Debt', energy: null, triggers: [{on: 'fightStart', effects: [{do: 'loseHp', n: 2}]}], flavor: 'The debt comes due when you least expect it.', art: {prop: 'coin', tint: 'doubt'}},
})

/** Prefixes used when a themed curse name is already in the book. */
export const CURSE_PREFIX = Object.freeze(['Old', 'Second', 'Deeper', 'Bitter', 'Lingering', 'Quiet'])

/** NPCs (GDD_V2 10.2-10.4). Fixed name parts and seeded names. */
export const NPC_WORDS = Object.freeze({
	marcus: {name: 'Marcus', adj: ["Tobin's", "Hale's", 'Cold', 'Heart-coal', 'Forge-lit'], themes: ['forge']},
	wayfarer: {names: ['Ferrin', 'Oda', 'Tamsin', 'Bram', 'Ilse', 'Corwin', 'Mabry', 'Juno'], adj: ["Wayfarer's", 'Roadworn', 'Traveling', 'Cart-borne'], themes: ['bargain', 'lantern']},
	keeper: {names: ['Wren', 'Agnes', 'Hollis', 'Maud', 'Edda', 'Osric'], adj: ["Keeper's", 'Lamp-lit', 'Remembered', 'Old'], themes: ['well', 'lantern']},
})

/**
 * GDD_V2 10.6 request keywords -> steering. `want` is a mechanic family the templates know
 * (see templates.js `tags`), `theme` an optional theme override.
 */
export const REQUEST_KEYWORDS = Object.freeze([
	{words: ['burn', 'fire', 'hot', 'flame', 'heat', 'forge', 'hammer', 'smith'], want: 'damage', theme: 'forge'},
	{words: ['strong', 'stronger', 'strength', 'mighty', 'power'], want: 'strength', theme: 'forge'},
	{words: ['shield', 'protect', 'safe', 'guard', 'armor', 'armour', 'defend', 'block', 'wall'], want: 'block'},
	{words: ['heal', 'rest', 'grow', 'mend', 'life', 'healthy', 'regen'], want: 'regen', theme: 'briar'},
	{words: ['poison', 'thorn', 'thorns', 'venom', 'sting', 'bramble'], want: 'poison', theme: 'briar'},
	{words: ['see', 'draw', 'learn', 'read', 'know', 'think', 'book', 'cards'], want: 'draw', theme: 'lantern'},
	{words: ['luck', 'lucky', 'coin', 'deal', 'gold', 'trade', 'money', 'rich'], want: 'bargain', theme: 'bargain'},
	{words: ['weak', 'scare', 'frighten', 'fear', 'curse', 'hex'], want: 'weak', theme: 'crow'},
	{words: ['break', 'crack', 'pierce', 'shatter', 'sharp', 'cut'], want: 'vulnerable', theme: 'crow'},
	{words: ['fast', 'quick', 'energy', 'speed', 'haste'], want: 'energy', theme: 'lantern'},
	{words: ['promise', 'vow', 'honor', 'honour', 'oath'], want: 'condition', theme: 'oath'},
	{words: ['sacrifice', 'blood', 'grief', 'pain', 'ash'], want: 'sacrifice', theme: 'ash'},
])

/**
 * Read a free-text request (already capped by the caller) into steering hints.
 * Only matches whole words from the fixed list; the text itself is never kept.
 * @param {string} text
 * @returns {{want: string|null, theme: string|null, hash: string}}
 */
export function readRequest(text) {
	const words = String(text ?? '').toLowerCase().normalize('NFKC').split(/[^a-z]+/).filter(Boolean).slice(0, 40)
	const set = new Set(words)
	for (const row of REQUEST_KEYWORDS) {
		if (row.words.some((w) => set.has(w))) return {want: row.want, theme: row.theme ?? null, hash: words.join(' ')}
	}
	return {want: null, theme: null, hash: words.join(' ')}
}
