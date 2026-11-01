// v2 screens: New book (seed field, Random, Today's page, live preview, share), the v2
// chapter page, the ledger ("What changed"), and the Last Page (choose the world change).
// Views only; core/run-flow.js decides what happens. Untrusted text (seeds, AI proposal
// titles) goes in as textContent. OWNER: systems engineer.
// Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later

import {COPY2} from '../copy-v2.js'
import {SETUP_LINES, THEME_NAMES, previewSeed} from '../rules/path.js'
import {dailySeed, formatSeed, parseSeedInput, randomSeed, shareCode} from '../rules/seed.js'
import {btn, h, isolateKeys} from './dom.js'

const screen = (page, extra = '') => h('div', {class: `ever-screen ${extra}`.trim()}, page)

/**
 * A new book (GDD_V2 19 "New book"). The preview updates as you type.
 * @param {{edition: number, lastSeed?: string, echo?: {name: string}|null, cleanReads: boolean, initial?: string,
 *   onBegin: (o: {code: string, edition: number}) => void, onBack: () => void, onCopy: (text: string) => void, onCleanReads: (on: boolean) => void,
 *   beginLabel?: string}} o
 */
export function newBookScreen({edition, echo = null, cleanReads, initial = '', onBegin, onBack, onCopy, onCleanReads, beginLabel = COPY2.newBook.begin}) {
	const input = isolateKeys(h('input', {class: 'ever-input', id: 'ever-seed', type: 'text', maxlength: 32, autocomplete: 'off', spellcheck: 'false', placeholder: COPY2.newBook.placeholder, value: initial, 'data-testid': 'seed-input'}))
	const preview = h('div', {class: 'ever-newbook__preview', 'aria-live': 'polite'})
	const note = h('p', {class: 'ever-muted', style: 'margin:6px 0 0;font-size:var(--ever-fs-sm)'})
	let state = {code: '', edition, random: true}
	const show = (code, word = null, from = null) => {
		const pv = previewSeed(code)
		const [p, s, sh] = pv.themes.map((t) => THEME_NAMES[t])
		preview.replaceChildren(
			h('p', {class: 'ever-newbook__code', text: `${COPY2.newBook.seed} ${formatSeed(code)}`}),
			word ? h('p', {class: 'ever-muted', text: COPY2.newBook.word(word, formatSeed(code))}) : null,
			h('p', {text: COPY2.newBook.keepsake(pv.keepsake)}),
			h('p', {text: COPY2.newBook.themes(p, s, sh)}),
			h('p', {class: 'ever-muted', text: COPY2.newBook.pages(pv.L, pv.minutes)}),
		)
		note.replaceChildren()
		if (from !== null && from !== edition) {
			note.append(
				h('span', {text: from < edition ? COPY2.newBook.shared(from) : COPY2.newBook.sharedGone(from, edition)}),
				' ',
				from < edition ? btn(`Read edition ${from}`, () => ((state.edition = from), note.replaceChildren(h('span', {text: COPY2.cover.edition(from)}))), 'ever-btn--quiet') : null,
				from < edition ? btn("Use today's Ashbrook", () => ((state.edition = edition), note.replaceChildren(h('span', {text: COPY2.cover.edition(edition)}))), 'ever-btn--quiet') : null,
			)
		}
	}
	const update = () => {
		const r = parseSeedInput(input.value)
		if (r.ok) {
			state = {code: r.code, edition, random: false}
			show(r.code, r.word, r.edition)
			begin.disabled = false
		} else if (r.empty) {
			state = {code: randomSeed(), edition, random: true}
			show(state.code)
			begin.disabled = false
		} else {
			preview.replaceChildren(h('p', {class: 'ever-error', text: COPY2.newBook.bad}))
			begin.disabled = true
		}
	}
	input.addEventListener('input', update)
	input.addEventListener('keydown', (e) => e.key === 'Enter' && !begin.disabled && begin.click())
	const begin = btn(beginLabel, () => onBegin({code: state.code, edition: state.edition}), 'ever-btn--primary', {'data-testid': 'begin'})
	const random = btn(COPY2.newBook.random, () => {
		input.value = formatSeed(randomSeed())
		update()
	})
	const today = btn(COPY2.newBook.today, () => {
		input.value = formatSeed(dailySeed())
		update()
	})
	const copy = btn(COPY2.newBook.copy, () => onCopy(shareCode(state.edition, state.code)), 'ever-btn--quiet')
	const clean = h('input', {type: 'checkbox', id: 'ever-clean', ...(cleanReads ? {checked: true} : {})})
	clean.addEventListener('change', () => onCleanReads(clean.checked))
	const page = h(
		'section',
		{class: 'ever-page ever-form ever-newbook', 'aria-label': COPY2.newBook.title},
		h('h2', {text: COPY2.newBook.title}),
		h('label', {class: 'ever-label', for: 'ever-seed', text: COPY2.newBook.seed}),
		h('div', {class: 'ever-newbook__row'}, input, random, today),
		preview,
		note,
		echo && !cleanReads ? h('p', {class: 'ever-muted', style: 'font-size:var(--ever-fs-sm)', text: COPY2.newBook.echo(echo.name)}) : null,
		h('label', {class: 'ever-newbook__check', for: 'ever-clean'}, clean, h('span', {text: COPY2.newBook.clean})),
		h('div', {class: 'ever-panel__actions', style: 'margin-top:14px;justify-content:center'}, begin, copy, btn(COPY2.newBook.back, onBack, 'ever-btn--quiet')),
	)
	update()
	queueMicrotask(() => input.focus())
	return {el: screen(page), get state() {
		return state
	}}
}

/** Chapter page v2: themes, setup line, seed. Auto-advances after 4 s or on click / key. */
export function chapterScreenV2({book, onDone}) {
	let done = false
	const finish = () => {
		if (done) return
		done = true
		clearTimeout(timer)
		document.removeEventListener('keydown', onKey)
		el.firstChild.classList.add('is-turning')
		setTimeout(onDone, 380)
	}
	const onKey = (e) => {
		if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
			e.preventDefault()
			finish()
		}
	}
	const [p, s] = book.path.themes
	const page = h(
		'button',
		{class: 'ever-page ever-chapter', type: 'button', onclick: finish, 'aria-label': `${COPY2.chapter.kicker(book.bookNo)}. ${THEME_NAMES[p]} and ${THEME_NAMES[s]}.`},
		h('p', {class: 'ever-smallcaps ever-muted', text: COPY2.chapter.kicker(book.bookNo)}),
		h('h2', {class: 'ever-chapter__name', text: COPY2.chapter.themes(THEME_NAMES[p], THEME_NAMES[s])}),
		h('p', {class: 'ever-chapter__line', text: SETUP_LINES[p]}),
		h('p', {class: 'ever-page__stat', text: COPY2.chapter.seed(formatSeed(book.seed))}),
		h('p', {class: 'ever-page__stat', text: COPY2.chapter.turn}),
	)
	const el = screen(page)
	const timer = setTimeout(finish, 4000)
	document.addEventListener('keydown', onKey)
	return {el}
}

/** "What changed in Ashbrook" (GDD_V2 14.6). @param {{ledger: {title: string, book?: number, at?: string}[], onClose: () => void}} o */
export function ledgerModal({ledger, onClose}) {
	const list = ledger.length ? h('ul', {class: 'ever-run__contents'}, ...ledger.slice(0, 20).map((r) => h('li', {class: 'ever-run__page', text: COPY2.cover.ledgerRow(String(r.title ?? ''), r.book ?? '?', r.at ?? '')}))) : h('p', {text: COPY2.cover.ledgerEmpty})
	return h(
		'div',
		{class: 'ever-modal', onclick: (e) => e.target === e.currentTarget && onClose()},
		h('div', {class: 'ever-panel', role: 'dialog', 'aria-label': COPY2.cover.ledgerTitle}, h('h2', {class: 'ever-panel__title', text: COPY2.cover.ledgerTitle}), list, h('div', {class: 'ever-panel__actions'}, btn(COPY2.cover.close, onClose, 'ever-btn--primary'))),
	)
}

/**
 * The last page (GDD_V2 14.1, 19). Proposals arrive async; one choice or "keep it".
 * @param {{load: () => Promise<{proposals: {title: string, kind: string, summary: string, icon?: string}[], line: string|null}>,
 *   showFine: boolean, onSend: (index: number, setStatus: (t: string, link?: string|null) => void) => Promise<void>,
 *   onKeep: () => void, onNext: () => void, canSend?: boolean, note?: string}} o
 */
export function lastPageScreen({load, showFine, onSend, onKeep, onNext, canSend = true, note = ''}) {
	const list = h('div', {class: 'ever-last__list'}, h('p', {class: 'ever-thinking', text: 'Ashbrook thinks it over...'}))
	const status = h('p', {class: 'ever-last__status', role: 'status', 'aria-live': 'polite'})
	const lineEl = h('p', {class: 'ever-muted'})
	let chosen = -1
	let sent = false
	const send = btn(COPY2.last.send, async () => {
		if (chosen < 0 || sent) return
		sent = true
		send.disabled = keep.disabled = true
		status.textContent = COPY2.last.status.sending
		await onSend(chosen, setStatus)
		next.hidden = false
		next.focus()
	}, 'ever-btn--primary', {disabled: true, 'data-testid': 'send-world'})
	const keep = btn(COPY2.last.keep, () => {
		if (sent) return
		sent = true
		send.disabled = keep.disabled = true
		status.textContent = COPY2.last.status.kept
		onKeep()
		next.hidden = false
		next.focus()
	}, '', {'data-testid': 'keep-book'})
	const next = btn(COPY2.last.next, onNext, 'ever-btn--primary', {hidden: true, 'data-testid': 'last-next'})
	const linkSlot = h('span', {})
	function setStatus(t, link = null) {
		status.textContent = t
		linkSlot.replaceChildren(link ? h('a', {href: link, target: '_blank', rel: 'noopener', text: COPY2.last.see}) : '')
	}
	const page = h(
		'section',
		{class: 'ever-page ever-last', role: 'dialog', 'aria-label': COPY2.last.heading},
		h('h2', {text: COPY2.last.heading}),
		h('p', {text: COPY2.last.body}),
		lineEl,
		list,
		note ? h('p', {class: 'ever-muted', text: note}) : null,
		showFine ? h('p', {class: 'ever-last__fine', text: COPY2.last.fine}) : null,
		h('div', {class: 'ever-panel__actions'}, canSend ? send : null, keep, next),
		status,
		linkSlot,
	)
	load().then(({proposals, line}) => {
		lineEl.textContent = line ?? ''
		if (!proposals.length) {
			list.replaceChildren(h('p', {text: COPY2.last.allUsed}))
			send.hidden = true
			return
		}
		const paint = () =>
			list.replaceChildren(
				...proposals.map((p, i) =>
					h(
						'button',
						{class: `ever-last__opt${chosen === i ? ' is-selected' : ''}`, type: 'button', disabled: sent ? true : null, onclick: () => ((chosen = i), (send.disabled = !canSend), paint())},
						p.icon ? h('img', {src: p.icon, alt: ''}) : h('span', {}),
						h('span', {class: 'ever-last__kind', text: p.kind}),
						h('span', {class: 'ever-last__title', text: p.title}),
						h('span', {text: p.summary}),
					),
				),
			)
		paint()
	})
	return {el: screen(page), setStatus}
}
