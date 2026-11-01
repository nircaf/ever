// EVER world bot: a tiny GitHub REST client authenticated as a GitHub App installation.
// WebCrypto only (Workers, Node 20+). `fetchFn` is injected so tests mock the API.
//
//   const gh = createGitHub({appId, privateKey, installationId, owner, repo})
//   await gh.openWorldPr({branch, title, body, message, files: [{path, content}], labels})
//
// Permissions the App needs on nircaf/ever: Contents read/write, Pull requests read/write,
// Metadata read (docs/PLATFORM.md 2). Nothing else.
//
// Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later

const API = 'https://api.github.com'
const enc = new TextEncoder()

const b64url = (bytes) => {
	let s = ''
	for (const b of bytes) s += String.fromCharCode(b)
	return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const b64urlJson = (obj) => b64url(enc.encode(JSON.stringify(obj)))

function derLength(n) {
	if (n < 0x80) return [n]
	const out = []
	while (n > 0) {
		out.unshift(n & 0xff)
		n >>= 8
	}
	return [0x80 | out.length, ...out]
}

/**
 * PEM private key to PKCS#8 DER. GitHub hands out PKCS#1 ("BEGIN RSA PRIVATE KEY"), which
 * WebCrypto cannot import, so it is wrapped in a PKCS#8 envelope here.
 * @param {string} pem
 * @returns {Uint8Array}
 */
export function pemToPkcs8(pem) {
	const text = String(pem).replace(/\\n/g, '\n')
	const pkcs1 = /-----BEGIN RSA PRIVATE KEY-----/.test(text)
	const b64 = text.replace(/-----(BEGIN|END)[^-]+-----/g, '').replace(/\s+/g, '')
	const der = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
	if (!pkcs1) return der
	// SEQUENCE { INTEGER 0, SEQUENCE { OID 1.2.840.113549.1.1.1, NULL }, OCTET STRING { pkcs1 } }
	const algo = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00]
	const octet = [0x04, ...derLength(der.length)]
	const inner = [0x02, 0x01, 0x00, ...algo, ...octet]
	const total = inner.length + der.length
	const out = new Uint8Array(1 + derLength(total).length + total)
	out.set([0x30, ...derLength(total), ...inner], 0)
	out.set(der, out.length - der.length)
	return out
}

/** RS256 JWT for the App (iat 60 s in the past against clock drift, 9 minute life). */
export async function appJwt({appId, privateKey, now = Date.now()}) {
	const key = await crypto.subtle.importKey('pkcs8', pemToPkcs8(privateKey), {name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256'}, false, ['sign'])
	const iat = Math.floor(now / 1000) - 60
	const head = b64urlJson({alg: 'RS256', typ: 'JWT'})
	const body = b64urlJson({iat, exp: iat + 600, iss: String(appId)})
	const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(`${head}.${body}`)))
	return `${head}.${body}.${b64url(sig)}`
}

export class GitHubError extends Error {
	constructor(status, path, body) {
		super(`GitHub ${status} on ${path}: ${String(body?.message ?? '').slice(0, 200)}`)
		this.status = status
		this.body = body
	}
}

const toBase64 = (text) => {
	let s = ''
	for (const b of enc.encode(text)) s += String.fromCharCode(b)
	return btoa(s)
}
const fromBase64 = (b64) => new TextDecoder().decode(Uint8Array.from(atob(String(b64).replace(/\s+/g, '')), (c) => c.charCodeAt(0)))

/**
 * @param {{appId: string, privateKey: string, installationId: string, owner: string, repo: string, base?: string,
 *          fetchFn?: typeof fetch, now?: () => number}} cfg
 */
export function createGitHub({appId, privateKey, installationId, owner, repo, base = 'main', fetchFn = globalThis.fetch.bind(globalThis), now = () => Date.now()}) {
	let token = null
	let tokenExp = 0
	const headers = (auth) => ({authorization: auth, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'ever-world-bot', 'content-type': 'application/json'})

	async function installationToken() {
		if (token && now() < tokenExp - 5 * 60 * 1000) return token
		const jwt = await appJwt({appId, privateKey, now: now()})
		const path = `/app/installations/${installationId}/access_tokens`
		const r = await fetchFn(API + path, {method: 'POST', headers: headers(`Bearer ${jwt}`), body: JSON.stringify({repositories: [repo]})})
		const j = await r.json().catch(() => ({}))
		if (!r.ok) throw new GitHubError(r.status, path, j)
		token = j.token
		tokenExp = Date.parse(j.expires_at) || now() + 50 * 60 * 1000
		return token
	}

	async function req(method, path, body) {
		const t = await installationToken()
		const url = path.startsWith('/graphql') ? API + path : `${API}/repos/${owner}/${repo}${path}`
		const r = await fetchFn(url, {method, headers: headers(`token ${t}`), ...(body ? {body: JSON.stringify(body)} : {})})
		const j = r.status === 204 ? {} : await r.json().catch(() => ({}))
		if (!r.ok) throw new GitHubError(r.status, path, j)
		return j
	}

	return {
		req,
		installationToken,
		/** Head commit sha of the base branch. */
		async baseSha() {
			return (await req('GET', `/git/ref/heads/${base}`)).object.sha
		},
		/** File text at a ref, or null when it does not exist. */
		async readFile(path, ref) {
			try {
				const j = await req('GET', `/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`)
				return j.encoding === 'base64' ? fromBase64(j.content) : null
			} catch (e) {
				if (e.status === 404) return null
				throw e
			}
		},
		/** File names in a folder at a ref. */
		async listDir(path, ref) {
			try {
				const j = await req('GET', `/contents/${path}?ref=${encodeURIComponent(ref)}`)
				return Array.isArray(j) ? j.map((x) => x.name) : []
			} catch (e) {
				if (e.status === 404) return []
				throw e
			}
		},
		/**
		 * One commit with all files on a new branch from `parent`, then a PR. Returns {number, url, nodeId, branch}.
		 * @param {{branch: string, parent: string, title: string, body: string, message: string, files: {path: string, content: string}[], labels?: string[]}} o
		 */
		async openWorldPr({branch, parent, title, body, message, files, labels = []}) {
			const parentCommit = await req('GET', `/git/commits/${parent}`)
			const tree = await req('POST', '/git/trees', {base_tree: parentCommit.tree.sha, tree: files.map((f) => ({path: f.path, mode: '100644', type: 'blob', content: f.content}))})
			const commit = await req('POST', '/git/commits', {message, tree: tree.sha, parents: [parent]})
			await req('POST', '/git/refs', {ref: `refs/heads/${branch}`, sha: commit.sha})
			const pr = await req('POST', '/pulls', {title, head: branch, base, body, maintainer_can_modify: true})
			if (labels.length) await req('POST', `/issues/${pr.number}/labels`, {labels}).catch(() => {})
			return {number: pr.number, url: pr.html_url, nodeId: pr.node_id, branch}
		},
		/** Turn on GitHub auto-merge (squash). Needs "Allow auto-merge" on the repo. Never throws. */
		async enableAutoMerge(nodeId) {
			try {
				const q = 'mutation($id: ID!) { enablePullRequestAutoMerge(input: {pullRequestId: $id, mergeMethod: SQUASH}) { clientMutationId } }'
				const j = await req('POST', '/graphql', {query: q, variables: {id: nodeId}})
				return !j.errors
			} catch {
				return false
			}
		},
		async getPr(number) {
			return req('GET', `/pulls/${number}`)
		},
		async closePr(number, branch, comment) {
			if (comment) await req('POST', `/issues/${number}/comments`, {body: comment}).catch(() => {})
			await req('PATCH', `/pulls/${number}`, {state: 'closed'})
			if (branch) await req('DELETE', `/git/refs/heads/${branch}`).catch(() => {})
		},
		toBase64,
	}
}
