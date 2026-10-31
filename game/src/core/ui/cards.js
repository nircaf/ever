// Card faces for the deck screen and pickers, drawn with the shared art kit's markup
// (style.css .ever-card) and icons from style.js. OWNER: systems engineer.
// Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later

import {createIconRenderer, makeCardIcon} from '../../shared/style.js'
import {engineCard} from '../../combat/rules/index.js'
import {h} from './dom.js'

let renderer = null
let rendererFailed = false
const iconCache = new Map()

/** PNG data URL of the kit icon for a card (or token) name, or '' when WebGL is unavailable. */
export function iconFor(name, type = 'attack') {
	const key = `${name}|${type}`
	if (iconCache.has(key)) return iconCache.get(key)
	let url = ''
	if (!rendererFailed) {
		try {
			renderer ??= createIconRenderer({size: 128})
			url = renderer.render(makeCardIcon(name, type), 128)
		} catch {
			rendererFailed = true
		}
	}
	iconCache.set(key, url)
	return url
}

/** Display facts for a deck card, from the engine (falls back to the bare id). */
export function cardFacts(deckCard) {
	try {
		const c = engineCard(deckCard)
		return {name: deckCard.id, type: c.type || 'attack', energy: c.energy, description: c.description || '', unplayable: deckCard.id === 'Doubt'}
	} catch {
		return {name: deckCard.id, type: deckCard.id === 'Doubt' ? 'curse' : 'attack', energy: 1, description: '', unplayable: deckCard.id === 'Doubt'}
	}
}

/**
 * @param {{id: string, upgraded: boolean}} deckCard
 * @param {{count?: number, onClick?: () => void, selected?: boolean, size?: 'sm'|'lg'|''}} [o]
 */
export function cardEl(deckCard, {count = 1, onClick, selected = false, size = ''} = {}) {
	const f = cardFacts(deckCard)
	const icon = iconFor(f.name, f.type)
	const el = h(
		onClick ? 'button' : 'div',
		{
			class: ['ever-card', size && `ever-card--${size}`, deckCard.upgraded && 'is-upgraded', f.unplayable && 'is-unplayable', selected && 'is-selected', onClick && 'is-playable'].filter(Boolean).join(' '),
			'data-type': f.type,
			type: onClick ? 'button' : null,
			'aria-label': `${f.name}${deckCard.upgraded ? ' plus' : ''}, ${f.type}. ${f.description}`,
			onclick: onClick,
			style: onClick ? 'padding:0;font-family:inherit;color:inherit;text-align:inherit;' : null,
		},
		h('div', {class: 'ever-card__band', text: f.type}),
		h('div', {class: 'ever-card__cost', text: String(f.energy)}),
		h('div', {class: 'ever-card__name', text: f.name}),
		h('div', {class: 'ever-card__art'}, icon ? h('img', {src: icon, alt: '', draggable: 'false'}) : null),
		h('p', {class: 'ever-card__text', text: f.description}),
		count > 1 ? h('span', {class: 'ever-count', text: `x${count}`}) : null,
	)
	return el
}

/** Group a deck into [{card, count}] by id + upgraded, curses last, then by name. */
export function groupDeck(deck) {
	const m = new Map()
	for (const c of deck) {
		const k = c.id + (c.upgraded ? '+' : '')
		if (!m.has(k)) m.set(k, {card: c, count: 0, uids: []})
		const g = m.get(k)
		g.count += 1
		g.uids.push(c.uid)
	}
	const rank = (g) => (g.card.id === 'Doubt' ? 2 : g.card.upgraded ? 0 : 1)
	return [...m.values()].sort((a, b) => rank(a) - rank(b) || a.card.id.localeCompare(b.card.id))
}
