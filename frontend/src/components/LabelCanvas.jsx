import React, {
  useRef,
  useEffect,
  useState,
  useCallback,
  useMemo,
} from 'react'
import { Stage, Layer, Image as KonvaImage, Circle, Text, Group, Rect, Line } from 'react-konva'
import useImage from './useImage'
import { Box, CircularProgress, Typography, Checkbox, FormControlLabel, Slider } from '@mui/material'

const MIN_SCALE = 0.05
const MAX_SCALE = 10
const TOOLTIP_OFFSET_Y = -24

/**
 * LabelCanvas — the main Konva-based labeling canvas.
 *
 * Props:
 *   imageUrl: string
 *   imageWidth: number
 *   imageHeight: number
 *   labels: Object — bodypart -> {x, y, occluded?} | null  (human labels)
 *   machineLabels: Object — bodypart -> {x, y, confidence, below_pcutoff} | null
 *   bodyparts: string[]
 *   colors: string[]
 *   selectedKeypoint: string | null
 *   dotSize: number
 *   onLabelPlace: fn(bodypart, {x, y})  — image coords
 *   onLabelMove: fn(bodypart, {x, y})   — image coords
 *   onOcclude: fn(bodypart)             — toggle occluded for that bodypart
 *   onSelectKeypoint: fn(bodypart)
 */
export default function LabelCanvas({
  imageUrl,
  imageWidth,
  imageHeight,
  labels,
  machineLabels,
  bodyparts,
  colors,
  selectedKeypoint,
  dotSize,
  onLabelPlace,
  onLabelMove,
  onOcclude,
  onSelectKeypoint,
}) {
  const containerRef = useRef(null)
  const stageRef = useRef(null)
  const spaceHeldRef = useRef(false)

  // Container size state
  const [containerSize, setContainerSize] = useState({ width: 800, height: 600 })

  // Viewport: scale and offset (image top-left position in stage coords)
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })

  // Tooltip state: {x, y, text} in stage coords, or null
  const [tooltip, setTooltip] = useState(null)

  // Drag state ref used to suppress the click that fires after a label drag.
  const didDragRef = useRef(false)

  // Offset ref for use inside mouse move handler (avoids closure stale state)
  const offsetRef = useRef(offset)
  offsetRef.current = offset
  const scaleRef = useRef(scale)
  scaleRef.current = scale

  // Labels ref so handleStageClick can check placement without a stale closure
  const labelsRef = useRef(labels)
  labelsRef.current = labels

  // Guide state: positions stored in image coordinates
  const [showHGuides, setShowHGuides] = useState(false)
  const [showVGuides, setShowVGuides] = useState(false)
  const [hGuides, setHGuides] = useState([])
  const [vGuides, setVGuides] = useState([])

  // Load the image
  const [image, imageStatus] = useImage(imageUrl)

  // Observe container size
  useEffect(() => {
    if (!containerRef.current) return
    const obs = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        setContainerSize({ width: Math.max(width, 100), height: Math.max(height, 100) })
      }
    })
    obs.observe(containerRef.current)
    return () => obs.disconnect()
  }, [])

  // Fit image to container: call when image or container changes
  const fitImageToContainer = useCallback((cw, ch, iw, ih) => {
    if (!iw || !ih) return { scale: 1, offset: { x: 0, y: 0 } }
    const scaleX = cw / iw
    const scaleY = ch / ih
    const newScale = Math.min(scaleX, scaleY, 1)
    const offsetX = (cw - iw * newScale) / 2
    const offsetY = (ch - ih * newScale) / 2
    return { scale: newScale, offset: { x: offsetX, y: offsetY } }
  }, [])

  useEffect(() => {
    if (!imageUrl || !imageWidth || !imageHeight) return
    const { width: cw, height: ch } = containerSize
    if (!cw || !ch) return
    const { scale: s, offset: o } = fitImageToContainer(cw, ch, imageWidth, imageHeight)
    setScale(s)
    setOffset(o)
  }, [containerSize, imageUrl, imageWidth, imageHeight, fitImageToContainer])

  // Convert stage coords to image pixel coords
  const stageToImage = useCallback((sx, sy) => ({
    x: (sx - offsetRef.current.x) / scaleRef.current,
    y: (sy - offsetRef.current.y) / scaleRef.current,
  }), [])

  // Convert image pixel coords to stage coords
  const imageToStage = useCallback((ix, iy) => ({
    x: ix * scale + offset.x,
    y: iy * scale + offset.y,
  }), [scale, offset])

  // -----------------------------------------------------------------------
  // Guide toggle handlers — reinitialize guides at every 25px when turned on
  // -----------------------------------------------------------------------
  const handleToggleHGuides = useCallback((checked) => {
    setShowHGuides(checked)
    if (checked && imageHeight) {
      const guides = []
      for (let y = 25; y < imageHeight; y += 25) {
        guides.push(y)
      }
      setHGuides(guides)
    }
  }, [imageHeight])

  const handleToggleVGuides = useCallback((checked) => {
    setShowVGuides(checked)
    if (checked && imageWidth) {
      const guides = []
      for (let x = 25; x < imageWidth; x += 25) {
        guides.push(x)
      }
      setVGuides(guides)
    }
  }, [imageWidth])

  // -----------------------------------------------------------------------
  // Mouse wheel zoom
  // -----------------------------------------------------------------------
  const handleWheel = useCallback((e) => {
    e.evt.preventDefault()
    const stage = stageRef.current
    if (!stage) return

    const pointer = stage.getPointerPosition()
    if (!pointer) return

    const oldScale = scaleRef.current
    const zoomFactor = e.evt.deltaY < 0 ? 1.12 : 1 / 1.12
    const newScale = Math.min(Math.max(oldScale * zoomFactor, MIN_SCALE), MAX_SCALE)

    // Zoom toward pointer position
    const mousePointTo = {
      x: (pointer.x - offsetRef.current.x) / oldScale,
      y: (pointer.y - offsetRef.current.y) / oldScale,
    }
    const newOffset = {
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    }
    setScale(newScale)
    setOffset(newOffset)
  }, [])

  // -----------------------------------------------------------------------
  // Stage click — handles both dot clicks (select+occlude) and background clicks (place label)
  // Using the Stage handler is more reliable than per-node onClick on draggable nodes.
  // -----------------------------------------------------------------------
  const handleStageClick = useCallback((e) => {
    if (e.evt.button !== 0) return
    if (didDragRef.current) {
      didDragRef.current = false
      return
    }

    // Click on a placed label dot → select it and toggle occluded
    const labelBp = e.target?.getAttr?.('labelBp')
    if (labelBp) {
      onSelectKeypoint(labelBp)
      onOcclude(labelBp)
      return
    }

    // Background click → place label for the active unplaced keypoint
    if (!selectedKeypoint) return
    if (labelsRef.current?.[selectedKeypoint] != null) return

    const stage = stageRef.current
    if (!stage) return
    const pointer = stage.getPointerPosition()
    if (!pointer) return
    const imgCoords = stageToImage(pointer.x, pointer.y)
    if (!imageWidth || !imageHeight) return
    if (imgCoords.x < 0 || imgCoords.y < 0 || imgCoords.x > imageWidth || imgCoords.y > imageHeight) return

    onLabelPlace(selectedKeypoint, imgCoords)
  }, [selectedKeypoint, stageToImage, onLabelPlace, imageWidth, imageHeight, onSelectKeypoint, onOcclude])

  // Prevent browser context menu on right/middle click
  const handleContextMenu = useCallback((e) => {
    e.evt.preventDefault()
  }, [])

  // -----------------------------------------------------------------------
  // Determine which labels to render
  // -----------------------------------------------------------------------
  const showHumanLabels = useMemo(() => {
    if (!labels) return false
    return Object.values(labels).some(v => v !== null && v !== undefined)
  }, [labels])

  const radius = Math.max(2, dotSize || 6)

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  return (
    <Box
      sx={{
        flex: 1,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#1a1a2e',
        userSelect: 'none',
      }}
    >
      {/* Canvas area */}
      <Box
        ref={containerRef}
        sx={{
          flex: 1,
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {/* Loading indicator */}
        {imageStatus === 'loading' && (
          <Box
            sx={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              zIndex: 10,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 1,
            }}
          >
            <CircularProgress color="primary" />
            <Typography color="white" variant="body2">Loading frame...</Typography>
          </Box>
        )}

        {/* Empty state */}
        {!imageUrl && (
          <Box
            sx={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              color: 'rgba(255,255,255,0.4)',
              textAlign: 'center',
              pointerEvents: 'none',
            }}
          >
            <Typography variant="h6">Select a video to begin labeling</Typography>
          </Box>
        )}

        <Stage
          ref={stageRef}
          width={containerSize.width}
          height={containerSize.height}
          onWheel={handleWheel}
          onClick={handleStageClick}
          onContextMenu={handleContextMenu}
        >
          {/* Image layer */}
          <Layer>
            {image && (
              <>
                <Rect
                  x={offset.x - 1}
                  y={offset.y - 1}
                  width={imageWidth * scale + 2}
                  height={imageHeight * scale + 2}
                  stroke="#4fc3f7"
                  strokeWidth={2}
                  fill="transparent"
                  listening={false}
                />
                <KonvaImage
                  image={image}
                  x={offset.x}
                  y={offset.y}
                  width={imageWidth * scale}
                  height={imageHeight * scale}
                  listening={false}
                />
              </>
            )}
          </Layer>

          {/* Guide lines layer — renders above image, below labels */}
          <Layer>
            {showHGuides && hGuides.map((guideY, i) => (
              <Line
                key={`hguide-${i}`}
                x={0}
                y={guideY * scale + offset.y}
                points={[offset.x, 0, offset.x + imageWidth * scale, 0]}
                stroke="rgba(0, 220, 255, 0.75)"
                strokeWidth={1}
                hitStrokeWidth={10}
                draggable
                dragBoundFunc={(pos) => ({
                  x: 0,
                  y: Math.max(
                    offsetRef.current.y,
                    Math.min(pos.y, offsetRef.current.y + imageHeight * scaleRef.current)
                  ),
                })}
                onMouseEnter={(e) => {
                  e.target.getStage().container().style.cursor = 'ns-resize'
                }}
                onMouseLeave={(e) => {
                  e.target.getStage().container().style.cursor = ''
                }}
                onDragStart={() => {
                  didDragRef.current = true
                }}
                onDragEnd={(e) => {
                  const newStageY = e.target.y()
                  const newImageY = (newStageY - offsetRef.current.y) / scaleRef.current
                  setHGuides(prev => {
                    const updated = [...prev]
                    updated[i] = Math.max(0, Math.min(newImageY, imageHeight))
                    return updated
                  })
                }}
              />
            ))}
            {showVGuides && vGuides.map((guideX, i) => (
              <Line
                key={`vguide-${i}`}
                x={guideX * scale + offset.x}
                y={0}
                points={[0, offset.y, 0, offset.y + imageHeight * scale]}
                stroke="rgba(0, 220, 255, 0.75)"
                strokeWidth={1}
                hitStrokeWidth={10}
                draggable
                dragBoundFunc={(pos) => ({
                  x: Math.max(
                    offsetRef.current.x,
                    Math.min(pos.x, offsetRef.current.x + imageWidth * scaleRef.current)
                  ),
                  y: 0,
                })}
                onMouseEnter={(e) => {
                  e.target.getStage().container().style.cursor = 'ew-resize'
                }}
                onMouseLeave={(e) => {
                  e.target.getStage().container().style.cursor = ''
                }}
                onDragStart={() => {
                  didDragRef.current = true
                }}
                onDragEnd={(e) => {
                  const newStageX = e.target.x()
                  const newImageX = (newStageX - offsetRef.current.x) / scaleRef.current
                  setVGuides(prev => {
                    const updated = [...prev]
                    updated[i] = Math.max(0, Math.min(newImageX, imageWidth))
                    return updated
                  })
                }}
              />
            ))}
          </Layer>

          {/* Machine labels (shown only when no human labels exist) */}
          {!showHumanLabels && machineLabels && (
            <Layer>
              {(bodyparts || []).map((bp, idx) => {
                const ml = machineLabels[bp]
                if (!ml) return null
                const pos = imageToStage(ml.x, ml.y)
                const color = colors?.[idx] || '#999999'

                return (
                  <Circle
                    key={`machine-${bp}`}
                    x={pos.x}
                    y={pos.y}
                    radius={radius}
                    fill={`${color}88`}
                    stroke={color}
                    strokeWidth={1.5}
                    dash={ml.below_pcutoff ? [5, 5] : []}
                    onMouseEnter={e => {
                      const stage = stageRef.current
                      if (stage) {
                        const pointer = stage.getPointerPosition()
                        setTooltip({ x: pointer.x, y: pointer.y + TOOLTIP_OFFSET_Y, text: `${bp} (machine)` })
                      }
                    }}
                    onMouseLeave={() => setTooltip(null)}
                  />
                )
              })}
            </Layer>
          )}

          {/* Human labels */}
          <Layer>
            {(bodyparts || []).map((bp, idx) => {
              const label = labels ? labels[bp] : null
              if (!label) return null
              // Sentinel occluded position (-1,-1) means "off screen" — no dot to draw
              if (label.x < 0 || label.y < 0) return null

              const pos = imageToStage(label.x, label.y)
              const color = colors?.[idx] || '#999999'
              const isSelected = selectedKeypoint === bp
              const isOccluded = label.occluded === true

              return (
                <Group key={`label-${bp}`}>
                  {/* White selection ring */}
                  {isSelected && (
                    <Circle
                      x={pos.x}
                      y={pos.y}
                      radius={radius + 5}
                      stroke="white"
                      strokeWidth={2}
                      fill="transparent"
                      listening={false}
                    />
                  )}

                  {/* Label dot */}
                  <Circle
                    x={pos.x}
                    y={pos.y}
                    radius={radius}
                    fill={isOccluded ? 'transparent' : color}
                    stroke={color}
                    strokeWidth={isOccluded ? 2 : 1}
                    dash={isOccluded ? [4, 3] : []}
                    draggable
                    labelBp={bp}
                    onMouseEnter={e => {
                      const stage = e.target.getStage()
                      if (stage) {
                        stage.container().style.cursor = 'pointer'
                        const pointer = stage.getPointerPosition()
                        setTooltip({ x: pointer.x, y: pointer.y + TOOLTIP_OFFSET_Y, text: bp })
                      }
                    }}
                    onMouseLeave={e => {
                      const stage = e.target.getStage()
                      if (stage) {
                        stage.container().style.cursor = spaceHeldRef.current ? 'grab' : ''
                      }
                      setTooltip(null)
                    }}
                    onMouseMove={e => {
                      const stage = e.target.getStage()
                      if (stage) {
                        const pointer = stage.getPointerPosition()
                        setTooltip({ x: pointer.x, y: pointer.y + TOOLTIP_OFFSET_Y, text: bp })
                      }
                    }}
                    onDragStart={e => {
                      // Mark as drag so stage click (firing after drag) is ignored
                      didDragRef.current = true
                    }}
                    onDragMove={e => {
                      const stage = e.target.getStage()
                      if (stage) {
                        const pointer = stage.getPointerPosition()
                        setTooltip({ x: pointer.x, y: pointer.y + TOOLTIP_OFFSET_Y, text: bp })
                      }
                    }}
                    onDragEnd={e => {
                      e.cancelBubble = true
                      const stageX = e.target.x()
                      const stageY = e.target.y()
                      // Convert back to image coords using current scale/offset
                      const imgX = (stageX - offsetRef.current.x) / scaleRef.current
                      const imgY = (stageY - offsetRef.current.y) / scaleRef.current
                      const clampedX = Math.max(0, Math.min(imgX, imageWidth))
                      const clampedY = Math.max(0, Math.min(imgY, imageHeight))
                      onLabelMove(bp, { x: clampedX, y: clampedY })
                    }}
                  />
                </Group>
              )
            })}
          </Layer>

          {/* Tooltip overlay layer */}
          {tooltip && (
            <Layer listening={false}>
              <TooltipLabel x={tooltip.x} y={tooltip.y} text={tooltip.text} />
            </Layer>
          )}
        </Stage>
      </Box>

      {/* Guide toggle controls */}
      <Box
        sx={{
          display: 'flex',
          gap: 2,
          px: 2,
          py: 0.5,
          borderTop: '1px solid rgba(255,255,255,0.08)',
          backgroundColor: '#12122a',
        }}
      >
        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={showVGuides}
              onChange={e => handleToggleVGuides(e.target.checked)}
              sx={{
                color: 'rgba(0, 220, 255, 0.5)',
                '&.Mui-checked': { color: 'rgba(0, 220, 255, 0.9)' },
                py: 0.5,
              }}
            />
          }
          label={
            <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.65)', fontSize: '0.72rem' }}>
              Vertical Guides
            </Typography>
          }
        />
        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={showHGuides}
              onChange={e => handleToggleHGuides(e.target.checked)}
              sx={{
                color: 'rgba(0, 220, 255, 0.5)',
                '&.Mui-checked': { color: 'rgba(0, 220, 255, 0.9)' },
                py: 0.5,
              }}
            />
          }
          label={
            <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.65)', fontSize: '0.72rem' }}>
              Horizontal Guides
            </Typography>
          }
        />
      </Box>
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Tooltip component: text with background rectangle
// ---------------------------------------------------------------------------
function TooltipLabel({ x, y, text }) {
  const padding = 5
  const fontSize = 13
  const charWidth = fontSize * 0.62
  const textWidth = text.length * charWidth
  const bgWidth = textWidth + padding * 2
  const bgHeight = fontSize + padding * 2

  return (
    <Group x={x - bgWidth / 2} y={y - bgHeight}>
      <Rect
        width={bgWidth}
        height={bgHeight}
        fill="rgba(0,0,0,0.78)"
        cornerRadius={3}
      />
      <Text
        x={padding}
        y={padding}
        text={text}
        fontSize={fontSize}
        fill="white"
        fontStyle="bold"
      />
    </Group>
  )
}
