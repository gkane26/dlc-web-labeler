import React from 'react'
import {
  Box,
  Paper,
  Typography,
  Checkbox,
  FormControlLabel,
  Divider,
  Slider,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
} from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked'

const COLOR_SCHEME_OPTIONS = [
  { value: 'rainbow', label: 'Rainbow' },
  { value: 'viridis', label: 'Viridis' },
  { value: 'plasma', label: 'Plasma' },
  { value: 'cool', label: 'Cool' },
  { value: 'warm', label: 'Warm' },
  { value: 'blues', label: 'Blues' },
]

/**
 * RightSidebar — keypoint list, occluded checkbox, dot size, color scheme.
 *
 * Props:
 *   bodyparts: string[]
 *   colors: string[] — hex colors per bodypart
 *   labels: Object — bodypart -> {x,y,occluded?} | null
 *   selectedKeypoint: string | null
 *   onSelectKeypoint: fn(bodypart)
 *   occluded: bool — is selected keypoint occluded?
 *   onOccludedChange: fn(bool)
 *   dotSize: number
 *   onDotSizeChange: fn(number)
 *   colorScheme: string
 *   onColorSchemeChange: fn(string)
 */
export default function RightSidebar({
  bodyparts,
  colors,
  labels,
  selectedKeypoint,
  onSelectKeypoint,
  occluded,
  onOccludedChange,
  dotSize,
  onDotSizeChange,
  colorScheme,
  onColorSchemeChange,
}) {
  return (
    <Paper
      elevation={2}
      sx={{
        width: 210,
        minWidth: 190,
        display: 'flex',
        flexDirection: 'column',
        p: 1,
        overflowY: 'auto',
        flexShrink: 0,
      }}
    >
      <Typography variant="subtitle2" sx={{ px: 1, pt: 1, pb: 0.5, fontWeight: 700 }}>
        Keypoints
      </Typography>

      {/* Keypoints list */}
      <List dense disablePadding sx={{ flex: 1, overflowY: 'auto' }}>
        {(bodyparts || []).map((bp, idx) => {
          const label = labels ? labels[bp] : null
          const isLabeled = label !== null && label !== undefined
          const isSelected = selectedKeypoint === bp
          const color = colors?.[idx] || '#999'

          return (
            <ListItem
              key={bp}
              disablePadding
              secondaryAction={
                isLabeled ? (
                  <CheckCircleIcon sx={{ fontSize: 16, color }} />
                ) : (
                  <RadioButtonUncheckedIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
                )
              }
            >
              <ListItemButton
                selected={isSelected}
                onClick={() => onSelectKeypoint(bp)}
                sx={{
                  borderRadius: 1,
                  py: 0.5,
                  pr: 4,
                  '&.Mui-selected': {
                    backgroundColor: `${color}22`,
                    '&:hover': { backgroundColor: `${color}33` },
                  },
                }}
              >
                {/* Color dot */}
                <Box
                  sx={{
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                    backgroundColor: color,
                    mr: 1,
                    flexShrink: 0,
                    border: isSelected ? '2px solid white' : '1px solid rgba(255,255,255,0.3)',
                    boxShadow: isSelected ? `0 0 0 2px ${color}` : 'none',
                  }}
                />
                <ListItemText
                  primary={bp}
                  primaryTypographyProps={{
                    variant: 'body2',
                    sx: {
                      color: isLabeled ? 'text.primary' : 'text.secondary',
                      fontWeight: isSelected ? 600 : 400,
                      fontSize: '0.8rem',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    },
                  }}
                />
              </ListItemButton>
            </ListItem>
          )
        })}
      </List>

      {/* Occluded checkbox */}
      <Box sx={{ px: 1, pt: 1 }}>
        <FormControlLabel
          control={
            <Checkbox
              checked={occluded}
              onChange={e => onOccludedChange(e.target.checked)}
              size="small"
              disabled={!selectedKeypoint}
            />
          }
          label={<Typography variant="body2">Occluded (O)</Typography>}
          sx={{ m: 0 }}
        />
      </Box>

      <Divider sx={{ my: 1 }} />

      {/* Dot size slider */}
      <Box sx={{ px: 1.5 }}>
        <Typography variant="body2" gutterBottom>
          Dot Size: <strong>{dotSize}</strong>
        </Typography>
        <Slider
          value={dotSize}
          min={2}
          max={20}
          step={1}
          size="small"
          onChange={(_, v) => onDotSizeChange(v)}
          valueLabelDisplay="auto"
        />
      </Box>

      {/* Color scheme select */}
      <Box sx={{ px: 1.5, pb: 1.5 }}>
        <FormControl size="small" fullWidth>
          <InputLabel id="color-scheme-label">Color Scheme</InputLabel>
          <Select
            labelId="color-scheme-label"
            value={colorScheme}
            label="Color Scheme"
            onChange={e => onColorSchemeChange(e.target.value)}
          >
            {COLOR_SCHEME_OPTIONS.map(opt => (
              <MenuItem key={opt.value} value={opt.value}>
                {opt.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>
    </Paper>
  )
}
