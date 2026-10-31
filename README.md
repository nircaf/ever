# EVER

**Evolving Virtual Experiences & Reincarnation.** A run is a book. Walk a low-poly village at dusk, earn (or lose) a grieving blacksmith's trust, shape your deck, and fight the Ash Warden in a card combat built on [Slay the Web](https://github.com/oskarrough/slaytheweb). Die once and the book closes; you start a new one. Play alone or host a room for up to 3 friends.

- Design: `docs/GDD.md` · Look: `docs/ART_BIBLE.md` · Code architecture and contracts: `docs/TECH.md`
- Live: https://game.dreamz.rest

## Run locally

Needs Node 20.19+ (22 recommended).

```bash
npm install
npm run build     # builds game/ into public/
npm start         # serves public/ at http://127.0.0.1:1455 (plus the optional AI bridge)
```

Co-op locally: in a second terminal run `npm run rooms` (the room server, `wrangler dev` on http://127.0.0.1:8787, no Cloudflare account needed). The game finds it automatically when it is opened from localhost or 127.0.0.1. Open two browser windows to host and join.

While developing: `npm run dev` (Vite with hot reload on http://127.0.0.1:5173; it proxies `/room` to the room server) and `npm test` (unit tests + bridge smoke test).

## Deploy

- **Game (static)**: Cloudflare Pages. Build command `npm run build`, output directory `public`, custom domain `game.dreamz.rest`.
- **Rooms (multiplayer)**: a Cloudflare Worker with one Durable Object per room, routed at `game.dreamz.rest/room/*`. Enable the `routes` line in `server/wrangler.toml`, then `npx wrangler deploy --config server/wrangler.toml`.

Details and the protocol are in `docs/TECH.md` sections 6 and 7.

## Let Marcus answer with your ChatGPT plan (local only)

The hosted game is fully offline-capable: Marcus is voiced by authored lines and a local rules-based script. When the game is served by the local bridge (`npm start`), you can click **Connect AI** to sign in with ChatGPT (OpenAI's open source, locally hosted flow). The model can only propose a reply, an intent from a fixed list and a small trust change; the game's rules decide every outcome and validate everything the model returns.

- Tokens stay in `~/.config/ever-bridge/credentials.json` (owner-only). The browser never sees them.
- The bridge only answers on 127.0.0.1, rejects other Host and Origin headers, and requires an `X-Ever` header on every POST.
- Usage counts against your ChatGPT plan limits. If the plan is out of allowance or the model fails, the game falls back to the local script.
- `npm run test:bridge` runs the bridge against a fake OpenAI. `node test/fake-openai.mjs` starts the fake for manual runs: `EVER_PORT=1466 EVER_ISS=http://127.0.0.1:9101 EVER_API=http://127.0.0.1:9101/v1 EVER_NO_OPEN=1 node bridge.mjs`.

## License and credits

EVER is free software under the **GNU Affero General Public License v3.0 or later** (`LICENSE`). If you run a modified version for others over a network, you must offer them its source.

Card combat is built on **Slay the Web** by Oskar Rough and contributors (AGPL-3.0-or-later), vendored unchanged from commit `a108c3e` in `vendor/slaytheweb/` (see its `NOTICE.md`). Also uses three.js (MIT) and Immer (MIT). Fonts: Young Serif and Figtree (OFL). All 3D models are built procedurally in code. Full credits: `game/static/CREDITS.txt`.

The previous hand-drawn prototype is kept in `legacy/inkwell-v0.html`, `inkwell-grimoire.html` and `ever-style-forge.html` for reference; it is not built or shipped.
