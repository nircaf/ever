// Tiny DOM helpers for the core UI. Everything dynamic goes in as textContent, never
// innerHTML (names and AI replies are untrusted). OWNER: systems engineer.
// Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * h('button', {class: 'ever-btn', onclick: fn, 'data-x': 1}, 'Text', childEl)
 * @param {string} tag
 * @param {Record<string, any>} [props]
 * @param {...(Node|string|null|undefined|false)} kids
 * @returns {HTMLElement}
 */
export function h(tag, props = {}, ...kids) {
	const el = document.createElement(tag)
	for (const [k, v] of Object.entries(props || {})) {
		if (v === undefined || v === null || v === false) continue
		if (k === 'class') el.className = v
		else if (k === 'text') el.textContent = v
		else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v)
		else if (k === 'hidden') el.hidden = Boolean(v)
		else el.setAttribute(k, v === true ? '' : String(v))
	}
	for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid)
	return el
}

export const btn = (text, onclick, cls = '', props = {}) => h('button', {type: 'button', class: `ever-btn ${cls}`.trim(), onclick, ...props}, text)

/** Stop keys typed in a field from reaching the world's WASD handler on window. */
export function isolateKeys(el) {
	for (const t of ['keydown', 'keyup', 'keypress']) el.addEventListener(t, (e) => e.stopPropagation())
	return el
}

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
export const sleep = (ms) => new Promise((r) => setTimeout(r, reduced() ? Math.min(ms, 60) : ms))

/** Toasts (ART_BIBLE 9): slide in, stay 2.4 s. @param {HTMLElement} parent */
export function createToaster(parent) {
	const box = h('div', {class: 'ever-toasts', role: 'status', 'aria-live': 'polite'})
	parent.append(box)
	return (text, kind = '') => {
		if (!text) return
		const t = h('div', {class: `ever-toast ${kind ? 'ever-toast--' + kind : ''}`.trim(), text})
		box.prepend(t)
		while (box.children.length > 4) box.lastChild.remove()
		setTimeout(() => t.remove(), 2400)
	}
}
