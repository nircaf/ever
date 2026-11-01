// v2 panels: NPC moments (Wayfarer, Keeper), the Offer panel (cards and items side by side,
// labels, costs, sealed faces, swaps), v2 stations (Lectern, Well, Grindstone, Shrine,
// Hearth), Spoils, fight prompts, the Contents, and the deck viewer with equipment.
// The UI never edits the book: every change is store.dispatch(BookAction); the rules
// re-check everything (offers included). Model text is rendered with textContent only.
// OWNER: systems engineer.
// Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later

import {getDef} from '../../mechanics/index.js'
import {artRecipe} from '../../content-gen/art.js'
import {COPY2, NPC_LINES} from '../copy-v2.js'
import {FREE_TEXT_MAX, trustWord} from '../contracts.js'
import {
	costText,
	curseCount,
	currentPage,
	deckName,
	hearthLit,
	isCurseCard,
	isKeepsake,
	itemInSlot,
	lecternOffers,
	momentContext,
	momentPanel,
	offerText,
	offlineOffers,
	pageTitle,
	shrineOffer,
	spoilsOffers,
	temperCount,
	twistFor,
	ITEM_SLOTS,
} from '../rules/run.js'
import {WARDEN_ASPECT, THEME_NAMES} from '../rules/path.js'
import {btn, h, isolateKeys} from './dom.js'
import {cardEl, defIcon, faceEl, groupDeck} from './cards.js'

const SLOT = COPY2.hud.slotName

/** Rules errors -> a line the player understands (rules return codes, never prose). */
const ERR = {
	keepsake: COPY2.offer.keepsakeRefuse,
	tokens_full: COPY2.offer.tokensFull,
	wait: COPY2.hud.waiting,
	pending: COPY2.hud.pending,
	too_far: 'Step closer first.',
}

/**
 * @param {{panels: ReturnType<typeof import('./panels.js').createPanels>, store: any, toast: (t: string, kind?: string) => void,
 *   ai?: any, moments?: {request: (ctx: any) => Promise<any>, cancel?: () => void, active?: () => boolean}}} deps
 *   moments: the AI moment session (core/ai createMomentSession); absent = offline offers only.
 */
export function createRunPanels({panels, store, toast, moments = null}) {
	const {mount, modal, close, flash} = panels
	let scriptNoted = false

	async function act(action, buttons = []) {
		for (const b of buttons) b.disabled = true
		const r = await store.dispatch(action)
		flash(r.effects)
		for (const b of buttons) if (b.isConnected) b.disabled = false
		if (!r.ok) {
			const fx = (r.effects || []).find((e) => e.k === 'toast' || e.k === 'say')
			if (!fx) toast(ERR[r.error] ?? 'That does not work here.', 'bad')
			else if (fx.k === 'say') toast(fx.text)
		}
		return r
	}

	const title = (t) => h('h2', {class: 'ever-panel__title', text: t})
	const text = (t) => h('p', {class: 'ever-panel__text', text: t})
	const small = (t) => h('p', {class: 'ever-muted ever-run__small', text: t})
	const actions = (...b) => h('div', {class: 'ever-panel__actions'}, ...b)
	const row = (...kids) => h('div', {class: 'ever-deck-grid ever-deck-grid--picker ever-deck-grid--offer ever-run__row'}, ...kids)

	// -------------------------------------------------------------------------------
	// Card picker over the book's deck (generated cards need the run content)
	// -------------------------------------------------------------------------------

	function pickCards({cards, need = 1, confirm, cancel, onPick, onCancel}) {
		const book = store.get()
		let chosen = []
		const grid = h('div', {class: 'ever-deck-grid ever-deck-grid--picker'})
		const ok = btn(confirm, () => chosen.length === need && onPick(chosen), 'ever-btn--primary', {disabled: true})
		const groups = groupDeck(cards, book.content)
		const render = () => {
			grid.replaceChildren(
				...groups.map((g) =>
					cardEl(g.card, {
						content: book.content,
						count: g.count,
						selected: g.uids.some((u) => chosen.includes(u)),
						onClick: () => {
							const free = g.uids.find((u) => !chosen.includes(u))
							if (g.uids.some((u) => chosen.includes(u))) chosen = chosen.filter((u) => !g.uids.includes(u))
							else if (free) chosen = [...chosen, free].slice(-need)
							ok.disabled = chosen.length !== need
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
	// Offer faces
	// -------------------------------------------------------------------------------

	const LABEL = {gift: COPY2.offer.gift, bargain: COPY2.offer.bargain, sealed: COPY2.offer.sealed, curse: 'Curse', echo: COPY2.offer.echo}

	/** One offer as a card face (+ its label chip, cost and twist lines). */
	function offerFace(book, o, {onClick, selected, twist} = {}) {
		const t = offerText(book, o)
		const chips = h(
			'div',
			{class: 'ever-run__chips'},
			h('span', {class: `ever-run__chip ever-run__chip--${o.label ?? 'gift'}`, text: twist ? COPY2.offer.twist : LABEL[o.label] ?? LABEL.gift}),
			o.src === 'ai' ? null : null,
		)
		const notes = h('div', {class: 'ever-run__notes'}, costText(o) ? h('p', {class: 'ever-run__cost', text: costText(o)}) : null, twist ? h('p', {class: 'ever-run__twist', text: COPY2.offer.twists[twist]}) : null)
		const extra = h('div', {class: 'ever-run__extra'}, chips, notes)
		if (o.label === 'sealed') return faceEl({name: t.name, band: COPY2.offer.sealed, text: t.text, type: 'curse', icon: '', onClick, selected, extra})
		if (o.def?.kind === 'card' || o.def?.kind === 'curse') return cardEl({uid: 'x', id: 'g:x', def: o.def, upgraded: false}, {content: book.content, onClick, selected, size: 'sm', extra})
		if (o.def?.kind === 'item') return faceEl({name: t.name, band: `${SLOT[o.def.slot]} item`, text: t.text, flavor: t.flavor, icon: defIcon(o.def), onClick, selected, extra})
		if (o.def?.kind === 'token') return faceEl({name: t.name, band: 'Token', text: t.text, flavor: t.flavor, icon: defIcon(o.def), type: 'token', onClick, selected, extra})
		return faceEl({name: t.name, band: o.kind === 'upgrade' ? 'Upgrade' : 'Removal', text: t.text, type: 'skill', onClick, selected, extra})
	}

	/**
	 * The Offer panel (GDD_V2 10.1): offers side by side, one choice or none.
	 * @param {{who: string, name: string, reply?: string}} o
	 */
	async function openOffer({who, name, reply = ''}) {
		const book0 = store.get()
		const page = book0.page
		const head = title(COPY2.offer.title(name))
		const line = h('p', {class: 'ever-dialogue__line'})
		const body = h('div', {})
		const panel = modal(head, line, body)
		panel.classList.add('ever-run')
		mount(panel, {station: siteStation(book0), kind: 'offer'})
		let offers
		let fallbackNote = false
		const ctx = momentContext(book0)
		if (moments && moments.active?.()) {
			line.textContent = COPY2.moment.thinking(name)
			line.classList.add('ever-thinking')
			try {
				const r = await moments.request(ctx)
				offers = r.offers
				fallbackNote = Boolean(r.fallbackNote)
				if (r.reply && who !== 'marcus') reply = r.reply
			} catch {
				offers = null
			}
			line.classList.remove('ever-thinking')
		}
		if (!panel.isConnected) return
		if (!offers) offers = offlineOffers(book0)
		line.textContent = reply ? `“${reply}”` : ''
		if (fallbackNote && !scriptNoted) {
			scriptNoted = true
			toast(COPY2.offer.script)
		}
		let chosen = null
		const take = btn(COPY2.offer.take, () => chosen !== null && doTake(offers[chosen]), 'ever-btn--primary', {disabled: true})
		const none = btn(COPY2.offer.nothing, async () => {
			const r = await act({type: 'offer.decline', page}, [take, none])
			if (r.ok) close()
		})
		const paint = () => {
			const book = store.get()
			body.replaceChildren(
				offers.length ? row(...offers.map((o, j) => offerFace(book, o, {selected: chosen === j, twist: twistFor(book, o.slot ?? j), onClick: () => ((chosen = j), (take.disabled = false), paint())}))) : text(who === 'marcus' ? 'Marcus turns away.' : NPC_LINES[who]?.closed ?? ''),
				actions(take, none),
			)
		}
		async function doTake(o, swap = false) {
			const a = {type: 'offer.take', page, slot: o.slot}
			if (o.src === 'ai') a.def = o.kind === 'upgrade' || o.kind === 'remove' ? {kind: o.kind, target: o.target?.name} : o.def
			if (swap) a.swap = true
			const r = await act(a, [take, none])
			if (r.ok) return close()
			if (r.error === 'slot_full') {
				const book = store.get()
				const old = getDef(book.content, itemInSlot(book, o.def.slot))
				body.replaceChildren(
					text(COPY2.offer.slotFull(SLOT[o.def.slot], old?.name ?? '', o.def.name)),
					actions(btn(COPY2.offer.swap, () => doTake(o, true), 'ever-btn--primary'), btn(COPY2.offer.keep(old?.name ?? ''), paint)),
				)
			} else if (r.error === 'bound') toast(COPY2.offer.boundRefuse(getDef(store.get().content, itemInSlot(store.get(), o.def.slot))?.name ?? ''), 'bad')
		}
		paint()
	}

	const siteStation = (book) => {
		const p = currentPage(book)
		return p?.type === 'marcus' ? 'marcus' : null
	}

	// -------------------------------------------------------------------------------
	// Wayfarer and Keeper moments (dialogue in the MVP style)
	// -------------------------------------------------------------------------------

	function openMoment() {
		const book0 = store.get()
		const p = currentPage(book0)
		if (p?.type !== 'moment') return
		const who = p.archetype
		const name = p.npc
		const pill = h('span', {class: 'ever-pill ever-pill--trust'}, h('span', {class: 'ever-pill__dot'}), h('span', {text: ''}))
		const speaker = h('div', {class: 'ever-dialogue__speaker'}, h('span', {text: name}), pill)
		const body = h('div', {class: 'ever-dialogue__scroll'})
		const panel = h('section', {class: 'ever-panel ever-dialogue', role: 'dialog', 'aria-label': name}, speaker, body)
		const s = {lines: [], options: [], closed: false, mode: 'options', busy: false}

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
		function apply(r) {
			flash(r.effects)
			const lines = []
			let offer = false
			for (const e of r.effects || []) {
				if (e.k === 'say') lines.push({text: e.text, narr: Boolean(e.narr)})
				else if (e.k === 'hp') lines.push({text: `(${e.delta} HP)`, out: true})
				else if (e.k === 'trust') lines.push({text: e.delta > 0 ? `${name} trusts you more.` : `${name} trusts you less.`, out: true})
				else if (e.k === 'options') s.options = e.options
				else if (e.k === 'close') s.closed = true
				else if (e.k === 'offer') offer = true
			}
			if (lines.length) s.lines = [...lines.filter((l) => !l.out), ...lines.filter((l) => l.out)]
			if (s.closed) s.options = []
			render()
			if (offer) queueMicrotask(() => openOffer({who, name, reply: s.lines.filter((l) => !l.out && !l.narr).at(-1)?.text ?? ''}))
		}
		async function run(action) {
			if (s.busy) return
			s.busy = true
			render()
			const r = await store.dispatch(action)
			s.busy = false
			apply(r)
		}
		const choose = (id) => run({type: 'moment.option', option: id})

		function render() {
			const info = momentPanel(store.get(), who)
			pill.lastChild.textContent = trustWord(info.trust)
			const lines = h('div', {class: 'ever-dialogue__lines'})
			for (const l of s.lines) lines.append(l.narr ? h('p', {class: 'ever-dialogue__line'}, h('em', {text: l.text})) : l.out ? h('p', {class: 'ever-dialogue__note', text: l.text}) : h('p', {class: 'ever-dialogue__line', text: `“${l.text}”`}))
			const parts = [lines]
			if (s.mode === 'free') {
				const input = isolateKeys(h('input', {class: 'ever-input', type: 'text', maxlength: FREE_TEXT_MAX, placeholder: COPY2.moment.placeholder, 'aria-label': COPY2.moment.freeOpen, autocomplete: 'off'}))
				const go = () => {
					const t = input.value.trim()
					if (!t || s.busy) return
					s.mode = 'options'
					run({type: 'moment.free', text: t})
				}
				input.addEventListener('keydown', (e) => e.key === 'Enter' && go())
				queueMicrotask(() => input.focus())
				parts.push(h('div', {class: 'ever-dialogue__free'}, input, btn('Say it', go, 'ever-btn--primary'), btn('Back', () => ((s.mode = 'options'), render()))))
			} else {
				const opts = h('ul', {class: 'ever-dialogue__options'})
				s.options.forEach((o, i) => opts.append(h('li', {}, btn([h('span', {class: 'ever-btn__key', text: String(i + 1)}), h('span', {text: o.text})], () => choose(o.id), 'ever-btn--block', {disabled: s.busy}))))
				const acts = h('div', {class: 'ever-panel__actions'})
				if (info.freeText && !s.closed) acts.append(btn(COPY2.moment.freeOpen, () => ((s.mode = 'free'), render()), '', {disabled: s.busy}))
				acts.append(btn(COPY2.moment.walkOn, async () => {
					const r = await act({type: 'page.skip', page: store.get().page})
					if (r.ok) close()
				}, 'ever-btn--quiet'))
				acts.append(btn(COPY2.moment.leave, close, 'ever-btn--quiet'))
				parts.push(opts, acts)
			}
			body.replaceChildren(...parts)
			if (s.mode === 'options') body.querySelector('.ever-dialogue__options button')?.focus({preventScroll: true})
		}
		mount(panel, {kind: 'dialogue', keys})
		render()
		run({type: 'moment.talk'})
	}

	// -------------------------------------------------------------------------------
	// Stations (v2)
	// -------------------------------------------------------------------------------

	const skipBtn = (label = COPY2.stations.skip) =>
		btn(label, async () => {
			const r = await act({type: 'page.skip', page: store.get().page})
			if (r.ok) close()
		}, 'ever-btn--quiet')

	function openLectern() {
		const book = store.get()
		const offers = lecternOffers(book)
		const page = book.page
		const cards = offers.map((o) =>
			offerFace(book, {...o, label: o.echo ? 'echo' : 'gift'}, {
				onClick: async () => {
					const r = await act({type: 'lectern.take', page, slot: o.slot})
					if (r.ok) close()
				},
			}),
		)
		mount(modal(title(pageTitle(book)), text(COPY2.stations.lecternText), row(...cards), actions(skipBtn(LECTERN_LEAVE))), {kind: 'station'})
	}

	function openWell() {
		const book = store.get()
		const page = book.page
		const drop = btn('Drop a card in', () => {
			const cards = store.get().deck.filter((c) => !isKeepsake(store.get(), c))
			if (!cards.length) return toast(COPY2.offer.keepsakeRefuse)
			mount(
				modal(
					title(pageTitle(book)),
					text('Choose a card to drop in the well. Not your keepsake.'),
					pickCards({cards, confirm: 'Drop it', cancel: 'Back', onCancel: openWell, onPick: async ([uid]) => (await act({type: 'well.remove', page, uid})).ok && close()}),
				),
				{kind: 'station'},
			)
		}, 'ever-btn--primary')
		const ward = btn('Draw up the Ward', async () => (await act({type: 'well.ward', page}, [drop, ward])).ok && close())
		mount(modal(title(pageTitle(book)), text(COPY2.stations.wellText), small('Ward: start your next fight with 8 Block.'), actions(drop, ward, skipBtn())), {kind: 'station'})
	}

	function openGrindstone() {
		const book = store.get()
		const page = book.page
		const up = btn(COPY2.stations.grindUpgrade, () => {
			const cards = store.get().deck.filter((c) => !c.upgraded && !isCurseCard(store.get(), c))
			mount(
				modal(title(pageTitle(book)), text('Choose a card to sharpen.'), pickCards({cards, confirm: 'Sharpen', cancel: 'Back', onCancel: openGrindstone, onPick: async ([uid]) => (await act({type: 'grind.upgrade', page, uid})).ok && close()})),
				{kind: 'station'},
			)
		}, 'ever-btn--primary')
		const tok = btn(COPY2.stations.grindToken, async () => (await act({type: 'grindstone.take', page}, [up, tok])).ok && close())
		mount(modal(title(pageTitle(book)), text(COPY2.stations.grindText), small('Whetstone: your next enemy starts Vulnerable.'), actions(up, tok, skipBtn())), {kind: 'station'})
	}

	function openShrine() {
		const book = store.get()
		const o = shrineOffer(book)
		const page = book.page
		const take = btn(COPY2.stations.shrineTake(o?.def?.name ?? ''), async () => (await act({type: 'shrine.take', page}, [take])).ok && close(), 'ever-btn--doubt')
		mount(modal(title(pageTitle(book)), text(COPY2.stations.shrineText), o ? row(offerFace(book, {...o, label: 'bargain'})) : null, small(COPY2.stations.shrineSmall), actions(take, skipBtn())), {kind: 'station'})
	}

	function openHearth() {
		const book = store.get()
		const page = book.page
		const lit = hearthLit(book)
		const restN = Math.floor(book.maxHp * 0.3)
		const pick = (cards, need, confirm, type) =>
			mount(
				modal(title(pageTitle(book)), text(need > 1 ? 'Choose two cards.' : 'Choose a card.'), pickCards({cards, need, confirm, cancel: 'Back', onCancel: openHearth, onPick: async (uids) => (await act({type, page, uid: uids[0], ...(uids[1] ? {uid2: uids[1]} : {})})).ok && close()})),
				{kind: 'station'},
			)
		const rest = btn(COPY2.hearth.rest(restN), async () => (await act({type: 'hearth.rest', page})).ok && close(), 'ever-btn--primary')
		const n = temperCount(book)
		const temperCards = book.deck.filter((c) => !c.upgraded && !isCurseCard(book, c))
		const temper = btn(n > 1 ? COPY2.hearth.temperTwo : COPY2.hearth.temper, () => pick(temperCards, Math.min(n, temperCards.length), 'Temper', 'hearth.temper'), '', {disabled: !temperCards.length})
		const list = [rest, temper]
		if (curseCount(book) >= 2) list.push(btn(COPY2.hearth.burn, () => pick(book.deck.filter((c) => isCurseCard(book, c)), 1, 'Burn it', 'hearth.burn'), 'ever-btn--doubt'))
		if (book.path.hearthRemove) list.push(btn(COPY2.hearth.remove, () => pick(book.deck.filter((c) => !isKeepsake(book, c)), 1, 'Burn it', 'hearth.remove')))
		list.push(skipBtn(COPY2.hearth.walk))
		mount(modal(title(lit ? COPY2.hearth.titleLit : COPY2.hearth.titleRoad), text(COPY2.hearth.text), n > 1 ? small(COPY2.hearth.forTobin) : null, actions(...list)), {kind: 'station'})
	}

	// -------------------------------------------------------------------------------
	// Spoils (after a fight) and catch-up picks (co-op late joiners)
	// -------------------------------------------------------------------------------

	function openSpoils() {
		const book = store.get()
		const pend = book.pend
		if (!pend) return
		const offers = spoilsOffers(book)
		const take = async (o, swap = false) => {
			const r = await act({type: 'spoils.take', slot: o.slot, ...(swap ? {swap: true} : {})})
			if (r.ok) return store.get().pend ? openSpoils() : close()
			if (r.error === 'slot_full') {
				const old = getDef(store.get().content, itemInSlot(store.get(), o.def.slot))
				mount(modal(title(COPY2.spoils.title), text(COPY2.offer.slotFull(SLOT[o.def.slot], old?.name ?? '', o.def.name)), actions(btn(COPY2.offer.swap, () => take(o, true), 'ever-btn--primary'), btn(COPY2.offer.keep(old?.name ?? ''), openSpoils))), {kind: 'spoils'})
			}
		}
		const leaveLabel = pend.kind === 'catchup' ? COPY2.spoils.skip : COPY2.spoils.leave(4)
		const leave = btn(leaveLabel, async () => {
			const r = await act({type: 'spoils.leave'})
			if (r.ok) return store.get().pend ? openSpoils() : close()
		})
		const head = pend.kind === 'catchup' ? [title(COPY2.spoils.title), text(COPY2.spoils.catchup(book.page + 1)), small(COPY2.spoils.picksLeft(pend.left))] : [title(COPY2.spoils.title), text(pend.elite ? COPY2.spoils.elite : COPY2.spoils.text)]
		mount(modal(...head, row(...offers.map((o) => offerFace(book, o, {onClick: () => take(o)}))), actions(leave)), {kind: 'spoils'})
	}

	// -------------------------------------------------------------------------------
	// Fight prompts (solo). Co-op uses the lobby in panels.js.
	// -------------------------------------------------------------------------------

	function openFightPrompt({onFight, onNotYet}) {
		const book = store.get()
		const p = currentPage(book)
		let decided = false
		const lines = []
		if (p.type === 'final') {
			const [prim, , shadow] = book.path.themes
			lines.push(h('p', {class: 'ever-panel__text ever-display', style: 'font-size:20px', text: COPY2.fights.gate(WARDEN_ASPECT[prim])}))
			lines.push(text(COPY2.fights.gateTwist(THEME_NAMES[shadow])))
			if (book.marks) lines.push(text(COPY2.fights.gateMarks))
		} else lines.push(h('p', {class: 'ever-panel__text ever-display', style: 'font-size:20px', text: p.type === 'elite' ? COPY2.fights.elite : COPY2.fights.skirmish}))
		const fight = btn(COPY2.fights.fight, () => {
			decided = true
			close()
			onFight()
		}, 'ever-btn--primary')
		mount(modal(...lines, actions(fight, btn(COPY2.fights.notYet, close))), {kind: 'gate', onClose: () => !decided && onNotYet?.()})
	}

	// -------------------------------------------------------------------------------
	// Contents (GDD_V2 2.1 #4) and the deck viewer with equipment
	// -------------------------------------------------------------------------------

	function openContents({auto = false} = {}) {
		const book = store.get()
		const list = h('ol', {class: 'ever-run__contents'})
		book.path.pages.forEach((p, i) => {
			const state = i < book.page ? 'done' : i === book.page ? 'here' : 'ahead'
			list.append(h('li', {class: `ever-run__page is-${state}`}, h('span', {class: 'ever-run__mark', text: state === 'done' ? '✓' : state === 'here' ? '▸' : ''}), h('span', {text: COPY2.contents.row(i + 1, pageTitle(book, i))}), state === 'here' ? h('span', {class: 'ever-run__here', text: COPY2.contents.here}) : null))
		})
		let timer = null
		const panel = modal(title(COPY2.contents.title), list, small(COPY2.contents.foot(book.path.L, book.path.minutes)), actions(btn(COPY2.contents.close, close, 'ever-btn--primary')))
		panel.classList.add('ever-run')
		const keys = (e) => {
			if (e.key === 'Escape' || e.key === 'c' || e.key === 'C') {
				e.preventDefault()
				close()
			}
		}
		mount(panel, {kind: 'contents', keys, onClose: () => clearTimeout(timer)})
		if (auto) timer = setTimeout(() => panels.kind === 'contents' && close(), 4000)
	}

	function openDeck() {
		const book = store.get()
		const groups = groupDeck(book.deck, book.content)
		const grid = h('div', {class: 'ever-deck-grid'}, ...groups.map((g) => cardEl(g.card, {count: g.count, content: book.content})))
		const items = h(
			'div',
			{class: 'ever-run__items'},
			...ITEM_SLOTS.map((slot) => {
				const id = itemInSlot(book, slot)
				const def = id ? getDef(book.content, id) : null
				return def ? faceEl({name: def.name, band: `${SLOT[slot]} item`, text: offerText(book, {kind: 'item', def}).text + (def.bound ? ` ${COPY2.hud.bound}` : ''), icon: defIcon(def), size: 'sm'}) : h('div', {class: 'ever-run__empty', text: COPY2.hud.itemEmpty(SLOT[slot])})
			}),
		)
		const keys = (e) => {
			if (e.key === 'Escape' || e.key === 'Tab') {
				e.preventDefault()
				close()
			}
		}
		const kept = book.deck.find((c) => isKeepsake(book, c))
		mount(
			modal(
				title(`Your deck (${book.deck.length})`),
				h('div', {class: 'ever-dialogue__scroll', style: 'max-height:min(56vh,520px);padding:8px 6px 6px'}, grid, h('h3', {class: 'ever-run__sub', text: 'Equipment'}), items),
				kept ? small(`${deckName(book, kept)} is your keepsake. It stays with you.`) : null,
				actions(btn('Close', close, 'ever-btn--primary')),
			),
			{kind: 'deck', keys},
		)
	}

	return {openOffer, openMoment, openLectern, openWell, openGrindstone, openShrine, openHearth, openSpoils, openFightPrompt, openContents, openDeck, recipeOf: (def) => artRecipe(def)}
}

const LECTERN_LEAVE = 'Leave them'
