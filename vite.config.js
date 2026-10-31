// EVER build config. Owner: Technical Director. AGPL-3.0-or-later.
// root = game/ (source), output = public/ (served by bridge.mjs, deployed to Cloudflare Pages).
import {fileURLToPath} from 'node:url'
import {defineConfig} from 'vite'

const here = fileURLToPath(new URL('.', import.meta.url))
const ROOMS_DEV = process.env.EVER_ROOMS_URL || 'http://127.0.0.1:8787'

export default defineConfig({
	root: 'game',
	base: './', // relative asset URLs: works at game.dreamz.rest/ and at http://127.0.0.1:1455/
	publicDir: 'static', // game/static/** is copied verbatim (e.g. _headers, favicon.svg, CREDITS.txt)
	build: {
		outDir: '../public',
		emptyOutDir: true,
		// The vendored Slay the Web content uses top-level await (src/content/cards.js).
		target: 'es2022',
		sourcemap: true,
		chunkSizeWarningLimit: 900,
	},
	esbuild: {target: 'es2022'},
	optimizeDeps: {esbuildOptions: {target: 'es2022'}},
	server: {
		port: 5173,
		strictPort: false,
		// vendor/ lives outside the Vite root.
		fs: {allow: [here]},
		// `npm run dev` + `npm run rooms`: the room server is reached same-origin through this proxy.
		proxy: {
			'/room': {target: ROOMS_DEV, ws: true, changeOrigin: true},
		},
	},
	preview: {port: 4173},
	test: {
		dir: here,
		include: ['game/src/**/*.test.js', 'server/**/*.test.js', 'test/unit/**/*.test.js'],
		environment: 'node',
	},
})
