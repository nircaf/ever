// A small in-memory GitHub REST API for the world-bot tests. It checks the App JWT with
// the public key, keeps one repo (main branch as a path -> text map) and records every call.
// merge(number) applies a PR's files to main, like an auto-merge would.
// Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later

import {createVerify, generateKeyPairSync} from 'node:crypto'

export function makeAppKey() {
	const {privateKey, publicKey} = generateKeyPairSync('rsa', {modulusLength: 2048})
	return {
		pkcs1: privateKey.export({type: 'pkcs1', format: 'pem'}),
		pkcs8: privateKey.export({type: 'pkcs8', format: 'pem'}),
		publicPem: publicKey.export({type: 'spki', format: 'pem'}),
	}
}

export function verifyJwt(jwt, publicPem) {
	const [h, b, sig] = jwt.split('.')
	const v = createVerify('RSA-SHA256')
	v.update(`${h}.${b}`)
	const ok = v.verify(publicPem, Buffer.from(sig, 'base64url'))
	return ok ? JSON.parse(Buffer.from(b, 'base64url').toString('utf8')) : null
}

/**
 * @param {{files: Record<string, string>, publicPem: string, owner?: string, repo?: string, appId?: string}} o
 */
export function createFakeGitHub({files, publicPem, owner = 'nircaf', repo = 'ever', appId = '123'}) {
	const main = {sha: 'c0', files: {...files}}
	const commits = {c0: {tree: 't0', files: {...files}}}
	const trees = {t0: {...files}}
	const refs = {}
	const pulls = {}
	const calls = []
	let n = 0
	let failNext = null
	const res = (status, body) => new Response(status === 204 ? null : JSON.stringify(body), {status, headers: {'content-type': 'application/json'}})
	const prefix = `/repos/${owner}/${repo}`

	async function fetchFn(url, init = {}) {
		const u = new URL(url)
		const method = init.method ?? 'GET'
		const body = init.body ? JSON.parse(init.body) : null
		calls.push({method, path: u.pathname, body})
		if (failNext) {
			const f = failNext
			failNext = null
			return res(f, {message: 'boom'})
		}
		const auth = init.headers?.authorization ?? ''
		if (u.pathname.startsWith('/app/installations/')) {
			const claims = verifyJwt(auth.replace(/^Bearer /, ''), publicPem)
			if (!claims || claims.iss !== appId) return res(401, {message: 'bad jwt'})
			return res(201, {token: 'ghs_test', expires_at: new Date(Date.now() + 3600e3).toISOString()})
		}
		if (auth !== 'token ghs_test') return res(401, {message: 'no token'})
		if (u.pathname === '/graphql') return res(200, {data: {enablePullRequestAutoMerge: {clientMutationId: null}}})
		if (!u.pathname.startsWith(prefix)) return res(404, {message: 'repo'})
		const p = u.pathname.slice(prefix.length)
		let m
		if (method === 'GET' && p === '/git/ref/heads/main') return res(200, {object: {sha: main.sha}})
		if (method === 'GET' && (m = /^\/contents\/(.+)$/.exec(p))) {
			const path = decodeURIComponent(m[1])
			const ref = u.searchParams.get('ref')
			const fs = commits[ref]?.files ?? main.files
			if (fs[path] !== undefined) return res(200, {encoding: 'base64', content: Buffer.from(fs[path]).toString('base64')})
			const kids = Object.keys(fs).filter((k) => k.startsWith(path + '/') && !k.slice(path.length + 1).includes('/'))
			if (kids.length) return res(200, kids.map((k) => ({name: k.slice(path.length + 1), type: 'file'})))
			return res(404, {message: 'Not Found'})
		}
		if (method === 'GET' && (m = /^\/git\/commits\/(\w+)$/.exec(p))) return commits[m[1]] ? res(200, {sha: m[1], tree: {sha: commits[m[1]].tree}}) : res(404, {})
		if (method === 'POST' && p === '/git/trees') {
			const t = `t${++n}`
			trees[t] = {...trees[body.base_tree]}
			for (const e of body.tree) trees[t][e.path] = e.content
			return res(201, {sha: t})
		}
		if (method === 'POST' && p === '/git/commits') {
			const c = `c${++n}`
			commits[c] = {tree: body.tree, files: trees[body.tree], parents: body.parents, message: body.message}
			return res(201, {sha: c})
		}
		if (method === 'POST' && p === '/git/refs') {
			const name = body.ref.replace('refs/heads/', '')
			if (refs[name]) return res(422, {message: 'Reference already exists'})
			refs[name] = body.sha
			return res(201, {ref: body.ref})
		}
		if (method === 'POST' && p === '/pulls') {
			const num = Object.keys(pulls).length + 1
			const commit = commits[refs[body.head]]
			const changed = Object.keys(commit.files).filter((k) => commit.files[k] !== commits[commit.parents[0]].files[k])
			pulls[num] = {number: num, title: body.title, body: body.body, head: body.head, state: 'open', merged: false, changed: Object.fromEntries(changed.map((k) => [k, commit.files[k]])), labels: []}
			return res(201, {number: num, html_url: `https://github.com/${owner}/${repo}/pull/${num}`, node_id: `PR_${num}`})
		}
		if (method === 'POST' && (m = /^\/issues\/(\d+)\/labels$/.exec(p))) {
			pulls[m[1]].labels.push(...body.labels)
			return res(200, [])
		}
		if (method === 'POST' && /^\/issues\/\d+\/comments$/.test(p)) return res(201, {})
		if (method === 'GET' && (m = /^\/pulls\/(\d+)$/.exec(p))) {
			const pr = pulls[m[1]]
			return pr ? res(200, {number: pr.number, state: pr.state, merged: pr.merged}) : res(404, {})
		}
		if (method === 'PATCH' && (m = /^\/pulls\/(\d+)$/.exec(p))) {
			pulls[m[1]].state = body.state
			return res(200, {})
		}
		if (method === 'DELETE' && (m = /^\/git\/refs\/heads\/(.+)$/.exec(p))) {
			delete refs[m[1]]
			return res(204)
		}
		return res(404, {message: `fake: ${method} ${p}`})
	}

	return {
		fetchFn,
		calls,
		pulls,
		main,
		refs,
		failNext: (status) => (failNext = status),
		/** Apply PR files to main (what auto-merge does after green checks). */
		merge(num) {
			const pr = pulls[num]
			const c = `c${++n}`
			const fs = {...main.files, ...pr.changed}
			const t = `t${++n}`
			trees[t] = fs
			commits[c] = {tree: t, files: fs, parents: [main.sha]}
			main.sha = c
			main.files = fs
			pr.state = 'closed'
			pr.merged = true
		},
		/** Commit a file straight to main (a human change). */
		commit(path, text) {
			const fs = {...main.files, [path]: text}
			const c = `c${++n}`
			const t = `t${++n}`
			trees[t] = fs
			commits[c] = {tree: t, files: fs, parents: [main.sha]}
			main.sha = c
			main.files = fs
		},
	}
}
