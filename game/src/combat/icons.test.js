// Intent icon mapping (pure part of icons.js). AGPL-3.0-or-later.
import {describe, expect, it} from 'vitest'
import {intentIconKinds} from './icons.js'
import {ENEMIES} from './rules/index.js'

describe('intentIconKinds', () => {
	it('maps the four Ash Warden intents to sword / shield / cloud / slam icons', () => {
		const kinds = ENEMIES.ashWarden.intents.map((i, k) => intentIconKinds({...i, step: k + 1}))
		expect(kinds).toEqual([['attack'], ['attack', 'block'], ['attack', 'weak'], ['slam']])
	})
	it('shows nothing for an empty intent and keeps the slam icon even at 0 damage', () => {
		expect(intentIconKinds({step: 1, damage: 0})).toEqual([])
		expect(intentIconKinds({step: 4, damage: 0})).toEqual(['slam'])
	})
})
