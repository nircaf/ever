// Live check (manual): asks the real model, through the local bridge on :1455, for an NPC moment
// and prints the validated offers. Run: EVER_LIVE=1 npx vitest run src/core/ai/live.test.js
import {it, expect} from 'vitest'
import {createAiTransport} from './bridge.js'
import {runMoment} from './moment.js'

it.runIf(process.env.EVER_LIVE)('real model creates validated new mechanics', async () => {
	const transport = createAiTransport({origin: 'http://127.0.0.1:1455', fetch: (url, o) => fetch(new URL(url, 'http://127.0.0.1:1455'), o)})
	const ctx = {seed: 'KQ7FM2XB', page: 1, pages: 9, themes: {primary: 'forge', secondary: 'well', shadow: 'ash'},
		npc: {id: 'marcus', name: 'Marcus Hale', archetype: 'marcus'}, trust: 1,
		deck: [{uid: 'c1', name: "Tobin's Hammer", keepsake: true}], existingNames: ["Tobin's Hammer"], hp: 50, maxHp: 50,
		playerText: 'Forge me something that burns brighter the more I am hurt.'}
	const res = await runMoment(ctx, {transport})
	console.log(JSON.stringify({source: res.source, reply: res.reply, offers: res.offers.map(o => ({kind: o.kind, label: o.label, def: o.def}))}, null, 1).slice(0, 4000))
	expect(res.offers.length).toBeGreaterThan(0)
}, 90000)
