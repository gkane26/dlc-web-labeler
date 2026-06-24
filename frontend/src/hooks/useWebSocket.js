import { useEffect, useRef, useState, useCallback } from 'react'

const RECONNECT_DELAY_MS = 3000
const MAX_RECONNECT_DELAY_MS = 30000

/**
 * Custom hook for maintaining a WebSocket connection.
 * Handles automatic reconnection with exponential backoff.
 *
 * @param {string|null} clientId - The client ID to connect with. Pass null to disable.
 * @returns {{ lastMessage: Object|null, sendMessage: Function }}
 */
export function useWebSocket(clientId) {
  const [lastMessage, setLastMessage] = useState(null)
  const wsRef = useRef(null)
  const reconnectDelayRef = useRef(RECONNECT_DELAY_MS)
  const reconnectTimerRef = useRef(null)
  const mountedRef = useRef(true)
  const clientIdRef = useRef(clientId)

  // Keep clientIdRef current
  clientIdRef.current = clientId

  const connect = useCallback(() => {
    if (!clientIdRef.current || !mountedRef.current) return

    // Determine WebSocket URL
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.host
    const url = `${protocol}//${host}/ws/${clientIdRef.current}`

    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      if (!mountedRef.current) return
      reconnectDelayRef.current = RECONNECT_DELAY_MS
    }

    ws.onmessage = (event) => {
      if (!mountedRef.current) return
      try {
        const data = JSON.parse(event.data)
        setLastMessage(data)
      } catch (e) {
        console.warn('Failed to parse WebSocket message:', event.data)
      }
    }

    ws.onclose = (event) => {
      if (!mountedRef.current) return
      wsRef.current = null

      // Don't reconnect if intentionally closed (code 1000) due to server shutdown
      if (event.code === 1000) return

      // Schedule reconnect with backoff
      const delay = reconnectDelayRef.current
      reconnectDelayRef.current = Math.min(delay * 2, MAX_RECONNECT_DELAY_MS)
      reconnectTimerRef.current = setTimeout(() => {
        if (mountedRef.current && clientIdRef.current) {
          connect()
        }
      }, delay)
    }

    ws.onerror = () => {
      // onclose will be called after onerror, handle reconnect there
      ws.close()
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true

    if (clientId) {
      connect()
    }

    return () => {
      mountedRef.current = false
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
      }
      if (wsRef.current) {
        wsRef.current.onclose = null // prevent reconnect on cleanup
        wsRef.current.close(1000, 'Component unmounted')
        wsRef.current = null
      }
    }
  }, [clientId, connect])

  const sendMessage = useCallback((data) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data))
    }
  }, [])

  return { lastMessage, sendMessage }
}
