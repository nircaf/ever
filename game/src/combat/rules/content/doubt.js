// Doubt: the only new card in the EVER MVP (GDD 3.3). Slay the Web card format.
// Registered into the engine by ensureEngine() in ../index.js.
// Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later
export default {
	name: 'Doubt',
	type: 'curse',
	energy: 0,
	target: 'player',
	description: 'Unplayable. At the end of your turn, if Doubt is in your hand, lose 2 HP.',
	conditions: [{type: 'unplayable'}],
}

/** Curses cannot be upgraded. */
export const upgrade = (card) => card
