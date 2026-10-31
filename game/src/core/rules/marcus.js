// Marcus: free-text classifier (GDD 2.4), rules table, topic answers, scripted lines (GDD 2.3).
// OWNER: systems engineer. PURE (no DOM): the room server imports this file.
// Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later

/** @typedef {'help'|'threaten'|'bribe'|'deceive'|'flatter'|'steal'|'attack'|'ask'} Intent */

/**
 * GDD 2.4 patterns, tested in this order; first match wins. Each pattern is anchored at a
 * word start (so "repay" is not "pay", "believe" is not "lie"); that is the one deliberate
 * tightening of "substring".
 */
const PATTERNS = /** @type {[Intent, RegExp][]} */ ([
	['attack', /\b(kill|attack|stab|punch|hit him|slay|fight you|strike him|draw (my )?(sword|steel|blade))/],
	['steal', /\b(steal|rob|pickpocket|swipe|take his|lift his|pocket)/],
	['threaten', /\b(threat|or else|scare|intimidat|hurt you|warn you)/],
	['bribe', /\b(pay|gold|coin|bribe|money|offer you|reward)/],
	['deceive', /\b(lie|lies|lying|pretend|i am the|i'm the|trick|disguise|fake|claim)/],
	['flatter', /\b(flatter|wise|greatest|finest|brilliant|admire|best smith|handsome)/],
	['help', /\b(help|sorry|sweep|clean|comfort|condolence|light the (forge|hearth)|carry|kind|thank|bury)/],
])

/**
 * Local classifier: lowercase, test the patterns in order, first match wins, else 'ask'.
 * @param {string} text
 * @returns {Intent}
 */
export function classifyFreeText(text) {
	const t = String(text ?? '')
		.toLowerCase()
		.replace(/[‘’]/g, "'")
	for (const [intent, re] of PATTERNS) if (re.test(t)) return intent
	return 'ask'
}

/**
 * GDD 2.4 rules table. `trust` is the delta (attack sets to -3 instead). `hp` is the loss
 * (never below 1 HP). `reply` = [variant A, variant B]; `narr` is game-written narration.
 */
export const FREE_RULES = Object.freeze({
	help: {trust: 1, capped: true, reply: ['...Thank you. Not many offer.', "Hm. You've got decent hands."]},
	flatter: {trust: 0, aiTrust: true, reply: ["Pretty words don't heat iron.", 'Save it.']},
	ask: {trust: 0, aiTrust: true, reply: null}, // topic answer
	bribe: {trust: -1, reply: ["Coin won't bring him back.", 'Keep your purse.']},
	deceive: {trust: -1, reply: ['I know the sound of a false note. I hammer iron.', "You're lying. Don't."]},
	threaten: {trust: -1, reply: ["I've been threatened by better. Go on.", 'Try that again.']},
	steal: {trust: -2, hp: 6, narr: 'He catches your wrist and shoves you into the post.', reply: null},
	attack: {setTrust: -3, hp: 8, narr: 'He turns your blow with the hammer handle and you go down hard.', reply: ['Out.', 'Out.'], curse: true},
})

export const FREE_TEXT_CAP = 2
export const NOTHING_MORE = 'He nods. Nothing more to say.'

/** GDD 2.4 topic answers; first topic whose pattern matches wins. */
const TOPICS = [
	[/\b(tobin|son|boy)\b/, () => 'Sixteen. Stubborn like his mother. Braver than me.'],
	[/\b(warden|iron|thing)/, () => 'Iron and ash, taller than this roof. It hits like a falling beam.'],
	[/\b(gate|north)/, () => "North end of the village. You'll see the ash on the stones."],
	[/\b(forge|anvil|upgrade|cards?)\b/, (trust) => (trust >= 1 ? "The anvil's yours. Ask." : "Anvil's not for strangers.")],
	[/\bhammer/, () => 'Tobin had it. If you find it up there... bring it back.'],
	[/\b(well|lectern|shrine|grindstone)/, () => "Well takes what you throw in. The stone by the tree shows you things. Don't touch the crooked shrine."],
]
const TOPIC_DEFAULT = "Ask me plainly and I'll answer plainly."

/** Offline answer for an 'ask'. */
export function topicAnswer(text, trust) {
	const t = String(text ?? '').toLowerCase()
	for (const [re, fn] of TOPICS) if (re.test(t)) return fn(trust)
	return TOPIC_DEFAULT
}

/** Scripted lines (GDD 2.3). */
export const LINES = Object.freeze({
	haveWeMet: 'He looks at you a moment too long. "Have we met?"',
	friendStruck: 'Your friend drew steel in my forge.',
	beat1: "Forge is cold. If you're not here about the gate, keep walking.",
	beat1Sorry: 'My boy. Tobin. Three nights ago.',
	beat1Smith: 'Then you need a different village.',
	beat2: "There's a thing of iron and ash at the north gate. The Warden. It killed my son. Nobody here will go near it.",
	promise: "Then you'll want your cards sharper than they are.",
	greedy: 'Nothing. Same as for everyone else who said no.',
	why: 'It was made to. It forgets who for.',
	whoCold: "Ask the gate. I'm done talking.",
	confession:
		'I did. Twelve years ago, for the old lord. I fed it the heart of this forge so it would listen to me. Tobin took my hammer up there to put it out. I should have gone. I was afraid.',
	forgive: '...Thank you.',
	tip: 'When it raises both arms, the Slam is coming. Have your block ready.',
	insult: 'Get out of my forge.',
	anvilPrompt: 'Put one on the anvil.',
	anvilDone: "There. It'll hold.",
	anvilProve: "Prove you're not just passing through.",
	ember: 'Take this. The last live coal from the forge-heart. It burns once. Make it count.',
	second: 'One more. For Tobin.',
	curse: 'Take your doubts with you.',
	stealLine: '(-6 HP)',
})

/** Return greetings by trust word (after Beat 1 is done). */
export const GREETINGS = Object.freeze({
	Cold: "We're finished.",
	Wary: 'Say what you came to say.',
	Guarded: 'Still here?',
	Warm: 'Back again.',
	Trusting: "Sit by the hearth if you like. It's warm again.",
})

export const EPILOGUE = Object.freeze({
	warm: "You brought the hammer back. I'll hang it over the door.",
	plain: "It's done, then. Good.",
})

/** Player-side option texts (GDD 2.3). id -> text. */
export const OPTION_TEXT = Object.freeze({
	'b1.what': 'What happened at the gate?',
	'b1.sorry': "I'm sorry. You look like you've lost someone.",
	'b1.smith': 'I need a smith, not a story.',
	'b2.promise': "I'll put it down.",
	'b2.greedy': "What's in it for me?",
	'b2.why': 'Why does it guard the gate?',
	'b3.who': 'Who made the Warden, Marcus?',
	'b3.forgive': "It wasn't your fault. Let me finish what he started.",
	'b3.tip': 'Then tell me how to beat it.',
	'b3.insult': 'You sent your son to clean up your mess.',
	'anvil.open': 'Can you work on my cards?',
})
