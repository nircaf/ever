// EVER AI: player-facing lines around AI calls (GDD_V2 19 "Moment and offer"). The UI
// shows these; nothing here is model text. Plain sentence case, no exclamation marks.
//
// Copyright (C) 2026 the EVER contributors.
// SPDX-License-Identifier: AGPL-3.0-or-later

export const AI_LINES = Object.freeze({
	thinking: (name) => `${name} thinks it over...`,
	checking: (name) => `${name} weighs it in their hands...`,
	/** Once per book, when any offer came from the local script instead of the AI. */
	fallbackNote: 'Some offers were written by the local script.',
	/** The AI took too long (20 s): the offline offers are already on the table. */
	slow: (name) => `${name} stops mid-thought and shows you what is at hand.`,
	worldOffline: 'Without the AI, Ashbrook offers marks it has prepared.',
	worldAllUsed: 'Ashbrook has taken every mark it can for now.',
})

/**
 * Authored replies used when the model's reply is missing or refused, per archetype.
 * Chosen by the moment's seed stream, so offline reads stay reproducible.
 */
export const FALLBACK_REPLIES = Object.freeze({
	marcus: [
		'Marcus turns the metal over in his hands. "This will do. Take what you need."',
		'"Hm." He sets a few things on the anvil. "Pick one. Quickly, the coals are going."',
		'"Tobin would have known what to give you. Here. Choose."',
	],
	wayfarer: [
		'"Everything has a price. Most of them are small. Have a look."',
		'The cart creaks open. "Fair goods for a fair reader."',
		'"Take your time. The road north is not going anywhere."',
	],
	keeper: [
		'"Sit. Let me see what you are carrying."',
		'The lamp flickers. "You have been here before, I think. Choose."',
		'"Old things, new things. One of them is yours."',
	],
	other: ['"Here. See if any of this helps."', '"Take one. The night is long."'],
})

/** @param {string} npcId @param {() => number} rand */
export function fallbackReply(npcId, rand) {
	const list = FALLBACK_REPLIES[npcId] ?? FALLBACK_REPLIES.other
	return list[Math.floor(rand() * list.length)]
}
