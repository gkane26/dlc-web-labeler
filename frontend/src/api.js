/**
 * API helper functions for the DLC labeler frontend.
 * All functions return the parsed JSON response or throw on error.
 */

/**
 * Authenticate a user.
 * @param {string} token
 * @returns {Promise<{ok: boolean, client_id: string}>}
 * @throws on 401 (invalid token) or network errors
 */
export async function authUser(token) {
  const res = await fetch('/api/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  })
  if (res.status === 401) {
    throw new Error('Invalid token')
  }
  if (!res.ok) {
    throw new Error(`Auth failed: ${res.status}`)
  }
  return res.json()
}

/**
 * Fetch application config.
 * @returns {Promise<{task, instructions_markdown, howto_markdown, bodyparts, colormap, videos, dotsize, alphavalue, pcutoff}>}
 */
export async function fetchConfig() {
  const res = await fetch('/api/config')
  if (!res.ok) {
    throw new Error(`Config fetch failed: ${res.status}`)
  }
  return res.json()
}

/**
 * Fetch a frame.
 * @param {Object} params
 * @param {string} params.client_id
 * @param {string} params.username
 * @param {string} params.video
 * @param {boolean} params.only_unlabeled
 * @param {number|undefined} params.frame_idx
 * @param {number|undefined} params.after_frame_idx
 * @param {number|undefined} params.before_frame_idx
 * @returns {Promise<Object>} frame data
 * @throws {Error} with .status and .detail for 409 conflicts
 */
export async function fetchFrame({
  client_id,
  username,
  video,
  only_unlabeled,
  frame_idx,
  after_frame_idx,
  before_frame_idx,
}) {
  const params = new URLSearchParams()
  params.set('client_id', client_id)
  params.set('username', username)
  params.set('video', video)
  params.set('only_unlabeled', only_unlabeled ? 'true' : 'false')
  if (frame_idx !== undefined && frame_idx !== null) {
    params.set('frame_idx', frame_idx)
  }
  if (after_frame_idx !== undefined && after_frame_idx !== null) {
    params.set('after_frame_idx', after_frame_idx)
  }
  if (before_frame_idx !== undefined && before_frame_idx !== null) {
    params.set('before_frame_idx', before_frame_idx)
  }

  const res = await fetch(`/api/frame?${params.toString()}`)
  if (res.status === 409) {
    const data = await res.json()
    const err = new Error(data.detail || 'Conflict')
    err.status = 409
    err.detail = data.detail
    throw err
  }
  if (!res.ok) {
    throw new Error(`Frame fetch failed: ${res.status}`)
  }
  return res.json()
}

/**
 * Submit labels for a frame.
 * @param {Object} params
 * @param {string} params.client_id
 * @param {string} params.username
 * @param {string} params.video
 * @param {number} params.frame_idx
 * @param {Object} params.labels - bodypart -> {x, y, occluded?} or null
 * @param {boolean} params.overwrite
 * @returns {Promise<{saved: true}>}
 * @throws {Error} with .status=409 and .isStale=true for stale session
 */
export async function submitLabels({ client_id, username, video, frame_idx, labels, overwrite = false }) {
  const res = await fetch('/api/labels', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id, username, video, frame_idx, labels, overwrite }),
  })
  if (res.status === 409) {
    const data = await res.json()
    if (data.detail && data.detail.error === 'stale_session') {
      const err = new Error('Stale session')
      err.status = 409
      err.isStale = true
      throw err
    }
    throw new Error(`Submit labels conflict: ${JSON.stringify(data)}`)
  }
  if (!res.ok) {
    throw new Error(`Submit labels failed: ${res.status}`)
  }
  return res.json()
}

/**
 * Release a frame (abandon checkout without saving).
 * @param {Object} params
 * @param {string} params.client_id
 * @param {string} params.username
 * @param {string} params.video
 * @param {number} params.frame_idx
 */
export async function releaseFrame({ client_id, username, video, frame_idx }) {
  const res = await fetch('/api/release', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id, username, video, frame_idx }),
  })
  if (!res.ok) {
    // Non-fatal — log but don't throw
    console.warn(`Release frame failed: ${res.status}`)
  }
}

/**
 * Send a heartbeat for the current frame checkout.
 * @param {Object} params
 * @param {string} params.client_id
 * @param {string} params.username
 * @param {string} params.video
 * @param {number} params.frame_idx
 */
export async function sendHeartbeat({ client_id, username, video, frame_idx }) {
  const res = await fetch('/api/heartbeat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id, username, video, frame_idx }),
  })
  if (!res.ok) {
    console.warn(`Heartbeat failed: ${res.status}`)
  }
}
