// EVER exploration UI: HUD, hint strip, interact prompt, station panels, Marcus dialogue,
// anvil/well pickers, deck viewer, party list and toasts. DOM over the canvas, styled only
// with shared/style.css classes. OWNER: world engineer.
//
// Rules: every deck change goes through store.dispatch(BookAction) (solo: local rules,
// co-op: the room). Untrusted text (names, AI replies) is set with textContent only.
//
// Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later

import {EV, MSG, CURSE_ID, FREE_TEXT_MAX} from '../core/contracts.js'
import {engineCard} from '../combat/rules/index.js'
import {iconUrl} from './card-art.js'
import {
	FREE_TEXT,
	deckSummary,
	dialogueReduce,
	dialogueStart,
	effectToasts,
	errorText,
	freeTextAllowed,
	groupDeck,
	hintFor,
	partyRow,
	pickerPanel,
	promptFor,
	proposeFreeText,
	stationPanel,
	tokenSlots,
	trustLabel,
} from './guide.js'

/** Tiny element helper. Text goes in via textContent, never innerHTML. */
function h(tag, props = {}, ...kids) {
	const el = document.createElement(tag)
	for (const [k, v] of Object.entries(props)) {
		if (v == null || v === false) continue
		if (k === 'class') el.className = v
		else if (k === 'text') el.textContent = v
		else if (k === 'style') el.style.cssText = v
		else if (k.startsWith('on')) el.addEventListener(k.slice(2), v)
		else el.setAttribute(k, v === true ? '' : String(v))
	}
	for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid)
	return el
}

/** Card face info from the engine (name/type/cost/text), with a safe fallback. */
export function cardInfo(id, upgraded) {
	try {
		const c = engineCard({id, upgraded})
		return {name: id, type: c.type || 'attack', energy: c.energy ?? 0, description: c.description || ''}
	} catch {
		return {name: id, type: id === CURSE_ID ? 'curse' : 'attack', energy: 0, description: ''}
	}
}

/** One .ever-card. `onPick` makes it a button. */
export function cardEl({id, upgraded = false}, {count = 0, onPick = null, size = ''} = {}) {
	const info = cardInfo(id, upgraded)
	const unplayable = id === CURSE_ID
	const art = iconUrl(id, info.type)
	const el = h(
		'div',
		{
			class: ['ever-card', size && `ever-card--${size}`, upgraded && 'is-upgraded', unplayable && 'is-unplayable', onPick && 'is-playable'].filter(Boolean).join(' '),
			'data-type': info.type,
			role: onPick ? 'button' : null,
			tabindex: onPick ? 0 : null,
			'aria-label': `${id}${upgraded ? '+' : ''}. ${info.description}`,
		},
		h('div', {class: 'ever-card__band', text: info.type}),
		h('div', {class: 'ever-card__cost', text: String(info.energy)}),
		h('div', {class: 'ever-card__name', text: id}),
		h('div', {class: 'ever-card__art'}, art ? h('img', {src: art, alt: ''}) : null),
		h('p', {class: 'ever-card__text', text: info.description}),
		count > 1 ? h('span', {class: 'ever-count', text: `x${count}`}) : null,
	)
	if (onPick) {
		el.addEventListener('click', onPick)
		el.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault()
				onPick()
			}
		})
	}
	return el
}

const BTN = {primary: 'ever-btn ever-btn--primary', secondary: 'ever-btn', doubt: 'ever-btn ever-btn--doubt', quiet: 'ever-btn ever-btn--quiet'}

/**
 * @param {{bus: any, getStore: () => any, bridge: any, getNet: () => any, getSeat: () => number|null,
 *   onFight: () => void, onStepBack: () => void, onInteract: (station: string) => void,
 *   renderToasts?: boolean}} deps
 */
export function createWorldUi(deps) {
	const {bus, getStore, bridge, getNet, getSeat} = deps
	const offs = []

	// ---- layout ----------------------------------------------------------------------
	const hpBar = h('i')
	const hpText = h('span', {text: 'HP 50/50'})
	const hpPill = h('div', {class: 'ever-pill ever-pill--hp', title: 'Your health. It carries into the fight.'}, h('span', {class: 'ever-pill__dot'}), hpText, h('span', {class: 'ever-bar'}, hpBar))
	const deckText = h('span', {text: 'Deck 10'})
	const deckPill = h('button', {class: 'ever-pill', type: 'button', title: 'Your deck. Press Tab to look.', onclick: () => toggleDeck()}, h('span', {class: 'ever-pill__dot'}), deckText)
	const doubtText = h('span', {text: ''})
	const doubtPill = h('div', {class: 'ever-pill', title: 'Doubt: at the end of your turn, lose 2 HP for each Doubt in your hand.', hidden: true}, h('span', {class: 'ever-pill__dot', style: 'background: var(--ever-doubt)'}), doubtText)
	const tokenEls = {}
	const tokenWrap = h('span', {class: 'ever-tokens'})
	for (const s of tokenSlots(null)) {
		tokenEls[s.kind] = h('span', {class: `ever-token ever-token--${s.kind}`, title: s.tip, 'aria-label': s.tip})
		tokenWrap.append(tokenEls[s.kind])
	}
	const tokenPill = h('div', {class: 'ever-pill', title: 'Tokens are spent when the fight starts.'}, h('span', {text: 'Tokens'}), tokenWrap)
	const hud = h('div', {class: 'ever-hud'}, hpPill, deckPill, tokenPill, doubtPill)
	const hint = h('div', {class: 'ever-hint', hidden: true})
	const promptKey = h('span', {class: 'ever-btn__key', text: 'E'})
	const promptText = h('span')
	const prompt = h('button', {
		class: 'ever-prompt',
		type: 'button',
		hidden: true,
		style: 'position:absolute;left:50%;transform:translateX(-50%);bottom:calc(max(16px, env(safe-area-inset-bottom)) + 64px);border:0;cursor:pointer;font:inherit;min-height:44px',
		onclick: () => range && deps.onInteract(range),
	}, promptKey, promptText)
	const roomChip = h('button', {class: 'ever-pill ever-chip', type: 'button', title: 'Click to copy', onclick: copyCode})
	const partyList = h('ul', {class: 'ever-party__list'})
	const party = h('div', {class: 'ever-party', hidden: true}, roomChip, partyList)
	const tags = h('div', {style: 'position:absolute;inset:0;pointer-events:none;overflow:hidden'})
	const toasts = h('div', {class: 'ever-toasts', 'aria-live': 'polite'})
	const panelHost = h('div', {style: 'display:contents'})
	const root = h('div', {class: 'ever-layer ever-ui', id: 'world-ui', hidden: true, style: 'padding:0'}, tags, hud, hint, party, prompt, panelHost, toasts)
	document.body.append(root)

	// ---- state -----------------------------------------------------------------------
	let book = null
	let room = null
	let range = null
	let panel = null // {kind: 'station'|'gate'|'dialogue'|'deck'|'picker', el, station}
	let picker = null // overlay above dialogue
	let dlg = null // {view, busy, freeOpen}
	const ai = {on: false, disabled: false, warned: false, signedIn: false, email: '', checked: false}

	const store = () => getStore()
	const toast = (text, tone = 'good') => text && bus.emit(EV.TOAST, {text, tone})

	if (deps.renderToasts !== false) {
		offs.push(
			bus.on(EV.TOAST, ({text, tone} = {}) => {
				if (!text) return
				const t = h('div', {class: `ever-toast${tone ? ' ever-toast--' + tone : ''}`, text})
				toasts.append(t)
				while (toasts.children.length > 4) toasts.firstChild.remove()
				setTimeout(() => t.remove(), 2400)
			}),
		)
	}

	async function checkAi() {
		if (!bridge?.enabled || ai.checked) return
		ai.checked = true
		try {
			const s = await bridge.status()
			ai.signedIn = !!s.signedIn
			ai.email = s.email || ''
			ai.on = !!(s.signedIn && s.planUse)
		} catch {
			ai.on = false
		}
		if (dlg) renderDialogue()
	}

	// ---- dispatch --------------------------------------------------------------------
	/** Send a BookAction; toast the effects; returns the BookResult (or null). */
	async function act(a) {
		const s = store()
		if (!s) return null
		let r
		try {
			r = await s.dispatch(a)
		} catch {
			return null
		}
		if (!r) return null
		if (!r.ok) {
			toast(errorText(r.error), 'bad')
			return r
		}
		for (const t of effectToasts(r.effects)) toast(t.text, t.tone)
		if (r.book) syncBook(r.book)
		return r
	}

	// ---- HUD -------------------------------------------------------------------------
	function syncBook(b) {
		if (!b) return
		book = b
		const pct = Math.max(0, Math.min(100, (b.hp / Math.max(1, b.maxHp)) * 100))
		hpText.textContent = `HP ${b.hp}/${b.maxHp}`
		hpBar.style.setProperty('--ever-fill', pct + '%')
		const d = deckSummary(b)
		deckText.textContent = `Deck ${d.count}`
		doubtPill.hidden = d.doubts === 0
		doubtText.textContent = d.doubts === 1 ? 'Doubt' : `Doubt x${d.doubts}`
		for (const s of tokenSlots(b)) {
			const el = tokenEls[s.kind]
			el.classList.toggle('is-full', s.full)
			if (s.full && !el.firstChild) {
				const url = iconUrl(s.kind, 'token')
				if (url) el.append(h('img', {src: url, alt: ''}))
			} else if (!s.full) el.replaceChildren()
		}
		refreshHint()
		refreshPrompt()
		// re-render live panels so "used" states and trust labels follow the book
		if (panel?.kind === 'station') openStation(panel.station, {refresh: true})
		if (panel?.kind === 'deck') renderDeck()
		if (dlg) renderDialogue()
	}

	function refreshHint() {
		const t = hintFor(book)
		hint.hidden = !t || !!panel // GDD/Art: hide the hint while a panel or dialogue is open
		if (t) hint.textContent = t
	}

	function refreshPrompt() {
		const label = range && !panel ? promptFor(range, book) : null
		// The gate shows its own panel, not an "E" prompt.
		prompt.hidden = !label || range === 'gate'
		if (label) promptText.textContent = label
	}

	/** Player entered/left a station radius. Gate opens its panel on entry (GDD 5). */
	function setRange(station) {
		if (station === range) return
		const prev = range
		range = station
		if (prev === 'gate') {
			if (panel?.kind === 'gate') closePanel()
			if (getNet()) getNet().send(MSG.GATE, {ready: false})
		}
		if (station === 'gate' && !panel) openStation('gate')
		refreshPrompt()
	}

	// ---- panels ----------------------------------------------------------------------
	function closePanel() {
		if (picker) {
			picker.remove()
			picker = null
			return
		}
		panel?.el.remove()
		panel = null
		dlg = null
		refreshHint()
		refreshPrompt()
	}

	function closeAll() {
		picker?.remove()
		picker = null
		panel?.el.remove()
		panel = null
		dlg = null
		refreshHint()
		refreshPrompt()
	}

	function buttonsEl(buttons, onDo) {
		return h(
			'div',
			{class: 'ever-panel__actions'},
			buttons.map((b) => h('button', {class: BTN[b.kind || 'secondary'], type: 'button', disabled: b.disabled, onclick: () => onDo(b.do)}, b.key ? h('span', {class: 'ever-btn__key', text: b.key}) : null, b.label)),
		)
	}

	async function runDo(d, station) {
		if (!d) return
		if (d.close) return closePanel()
		if (d.fight) {
			closeAll()
			return deps.onFight()
		}
		if (d.stepBack) {
			closeAll()
			return deps.onStepBack()
		}
		if ('ready' in d) {
			getNet()?.send(MSG.GATE, {ready: d.ready})
			return
		}
		if (d.picker) return openPicker(d.picker)
		if (d.act) {
			const r = await act(d.act)
			if (r?.ok) {
				if (picker) {
					picker.remove()
					picker = null
				}
				if (dlg) {
					dlg.view = dialogueReduce(dlg.view, r.effects)
					renderDialogue()
				} else if (panel?.kind === 'station') openStation(station, {refresh: true})
			}
		}
	}

	function openStation(station, {refresh = false} = {}) {
		if (!book) return
		if (station === 'marcus') return openMarcus()
		const coop = !!getNet()
		const p = stationPanel(station, book, {coop, room, seat: getSeat()})
		if (!p) {
			if (refresh) closeAll()
			return
		}
		const body = [
			p.title ? h('h2', {class: 'ever-panel__title', text: p.title}) : null,
			h('p', {class: p.prompt ? 'ever-panel__text ever-display' : 'ever-panel__text', text: p.text}),
			p.small ? h('p', {class: 'ever-muted', style: 'font-size:14px;margin:-6px 0 14px', text: p.small}) : null,
			p.cards?.length ? h('div', {style: 'display:flex;flex-wrap:wrap;gap:12px;justify-content:center;margin:4px 0 16px'}, p.cards.map((c) => cardEl(c, {onPick: () => runDo(c.do, station)}))) : null,
			buttonsEl(p.buttons, (d) => runDo(d, station)),
		]
		let el
		if (p.prompt) {
			// gate: a bottom card, no scrim; walking out of the circle closes it
			el = h('div', {class: 'ever-panel', role: 'dialog', 'aria-label': p.text, style: 'position:absolute;left:50%;transform:translateX(-50%);bottom:calc(max(16px, env(safe-area-inset-bottom)) + 56px);width:min(460px, calc(100% - 32px));text-align:center'}, body)
			el.querySelector('.ever-panel__actions').style.justifyContent = 'center'
		} else {
			el = h('div', {class: 'ever-modal', role: 'dialog', 'aria-label': p.title || p.text, onclick: (e) => e.target === el && closePanel()}, h('div', {class: 'ever-panel'}, body))
		}
		if (panel && refresh && panel.station === station) panel.el.replaceWith(el)
		else {
			closeAll()
			panelHost.append(el)
		}
		panel = {kind: p.prompt ? 'gate' : 'station', el, station}
		refreshHint()
		refreshPrompt()
		if (!refresh) el.querySelector('button:not([disabled]), [role=button]')?.focus({preventScroll: true})
	}

	function openPicker(purpose) {
		if (!book) return
		const p = pickerPanel(purpose, book)
		const grid = h('div', {class: 'ever-deck-grid', style: 'margin:8px 0 16px'}, p.pick.map((c) => cardEl(c, {onPick: () => runDo(c.do, p.station)})))
		const el = h(
			'div',
			{class: 'ever-modal', role: 'dialog', 'aria-label': p.title, style: 'z-index:20'},
			h('div', {class: 'ever-panel', style: 'width:min(720px, 100%)'}, h('h2', {class: 'ever-panel__title', text: p.title}), h('p', {class: 'ever-panel__text', text: p.text}), grid, buttonsEl(p.buttons, (d) => runDo(d, p.station))),
		)
		picker?.remove()
		picker = el
		panelHost.append(el)
		el.querySelector('[role=button]')?.focus({preventScroll: true})
	}

	// ---- deck viewer (GDD 3.6) ---------------------------------------------------------
	function renderDeck() {
		if (!book || panel?.kind !== 'deck') return
		const groups = groupDeck(book.deck)
		const grid = h('div', {class: 'ever-deck-grid', style: 'margin:8px 0 16px'}, groups.map((g) => h('div', {style: 'position:relative'}, cardEl(g, {count: g.count}))))
		panel.el.firstChild.replaceChildren(
			h('h2', {class: 'ever-panel__title', text: `Deck ${book.deck.length}`}),
			grid,
			h('div', {class: 'ever-panel__actions'}, h('button', {class: 'ever-btn', type: 'button', onclick: closePanel}, h('span', {class: 'ever-btn__key', text: 'Tab'}), 'Close')),
		)
	}
	function toggleDeck() {
		if (panel?.kind === 'deck') return closePanel()
		if (!book || (panel && panel.kind !== 'gate')) return
		closeAll()
		const el = h('div', {class: 'ever-modal', role: 'dialog', 'aria-label': 'Your deck', onclick: (e) => e.target === el && closePanel()}, h('div', {class: 'ever-panel', style: 'width:min(760px, 100%)'}))
		panelHost.append(el)
		panel = {kind: 'deck', el, station: null}
		renderDeck()
		refreshHint()
		refreshPrompt()
		el.querySelector('button')?.focus({preventScroll: true})
	}

	// ---- Marcus (GDD 2.3 - 2.5) --------------------------------------------------------
	async function openMarcus() {
		if (dlg) return
		closeAll()
		checkAi()
		const el = h('div', {class: 'ever-dialogue ever-panel', role: 'dialog', 'aria-label': 'Marcus Hale'})
		panelHost.append(el)
		panel = {kind: 'dialogue', el, station: 'marcus'}
		dlg = {view: dialogueStart(), busy: true, freeOpen: false, thinking: false, draft: ''}
		refreshHint()
		refreshPrompt()
		renderDialogue()
		const r = await act({type: 'marcus.talk'})
		if (!dlg) return
		dlg.busy = false
		if (r?.ok) dlg.view = dialogueReduce(dlg.view, r.effects)
		if (dlg.view.picker) openPicker(dlg.view.picker)
		renderDialogue()
	}

	async function chooseOption(id) {
		if (!dlg || dlg.busy) return
		dlg.busy = true
		renderDialogue()
		const r = await act({type: 'marcus.option', option: id})
		if (!dlg) return
		dlg.busy = false
		if (r?.ok) dlg.view = dialogueReduce(dlg.view, r.effects)
		renderDialogue()
		if (dlg.view.picker) openPicker(dlg.view.picker)
	}

	async function submitFree(text) {
		if (!dlg || dlg.busy || !book) return
		dlg.busy = true
		dlg.thinking = true
		renderDialogue()
		const p = await proposeFreeText({book, text, bridge, ai})
		if (p.toast) toast(p.toast, 'bad')
		if (p.warned) ai.warned = true
		if (p.disableAi) ai.disabled = true
		if (p.recheck) {
			ai.checked = false
			checkAi()
		}
		if (!dlg) return
		const r = p.action.text ? await act(p.action) : null
		if (!dlg) return
		dlg.busy = false
		dlg.thinking = false
		if (r?.ok) {
			dlg.view = dialogueReduce(dlg.view, r.effects)
			dlg.draft = ''
		}
		renderDialogue()
		if (dlg.view.picker) openPicker(dlg.view.picker)
		else dlg.freeOpen && panel?.el.querySelector('input')?.focus({preventScroll: true})
	}

	function renderDialogue() {
		if (!dlg || panel?.kind !== 'dialogue') return
		const v = dlg.view
		const el = panel.el
		const input = el.querySelector('input')
		if (input) dlg.draft = input.value
		const speaker = h('div', {class: 'ever-dialogue__speaker'}, 'Marcus Hale', h('span', {class: 'ever-pill ever-pill--trust'}, h('span', {class: 'ever-pill__dot'}), trustLabel(book)))
		const lineText = dlg.thinking ? null : v.lines.join(' ')
		const line = dlg.thinking
			? h('p', {class: 'ever-dialogue__line ever-thinking', text: FREE_TEXT.thinking})
			: h('p', {class: 'ever-dialogue__line', text: lineText || (dlg.busy ? '' : '...')})
		const note = v.note ? h('p', {class: 'ever-dialogue__line', style: 'margin-top:-8px;font-size:14px'}, h('em', {text: v.note})) : null
		const opts = v.options.length
			? h(
					'ol',
					{class: 'ever-dialogue__options'},
					v.options.slice(0, 4).map((o, i) => h('li', {}, h('button', {class: 'ever-btn ever-btn--block', type: 'button', disabled: dlg.busy, onclick: () => chooseOption(o.id)}, h('span', {class: 'ever-btn__key', text: String(i + 1)}), o.text))),
				)
			: null
		const canFree = freeTextAllowed(book) && !v.closed
		const row = h(
			'div',
			{class: 'ever-panel__actions'},
			canFree && !dlg.freeOpen ? h('button', {class: 'ever-btn ever-btn--quiet', type: 'button', disabled: dlg.busy, onclick: () => ((dlg.freeOpen = true), renderDialogue(), panel.el.querySelector('input')?.focus())}, FREE_TEXT.open) : null,
			h('button', {class: 'ever-btn', type: 'button', onclick: closePanel}, h('span', {class: 'ever-btn__key', text: 'Esc'}), 'Leave'),
		)
		let free = null
		if (canFree && dlg.freeOpen) {
			const inp = h('input', {class: 'ever-input', type: 'text', maxlength: FREE_TEXT_MAX, placeholder: FREE_TEXT.placeholder, 'aria-label': FREE_TEXT.open, autocomplete: 'off', disabled: dlg.busy})
			inp.value = dlg.draft || ''
			const form = h(
				'form',
				{class: 'ever-dialogue__free', onsubmit: (e) => (e.preventDefault(), submitFree(inp.value))},
				inp,
				h('button', {class: 'ever-btn ever-btn--primary', type: 'submit', disabled: dlg.busy}, FREE_TEXT.button),
				h('button', {class: 'ever-btn ever-btn--quiet', type: 'button', onclick: () => ((dlg.freeOpen = false), (dlg.draft = ''), renderDialogue())}, FREE_TEXT.back),
			)
			const aiNote = bridge?.enabled
				? ai.on && !ai.disabled
					? h('p', {class: 'ever-dialogue__note', text: FREE_TEXT.ai})
					: h('p', {class: 'ever-dialogue__note'}, FREE_TEXT.offline + ' ', !ai.signedIn && ai.checked ? h('button', {class: 'ever-btn ever-btn--quiet', type: 'button', style: 'min-height:0;padding:0 4px;font-size:12px', onclick: connectAi}, FREE_TEXT.connect) : null)
				: h('p', {class: 'ever-dialogue__note', text: FREE_TEXT.offline})
			free = h('div', {}, form, aiNote)
		}
		el.replaceChildren(speaker, h('div', {class: 'ever-dialogue__scroll'}, line, note, opts, free), row)
		if (dlg.freeOpen && document.activeElement === document.body) el.querySelector('input')?.focus({preventScroll: true})
	}

	async function connectAi() {
		try {
			await bridge.login()
		} catch {}
		// poll status for up to a minute while the user signs in
		for (let i = 0; i < 30 && !ai.on; i++) {
			await new Promise((r) => setTimeout(r, 2000))
			ai.checked = false
			await checkAi()
		}
	}

	// ---- co-op -----------------------------------------------------------------------
	function setRoom(r) {
		room = r
		party.hidden = !r
		if (!r) return
		roomChip.textContent = `Room ${r.code}`
		partyList.replaceChildren(
			...r.seats.map((s) => h('li', {class: `ever-party__row${s.connected ? '' : ' is-away'}`}, h('span', {class: 'ever-seat', 'data-seat': s.seat + 1}), h('span', {text: partyRow(s)}))),
		)
		if (panel?.kind === 'gate') openStation('gate', {refresh: true})
	}
	async function copyCode() {
		if (!room) return
		try {
			await navigator.clipboard.writeText(room.code)
			toast('Room code copied.')
		} catch {}
	}

	// ---- keyboard --------------------------------------------------------------------
	/** @returns {boolean} true if the UI used the key */
	function keydown(e) {
		const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
		if (e.key === 'Escape') {
			if (picker || panel) {
				closePanel()
				return true
			}
			return false
		}
		if (typing) return true // the input owns every other key
		if (e.key === 'Tab') {
			e.preventDefault()
			toggleDeck()
			return true
		}
		if (panel?.kind === 'dialogue' && !picker && /^[1-4]$/.test(e.key)) {
			const o = dlg?.view.options[Number(e.key) - 1]
			if (o) chooseOption(o.id)
			return true
		}
		if (panel?.kind === 'gate' && (e.key === 'f' || e.key === 'F') && !getNet()) {
			runDo({fight: true})
			return true
		}
		return !!panel && panel.kind !== 'gate'
	}

	return {
		root,
		tagLayer: tags,
		syncBook,
		setRoom,
		setRange,
		open: openStation,
		openPicker,
		close: closeAll,
		toggleDeck,
		keydown,
		/** true while a panel that should freeze walking is open (gate prompt does not) */
		blocksMovement: () => !!picker || (!!panel && panel.kind !== 'gate'),
		isOpen: () => !!panel || !!picker,
		setVisible(v) {
			root.hidden = !v
			if (!v) closeAll()
		},
		/** once per second: hint timer (6-minute gate hint) and lobby countdown */
		tick() {
			refreshHint()
			if (panel?.kind === 'gate' && room?.lobby?.startsAt) openStation('gate', {refresh: true})
		},
		dispose() {
			offs.forEach((f) => f())
			root.remove()
		},
	}
}
