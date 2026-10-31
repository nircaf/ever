// EVER combat UI (DOM layer #combat over the shared 3D stage) + the solo driver.
// OWNER: combat engineer. Exported signatures follow contracts.js section 5/6:
//   createCombat(el, ctx) -> CombatUiApi {run(driver) -> Promise<CombatResult>, dispose}
//   createLocalCombatDriver({book, enemyId}) -> CombatDriver   (./driver.js)
// The UI only talks to a CombatDriver, so solo and co-op share every line below.
// Copyright (C) 2026 the EVER contributors. Card combat rules: Slay the Web by Oskar Rough
// and contributors (AGPL-3.0-or-later). SPDX-License-Identifier: AGPL-3.0-or-later

import './combat.css'
import {EV} from '../core/contracts.js'
import {REDUCED_MOTION} from '../shared/style.js'
import {cardElement, warmCardArt} from './cards.js'
import {createStage} from './stage.js'
import {intentIcon, intentIconKinds} from './icons.js'

export {createLocalCombatDriver} from './driver.js'
export {cardElement, cardArt} from './cards.js'

const TIP_BLOCK = 'Tip: Block wears off each turn. Play Defend before you end your turn.'

const SLAY_THE_WEB = 'https://github.com/oskarrough/slaytheweb'
const wait = (ms) => new Promise((r) => setTimeout(r, REDUCED_MOTION ? Math.min(ms, 120) : ms))

/** Small DOM helper: h('div.a.b', {text, attrs...}, ...children) */
function h(sel, props = {}, ...kids) {
	const [tag, ...cls] = sel.split('.')
	const el = document.createElement(tag || 'div')
	if (cls.length) el.className = cls.join(' ')
	for (const [k, v] of Object.entries(props)) {
		if (v === undefined || v === null || v === false) continue
		if (k === 'text') el.textContent = v
		else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn)
		else if (k in el && typeof v !== 'string') el[k] = v
		else el.setAttribute(k, v === true ? '' : v)
	}
	el.append(...kids.filter(Boolean))
	return el
}

const DENY = {
	energy: 'Not enough energy.',
	unplayable: "That card can't be played.",
	not_your_turn: 'Your turn is over. Waiting for the Warden.',
	not_in_fight: 'You are out of this fight.',
	over: 'The fight is over.',
}

/**
 * @param {HTMLElement} el   the #combat container
 * @param {{bus?: any, world?: import('../core/contracts.js').WorldApi}} ctx
 * @returns {import('../core/contracts.js').CombatUiApi}
 */
export function createCombat(el, ctx = {}) {
	let teardown = null

	async function run(driver) {
		teardown?.()
		el.hidden = false
		el.classList.add('cbt-layer')
		el.replaceChildren()

		// A network driver may not have a view yet: wait for the room's first frame.
		let view = driver.view()
		let firstEvents = null
		if (!view) {
			;[view, firstEvents] = await new Promise((res) => {
				const off = driver.onView((v, ev) => {
					off()
					res([v, ev || []])
				})
			})
		}
		const coop = view.fighters.length > 1
		const stage = createStage(el, ctx.world, {seats: view.fighters.map((f) => f.seat)})
		warmCardArt(view.hand)

		// ---------- static layout ----------
		const ui = h('div.cbt', {role: 'application', 'aria-label': 'Card combat'})
		const foe = {
			root: h('section.cbt-foe.ever-panel', {'aria-label': 'The Ash Warden'}),
			name: h('h2.cbt-foe__name', {text: view.warden.name}),
			hp: h('span.cbt-hp'),
			bar: h('span.ever-bar.cbt-bar', {}, h('i')),
			status: h('div.cbt-status'),
			intents: h('ul.cbt-intents', {'aria-label': 'Intent'}),
		}
		foe.root.append(foe.name, h('div.cbt-hprow', {}, foe.bar, foe.hp), foe.status, foe.intents)
		const party = h('section.cbt-party', {'aria-label': coop ? 'Your party' : 'You'})
		const banner = h('div.cbt-banner', {'aria-live': 'polite'})
		const log = h('ol.cbt-log', {'aria-live': 'polite'})
		const energy = h('div.ever-energy.cbt-energy', {title: 'Energy', 'aria-label': 'Energy'})
		const draw = h('div.ever-pile.cbt-pile', {title: 'Draw pile'})
		const discard = h('div.ever-pile.cbt-pile', {title: 'Discard pile'})
		const hand = h('div.cbt-hand', {role: 'group', 'aria-label': 'Your hand'})
		const endBtn = h('button.ever-btn.ever-btn--primary.cbt-end', {type: 'button'})
		const timer = h('div.cbt-timer', {'aria-live': 'off'})
		const credit = h(
			'p.cbt-credit',
			{},
			'Combat engine: ',
			h('a', {href: SLAY_THE_WEB, target: '_blank', rel: 'noopener noreferrer', text: 'Slay the Web'}),
			' (AGPL)',
		)
		const bottom = h(
			'div.cbt-bottom',
			{},
			h('div.cbt-side.cbt-side--left', {}, energy, draw),
			hand,
			h('div.cbt-side.cbt-side--right', {}, h('div.cbt-endwrap', {}, timer, endBtn), discard),
		)
		ui.append(h('div.cbt-top', {}, foe.root, party), banner, log, bottom, credit)
		el.append(ui)

		// ---------- helpers ----------
		const youSeat = () => view.you
		const me = () => view.fighters.find((f) => f.seat === view.you)
		const nameOf = (seat) => (seat === view.you ? 'You' : view.fighters.find((f) => f.seat === seat)?.name || `Reader ${seat + 1}`)
		const plates = new Map() // seat -> {root, hp, bar, status, state, floats}
		const shownHp = new Map() // seat -> hp currently displayed (animated during the Warden's turn)

		const say = (text, kind = '', ms = 3000) => {
			const li = h('li.cbt-log__line' + (kind ? '.cbt-log__line--' + kind : ''), {text})
			log.append(li)
			while (log.children.length > 3) log.firstElementChild.remove()
			setTimeout(() => li.classList.add('is-gone'), ms)
			setTimeout(() => li.remove(), ms + 600)
		}
		let bannerTimer = 0
		const showBanner = (text, ms = 1100) => {
			clearTimeout(bannerTimer)
			banner.replaceChildren(h('div.ever-banner', {text}))
			bannerTimer = setTimeout(() => banner.replaceChildren(), ms)
		}
		const float = (host, text, kind) => {
			if (!host) return
			const f = h('span.ever-float.cbt-float.ever-float--' + kind, {text})
			// Numbers on the Warden rise from above its head in the 3D view (QA: they landed
			// on the HP bar). Fallback without a world: under the Warden panel.
			const head = host === foe.root ? wardenHead() : null
			if (head) {
				f.classList.add('cbt-float--world')
				f.style.left = `${head.x + (Math.random() - 0.5) * 40}px`
				f.style.top = `${head.y}px`
				ui.append(f)
			} else {
				f.style.left = `${40 + Math.random() * 20}%`
				host.append(f)
			}
			setTimeout(() => f.remove(), 760)
		}
		const wardenHead = () => {
			const w = stage.warden
			if (!w || typeof ctx.world?.screenPoint !== 'function') return null
			try {
				return ctx.world.screenPoint(w.position.x, w.position.y + 3.6, w.position.z)
			} catch {
				return null
			}
		}
		// Larger copy of the hovered / focused card above the hand (QA: card text was small).
		const preview = h('div.cbt-preview', {'aria-hidden': 'true'})
		const showPreview = (c, node) => {
			if (!matchMedia('(hover: hover) and (pointer: fine)').matches && node.dataset.pointer !== 'keyboard') return
			const big = cardElement(c, {tag: 'div'})
			big.classList.toggle('is-upgraded', Boolean(c.upgraded))
			preview.replaceChildren(big)
			const r = node.getBoundingClientRect()
			const half = 115
			preview.style.left = `${Math.min(innerWidth - half - 8, Math.max(half + 8, r.left + r.width / 2))}px`
			preview.style.bottom = `${innerHeight - r.top + 18}px`
			preview.classList.add('is-on')
		}
		const hidePreview = () => preview.classList.remove('is-on')
		ui.append(preview)
		const bump = (node) => {
			if (!node || REDUCED_MOTION) return
			node.classList.remove('is-hit')
			void node.offsetWidth
			node.classList.add('is-hit')
		}
		const statusChips = (box, powers, block) => {
			box.replaceChildren()
			if (block > 0) box.append(h('span.ever-status.ever-status--block', {text: `Block ${block}`, title: 'Block absorbs damage until the next turn.'}))
			if (powers.vulnerable) box.append(h('span.ever-status.ever-status--vulnerable', {text: `Vulnerable ${powers.vulnerable}`, title: 'Takes 50% more damage.'}))
			if (powers.weak) box.append(h('span.ever-status.ever-status--weak', {text: `Weak ${powers.weak}`, title: 'Deals 25% less damage.'}))
		}
		const setBar = (bar, hp, max) => bar.style.setProperty('--ever-fill', `${Math.max(0, Math.min(100, (hp / Math.max(1, max)) * 100))}%`)

		function plateFor(f) {
			let p = plates.get(f.seat)
			if (p) return p
			p = {
				root: h('article.cbt-plate.ever-panel', {'data-seat': String(f.seat + 1)}),
				name: h('span.cbt-plate__name'),
				hp: h('span.cbt-hp'),
				bar: h('span.ever-bar.cbt-bar', {}, h('i')),
				status: h('div.cbt-status'),
				state: h('span.cbt-plate__state'),
			}
			p.root.append(h('div.cbt-plate__head', {}, h('span.ever-seat', {'data-seat': String(f.seat + 1)}), p.name, p.state), h('div.cbt-hprow', {}, p.bar, p.hp), p.status)
			plates.set(f.seat, p)
			party.append(p.root)
			return p
		}

		// ---------- render ----------
		let selectedId = null
		const cardEls = new Map() // id -> element
		let locked = false
		const pending = new Set() // card ids sent to the driver, not yet answered

		function renderFoe() {
			const w = view.warden
			foe.hp.textContent = `${w.hp}/${w.maxHp}`
			setBar(foe.bar, w.hp, w.maxHp)
			statusChips(foe.status, w.powers, w.block)
			foe.intents.replaceChildren(
				...w.intents.map((i) => {
					const label = (coop ? `→ ${nameOf(i.seat)}: ` : '') + i.label
					const kind = i.step === 2 ? '.ever-intent--block' : i.step === 3 ? '.ever-intent--debuff' : ''
					const tip = i.step === 4 && i.seat === youSeat() && view.tip ? 'Have your block ready.' : null
					const li = h('li.ever-intent.cbt-intent' + kind + (i.skipped ? '.is-skipped' : ''), {title: tip, 'data-step': String(i.step)})
					li.append(h('span.cbt-intent__icons', {}, ...intentIconKinds(i).map(intentIcon)), h('span.cbt-intent__label', {text: label}))
					if (tip) li.append(h('span.cbt-intent__tip', {text: tip}))
					return li
				}),
			)
		}
		function renderParty() {
			for (const f of view.fighters) {
				const p = plateFor(f)
				p.name.textContent = coop ? `${f.name}${f.seat === view.you ? ' (you)' : ''}` : 'You'
				const hp = f.hp
				shownHp.set(f.seat, hp)
				p.hp.textContent = `HP ${hp}/${f.maxHp}`
				setBar(p.bar, hp, f.maxHp)
				statusChips(p.status, f.powers, f.block)
				p.root.classList.toggle('is-you', f.seat === view.you)
				p.root.classList.toggle('is-down', f.dead)
				p.root.classList.toggle('is-away', !f.connected || f.removed)
				p.root.classList.toggle('is-ended', f.ended && !f.dead)
				p.state.textContent = f.dead ? 'Fallen' : f.removed ? 'Left' : !f.connected ? 'Away' : coop && f.ended ? 'Ended' : ''
			}
		}
		function renderHand() {
			const ids = new Set(view.hand.map((c) => c.id))
			for (const [id, node] of cardEls) {
				if (!ids.has(id)) {
					node.remove()
					cardEls.delete(id)
				}
			}
			let fresh = 0
			view.hand.forEach((c, i) => {
				let node = cardEls.get(c.id)
				if (!node) {
					node = cardElement(c, {key: i < 9 ? String(i + 1) : undefined})
					node.addEventListener('pointerdown', (e) => (node.dataset.pointer = e.pointerType || 'mouse'))
					node.addEventListener('click', () => (hidePreview(), onCardClick(c.id, node)))
					node.addEventListener('pointerenter', (e) => e.pointerType === 'mouse' && showPreview(view.hand.find((x) => x.id === c.id) || c, node))
					node.addEventListener('pointerleave', hidePreview)
					node.addEventListener('focus', () => node.matches(':focus-visible') && showPreview(view.hand.find((x) => x.id === c.id) || c, node))
					node.addEventListener('blur', hidePreview)
					if (!REDUCED_MOTION) {
						node.classList.add('cbt-deal')
						node.style.animationDelay = `${fresh++ * 40}ms`
					}
					cardEls.set(c.id, node)
				}
				node.style.visibility = pending.has(c.id) ? 'hidden' : '' // hidden while its play is in flight
				const key = node.querySelector('.cbt-card__key')
				if (key) key.textContent = i < 9 ? String(i + 1) : ''
				node.classList.toggle('is-playable', c.playable && !locked)
				node.classList.toggle('is-selected', c.id === selectedId)
				node.setAttribute('aria-disabled', String(!c.playable))
				hand.append(node) // keeps DOM order = hand order
			})
			hand.dataset.count = String(view.hand.length)
			hand.style.setProperty('--n', String(Math.max(5, view.hand.length)))
		}
		function renderControls() {
			const m = me()
			energy.textContent = m ? `${m.energy}/${m.maxEnergy ?? 3}` : '-'
			energy.classList.toggle('is-empty', Boolean(m && m.energy === 0))
			draw.replaceChildren(h('span.cbt-pile__n', {text: String(m?.drawCount ?? 0)}), h('span', {text: `Draw ${m?.drawCount ?? 0}`}))
			discard.replaceChildren(h('span.cbt-pile__n', {text: String(m?.discardCount ?? 0)}), h('span', {text: `Discard ${m?.discardCount ?? 0}`}))
			const canEnd = Boolean(m && !m.dead && !m.ended && m.connected && !view.over && !locked)
			endBtn.disabled = !canEnd
			endBtn.replaceChildren()
			if (m && m.ended && !m.dead && coop && !view.over) {
				const waiting = view.fighters.filter((f) => !f.dead && !f.removed && f.connected && !f.ended).map((f) => f.name)
				endBtn.append(waiting.length ? `Waiting for ${waiting.join(', ')}...` : 'The Warden moves...')
			} else {
				endBtn.append('End turn ', h('span.ever-btn__key.cbt-keyhint', {text: 'E'}))
			}
			renderTimer()
		}
		function renderTimer() {
			if (!view.timerEndsAt || view.over) {
				timer.textContent = ''
				return
			}
			const s = Math.max(0, Math.ceil((view.timerEndsAt - Date.now()) / 1000))
			timer.textContent = `${s}s`
			timer.classList.toggle('is-urgent', s <= 10)
		}
		const timerTick = setInterval(renderTimer, 250)

		function render() {
			renderFoe()
			renderParty()
			renderHand()
			renderControls()
			ui.classList.toggle('is-locked', locked)
			// The Warden shows the tell of the intent aimed at you (or the first one).
			const w = stage.warden
			if (w && !view.over) {
				const mine = view.warden.intents.find((i) => i.seat === view.you) ?? view.warden.intents[0]
				if (mine) w.setIntentPose(mine.step)
			}
		}

		// ---------- events (animation) ----------
		async function animate(events, next) {
			const slow = events.some((e) => e.k === 'intent')
			if (slow) {
				locked = true
				ui.classList.add('is-locked')
				renderControls()
				for (const c of cardEls.values()) c.classList.remove('is-playable')
			}
			for (const e of events) {
				const plate = plates.get(e.seat)
				switch (e.k) {
					case 'round':
						if (e.amount > 1 || !coop) await wait(slow ? 150 : 0)
						showBanner(coop ? `Round ${e.amount}` : 'Your turn')
						break
					case 'token':
						say(e.seat === view.you || !coop ? e.text : `${nameOf(e.seat)}: ${e.text}`, 'gold', 5000)
						break
					case 'play':
						if (e.seat !== view.you) say(`${nameOf(e.seat)} plays ${e.text}.`)
						break
					case 'damage':
						if (e.seat === -1) {
							if (e.amount > 0) float(foe.root, `-${e.amount}`, 'damage')
							else if (e.blocked > 0) float(foe.root, 'Blocked', 'block')
							bump(foe.root)
							stage.warden?.flash?.()
						}
						break
					case 'block':
						if (e.seat === -1) float(foe.root, `+${e.amount} Block`, 'block')
						else float(plate?.root, `+${e.amount}`, 'block')
						break
					case 'doubt':
						float(plate?.root, `-${e.amount}`, 'doubt')
						say(e.seat === view.you ? `Doubt gnaws at you. (-${e.amount} HP)` : `Doubt gnaws at ${nameOf(e.seat)}. (-${e.amount} HP)`, 'doubt')
						if (plate) {
							const hp = Math.max(0, (shownHp.get(e.seat) ?? 0) - e.amount)
							shownHp.set(e.seat, hp)
							plate.hp.textContent = `HP ${hp}/${view.fighters.find((f) => f.seat === e.seat)?.maxHp ?? 50}`
						}
						break
					case 'intent': {
						const w = stage.warden
						w?.setIntentPose?.(e.step)
						await wait(380)
						w?.lunge?.()
						if (e.step === 4) stage.shake()
						stage.hit(e.seat)
						bump(plate?.root)
						if (e.amount > 0) float(plate?.root, `-${e.amount}`, 'damage')
						else float(plate?.root, 'Blocked', 'block')
						if (plate) {
							const f = view.fighters.find((x) => x.seat === e.seat)
							const hp = Math.max(0, (shownHp.get(e.seat) ?? 0) - e.amount)
							shownHp.set(e.seat, hp)
							plate.hp.textContent = `HP ${hp}/${f?.maxHp ?? 50}`
							setBar(plate.bar, hp, f?.maxHp ?? 50)
						}
						await wait(460)
						break
					}
					case 'death':
						stage.fall(e.seat)
						plate?.root.classList.add('is-down')
						say(e.seat === view.you ? 'You fall.' : `${nameOf(e.seat)} falls.`, 'doubt')
						if (slow) await wait(500)
						break
					case 'end':
						if (e.seat === view.you) await sweepHand()
						else if (coop) say(`${nameOf(e.seat)} ended their turn.`)
						break
					case 'away':
						if (e.seat !== view.you) say(`${nameOf(e.seat)} lost connection.`)
						break
					case 'back':
						// my own return is announced by the "You're back in the room." toast
						if (e.seat !== view.you) say(`${nameOf(e.seat)} is back.`)
						break
					case 'removed':
						say(`${nameOf(e.seat)} left the fight.`)
						break
					case 'win':
						stage.warden?.setPose?.('dead')
						showBanner('The Warden falls.', 2400)
						break
					case 'lose':
						showBanner(coop ? 'The Warden stands. Every book at the gate is closed.' : 'The Warden stands.', 2400)
						break
				}
			}
			view = next
			if (slow) {
				locked = false
				stage.warden?.setPose?.('idle')
			}
			render()
			ctx.bus?.emit?.(EV.COMBAT_VIEW, {view})
		}

		// Give the screen fade a moment so the start-of-fight lines (tokens) are seen.
		let chain = wait(400)
		if (firstEvents?.length) chain = chain.then(() => animate(firstEvents, view))
		const offView = driver.onView((v, events = []) => {
			chain = chain.then(() => animate(events, v)).catch((e) => console.error('[combat] animate', e))
		})

		// ---------- input ----------
		function deny(node, text) {
			if (node) {
				node.classList.remove('is-denied')
				void node.offsetWidth
				node.classList.add('is-denied')
			}
			say(text, 'doubt')
		}
		function flyGhost(node) {
			if (!node?.getBoundingClientRect) return
			const r = node.getBoundingClientRect()
			const t = foe.root.getBoundingClientRect()
			const g = node.cloneNode(true)
			g.classList.add('cbt-ghost')
			g.classList.remove('is-selected', 'cbt-deal')
			Object.assign(g.style, {left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, animationDelay: '0ms'})
			el.append(g)
			const dx = t.left + t.width / 2 - (r.left + r.width / 2)
			const dy = t.top + t.height / 2 - (r.top + r.height / 2)
			const dur = REDUCED_MOTION ? 80 : 220
			const frames = REDUCED_MOTION
				? [{opacity: 1}, {opacity: 0}]
				: [
						{transform: 'translate(0, -12px) scale(1.06)', opacity: 1},
						{transform: `translate(${dx * 0.6}px, ${dy * 0.6}px) scale(0.7) rotate(-6deg)`, opacity: 0.9, offset: 0.7},
						{transform: `translate(${dx}px, ${dy}px) scale(0.45) rotate(-10deg)`, opacity: 0},
					]
			try {
				g.animate(frames, {duration: dur, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', fill: 'forwards'}).onfinish = () => g.remove()
			} catch {
				g.remove()
			}
			setTimeout(() => g.remove(), dur + 200)
		}
		/** End of my turn: what is left in my hand slides into the discard pile. */
		async function sweepHand() {
			const nodes = [...cardEls.values()]
			cardEls.clear()
			if (!nodes.length) return
			const to = discard.getBoundingClientRect()
			const dur = REDUCED_MOTION ? 80 : 260
			nodes.forEach((n, i) => {
				n.classList.remove('is-playable', 'is-selected', 'cbt-deal')
				const r = n.getBoundingClientRect()
				const dx = to.left + to.width / 2 - (r.left + r.width / 2)
				const dy = to.top + to.height / 2 - (r.top + r.height / 2)
				const frames = REDUCED_MOTION
					? [{opacity: 1}, {opacity: 0}]
					: [{transform: 'none', opacity: 1}, {transform: `translate(${dx}px, ${dy}px) scale(0.3) rotate(14deg)`, opacity: 0}]
				try {
					n.animate(frames, {duration: dur, delay: REDUCED_MOTION ? 0 : i * 35, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', fill: 'forwards'})
				} catch {}
			})
			await wait(dur + nodes.length * 35)
			for (const n of nodes) n.remove()
		}
		async function playCard(id, node) {
			if (locked || view.over) return
			const card = view.hand.find((c) => c.id === id)
			if (!card) return
			const m = me()
			if (!m || m.dead) return deny(node, DENY.not_in_fight)
			if (m.ended) return deny(node, DENY.not_your_turn)
			if (card.unplayable) return deny(node, card.name === 'Doubt' ? "Doubt can't be played." : DENY.unplayable)
			if (card.energy > m.energy) return deny(node, DENY.energy)
			if (!card.playable) return deny(node, DENY.unplayable)
			selectedId = null
			flyGhost(node)
			node.style.visibility = 'hidden'
			pending.add(id)
			const r = await driver.play(id).finally(() => pending.delete(id))
			if (!r.ok) {
				node.style.visibility = ''
				deny(node, DENY[r.error] ?? DENY.unplayable)
			}
		}
		function onCardClick(id, node) {
			// Touch: first tap lifts the card, second tap plays it. Mouse/keyboard: play at once.
			if (node.dataset.pointer === 'touch' && selectedId !== id) {
				selectedId = id
				for (const [cid, n] of cardEls) n.classList.toggle('is-selected', cid === id)
				node.dataset.pointer = ''
				return
			}
			node.dataset.pointer = ''
			playCard(id, node)
		}
		async function endTurn() {
			const m = me()
			if (locked || view.over || !m || m.ended || m.dead) return
			selectedId = null
			endBtn.disabled = true
			await driver.endTurn()
		}
		endBtn.addEventListener('click', endTurn)
		const onKey = (e) => {
			if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return
			const t = /** @type {HTMLElement} */ (e.target)
			if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
			if (e.key === 'e' || e.key === 'E') {
				e.preventDefault()
				endTurn()
			} else if (/^[1-9]$/.test(e.key)) {
				const c = view.hand[Number(e.key) - 1]
				if (c) {
					e.preventDefault()
					playCard(c.id, cardEls.get(c.id))
				}
			}
		}
		addEventListener('keydown', onKey)

		render()
		ctx.bus?.emit?.(EV.COMBAT_VIEW, {view})
		// One teaching line for the first turn (QA: the fight is harsh without instructions).
		setTimeout(() => !view.over && say(TIP_BLOCK, 'gold', 7000), 900)

		let closed = false
		const close = () => {
			if (closed) return
			closed = true
			offView()
			clearInterval(timerTick)
			clearTimeout(bannerTimer)
			removeEventListener('keydown', onKey)
			stage.dispose()
			el.replaceChildren()
			el.classList.remove('cbt-layer')
			el.hidden = true
			teardown = null
		}
		teardown = close

		const result = await driver.done
		await chain
		await wait(result.won ? 1800 : 1600)
		close()
		return result
	}

	return {
		run,
		dispose() {
			teardown?.()
		},
	}
}
