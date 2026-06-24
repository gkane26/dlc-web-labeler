import { useState, useEffect } from 'react'

/**
 * Hook to load an HTMLImageElement from a URL.
 * Returns [image, status] where status is 'loading' | 'loaded' | 'error' | 'empty'
 */
export default function useImage(url) {
  const [state, setState] = useState({ image: null, status: 'empty' })

  useEffect(() => {
    if (!url) {
      setState({ image: null, status: 'empty' })
      return
    }

    setState({ image: null, status: 'loading' })

    const img = new window.Image()
    img.crossOrigin = 'anonymous'

    img.onload = () => {
      setState({ image: img, status: 'loaded' })
    }
    img.onerror = () => {
      setState({ image: null, status: 'error' })
    }

    img.src = url

    return () => {
      img.onload = null
      img.onerror = null
    }
  }, [url])

  return [state.image, state.status]
}
