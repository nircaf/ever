// HUD: HP, deck, three token slots, hint line, interaction prompt, room chip and party
// roster (GDD 6 "HUD"). Pure view: game.js feeds it. OWNER: systems engineer.
// Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later

import {TOKEN_KINDS} from '../contracts.js'
import {COPY} from '../copy.js'
import {h} from './dom.js'
import {iconFor} from './cards.js'

/**
 * @param {HTMLElement} root
 * @param {{onDeck: () => void, onPrompt: () => void, onCopyCode: (code: string) => void, onLeave: () => void}} cb
 */
export function createHud(root, cb) {
	const hpText = h('span', {text: ''})
	const hpPill = h('span', {class: 'ever-pill ever-pill--hp'}, h('span', {class: 'ever-pill__dot'}), hpText)
	const deckText = h('span', {text: ''})
	const deckPill = h('button', {class: 'ever-pill', type: 'button', title: COPY.hud.deckTip, onclick: cb.onDeck}, h('span', {class: 'ever-pill__dot'}), deckText)
	// Curses (GDD 3.5): shown only while the deck holds at least one Doubt.
	const doubtText = h('span', {text: ''})
	const doubtPill = h('span', {class: 'ever-pill ever-pill--doubt', title: COPY.hud.doubtTip, hidden: true}, h('span', {class: 'ever-pill__dot'}), doubtText)
	const slots = TOKEN_KINDS.map((k) => {
		const el = h('span', {class: `ever-token ever-token--${k}`, 'data-kind': k, role: 'img', 'aria-label': `${COPY.hud.tokenName[k]} slot, empty`})
		// tap (phones) toggles the tip for 3 s; hover and focus show it via CSS
		el.addEventListener('click', () => {
			if (!el.classList.contains('is-full')) return
			el.classList.add('is-tip')
			setTimeout(() => el.classList.remove('is-tip'), 3000)
		})
		return el
	})
	const tokens = h('span', {class: 'ever-tokens', 'aria-label': COPY.hud.tokens}, ...slots)
	const bar = h('div', {class: 'ever-hud'}, hpPill, deckPill, doubtPill, tokens)

	const hint = h('div', {class: 'ever-hint', hidden: true})
	const prompt = h('button', {class: 'ever-prompt', type: 'button', hidden: true, onclick: () => cb.onPrompt()})
	const promptWrap = h('div', {class: 'ever-prompt-wrap'}, prompt)

	const roomChip = h('button', {class: 'ever-pill ever-chip', type: 'button', title: COPY.hud.roomCopied, onclick: () => cb.onCopyCode(roomChip.dataset.code || '')})
	const leave = h('button', {class: 'ever-btn ever-btn--quiet ever-party__leave', type: 'button', onclick: cb.onLeave, text: COPY.mp.leave})
	const list = h('ul', {class: 'ever-party__list'})
	const party = h('div', {class: 'ever-party', hidden: true}, roomChip, list, leave)

	const el = h('div', {class: 'ever-hudroot', hidden: true}, bar, hint, promptWrap, party)
	root.append(el)

	return {
		show() {
			el.hidden = false
		},
		hide() {
			el.hidden = true
		},
		update(book) {
			hpText.textContent = COPY.hud.hp(book.hp, book.maxHp)
			deckText.textContent = COPY.hud.deck(book.deck.length)
			const doubts = book.deck.filter((c) => c.id === 'Doubt').length
			doubtText.textContent = COPY.hud.doubts(doubts)
			doubtPill.hidden = doubts === 0
			for (const slot of slots) {
				const kind = slot.dataset.kind
				const full = book.tokens.includes(kind)
				slot.classList.toggle('is-full', full)
				if (full) slot.dataset.tip = COPY.hud.tokenTip[kind]
				else delete slot.dataset.tip
				slot.tabIndex = full ? 0 : -1
				slot.setAttribute('aria-label', `${COPY.hud.tokenName[kind]} ${full ? COPY.hud.tokenTip[kind] : 'slot, empty'}`)
				if (full) {
					if (!slot.firstChild) {
						const src = iconFor(kind, 'token')
						if (src) slot.append(h('img', {src, alt: ''}))
					}
				} else slot.replaceChildren()
			}
		},
		setHint(text) {
			hint.textContent = text || ''
			hint.hidden = !text
		},
		/** @param {string|null} label e.g. "Talk to Marcus" */
		setPrompt(label) {
			if (!label) {
				prompt.hidden = true
				return
			}
			prompt.replaceChildren(h('span', {class: 'ever-btn__key', text: 'E'}), h('span', {text: label}))
			prompt.hidden = false
		},
		/**
		 * @param {import('../contracts.js').RoomSnapshot|null} room
		 * @param {number|null} mySeat
		 */
		setRoom(room, mySeat) {
			if (!room) {
				party.hidden = true
				return
			}
			party.hidden = false
			roomChip.dataset.code = room.code
			roomChip.textContent = COPY.hud.room(room.code)
			list.replaceChildren(
				...room.seats.map((s) =>
					h(
						'li',
						{class: `ever-party__row${s.connected ? '' : ' is-away'}`, 'data-seat': s.seat},
						h('span', {class: 'ever-seat', 'data-seat': String(s.seat + 1)}),
						h('span', {text: COPY.hud.partyRow(s.seat === mySeat ? `${s.name} (${COPY.mp.youAre.toLowerCase()})` : s.name, s.hp, s.maxHp)}),
					),
				),
			)
		},
	}
}
