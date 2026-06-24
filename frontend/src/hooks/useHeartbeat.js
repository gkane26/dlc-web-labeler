import { useEffect, useRef } from 'react'
import { sendHeartbeat } from '../api'

const HEARTBEAT_INTERVAL_MS = 30000

/**
 * Custom hook that sends a heartbeat every 30 seconds when there's an active frame checkout.
 *
 * @param {Object|null} session - Active session info or null if no active checkout.
 * @param {string} session.client_id
 * @param {string} session.username
 * @param {string} session.video
 * @param {number} session.frame_idx
 */
export function useHeartbeat(session) {
  const sessionRef = useRef(session)
  sessionRef.current = session

  useEffect(() => {
    if (!session) return

    const interval = setInterval(() => {
      const s = sessionRef.current
      if (s) {
        sendHeartbeat({
          client_id: s.client_id,
          username: s.username,
          video: s.video,
          frame_idx: s.frame_idx,
        }).catch(err => {
          console.warn('Heartbeat error:', err)
        })
      }
    }, HEARTBEAT_INTERVAL_MS)

    return () => clearInterval(interval)
  }, [session?.client_id, session?.video, session?.frame_idx])
}
