// Station panels, Marcus's dialogue, deck picker and deck screen, gate prompts.
// The UI never edits the book: every change is store.dispatch(BookAction); what comes
// back (effects) is only shown. OWNER: systems engineer.
// Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later

import {FREE_TEXT_MAX, trustWord, upgradableCards} from '../contracts.js'
import {COPY} from '../copy.js'
import {marcusPanel} from '../rules/book.js'
import {btn, h, isolateKeys} from './dom.js'
import {cardEl, groupDeck} from './cards.js'

/**
 * @param {{root: HTMLElement, store: ReturnType<typeof import('../book-store.js').createBookStore>, ai: ReturnType<typeof import('../ai.js').createAiController>, toast: (t: string, kind?: string) => void}} deps
 */
export function createPanels({root, store, ai, toast}) {
	/** @type {{el: HTMLElement, station: string|null, onClose?: () => void, keys?: (e: KeyboardEvent) => void, kind: string}|null} */
	let cur = null

	function close() {
		if (!cur) return
		const c = cur
		cur = null
		if (c.keys) document.removeEventListener('keydown', c.keys, true)
		c.el.remove()
		c.onClose?.()
	}

	/** Mount a node as the one open panel. */
	function mount(el, {station = null, kind = 'modal', onClose, keys} = {}) {
		close()
		cur = {el, station, kind, onClose, keys}
		root.append(el)
		if (keys) document.addEventListener('keydown', keys, true)
		el.querySelector('button.ever-btn--primary, .ever-dialogue__options button, .ever-panel__actions button')?.focus({preventScroll: true})
	}

	const modal = (...kids) => h('div', {class: 'ever-modal', onclick: (e) => e.target === e.currentTarget && close()}, h('div', {class: 'ever-panel', role: 'dialog', 'aria-modal': 'true'}, ...kids))

	/** Show the toast effects of a result. */
	const flash = (effects) => {
		for (const e of effects || []) if (e.k === 'toast') toast(e.text, /doubt/i.test(e.text) ? 'bad' : e.text.startsWith('Card') || e.text.startsWith('Token') || e.text.startsWith('Upgraded') ? 'gold' : 'good')
	}

	/** Dispatch an action and show its effects; resolves true on success. */
	async function act(action, buttons = []) {
		for (const b of buttons) b.disabled = true
		const r = await store.dispatch(action)
		flash(r.effects)
		for (const b of buttons) b.disabled = false
		return r
	}

	// -------------------------------------------------------------------------------
	// Card picker (well: any card; anvil: upgradable cards)
	// -------------------------------------------------------------------------------

	/**
	 * @param {{cards: {uid: string, id: string, upgraded: boolean}[], confirm: string, cancel: string, onPick: (uid: string) => void, onCancel: () => void}} o
	 */
	function pickerNode({cards, confirm, cancel, onPick, onCancel}) {
		let chosen = null
		const grid = h('div', {class: 'ever-deck-grid ever-deck-grid--picker'})
		const ok = btn(confirm, () => chosen && onPick(chosen), 'ever-btn--primary', {disabled: true})
		const groups = groupDeck(cards)
		const render = () => {
			grid.replaceChildren(
				...groups.map((g) =>
					cardEl(g.card, {
						count: g.count,
						selected: chosen === g.uids[0],
						onClick: () => {
							chosen = g.uids[0]
							ok.disabled = false
							render()
						},
					}),
				),
			)
		}
		render()
		return h('div', {class: 'ever-picker'}, h('div', {class: 'ever-dialogue__scroll'}, grid), h('div', {class: 'ever-panel__actions', style: 'margin-top:12px'}, ok, btn(cancel, onCancel)))
	}

	// -------------------------------------------------------------------------------
	// Station panels
	// -------------------------------------------------------------------------------

	function simple(t, text, ...actions) {
		return modal(h('h2', {class: 'ever-panel__title', text: t.title}), h('p', {class: 'ever-panel__text', text}), ...actions)
	}
	const doneModal = (t) => simple(t, t.done, h('div', {class: 'ever-panel__actions'}, btn(COPY.deck.close, close, 'ever-btn--primary')))

	function openWell() {
		const t = COPY.stations.well
		const book = store.get()
		if (book.used.well || book.status !== 'exploring') return mount(doneModal(t), {station: 'well'})
		const drop = btn(t.drop, () => {
			const panel = modal(
				h('h2', {class: 'ever-panel__title', text: t.title}),
				h('p', {class: 'ever-panel__text', text: t.pick}),
				pickerNode({
					cards: store.get().deck,
					confirm: t.drop,
					cancel: COPY.free.back,
					onCancel: openWell,
					onPick: async (uid) => {
						const r = await act({type: 'well.remove', uid})
						if (r.ok) close()
					},
				}),
			)
			mount(panel, {station: 'well'})
		})
		const ward = btn(t.ward, async () => {
			const r = await act({type: 'well.ward'}, [drop, ward, leave])
			if (r.ok) close()
		})
		const leave = btn(t.leave, close)
		const what = h('p', {class: 'ever-muted', style: 'font-size:14px;margin:-6px 0 14px', text: COPY.hud.tokenTip.ward})
		mount(simple(t, t.text, what, h('div', {class: 'ever-panel__actions'}, drop, ward, leave)), {station: 'well'})
	}

	function openLectern() {
		const t = COPY.stations.lectern
		const book = store.get()
		if (book.used.lectern || book.status !== 'exploring') return mount(doneModal(t), {station: 'lectern'})
		const row = h('div', {class: 'ever-deck-grid ever-deck-grid--picker ever-deck-grid--offer', style: 'margin:6px 0 14px'})
		const leave = btn(t.leave, close)
		const cards = book.lecternOffer.map((id) =>
			cardEl(
				{id, upgraded: false},
				{
					size: 'sm',
					onClick: async () => {
						const r = await act({type: 'lectern.take', id}, [leave])
						if (r.ok) close()
					},
				},
			),
		)
		row.append(...cards)
		mount(simple(t, t.text, row, h('div', {class: 'ever-panel__actions'}, leave)), {station: 'lectern'})
	}

	function openGrindstone() {
		const t = COPY.stations.grindstone
		const book = store.get()
		if (book.used.grindstone || book.status !== 'exploring') return mount(doneModal(t), {station: 'grindstone'})
		const take = btn(t.take, async () => {
			const r = await act({type: 'grindstone.take'}, [take, leave])
			if (r.ok) close()
		}, 'ever-btn--primary')
		const leave = btn(t.leave, close)
		// say what the token does before you take it (QA: "Whetstone" alone meant nothing)
		const what = h('p', {class: 'ever-muted', style: 'font-size:14px;margin:-6px 0 14px', text: COPY.hud.tokenTip.whetstone})
		mount(simple(t, t.text, what, h('div', {class: 'ever-panel__actions'}, take, leave)), {station: 'grindstone'})
	}

	function openShrine() {
		const t = COPY.stations.shrine
		const book = store.get()
		if (book.used.shrine || book.status !== 'exploring') return mount(doneModal(t), {station: 'shrine'})
		const take = btn(t.take, async () => {
			const r = await act({type: 'shrine.take'}, [take, leave])
			if (r.ok) close()
		}, 'ever-btn--doubt')
		const leave = btn(t.leave, close, 'ever-btn--primary')
		mount(simple(t, t.text, h('p', {class: 'ever-muted', style: 'font-size:14px;margin:-6px 0 14px', text: t.small}), h('div', {class: 'ever-panel__actions'}, take, leave)), {station: 'shrine'})
	}

	// -------------------------------------------------------------------------------
	// Marcus
	// -------------------------------------------------------------------------------

	function openMarcus() {
		const T = COPY.stations.marcus
		const speakerPill = h('span', {class: 'ever-pill ever-pill--trust'}, h('span', {class: 'ever-pill__dot'}), h('span', {text: ''}))
		const speaker = h('div', {class: 'ever-dialogue__speaker'}, h('span', {text: T.title}), speakerPill)
		const body = h('div', {class: 'ever-dialogue__scroll'})
		const panel = h('section', {class: 'ever-panel ever-dialogue', role: 'dialog', 'aria-label': T.title}, speaker, body)

		const s = {lines: [], options: [], closed: false, mode: 'options', busy: false, thinking: false}

		const keys = (e) => {
			if (e.key === 'Escape') {
				e.preventDefault()
				close()
				return
			}
			if (s.mode !== 'options' || s.busy || e.target instanceof HTMLInputElement) return
			const n = Number(e.key)
			if (Number.isInteger(n) && n >= 1 && n <= s.options.length) {
				e.preventDefault()
				choose(s.options[n - 1].id)
			}
		}

		/** Turn effects into the lines and options on screen. */
		function apply(r) {
			flash(r.effects)
			const lines = []
			for (const e of r.effects || []) {
				if (e.k === 'say') lines.push({text: e.text, narr: Boolean(e.narr)})
				else if (e.k === 'hp') lines.push({text: `(${e.delta} HP)`, out: true})
				else if (e.k === 'trust') lines.push({text: e.delta > 0 ? COPY.toasts.trustUp : COPY.toasts.trustDown, out: true})
				else if (e.k === 'options') s.options = e.options
				else if (e.k === 'close') s.closed = true
				else if (e.k === 'picker' && e.purpose === 'anvil') s.mode = 'anvil'
			}
			// Marcus's words first, then the game's outcome lines ("Marcus trusts you more.", "(-6 HP)")
			if (lines.length) s.lines = [...lines.filter((l) => !l.out), ...lines.filter((l) => l.out)]
			if (r.ok === false && !lines.length) {
				close()
				return
			}
			if (s.closed) s.options = []
			render()
		}

		async function run(action) {
			if (s.busy) return
			s.busy = true
			render()
			const r = await store.dispatch(action)
			s.busy = false
			s.thinking = false
			apply(r)
		}
		const choose = (id) => run({type: 'marcus.option', option: id})

		function renderLines() {
			const wrap = h('div', {class: 'ever-dialogue__lines'})
			if (s.thinking) wrap.append(h('p', {class: 'ever-dialogue__line ever-thinking', text: COPY.free.thinking}))
			else
				for (const l of s.lines)
					wrap.append(
						l.narr
							? h('p', {class: 'ever-dialogue__line'}, h('em', {text: l.text}))
							: l.out
								? h('p', {class: 'ever-dialogue__note', text: l.text})
								: h('p', {class: 'ever-dialogue__line', text: `“${l.text}”`}),
					)
			return wrap
		}

		function renderAnvil() {
			return pickerNode({
				cards: upgradableCards(store.get()),
				confirm: 'Upgrade',
				cancel: COPY.stations.anvil.notNow,
				onCancel: () => {
					s.mode = 'options'
					render()
				},
				onPick: async (uid) => {
					s.mode = 'options'
					await run({type: 'anvil.upgrade', uid})
				},
			})
		}

		function renderFree() {
			const input = isolateKeys(h('input', {class: 'ever-input', type: 'text', maxlength: FREE_TEXT_MAX, placeholder: COPY.free.placeholder, 'aria-label': COPY.free.open, autocomplete: 'off'}))
			const go = async () => {
				const text = input.value.trim()
				if (!text || s.busy) return
				s.mode = 'options'
				s.thinking = ai.isActive(store.get())
				s.busy = true
				render()
				const p = await ai.propose(store.get(), text)
				s.busy = false
				await run({type: 'marcus.free', text: p.text, ...(p.ai ? {ai: p.ai} : {})})
			}
			input.addEventListener('keydown', (e) => e.key === 'Enter' && go())
			queueMicrotask(() => input.focus())
			return h(
				'div',
				{},
				h('div', {class: 'ever-dialogue__free'}, input, btn(COPY.free.go, go, 'ever-btn--primary'), btn(COPY.free.back, () => {
					s.mode = 'options'
					render()
				})),
				h('p', {class: 'ever-dialogue__note', text: ai.isActive(store.get()) ? COPY.aiOnNote : COPY.aiOffNote}),
			)
		}

		function render() {
			const info = marcusPanel(store.get())
			speakerPill.lastChild.textContent = trustWord(info.trust)
			const parts = [renderLines()]
			if (s.mode === 'anvil') parts.push(renderAnvil())
			else if (s.mode === 'free') parts.push(renderFree())
			else {
				const opts = h('ul', {class: 'ever-dialogue__options'})
				s.options.forEach((o, i) =>
					opts.append(h('li', {}, btn([h('span', {class: 'ever-btn__key', text: String(i + 1)}), h('span', {text: o.text})], () => choose(o.id), 'ever-btn--block', {disabled: s.busy}))),
				)
				const actions = h('div', {class: 'ever-panel__actions'})
				if (info.freeText && !s.closed)
					actions.append(
						btn(COPY.free.open, () => {
							s.mode = 'free'
							render()
						}, '', {disabled: s.busy}),
					)
				actions.append(btn(COPY.free.leave, close, 'ever-btn--quiet'))
				parts.push(opts, actions)
			}
			body.replaceChildren(...parts)
			// keep focus on the first option after a re-render (keyboard players)
			if (s.mode === 'options') body.querySelector('.ever-dialogue__options button')?.focus({preventScroll: true})
		}

		mount(panel, {station: 'marcus', kind: 'dialogue', keys})
		render()
		run({type: 'marcus.talk'})
	}

	// -------------------------------------------------------------------------------
	// Deck screen (read-only)
	// -------------------------------------------------------------------------------

	function openDeck() {
		const book = store.get()
		const groups = groupDeck(book.deck)
		const grid = h('div', {class: 'ever-deck-grid'}, ...groups.map((g) => cardEl(g.card, {count: g.count})))
		const keys = (e) => {
			if (e.key === 'Escape' || e.key === 'Tab') {
				e.preventDefault()
				close()
			}
		}
		mount(
			modal(
				h('h2', {class: 'ever-panel__title', text: `${COPY.deck.title} (${book.deck.length})`}),
				h('div', {class: 'ever-dialogue__scroll', style: 'max-height:min(60vh,520px);padding:8px 6px 6px'}, book.deck.length ? grid : h('p', {text: COPY.deck.empty})),
				h('div', {class: 'ever-panel__actions', style: 'margin-top:12px'}, btn(COPY.deck.close, close, 'ever-btn--primary')),
			),
			{kind: 'deck', keys},
		)
	}

	// -------------------------------------------------------------------------------
	// Gate
	// -------------------------------------------------------------------------------

	function openGateSolo({onFight, onNotYet}) {
		const t = COPY.stations.gate
		let decided = false
		const fight = btn(t.fight, () => {
			decided = true
			close()
			onFight()
		}, 'ever-btn--primary')
		const no = btn(t.notYet, close)
		mount(modal(h('p', {class: 'ever-panel__text ever-display', style: 'font-size:20px', text: t.text}), h('div', {class: 'ever-panel__actions'}, fight, no)), {
			station: 'gate',
			kind: 'gate',
			onClose: () => !decided && onNotYet(),
		})
	}

	/**
	 * Co-op fight lobby (GDD 7.4). Returns {refresh(room, mySeat)}.
	 * @param {{onReady: (ready: boolean) => void, onLeave: () => void}} cb
	 */
	function openGateCoop({onReady, onLeave}) {
		const line = h('p', {class: 'ever-panel__text ever-display', style: 'font-size:20px'})
		const sub = h('p', {class: 'ever-panel__text ever-muted'})
		const actions = h('div', {class: 'ever-panel__actions'})
		let ready = false
		let ticking = null
		const toggle = btn(COPY.mp.ready, () => {
			ready = !ready
			onReady(ready)
			paintToggle()
		}, 'ever-btn--primary')
		// Ready -> "Cancel ready" (quiet) and the line says we are waiting (QA: "Not ready"
		// next to "Not yet" read as two negatives).
		const paintToggle = () => {
			toggle.textContent = ready ? COPY.mp.notReady : COPY.mp.ready
			toggle.classList.toggle('ever-btn--primary', !ready)
			paint()
		}
		const back = btn(COPY.stations.gate.notYet, close)
		actions.append(toggle, back)
		let last = null
		const paint = () => {
			const room = last?.room
			if (!room) return
			const mine = room.seats.find((s) => s.seat === last.mySeat)
			if (room.phase === 'fighting' && !mine?.inFight) {
				line.textContent = COPY.mp.locked(room.warden.round)
				sub.textContent = ''
				toggle.hidden = true
				return
			}
			toggle.hidden = false
			line.textContent = ready ? COPY.mp.waiting(room.lobby.ready, room.lobby.of) : COPY.mp.lobby(room.lobby.ready, room.lobby.of)
			const left = room.lobby.startsAt ? Math.max(0, Math.ceil((room.lobby.startsAt - Date.now()) / 1000)) : null
			sub.textContent = left === null ? COPY.stations.gate.text : COPY.mp.startsIn(left)
			if (mine && ready !== mine.ready) {
				ready = mine.ready
				return paintToggle()
			}
		}
		mount(modal(line, sub, actions), {
			station: 'gate',
			kind: 'gate',
			onClose: () => {
				clearInterval(ticking)
				if (ready) onReady(false)
				onLeave()
			},
		})
		ticking = setInterval(paint, 500)
		return {
			refresh(room, mySeat) {
				last = {room, mySeat}
				paint()
			},
		}
	}

	return {
		close,
		openDeck,
		openGateSolo,
		openGateCoop,
		/** @param {string} id well|lectern|grindstone|shrine|marcus */
		openStation(id) {
			;({well: openWell, lectern: openLectern, grindstone: openGrindstone, shrine: openShrine, marcus: openMarcus})[id]?.()
		},
		get isOpen() {
			return cur !== null
		},
		get kind() {
			return cur?.kind ?? null
		},
		get station() {
			return cur?.station ?? null
		},
	}
}
