// Card faces for the deck screen and pickers, drawn with the shared art kit's markup
// (style.css .ever-card) and icons from style.js. OWNER: systems engineer.
// Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later

import {createIconRenderer, makeCardIcon} from '../../shared/style.js'
import {engineCard} from '../../combat/rules/index.js'
import {getDef, rulesText} from '../../mechanics/index.js'
import {artRecipe} from '../../content-gen/art.js'
import {recipeIconUrl} from '../../world/card-art.js'
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

/** Icon for a generated def (card, item, curse, token): its deterministic art recipe. */
export function defIcon(def) {
	try {
		return recipeIconUrl(artRecipe(def))
	} catch {
		return ''
	}
}

/**
 * Display facts for a deck card, from the engine (falls back to the bare id).
 * v2: generated cards ({id: 'g:c-...'} or an inline {def}) are read from the run content.
 */
export function cardFacts(deckCard, content) {
	const def = deckCard.def ?? (String(deckCard.id).startsWith('g:') ? getDef(content, deckCard.id) : null)
	if (def) {
		try {
			const c = engineCard({...deckCard, def}, content)
			return {name: c.name.replace(/\+$/, ''), type: c.type || 'attack', energy: def.energy ?? '', description: c.description || '', unplayable: def.kind === 'curse' && def.energy === null, gen: true, def, rarity: def.rarity}
		} catch {
			return {name: def.name, type: def.kind === 'curse' ? 'curse' : def.type ?? 'skill', energy: def.energy ?? '', description: rulesText(def), unplayable: def.kind === 'curse', gen: true, def, rarity: def.rarity}
		}
	}
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
export function cardEl(deckCard, {count = 1, onClick, selected = false, size = '', content, tag = '', extra = null} = {}) {
	const f = cardFacts(deckCard, content)
	const icon = f.gen ? defIcon(f.def) : iconFor(f.name, f.type)
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
		h('div', {class: 'ever-card__band', text: tag || (f.rarity === 'keepsake' ? 'keepsake' : f.type)}),
		h('div', {class: 'ever-card__cost', text: f.unplayable ? '' : String(f.energy)}),
		h('div', {class: 'ever-card__name', text: f.name}),
		h('div', {class: 'ever-card__art'}, icon ? h('img', {src: icon, alt: '', draggable: 'false'}) : null),
		h('p', {class: 'ever-card__text', text: f.description}),
		count > 1 ? h('span', {class: 'ever-count', text: `x${count}`}) : null,
		extra,
	)
	if (f.rarity && f.gen) el.dataset.rarity = f.rarity
	return el
}

/**
 * A face for any generated def that is not a deck card (item, token, sealed offer) or a
 * plain text offer (upgrade, removal). Same .ever-card markup, gold band for items.
 * @param {{name: string, band: string, text: string, flavor?: string, icon?: string, type?: string, onClick?: () => void, selected?: boolean, extra?: Node|null, size?: string}} o
 */
export function faceEl({name, band, text, flavor = '', icon = '', type = 'item', onClick, selected = false, extra = null, size = ''}) {
	return h(
		onClick ? 'button' : 'div',
		{
			class: ['ever-card', size && `ever-card--${size}`, selected && 'is-selected', onClick && 'is-playable'].filter(Boolean).join(' '),
			'data-type': type,
			type: onClick ? 'button' : null,
			'aria-label': `${name}, ${band}. ${text}`,
			onclick: onClick,
			style: onClick ? 'padding:0;font-family:inherit;color:inherit;text-align:inherit;' : null,
		},
		h('div', {class: 'ever-card__band', text: band}),
		h('div', {class: 'ever-card__name', text: name}),
		h('div', {class: 'ever-card__art'}, icon ? h('img', {src: icon, alt: '', draggable: 'false'}) : null),
		h('p', {class: 'ever-card__text', text: text}),
		flavor ? h('p', {class: 'ever-card__flavor', text: flavor}) : null,
		extra,
	)
}

/** Group a deck into [{card, count}] by id + upgraded, curses last, then by name. */
export function groupDeck(deck, content) {
	const m = new Map()
	for (const c of deck) {
		const k = c.id + (c.upgraded ? '+' : '')
		if (!m.has(k)) m.set(k, {card: c, count: 0, uids: []})
		const g = m.get(k)
		g.count += 1
		g.uids.push(c.uid)
	}
	const def = (c) => (String(c.id).startsWith('g:') ? getDef(content, c.id) : null)
	const rank = (g) => (g.card.id === 'Doubt' || def(g.card)?.kind === 'curse' ? 2 : def(g.card)?.rarity === 'keepsake' ? -1 : g.card.upgraded ? 0 : 1)
	const nm = (c) => def(c)?.name ?? c.id
	return [...m.values()].sort((a, b) => rank(a) - rank(b) || nm(a.card).localeCompare(nm(b.card)))
}
