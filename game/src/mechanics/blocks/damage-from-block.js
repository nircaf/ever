// EVER code block: deal damage equal to a share of your Block (GDD_V2 8.1 `damageFrom`).
// Sandboxed: see docs/MECHANICS.md section 7. Checked by sandbox/check.js.
//
// Copyright (C) 2026 the EVER contributors.
// SPDX-License-Identifier: AGPL-3.0-or-later

import {clamp, pct} from '../sandbox/lib.js'

export const block = {
	id: 'damageFromBlock',
	version: 1,
	enemy: true,
	params: {n: {t: 'int', min: 25, max: 100, def: 50}},
	// Planning guess: about 8 Block on the table when this is played.
	pp: (p) => Math.round(((8 * p.n) / 100) * 10) / 10,
	text: (p) => 'Deal damage equal to ' + p.n + '% of your Block',
}

export function run(api, p) {
	api.damage(clamp(pct(api.currentBlock(), p.n), 0, 30))
}
