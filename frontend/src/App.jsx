import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Box, CssBaseline, ThemeProvider, createTheme, CircularProgress, Typography } from '@mui/material'
import { v4 as uuidv4 } from 'uuid'

import { fetchConfig, fetchConfigStatus, fetchFrame, submitLabels, releaseFrame } from './api'
import { generatePaletteColors } from './utils/colors'
import { useWebSocket } from './hooks/useWebSocket'
import { useHeartbeat } from './hooks/useHeartbeat'

import SignInModal from './components/SignInModal'
import ConfigUploadModal from './components/ConfigUploadModal'
import TitleBar from './components/TitleBar'
import LeftSidebar from './components/LeftSidebar'
import LabelCanvas from './components/LabelCanvas'
import RightSidebar from './components/RightSidebar'
import StaleDialog from './components/dialogs/StaleDialog'
import NoFramesDialog from './components/dialogs/NoFramesDialog'
import ServerStoppedDialog from './components/dialogs/ServerStoppedDialog'

const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#4fc3f7' },
    background: { default: '#121212', paper: '#1e1e1e' },
  },
})

/**
 * Build an initial labels object with all bodyparts set to null.
 */
function buildEmptyLabels(bodyparts) {
  const obj = {}
  for (const bp of bodyparts) obj[bp] = null
  return obj
}

/**
 * Merge incoming human_labels into a full labels object (all bodyparts present).
 */
function mergeLabels(bodyparts, humanLabels) {
  const obj = {}
  for (const bp of bodyparts) {
    obj[bp] = (humanLabels && humanLabels[bp] != null) ? humanLabels[bp] : null
  }
  return obj
}

/**
 * Find the first unlabeled keypoint index, or last if all labeled.
 */
function firstUnlabeled(bodyparts, labels) {
  for (let i = 0; i < bodyparts.length; i++) {
    if (!labels || labels[bodyparts[i]] == null) return i
  }
  return bodyparts.length - 1
}

export default function App() {
  // Auth state
  const [auth, setAuth] = useState(null) // {clientId}
  const [token, setToken] = useState(null) // raw token string for config upload
  const [configNeeded, setConfigNeeded] = useState(false) // true when server has no config
  const [configStatusChecked, setConfigStatusChecked] = useState(false) // true once /api/config/status has resolved
  const [switchingProject, setSwitchingProject] = useState(false) // true during project switch
  const switchingProjectRef = useRef(false) // ref mirror for WS effect (avoids stale closure)

  // Config state
  const [config, setConfig] = useState(null)
  const [configLoading, setConfigLoading] = useState(false)
  const [configError, setConfigError] = useState(null)

  // Frame state
  const [frameData, setFrameData] = useState(null)    // full frame response
  const [frameLoading, setFrameLoading] = useState(false)
  const [frameError, setFrameError] = useState(null)

  // Labels state (working copy)
  const [labels, setLabels] = useState(null)          // bodypart -> {x,y,occluded?} | null
  const [labelHistory, setLabelHistory] = useState([]) // for undo: array of { labels, selectedKeypoint }
  const labelsRef = useRef(labels)
  labelsRef.current = labels

  // UI state
  const [selectedKeypoint, setSelectedKeypoint] = useState(null)
  const selectedKeypointRef = useRef(selectedKeypoint)
  selectedKeypointRef.current = selectedKeypoint
  const [onlyUnlabeled, setOnlyUnlabeled] = useState(true)
  const [selectedVideo, setSelectedVideo] = useState(null)
  const [dotSize, setDotSize] = useState(6)
  const [colorScheme, setColorScheme] = useState('rainbow')

  // Pending navigation (saved after submit resolves)
  const pendingNavRef = useRef(null)

  // Overwrite flag for stale sessions
  const [useOverwrite, setUseOverwrite] = useState(false)

  // Dialog state
  const [staleOpen, setStaleOpen] = useState(false)
  const [frameTaken, setFrameTaken] = useState(false)
  const [noFramesOpen, setNoFramesOpen] = useState(false)
  const [serverStoppedOpen, setServerStoppedOpen] = useState(false)

  // WebSocket
  const { lastMessage } = useWebSocket(auth?.clientId || null)

  // Heartbeat session
  const heartbeatSession = auth && frameData && config ? {
    client_id: auth.clientId,
    username: config.scorer || '',
    video: frameData.video,
    frame_idx: frameData.frame_idx,
  } : null
  useHeartbeat(heartbeatSession)

  // Generate colors
  const colors = config?.bodyparts
    ? generatePaletteColors(colorScheme, config.bodyparts.length)
    : []

  // -----------------------------------------------------------------------
  // Handle WebSocket messages
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!lastMessage) return
    const { type } = lastMessage

    if (type === 'stale') {
      setStaleOpen(true)
      setFrameTaken(false)
    } else if (type === 'frame_taken') {
      // If stale dialog is already open, upgrade the message
      setFrameTaken(true)
    } else if (type === 'server_shutdown') {
      if (!switchingProjectRef.current) {
        setServerStoppedOpen(true)
      }
    }
  }, [lastMessage])

  // -----------------------------------------------------------------------
  // Load config after sign-in
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!auth || configNeeded || !configStatusChecked) return
    setConfigLoading(true)
    setConfigError(null)
    fetchConfig()
      .then(cfg => {
        setConfig(cfg)
        setConfigLoading(false)
        if (cfg.dotsize) setDotSize(cfg.dotsize)
        if (cfg.videos?.length > 0) {
          setSelectedVideo(cfg.videos[0])
        }
      })
      .catch(err => {
        setConfigError(err.message)
        setConfigLoading(false)
      })
  }, [auth, configNeeded, configStatusChecked])

  // -----------------------------------------------------------------------
  // Load first frame after config loads
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!auth || !config || !selectedVideo) return
    loadFrame({ video: selectedVideo, only_unlabeled: onlyUnlabeled })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]) // Only on config load — not on every selectedVideo change

  // -----------------------------------------------------------------------
  // Frame loading helper
  // -----------------------------------------------------------------------
  const loadFrame = useCallback(async (params) => {
    if (!auth || !config) return
    setFrameLoading(true)
    setFrameError(null)
    try {
      const data = await fetchFrame({
        client_id: auth.clientId,
        username: config?.scorer || '',
        video: params.video ?? selectedVideo,
        only_unlabeled: params.only_unlabeled ?? onlyUnlabeled,
        frame_idx: params.frame_idx,
        after_frame_idx: params.after_frame_idx,
        before_frame_idx: params.before_frame_idx,
      })
      setFrameData(data)
      setSelectedVideo(data.video)

      // Set labels from human_labels or empty
      const merged = mergeLabels(config.bodyparts, data.human_labels)
      setLabels(merged)
      setLabelHistory([])
      setUseOverwrite(false)

      // Select first unlabeled keypoint
      const firstIdx = firstUnlabeled(config.bodyparts, merged)
      setSelectedKeypoint(config.bodyparts[firstIdx] || null)
    } catch (err) {
      if (err.status === 409) {
        if (err.detail === 'No free frames available') {
          setNoFramesOpen(true)
        } else {
          setFrameError(err.detail || err.message)
        }
      } else {
        setFrameError(err.message)
      }
    } finally {
      setFrameLoading(false)
    }
  }, [auth, config, selectedVideo, onlyUnlabeled])

  // -----------------------------------------------------------------------
  // Submit current labels (returns true on success)
  // -----------------------------------------------------------------------
  const submitCurrentLabels = useCallback(async (overwrite = false) => {
    if (!auth || !frameData || !labels || !config) return true
    // Check if there are any labels to submit
    const hasAnyLabel = Object.values(labels).some(v => v !== null)
    if (!hasAnyLabel) return true // Nothing to save

    try {
      await submitLabels({
        client_id: auth.clientId,
        username: config?.scorer || '',
        video: frameData.video,
        frame_idx: frameData.frame_idx,
        labels,
        overwrite: overwrite || useOverwrite,
      })
      return true
    } catch (err) {
      if (err.isStale) {
        return 'stale'
      }
      setFrameError(`Save failed: ${err.message}`)
      return false
    }
  }, [auth, frameData, labels, config, useOverwrite])

  // -----------------------------------------------------------------------
  // Navigation: save then load
  // -----------------------------------------------------------------------
  const navigateToFrame = useCallback(async (params) => {
    const result = await submitCurrentLabels()
    if (result === 'stale') {
      // Store the intended navigation
      pendingNavRef.current = params
      setStaleOpen(true)
      return
    }
    await loadFrame(params)
  }, [submitCurrentLabels, loadFrame])

  const handleNext = useCallback(() => {
    if (!frameData) return
    navigateToFrame({
      video: selectedVideo,
      only_unlabeled: onlyUnlabeled,
      after_frame_idx: frameData.frame_idx,
    })
  }, [frameData, selectedVideo, onlyUnlabeled, navigateToFrame])

  const handlePrev = useCallback(() => {
    if (!frameData) return
    navigateToFrame({
      video: selectedVideo,
      only_unlabeled: onlyUnlabeled,
      before_frame_idx: frameData.frame_idx,
    })
  }, [frameData, selectedVideo, onlyUnlabeled, navigateToFrame])

  const handleFrameSlider = useCallback((frameIdx) => {
    navigateToFrame({
      video: selectedVideo,
      only_unlabeled: false,
      frame_idx: frameIdx,
    })
  }, [selectedVideo, navigateToFrame])

  const handleVideoChange = useCallback(async (newVideo) => {
    if (newVideo === selectedVideo) return
    const result = await submitCurrentLabels()
    if (result === 'stale') {
      pendingNavRef.current = { video: newVideo, only_unlabeled: onlyUnlabeled }
      setStaleOpen(true)
      return
    }
    setSelectedVideo(newVideo)
    await loadFrame({ video: newVideo, only_unlabeled: onlyUnlabeled })
  }, [selectedVideo, onlyUnlabeled, submitCurrentLabels, loadFrame])

  const handleOnlyUnlabeledChange = useCallback((value) => {
    setOnlyUnlabeled(value)
  }, [])

  // -----------------------------------------------------------------------
  // Stale dialog handlers
  // -----------------------------------------------------------------------
  const handleStaleContinue = useCallback(() => {
    setStaleOpen(false)
    setUseOverwrite(true)
    pendingNavRef.current = null
  }, [])

  const handleStaleGetNextFrame = useCallback(async () => {
    setStaleOpen(false)
    setUseOverwrite(false)
    if (frameData) {
      await releaseFrame({
        client_id: auth.clientId,
        username: config?.scorer || '',
        video: frameData.video,
        frame_idx: frameData.frame_idx,
      })
    }
    const nav = pendingNavRef.current
    pendingNavRef.current = null
    if (nav) {
      await loadFrame(nav)
    } else {
      await loadFrame({
        video: selectedVideo,
        only_unlabeled: onlyUnlabeled,
        after_frame_idx: frameData?.frame_idx,
      })
    }
  }, [auth, frameData, selectedVideo, onlyUnlabeled, loadFrame])

  // -----------------------------------------------------------------------
  // Label placement callbacks
  // -----------------------------------------------------------------------
  const pushLabelHistory = useCallback((actionKeypoint) => {
    setLabelHistory(prev => [
      ...prev,
      {
        labels: { ...(labelsRef.current || {}) },
        selectedKeypoint: actionKeypoint ?? selectedKeypointRef.current ?? null,
      },
    ])
  }, [])

  const handleLabelPlace = useCallback((bodypart, coords) => {
    if (!config) return
    pushLabelHistory(bodypart)
    setLabels(prev => ({ ...prev, [bodypart]: { x: coords.x, y: coords.y } }))

    // Auto-advance to next unlabeled keypoint
    const updatedLabels = { ...(labelsRef.current || {}), [bodypart]: { x: coords.x, y: coords.y } }
    const nextIdx = firstUnlabeled(config.bodyparts, updatedLabels)
    setSelectedKeypoint(config.bodyparts[nextIdx] || bodypart)
  }, [config, pushLabelHistory])

  const handleLabelMove = useCallback((bodypart, coords) => {
    pushLabelHistory(bodypart)
    setLabels(prev => ({
      ...prev,
      [bodypart]: { ...(prev[bodypart] || {}), x: coords.x, y: coords.y },
    }))
  }, [pushLabelHistory])

  const handleOcclude = useCallback((bodypart) => {
    const currentLabel = labelsRef.current?.[bodypart]
    pushLabelHistory(bodypart)
    const isCurrentlyOccluded = !!(currentLabel?.occluded)
    const willBeOccluded = !isCurrentlyOccluded && !(currentLabel?.occluded && currentLabel?.x < 0)

    setLabels(prev => {
      const existing = prev[bodypart]
      if (existing == null) {
        return { ...prev, [bodypart]: { x: -1, y: -1, occluded: true } }
      }
      if (existing.occluded && existing.x < 0) {
        // Sentinel occluded → reset to unplaced
        return { ...prev, [bodypart]: null }
      }
      return { ...prev, [bodypart]: { ...existing, occluded: !existing.occluded } }
    })

    // Auto-advance to next unplaced keypoint when marking as occluded
    if (!isCurrentlyOccluded && config?.bodyparts) {
      const nextLabels = { ...(labelsRef.current || {}), [bodypart]: { x: -1, y: -1, occluded: true } }
      const nextIdx = firstUnlabeled(config.bodyparts, nextLabels)
      setSelectedKeypoint(config.bodyparts[nextIdx] || bodypart)
    }
  }, [config, pushLabelHistory])

  const handleSelectKeypoint = useCallback((bodypart) => {
    setSelectedKeypoint(bodypart)
  }, [])

  // Occluded state for the selected keypoint
  const selectedOccluded = selectedKeypoint && labels
    ? !!(labels[selectedKeypoint]?.occluded)
    : false

  const handleOccludedCheckbox = useCallback((value) => {
    if (!selectedKeypoint) return
    const existing = labelsRef.current?.[selectedKeypoint]

    if (existing == null && !value) return
    if (existing != null && !!existing.occluded === value) return

    pushLabelHistory(selectedKeypoint)

    setLabels(prev => {
      const cur = prev[selectedKeypoint]
      if (cur == null) {
        if (!value) return prev
        return { ...prev, [selectedKeypoint]: { x: -1, y: -1, occluded: true } }
      }
      if (!value && cur.x < 0) {
        return { ...prev, [selectedKeypoint]: null }
      }
      return { ...prev, [selectedKeypoint]: { ...cur, occluded: value } }
    })
    // Auto-advance when marking as occluded
    if (value && !(existing?.occluded) && config?.bodyparts) {
      const nextLabels = { ...(labelsRef.current || {}), [selectedKeypoint]: { x: -1, y: -1, occluded: true } }
      const nextIdx = firstUnlabeled(config.bodyparts, nextLabels)
      setSelectedKeypoint(config.bodyparts[nextIdx] || selectedKeypoint)
    }
  }, [selectedKeypoint, config, pushLabelHistory])

  // -----------------------------------------------------------------------
  // Keyboard shortcuts
  // -----------------------------------------------------------------------
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Don't fire shortcuts when typing in inputs
      const tag = document.activeElement?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (document.activeElement?.isContentEditable) return

      // ArrowRight or ] — next frame
      if (e.key === 'ArrowRight' || e.key === ']') {
        e.preventDefault()
        handleNext()
        return
      }

      // ArrowLeft or [ — prev frame
      if (e.key === 'ArrowLeft' || e.key === '[') {
        e.preventDefault()
        handlePrev()
        return
      }

      // O — toggle occluded (works whether keypoint is placed or not)
      if (e.key === 'o' || e.key === 'O') {
        if (selectedKeypoint) {
          handleOcclude(selectedKeypoint)
        }
        return
      }

      // Z or Ctrl+Z — undo last label placement
      if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault()
        setLabelHistory(prev => {
          if (prev.length === 0) return prev
          const newHistory = [...prev]
          const previousState = newHistory.pop()
          if (previousState && Object.prototype.hasOwnProperty.call(previousState, 'labels')) {
            setLabels(previousState.labels)
            setSelectedKeypoint(previousState.selectedKeypoint ?? null)
          } else {
            setLabels(previousState)
          }
          return newHistory
        })
        return
      }

      // 1-9 — select keypoint by index
      if (/^[1-9]$/.test(e.key) && config?.bodyparts) {
        const idx = parseInt(e.key, 10) - 1
        if (idx < config.bodyparts.length) {
          setSelectedKeypoint(config.bodyparts[idx])
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleNext, handlePrev, selectedKeypoint, labels, handleOcclude, config])

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  // Sign-in handler: check config status after auth
  const handleSignIn = useCallback(async ({ clientId, token: rawToken }) => {
    setAuth({ clientId })
    setToken(rawToken)
    try {
      const status = await fetchConfigStatus()
      if (!status.loaded) setConfigNeeded(true)
      // else: configNeeded stays false — fetchConfig useEffect will fire once
      // configStatusChecked is set to true below
    } catch {
      // Status check failed — show the config browser rather than crashing
      setConfigNeeded(true)
    } finally {
      setConfigStatusChecked(true)
    }
  }, [])

  // Config-upload success handler
  const handleConfigLoaded = useCallback(() => {
    setSwitchingProject(false)
    switchingProjectRef.current = false
    // Clear old project state before re-enabling the config-fetch useEffect
    setConfig(null)
    setFrameData(null)
    setLabels(null)
    setLabelHistory([])
    setFrameError(null)
    setConfigError(null)
    setSelectedVideo(null)
    setSelectedKeypoint(null)
    setUseOverwrite(false)
    // configStatusChecked is already true (set during sign-in); setting configNeeded(false)
    // re-enables the fetchConfig useEffect which will fire exactly once.
    setConfigNeeded(false)
  }, [])

  // Switch project handler: auto-save then show config browser
  const handleSwitchProject = useCallback(async () => {
    setSwitchingProject(true)
    switchingProjectRef.current = true
    // Auto-save current frame labels if any exist
    if (auth && frameData && labels && config) {
      const hasAnyLabel = Object.values(labels).some(v => v !== null)
      if (hasAnyLabel) {
        try { await submitCurrentLabels() } catch { /* best-effort */ }
      }
    }
    // Clear all project-specific state
    setConfig(null)
    setFrameData(null)
    setLabels(null)
    setLabelHistory([])
    setFrameError(null)
    setSelectedVideo(null)
    setSelectedKeypoint(null)
    setUseOverwrite(false)
    // Show the config browser
    setConfigNeeded(true)
  }, [auth, frameData, labels, config, submitCurrentLabels])

  if (!auth) {
    return (
      <ThemeProvider theme={darkTheme}>
        <CssBaseline />
        <SignInModal onSignIn={handleSignIn} />
      </ThemeProvider>
    )
  }

  if (configNeeded) {
    return (
      <ThemeProvider theme={darkTheme}>
        <CssBaseline />
        <ConfigUploadModal token={token} onConfigLoaded={handleConfigLoaded} />
      </ThemeProvider>
    )
  }

  if (configLoading) {
    return (
      <ThemeProvider theme={darkTheme}>
        <CssBaseline />
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 2 }}>
          <CircularProgress />
          <Typography>Loading configuration...</Typography>
        </Box>
      </ThemeProvider>
    )
  }

  if (configError) {
    return (
      <ThemeProvider theme={darkTheme}>
        <CssBaseline />
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
          <Typography color="error">Failed to load config: {configError}</Typography>
        </Box>
      </ThemeProvider>
    )
  }

  const isDisabled = frameLoading || !frameData

  // Determine which machine labels to pass (only when no human labels)
  const hasHumanLabels = labels && Object.values(labels).some(v => v !== null)
  const machineLabelsToShow = hasHumanLabels ? null : frameData?.machine_labels

  return (
    <ThemeProvider theme={darkTheme}>
      <CssBaseline />
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
        {/* Title Bar */}
        <TitleBar
          task={config?.task || ''}
          howtoMarkdown={config?.howto_markdown || ''}
          instructionsMarkdown={config?.instructions_markdown || ''}
          onSwitchProject={handleSwitchProject}
        />

        {/* Main content area */}
        <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden', gap: 0 }}>
          {/* Left Sidebar */}
          <LeftSidebar
            videos={config?.videos || []}
            selectedVideo={selectedVideo}
            onVideoChange={handleVideoChange}
            onPrev={handlePrev}
            onNext={handleNext}
            onlyUnlabeled={onlyUnlabeled}
            onOnlyUnlabeledChange={handleOnlyUnlabeledChange}
            frameIdx={frameData?.frame_idx ?? null}
            totalFrames={frameData?.total_frames ?? null}
            onFrameSliderChange={handleFrameSlider}
            progress={frameData?.progress || null}
            error={frameError}
            disabled={isDisabled}
          />

          {/* Canvas */}
          <LabelCanvas
            imageUrl={frameData?.frame_url || null}
            imageWidth={frameData?.image_width || 0}
            imageHeight={frameData?.image_height || 0}
            labels={labels}
            machineLabels={machineLabelsToShow}
            bodyparts={config?.bodyparts || []}
            colors={colors}
            selectedKeypoint={selectedKeypoint}
            dotSize={dotSize}
            onLabelPlace={handleLabelPlace}
            onLabelMove={handleLabelMove}
            onOcclude={handleOcclude}
            onSelectKeypoint={handleSelectKeypoint}
          />

          {/* Right Sidebar */}
          <RightSidebar
            bodyparts={config?.bodyparts || []}
            colors={colors}
            labels={labels}
            selectedKeypoint={selectedKeypoint}
            onSelectKeypoint={handleSelectKeypoint}
            occluded={selectedOccluded}
            onOccludedChange={handleOccludedCheckbox}
            dotSize={dotSize}
            onDotSizeChange={setDotSize}
            colorScheme={colorScheme}
            onColorSchemeChange={setColorScheme}
          />
        </Box>
      </Box>

      {/* Dialogs */}
      <StaleDialog
        open={staleOpen}
        frameTaken={frameTaken}
        onContinue={handleStaleContinue}
        onGetNextFrame={handleStaleGetNextFrame}
      />
      <NoFramesDialog
        open={noFramesOpen}
        onClose={() => setNoFramesOpen(false)}
      />
      <ServerStoppedDialog open={serverStoppedOpen} />
    </ThemeProvider>
  )
}
