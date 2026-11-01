// HUD: HP, deck, three token slots, hint line, interaction prompt, room chip and party
// roster (GDD 6 "HUD"). Pure view: game.js feeds it. OWNER: systems engineer.
// Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later

import {TOKEN_KINDS, BOOK_V2} from '../contracts.js'
import {COPY} from '../copy.js'
import {COPY2} from '../copy-v2.js'
import {getDef, rulesText} from '../../mechanics/index.js'
import {h} from './dom.js'
import {defIcon, iconFor} from './cards.js'

const ITEM_SLOTS = ['hand', 'body', 'charm']
const isCurse = (book, c) => c.id === 'Doubt' || getDef(book.content, c.id)?.kind === 'curse'

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
	// v2 (GDD_V2 19 HUD): page pill, item slots, marks, generated tokens.
	const pageText = h('span', {text: ''})
	const pagePill = h('button', {class: 'ever-pill ever-pill--page', type: 'button', title: COPY2.hud.pageTip, hidden: true, onclick: () => cb.onContents?.()}, h('span', {class: 'ever-pill__dot'}), pageText)
	const markText = h('span', {text: ''})
	const markPill = h('span', {class: 'ever-pill ever-pill--doubt', title: COPY2.hud.marksTip, hidden: true}, h('span', {class: 'ever-pill__dot'}), markText)
	const itemSlots = ITEM_SLOTS.map((slot) => {
		const el = h('span', {class: 'ever-token ever-item', 'data-slot': slot, role: 'img', tabindex: '0'})
		el.addEventListener('click', () => {
			el.classList.add('is-tip')
			setTimeout(() => el.classList.remove('is-tip'), 3000)
		})
		return el
	})
	const items = h('span', {class: 'ever-tokens ever-items', 'aria-label': 'Equipment', hidden: true}, ...itemSlots)
	const genTokens = h('span', {class: 'ever-tokens', hidden: true})
	const bar = h('div', {class: 'ever-hud'}, pagePill, hpPill, deckPill, doubtPill, markPill, tokens, genTokens, items)

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
			const v2 = book.v === BOOK_V2
			const doubts = v2 ? book.deck.filter((c) => isCurse(book, c)).length : book.deck.filter((c) => c.id === 'Doubt').length
			doubtText.textContent = v2 ? COPY2.hud.curses(doubts) : COPY.hud.doubts(doubts)
			doubtPill.title = v2 ? COPY2.hud.cursesTip : COPY.hud.doubtTip
			doubtPill.hidden = doubts === 0
			pagePill.hidden = !v2
			items.hidden = !v2
			markPill.hidden = !v2 || !book.marks
			if (v2) {
				pageText.textContent = COPY2.hud.page(Math.min(book.page + 1, book.path.L), book.path.L)
				markText.textContent = COPY2.hud.marks(book.marks)
				for (const el of itemSlots) {
					const slot = el.dataset.slot
					const id = (book.items ?? []).find((x) => getDef(book.content, x)?.slot === slot)
					const def = id ? getDef(book.content, id) : null
					el.classList.toggle('is-full', Boolean(def))
					const name = COPY2.hud.slotName[slot]
					const tip = def ? COPY2.hud.itemTip(def.name, name, rulesText(def)) + (def.bound ? ` ${COPY2.hud.bound}` : '') : COPY2.hud.itemEmpty(name)
					el.dataset.tip = tip
					el.setAttribute('aria-label', tip)
					if (el.dataset.item !== (id ?? '')) {
						el.dataset.item = id ?? ''
						const src = def ? defIcon(def) : ''
						el.replaceChildren(...(src ? [h('img', {src, alt: ''})] : []))
					}
				}
				const gen = (book.tokens ?? []).filter((t) => String(t).startsWith('g:'))
				genTokens.hidden = !gen.length
				genTokens.replaceChildren(
					...gen.map((id) => {
						const def = getDef(book.content, id)
						const src = def ? defIcon(def) : ''
						return h('span', {class: 'ever-token is-full', tabindex: '0', 'data-tip': def ? `${def.name}: ${rulesText(def)}` : '', 'aria-label': def?.name ?? 'Token'}, src ? h('img', {src, alt: ''}) : null)
					}),
				)
			}
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
			roomChip.textContent = room.seed ? COPY2.coop.chip(room.code, `${room.seed.slice(0, 4)}-${room.seed.slice(4)}`) : COPY.hud.room(room.code)
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
