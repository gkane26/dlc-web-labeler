import React, { useState } from 'react'
import {
  AppBar,
  Toolbar,
  Typography,
  Button,
  Popover,
  Box,
  IconButton,
} from '@mui/material'
import HelpOutlineIcon from '@mui/icons-material/HelpOutline'
import MenuBookIcon from '@mui/icons-material/MenuBook'
import FolderOpenIcon from '@mui/icons-material/FolderOpen'
import ReactMarkdown from 'react-markdown'

/**
 * TitleBar — top AppBar with title and How-To/Instructions buttons.
 *
 * Props:
 *   task: string
 *   howtoMarkdown: string
 *   instructionsMarkdown: string
 *   onSwitchProject: fn() — called when user clicks "Switch Project"
 *   onLoadConfig: fn() — called when user clicks "Load Config" (shown when no config is loaded)
 */
export default function TitleBar({ task, howtoMarkdown, instructionsMarkdown, onSwitchProject, onLoadConfig }) {
  const [howtoAnchor, setHowtoAnchor] = useState(null)
  const [instrAnchor, setInstrAnchor] = useState(null)

  return (
    <AppBar position="static" color="primary" elevation={2}>
      <Toolbar sx={{ position: 'relative' }}>
        {/* Left-side buttons */}
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center' }}>
          {onSwitchProject && (
            <Button
              color="inherit"
              startIcon={<FolderOpenIcon />}
              onClick={onSwitchProject}
              size="small"
            >
              Switch Project
            </Button>
          )}
          {!onSwitchProject && onLoadConfig && (
            <Button
              color="inherit"
              startIcon={<FolderOpenIcon />}
              onClick={onLoadConfig}
              size="small"
            >
              Load Config
            </Button>
          )}
        </Box>

        {/* Centered title */}
        <Typography
          variant="h6"
          component="div"
          sx={{
            position: 'absolute',
            left: '50%',
            transform: 'translateX(-50%)',
            whiteSpace: 'nowrap',
            fontWeight: 700,
            letterSpacing: 0.5,
          }}
        >
          DLC Labeler{task ? `: ${task}` : ''}
        </Typography>

        {/* Right-side buttons */}
        <Box sx={{ flex: 1, display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
          <Button
            color="inherit"
            startIcon={<HelpOutlineIcon />}
            onClick={e => setHowtoAnchor(e.currentTarget)}
            size="small"
          >
            How To
          </Button>
          <Button
            color="inherit"
            startIcon={<MenuBookIcon />}
            onClick={e => setInstrAnchor(e.currentTarget)}
            size="small"
          >
            Labeling Instructions
          </Button>
        </Box>
      </Toolbar>

      {/* How-To popover */}
      <Popover
        open={Boolean(howtoAnchor)}
        anchorEl={howtoAnchor}
        onClose={() => setHowtoAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{
          sx: {
            maxWidth: 500,
            maxHeight: '80vh',
            overflow: 'auto',
            p: 2,
          },
        }}
      >
        <Typography variant="h6" gutterBottom>How To Use</Typography>
        {howtoMarkdown ? (
          <Box sx={{ '& p': { mb: 1 }, '& ul, & ol': { pl: 2 } }}>
            <ReactMarkdown>{howtoMarkdown}</ReactMarkdown>
          </Box>
        ) : (
          <Typography color="text.secondary">No how-to content available.</Typography>
        )}
      </Popover>

      {/* Labeling Instructions popover */}
      <Popover
        open={Boolean(instrAnchor)}
        anchorEl={instrAnchor}
        onClose={() => setInstrAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{
          sx: {
            maxWidth: 500,
            maxHeight: '80vh',
            overflow: 'auto',
            p: 2,
          },
        }}
      >
        <Typography variant="h6" gutterBottom>Labeling Instructions</Typography>
        {instructionsMarkdown ? (
          <Box sx={{ '& p': { mb: 1 }, '& ul, & ol': { pl: 2 } }}>
            <ReactMarkdown>{instructionsMarkdown}</ReactMarkdown>
          </Box>
        ) : (
          <Typography color="text.secondary">No instructions available.</Typography>
        )}
      </Popover>
    </AppBar>
  )
}
