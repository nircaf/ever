// Card faces for the combat hand (and anyone else who wants them, e.g. the deck screen).
// Markup follows style.css: .ever-card[data-type] > __band, __cost, __name, __art, __text.
// Card art is a low-poly icon from the shared kit, rendered once per card name to a PNG
// data URL and cached (ART_BIBLE 8).
// OWNER: combat engineer.
// Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later

import {createIconRenderer, makeCardIcon} from '../shared/style.js'

const art = new Map()
let renderer = null
let disposeTimer = 0
let broken = false

/** PNG data URL for a card's icon, or '' if WebGL is unavailable. Cached per name. */
export function cardArt(name, type = 'attack') {
	const key = `${name}|${type}`
	if (art.has(key)) return art.get(key)
	let url = ''
	if (!broken) {
		try {
			renderer ??= createIconRenderer({size: 160})
			url = renderer.render(makeCardIcon(name, type))
		} catch (e) {
			broken = true
			console.warn('[combat] card art unavailable', e)
		}
	}
	art.set(key, url)
	// The icon renderer holds one extra WebGL context: let it go once a batch is done.
	clearTimeout(disposeTimer)
	disposeTimer = setTimeout(() => {
		renderer?.dispose()
		renderer = null
	}, 1500)
	return url
}

/** Render art for several cards up front (call at combat start, before the deal animation). */
export function warmCardArt(list) {
	for (const c of list) cardArt(c.name, c.type)
}

const TYPE_WORD = {attack: 'Attack', skill: 'Skill', power: 'Power', curse: 'Curse', status: 'Status'}

/**
 * Build one card element. `card` is a CombatView hand entry (name WITHOUT '+').
 * @param {{id?: string, name: string, type: string, energy: number, upgraded?: boolean,
 *   unplayable?: boolean, playable?: boolean, description: string}} card
 * @param {{key?: string, tag?: string}} [opts]
 */
export function cardElement(card, {key, tag = 'button'} = {}) {
	const el = document.createElement(tag)
	if (tag === 'button') el.type = 'button'
	el.className = 'ever-card cbt-card'
	el.dataset.type = card.type in TYPE_WORD ? card.type : 'status'
	if (card.id) el.dataset.id = card.id
	el.classList.toggle('is-upgraded', Boolean(card.upgraded))
	el.classList.toggle('is-unplayable', Boolean(card.unplayable))
	el.classList.toggle('is-long', String(card.description).length > 48)
	const part = (cls, text, t = 'span') => {
		const p = document.createElement(t)
		p.className = cls
		if (text !== undefined) p.textContent = text
		el.append(p)
		return p
	}
	part('ever-card__band', TYPE_WORD[card.type] ?? card.type)
	part('ever-card__cost', card.unplayable ? '' : String(card.energy))
	part('ever-card__name', card.name)
	const a = part('ever-card__art')
	const url = cardArt(card.name, card.type)
	if (url) {
		const img = document.createElement('img')
		img.alt = ''
		img.src = url
		img.draggable = false
		a.append(img)
	}
	part('ever-card__text', card.description)
	if (key) part('cbt-card__key', key)
	el.setAttribute(
		'aria-label',
		`${card.name}${card.upgraded ? ' plus' : ''}, ${TYPE_WORD[card.type] ?? card.type}, ${card.unplayable ? 'unplayable' : `costs ${card.energy}`}. ${card.description}`,
	)
	return el
}
