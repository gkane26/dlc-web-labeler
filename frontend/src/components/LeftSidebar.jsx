import React, { useState, useEffect } from 'react'
import {
  Box,
  Paper,
  Typography,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Button,
  Checkbox,
  FormControlLabel,
  Slider,
  LinearProgress,
  Alert,
  Divider,
  Stack,
} from '@mui/material'
import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore'
import NavigateNextIcon from '@mui/icons-material/NavigateNext'

/**
 * LeftSidebar — video selection, navigation, progress display.
 *
 * Props:
 *   videos: string[]
 *   selectedVideo: string
 *   onVideoChange: fn(videoName)
 *   onPrev: fn()
 *   onNext: fn()
 *   onlyUnlabeled: bool
 *   onOnlyUnlabeledChange: fn(bool)
 *   frameIdx: number
 *   totalFrames: number
 *   onFrameSliderChange: fn(frameIdx) — fires on commit only
 *   progress: {video_labeled, video_total, global_labeled, global_total} | null
 *   error: string | null
 *   disabled: bool — true when loading/no frame
 */
export default function LeftSidebar({
  videos,
  selectedVideo,
  onVideoChange,
  onPrev,
  onNext,
  onlyUnlabeled,
  onOnlyUnlabeledChange,
  frameIdx,
  totalFrames,
  onFrameSliderChange,
  progress,
  error,
  disabled,
}) {
  // Local slider value for live visual feedback while dragging.
  // Syncs from frameIdx when a new frame loads; updates locally on drag.
  const [sliderDisplay, setSliderDisplay] = useState(frameIdx ?? 0)

  useEffect(() => {
    if (frameIdx != null) setSliderDisplay(frameIdx)
  }, [frameIdx])

  return (
    <Paper
      elevation={2}
      sx={{
        width: 200,
        minWidth: 180,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        p: 2,
        overflowY: 'auto',
        flexShrink: 0,
      }}
    >
      {/* Video selection */}
      <FormControl size="small" fullWidth>
        <InputLabel id="video-select-label">Video</InputLabel>
        <Select
          labelId="video-select-label"
          value={selectedVideo || ''}
          label="Video"
          onChange={e => onVideoChange(e.target.value)}
          disabled={disabled || !videos?.length}
        >
          {(videos || []).map(v => (
            <MenuItem key={v} value={v} sx={{ fontSize: '0.8rem', wordBreak: 'break-all' }}>
              {v}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      {/* Navigation buttons */}
      <Stack direction="row" spacing={1}>
        <Button
          variant="outlined"
          size="small"
          onClick={onPrev}
          disabled={disabled}
          startIcon={<NavigateBeforeIcon />}
          sx={{ flex: 1, minWidth: 0 }}
        >
          Prev
        </Button>
        <Button
          variant="outlined"
          size="small"
          onClick={onNext}
          disabled={disabled}
          endIcon={<NavigateNextIcon />}
          sx={{ flex: 1, minWidth: 0 }}
        >
          Next
        </Button>
      </Stack>

      {/* Only unlabeled checkbox */}
      <FormControlLabel
        control={
          <Checkbox
            checked={onlyUnlabeled}
            onChange={e => onOnlyUnlabeledChange(e.target.checked)}
            size="small"
            disabled={disabled}
          />
        }
        label={<Typography variant="body2">Only Unlabeled</Typography>}
        sx={{ m: 0 }}
      />

      <Divider />

      {/* Frame slider */}
      <Box>
        <Typography variant="body2" gutterBottom>
          Frame:{' '}
          <strong>{sliderDisplay}</strong>
          {totalFrames ? ` / ${totalFrames - 1}` : ''}
        </Typography>
        <Slider
          value={sliderDisplay}
          min={0}
          max={totalFrames ? totalFrames - 1 : 0}
          step={1}
          disabled={disabled || !totalFrames}
          size="small"
          onChange={(_, value) => setSliderDisplay(value)}
          onChangeCommitted={(_, value) => onFrameSliderChange(value)}
          valueLabelDisplay="auto"
        />
      </Box>

      <Divider />

      {/* Progress */}
      {progress && (
        <Box>
          <Typography variant="body2" gutterBottom sx={{ fontWeight: 600 }}>
            Video Progress
          </Typography>
          <LinearProgress
            variant="determinate"
            value={progress.video_total > 0 ? (progress.video_labeled / progress.video_total) * 100 : 0}
            sx={{ mb: 0.5 }}
          />
          <Typography variant="caption" color="text.secondary">
            {progress.video_labeled} / {progress.video_total} labeled
          </Typography>

          <Typography variant="body2" sx={{ fontWeight: 600, mt: 1.5 }} gutterBottom>
            Global Progress
          </Typography>
          <LinearProgress
            variant="determinate"
            value={progress.global_total > 0 ? (progress.global_labeled / progress.global_total) * 100 : 0}
            color="success"
            sx={{ mb: 0.5 }}
          />
          <Typography variant="caption" color="text.secondary">
            {progress.global_labeled} / {progress.global_total} labeled
          </Typography>
        </Box>
      )}

      {/* Error display */}
      {error && (
        <Alert severity="error" sx={{ fontSize: '0.75rem' }}>
          {error}
        </Alert>
      )}
    </Paper>
  )
}
