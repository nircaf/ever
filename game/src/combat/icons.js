// Flat intent icons for the combat UI (sword = attack, shield = block, cloud = Weak).
// Tiny inline SVGs drawn with currentColor and the palette tokens from style.css, so they
// match the low-poly kit: straight facets, no strokes-as-outlines, no gradients.
// OWNER: combat engineer.
// Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later

const NS = 'http://www.w3.org/2000/svg'

/** Faceted polygons per icon: [fill css value, points]. viewBox 0 0 24 24. */
const SHAPES = {
	attack: [
		['var(--ever-paper)', '18,2 22,2 22,6 10,18 6,14'],
		['var(--ever-ember)', '6,14 10,18 8,20 4,16'],
		['var(--ever-gold)', '3,15 9,21 7,23 1,17'],
		['var(--ever-ink-soft, #6b6875)', '18,2 22,2 14,10 12,8'],
	],
	slam: [
		['var(--ever-ember)', '4,4 14,4 14,11 4,11'],
		['var(--ever-gold)', '14,5 20,5 20,10 14,10'],
		['var(--ever-paper)', '8,11 11,11 11,22 8,22'],
	],
	block: [
		['var(--ever-ward)', '12,2 21,5 20,13 12,22'],
		['var(--ever-slate)', '12,2 3,5 4,13 12,22'],
		['var(--ever-paper)', '12,6 16,8 12,16 8,8'],
	],
	weak: [
		['var(--ever-doubt)', '3,14 6,9 11,8 14,4 19,7 21,12 19,17 5,17'],
		['var(--ever-paper)', '6,19 9,19 8,22 5,22'],
		['var(--ever-paper)', '13,19 16,19 15,22 12,22'],
	],
}

/**
 * @param {'attack'|'slam'|'block'|'weak'} kind
 * @returns {SVGSVGElement}
 */
export function intentIcon(kind) {
	const svg = document.createElementNS(NS, 'svg')
	svg.setAttribute('viewBox', '0 0 24 24')
	svg.setAttribute('class', `cbt-icon cbt-icon--${kind}`)
	svg.setAttribute('aria-hidden', 'true')
	svg.setAttribute('focusable', 'false')
	for (const [fill, points] of SHAPES[kind] ?? SHAPES.attack) {
		const p = document.createElementNS(NS, 'polygon')
		p.setAttribute('points', points)
		p.setAttribute('style', `fill:${fill}`)
		svg.append(p)
	}
	return svg
}

/** Which icons an intent shows, in order (pure; tested). */
export function intentIconKinds(intent) {
	const kinds = []
	if (intent.damage > 0 || intent.step === 4) kinds.push(intent.step === 4 ? 'slam' : 'attack')
	if (intent.block > 0) kinds.push('block')
	if (intent.weak > 0) kinds.push('weak')
	return kinds
}
