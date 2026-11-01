// Book screens: cover (title + Solo / Host / Join), chapter page, chapter complete, the
// book closes, credits, host and join forms. Views only; game.js decides what happens.
// OWNER: systems engineer.
// Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later

import {NAME_MAX, ROOM_CODE_LENGTH, normalizeRoomCode} from '../contracts.js'
import {COPY} from '../copy.js'
import {btn, h, isolateKeys} from './dom.js'

const screen = (page, extra = '') => h('div', {class: `ever-screen ${extra}`.trim()}, page)

/**
 * Book cover. `mp` says whether the room server answered (buttons stay clickable either
 * way; an unreachable server explains itself when you try).
 * @param {{meta: {booksWritten: number, rememberedLine: string}, ai: any, onSolo: () => void, onHost: () => void, onJoin: () => void, onCredits: () => void}} o
 */
export function coverScreen({meta, ai, onSolo, onHost, onJoin, onCredits, top = null, below = null, soloLabel = COPY.begin}) {
	const aiLine = h('span', {class: 'ever-cover__ai'})
	const paintAi = () => {
		if (!ai.enabled) {
			aiLine.replaceChildren()
			return
		}
		const st = ai.state
		if (st.signedIn && st.planUse) aiLine.replaceChildren(h('span', {text: COPY.aiOn(st.email || 'signed in')}))
		else
			aiLine.replaceChildren(
				btn(st.connecting ? COPY.aiConnecting : COPY.aiConnect, () => ai.connect(), 'ever-btn--quiet', {disabled: st.connecting, 'data-testid': 'connect-ai'}),
			)
	}
	paintAi()
	const page = h(
		'section',
		{class: 'ever-page ever-cover', 'aria-label': COPY.title},
		h('h1', {class: 'ever-title', text: COPY.title}),
		h('p', {class: 'ever-display ever-cover__book', text: COPY.book(meta.booksWritten + 1)}),
		meta.rememberedLine ? h('p', {class: 'ever-page__quote', text: `“${meta.rememberedLine}”`}) : null,
		below, // v2: edition line ("Ashbrook, edition 14 · What changed")
		h(
			'div',
			{class: 'ever-cover__buttons'},
			top, // v2: "Continue Book N"
			btn(soloLabel, onSolo, top ? '' : 'ever-btn--primary', {autofocus: top ? null : true, 'data-testid': 'solo'}),
			btn(COPY.host, onHost, '', {'data-testid': 'host'}),
			btn(COPY.join, onJoin, '', {'data-testid': 'join'}),
		),
		h('p', {class: 'ever-page__stat ever-cover__foot'}, COPY.footer + ' ', h('a', {href: '#credits', onclick: (e) => (e.preventDefault(), onCredits())}, COPY.creditsLink), aiLine.childNodes.length ? ' ' : '', aiLine),
	)
	const el = screen(page, 'ever-screen--cover')
	return {el, paintAi}
}

/** Chapter page: auto-advances after 4 s or on click / key. @param {{onDone: () => void}} o */
export function chapterScreen({onDone}) {
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
	const page = h(
		'button',
		{class: 'ever-page ever-chapter', type: 'button', onclick: finish, 'aria-label': `${COPY.chapter.kicker}. ${COPY.chapter.name}. ${COPY.chapter.turn}`},
		h('p', {class: 'ever-smallcaps ever-muted', text: COPY.chapter.kicker}),
		h('h2', {class: 'ever-chapter__name', text: COPY.chapter.name}),
		h('p', {class: 'ever-chapter__line', text: COPY.chapter.line}),
		h('p', {class: 'ever-page__stat', text: COPY.chapter.turn}),
	)
	const el = screen(page)
	const timer = setTimeout(finish, 4000)
	document.addEventListener('keydown', onKey)
	return {el, dispose: () => (clearTimeout(timer), document.removeEventListener('keydown', onKey))}
}

/**
 * Chapter complete. Co-op: the "begin" button becomes a vote and shows the count.
 * @param {{bookNo: number, turns: number, hp: number, coop: boolean, onNew: () => void, onStay: () => void}} o
 */
export function winScreen({bookNo, turns, hp, coop, onNew, onStay, stat = null}) {
	const newBtn = btn(COPY.win.begin, () => {
		newBtn.disabled = true
		if (coop) newBtn.textContent = COPY.win.waiting
		onNew()
	}, 'ever-btn--primary', {'data-testid': 'new-book'})
	const page = h(
		'section',
		{class: 'ever-page', role: 'dialog', 'aria-label': COPY.win.heading},
		h('h2', {text: COPY.win.heading}),
		h('p', {text: COPY.win.body}),
		h('p', {class: 'ever-muted', text: COPY.win.second}),
		h('p', {class: 'ever-page__stat', text: stat ?? COPY.win.stat(bookNo, turns, hp)}),
		h('div', {class: 'ever-panel__actions'}, newBtn, btn(COPY.win.stay, onStay, '', {'data-testid': 'stay'})),
	)
	const el = screen(page)
	return {
		el,
		/** Co-op vote counter: "{v}/{m} ready for a new book". */
		setVotes(v, m, voted) {
			if (!coop) return
			newBtn.textContent = voted ? COPY.win.votes(v, m) : v > 0 ? COPY.win.votes(v, m) : COPY.win.begin
			newBtn.disabled = voted
		},
	}
}

/** The book closes. @param {{bookNo: number, turn: number, line: string, coop: boolean, onNew: () => void}} o */
export function deathScreen({bookNo, turn, line, coop, onNew, stat = null, extra = null, onAgain = null}) {
	const page = h(
		'section',
		{class: 'ever-page ever-page--dead', role: 'dialog', 'aria-label': COPY.death.heading},
		h('h2', {text: COPY.death.heading}),
		h('p', {text: COPY.death.body}),
		coop ? h('p', {class: 'ever-muted', text: COPY.death.coop}) : null,
		h('p', {class: 'ever-page__stat', text: stat ?? COPY.death.stat(bookNo, turn)}),
		line ? h('p', {class: 'ever-page__quote'}, COPY.death.remember + ' ', h('em', {text: line})) : null,
		extra, // v2: "The next book will carry an echo: {card}."
		h('div', {class: 'ever-panel__actions'}, btn(COPY.death.begin, onNew, 'ever-btn--primary', {autofocus: true, 'data-testid': 'new-book'}), onAgain ? btn('Read this seed again', onAgain, '', {'data-testid': 'again'}) : null),
	)
	return screen(page)
}

/** Credits panel (modal). @param {{onClose: () => void}} o */
export function creditsModal({onClose}) {
	return h(
		'div',
		{class: 'ever-modal', onclick: (e) => e.target === e.currentTarget && onClose()},
		h(
			'div',
			{class: 'ever-panel', role: 'dialog', 'aria-label': COPY.credits.title},
			h('h2', {class: 'ever-panel__title', text: COPY.credits.title}),
			...COPY.credits.lines.map((l) => h('p', {class: 'ever-panel__text', text: l})),
			h('p', {class: 'ever-panel__text'}, h('a', {href: 'https://github.com/oskarrough/slaytheweb', target: '_blank', rel: 'noopener', text: 'Slay the Web'})),
			h('div', {class: 'ever-panel__actions'}, btn(COPY.credits.close, onClose, 'ever-btn--primary')),
		),
	)
}

/**
 * Host form, then the code screen. `onHost(name)` returns a promise of {code} or throws a
 * string error key of COPY.mp.errors.
 * @param {{name: string, onHost: (name: string) => Promise<{code: string}>, onEnter: () => void, onBack: () => void, onCopy: (code: string) => void, errorText: (e: any) => string, cleanName: (s: string) => string}} o
 */
export function hostScreen({name, onHost, onEnter, onBack, onCopy, errorText, cleanName, extra = null}) {
	const input = isolateKeys(h('input', {class: 'ever-input', id: 'ever-host-name', type: 'text', maxlength: NAME_MAX, value: name, autocomplete: 'nickname'}))
	const err = h('p', {class: 'ever-error', role: 'alert', hidden: true})
	const go = btn(COPY.host, async () => {
		const n = cleanName(input.value)
		if (!n) return showErr(COPY.mp.errors.name)
		go.disabled = true
		go.textContent = COPY.mp.creating
		try {
			const {code} = await onHost(n)
			showCode(code)
		} catch (e) {
			go.disabled = false
			go.textContent = COPY.host
			showErr(errorText(e))
		}
	}, 'ever-btn--primary', {'data-testid': 'host-go'})
	const showErr = (t) => {
		err.textContent = t
		err.hidden = !t
	}
	const body = h('div', {})
	const page = h('section', {class: 'ever-page ever-form', 'aria-label': COPY.host}, h('h2', {text: COPY.host}), body)
	const form = () =>
		body.replaceChildren(
			h('label', {class: 'ever-label', for: 'ever-host-name', text: COPY.mp.hostName}),
			input,
			extra, // v2: the room's seed field
			err,
			h('div', {class: 'ever-panel__actions', style: 'margin-top:16px;justify-content:center'}, go, btn(COPY.mp.back, onBack, 'ever-btn--quiet')),
		)
	const showCode = (code) => {
		page.querySelector('h2').textContent = COPY.mp.hostTitle
		body.replaceChildren(
			h('p', {class: 'ever-code', 'data-testid': 'room-code', text: code}),
			h('p', {class: 'ever-muted', text: COPY.mp.hostShare}),
			h(
				'div',
				{class: 'ever-panel__actions', style: 'margin-top:16px;justify-content:center'},
				btn(COPY.mp.copy, () => onCopy(code)),
				btn(COPY.mp.enter, onEnter, 'ever-btn--primary', {autofocus: true, 'data-testid': 'enter'}),
			),
		)
	}
	form()
	queueMicrotask(() => input.select())
	return screen(page)
}

/**
 * Join form. `onJoin(code, name)` rejects with an error key / Error mapped by errorText.
 * @param {{name: string, onJoin: (code: string, name: string) => Promise<void>, onBack: () => void, errorText: (e: any) => string, cleanName: (s: string) => string}} o
 */
export function joinScreen({name, onJoin, onBack, errorText, cleanName}) {
	const code = isolateKeys(h('input', {class: 'ever-input ever-input--code', id: 'ever-join-code', type: 'text', maxlength: ROOM_CODE_LENGTH, autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', inputmode: 'text', placeholder: '_____', 'data-testid': 'code-input'}))
	const nm = isolateKeys(h('input', {class: 'ever-input', id: 'ever-join-name', type: 'text', maxlength: NAME_MAX, value: name, autocomplete: 'nickname'}))
	const err = h('p', {class: 'ever-error', role: 'alert', hidden: true})
	const showErr = (t) => {
		err.textContent = t
		err.hidden = !t
	}
	code.addEventListener('input', () => {
		code.value = normalizeRoomCode(code.value)
		showErr('')
	})
	const go = btn(COPY.mp.joinGo, async () => {
		const c = normalizeRoomCode(code.value)
		const n = cleanName(nm.value)
		if (c.length !== ROOM_CODE_LENGTH) return showErr(COPY.mp.errors.code)
		if (!n) return showErr(COPY.mp.errors.name)
		go.disabled = true
		go.textContent = COPY.mp.joining
		try {
			await onJoin(c, n)
		} catch (e) {
			go.disabled = false
			go.textContent = COPY.mp.joinGo
			showErr(errorText(e))
		}
	}, 'ever-btn--primary', {'data-testid': 'join-go'})
	const submitOnEnter = (e) => e.key === 'Enter' && go.click()
	code.addEventListener('keydown', submitOnEnter)
	nm.addEventListener('keydown', submitOnEnter)
	const page = h(
		'section',
		{class: 'ever-page ever-form', 'aria-label': COPY.mp.joinTitle},
		h('h2', {text: COPY.mp.joinTitle}),
		h('label', {class: 'ever-label', for: 'ever-join-code', text: COPY.mp.code}),
		code,
		h('label', {class: 'ever-label', for: 'ever-join-name', style: 'margin-top:12px', text: COPY.mp.name}),
		nm,
		err,
		h('div', {class: 'ever-panel__actions', style: 'margin-top:16px;justify-content:center'}, go, btn(COPY.mp.back, onBack, 'ever-btn--quiet')),
	)
	queueMicrotask(() => code.focus())
	return screen(page)
}
