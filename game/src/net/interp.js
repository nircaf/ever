// Latency-tolerant interpolation of other players' positions. OWNER: network engineer.
// The room relays positions at 10 Hz. We render each peer a little in the past
// (`delay`), between the two samples around that time, so jitter and a lost frame are
// invisible. Past the newest sample we extrapolate briefly, then hold. Big jumps
// (respawn at page one, server correction) snap instead of sliding across the map.
// Pure: no DOM, no three.
// Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @param {{delay?: number, maxExtrapolate?: number, snapDistance?: number, maxSamples?: number}} [opts]
 */
export function createInterpolator({delay = 130, maxExtrapolate = 150, snapDistance = 8, maxSamples = 10} = {}) {
	/** @type {Map<number, {t: number, x: number, z: number, yaw: number, w: 0|1}[]>} */
	const buf = new Map()

	return {
		/** Add a sample received at local time `t`. */
		push(seat, t, x, z, yaw, w = 0) {
			let a = buf.get(seat)
			if (!a) buf.set(seat, (a = []))
			const last = a[a.length - 1]
			if (last && Math.hypot(x - last.x, z - last.z) > snapDistance) a.length = 0 // teleport: no slide
			if (last && t <= last.t) t = last.t + 1
			a.push({t, x, z, yaw, w: w ? 1 : 0})
			if (a.length > maxSamples) a.splice(0, a.length - maxSamples)
		},
		/** Position to draw at local time `now`, or null if unknown. */
		sample(seat, now) {
			const a = buf.get(seat)
			if (!a || !a.length) return null
			const rt = now - delay
			if (a.length === 1 || rt <= a[0].t) return pick(a[0])
			for (let i = a.length - 1; i > 0; i--) {
				const p = a[i - 1]
				const n = a[i]
				if (rt >= p.t && rt <= n.t) {
					const k = (rt - p.t) / (n.t - p.t)
					return {x: lerp(p.x, n.x, k), z: lerp(p.z, n.z, k), yaw: lerpAngle(p.yaw, n.yaw, k), walking: Boolean(n.w)}
				}
			}
			// rt is past the newest sample: extrapolate a little if they were walking.
			const n = a[a.length - 1]
			const p = a[a.length - 2]
			if (!n.w) return pick(n)
			const ahead = Math.min(rt - n.t, maxExtrapolate)
			const span = n.t - p.t
			const vx = (n.x - p.x) / span
			const vz = (n.z - p.z) / span
			return {x: n.x + vx * ahead, z: n.z + vz * ahead, yaw: n.yaw, walking: rt - n.t < 400}
		},
		remove(seat) {
			buf.delete(seat)
		},
		seats() {
			return [...buf.keys()]
		},
		clear() {
			buf.clear()
		},
	}
}

const pick = (s) => ({x: s.x, z: s.z, yaw: s.yaw, walking: Boolean(s.w)})
const lerp = (a, b, k) => a + (b - a) * k
export function lerpAngle(a, b, k) {
	let d = (b - a) % (2 * Math.PI)
	if (d > Math.PI) d -= 2 * Math.PI
	if (d < -Math.PI) d += 2 * Math.PI
	return a + d * k
}
