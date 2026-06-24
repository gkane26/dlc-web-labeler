import React, { useState, useEffect, useCallback } from 'react'
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Alert, CircularProgress, Box, Typography,
  List, ListItemButton, ListItemIcon, ListItemText,
  Breadcrumbs, Link, Chip,
} from '@mui/material'
import FolderIcon from '@mui/icons-material/Folder'
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile'
import { browseDir, loadConfigFromPath } from '../api'

/**
 * ConfigUploadModal — shown after sign-in when the server has no config loaded.
 * Provides a server-side directory browser restricted to /mnt.
 *
 * Props:
 *   onConfigLoaded: fn(taskName) — called after a successful config load
 *   token: string — raw auth token for the load request
 */
export default function ConfigUploadModal({ onConfigLoaded, token }) {
  const [currentPath, setCurrentPath] = useState('/mnt')
  const [entries, setEntries] = useState([])
  const [selectedFile, setSelectedFile] = useState(null)
  const [browsing, setBrowsing] = useState(false)
  const [browseError, setBrowseError] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Browse a directory
  const navigate = useCallback(async (path) => {
    setBrowsing(true)
    setBrowseError('')
    setSelectedFile(null)
    try {
      const data = await browseDir(path)
      setCurrentPath(data.path)
      setEntries(data.entries)
    } catch (err) {
      setBrowseError(err.message)
    } finally {
      setBrowsing(false)
    }
  }, [])

  // Browse initial directory on mount
  useEffect(() => {
    navigate('/mnt')
  }, [navigate])

  // Build breadcrumb segments from currentPath
  const pathSegments = currentPath.split('/').filter(Boolean)
  // e.g. "/mnt/share/project" => ["mnt", "share", "project"]
  // Breadcrumb paths: "/mnt", "/mnt/share", "/mnt/share/project"

  const handleSelectFile = (entry) => {
    setSelectedFile(entry.path)
    setError('')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!selectedFile) { setError('Please select a config.yaml file.'); return }
    setError('')
    setLoading(true)
    try {
      const data = await loadConfigFromPath(selectedFile, token)
      onConfigLoaded(data.task || '')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open disableEscapeKeyDown onClose={() => {}} PaperProps={{ sx: { minWidth: 520, maxWidth: 620 } }}>
      <DialogTitle>Load DLC Config</DialogTitle>
      <Box component="form" onSubmit={handleSubmit}>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: 1, pb: 0 }}>
          <Typography variant="body2" color="text.secondary">
            No configuration is loaded. Browse the server filesystem to select a
            DLC <code>config.yaml</code> file.
          </Typography>

          {error && <Alert severity="error">{error}</Alert>}
          {browseError && <Alert severity="warning">{browseError}</Alert>}

          {/* Breadcrumb navigation */}
          <Breadcrumbs sx={{ fontSize: '0.85rem' }}>
            {pathSegments.map((seg, i) => {
              const segPath = '/' + pathSegments.slice(0, i + 1).join('/')
              const isLast = i === pathSegments.length - 1
              return isLast ? (
                <Typography key={segPath} variant="body2" color="text.primary" sx={{ fontWeight: 500 }}>
                  {seg}
                </Typography>
              ) : (
                <Link
                  key={segPath}
                  component="button"
                  type="button"
                  variant="body2"
                  underline="hover"
                  onClick={() => navigate(segPath)}
                  sx={{ cursor: 'pointer' }}
                >
                  {seg}
                </Link>
              )
            })}
          </Breadcrumbs>

          {/* Directory listing */}
          <Box sx={{
            border: 1, borderColor: 'divider', borderRadius: 1,
            maxHeight: 320, minHeight: 160, overflow: 'auto',
            bgcolor: 'background.default',
          }}>
            {browsing ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 4 }}>
                <CircularProgress size={24} />
              </Box>
            ) : entries.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>
                No config files or subdirectories found.
              </Typography>
            ) : (
              <List dense disablePadding>
                {entries.map((entry) => (
                  <ListItemButton
                    key={entry.path}
                    selected={!entry.is_dir && selectedFile === entry.path}
                    onClick={() => entry.is_dir ? navigate(entry.path) : handleSelectFile(entry)}
                    onDoubleClick={() => {
                      if (!entry.is_dir) {
                        setSelectedFile(entry.path)
                        // Auto-submit on double-click
                        setError('')
                        setLoading(true)
                        loadConfigFromPath(entry.path, token)
                          .then(data => onConfigLoaded(data.task || ''))
                          .catch(err => { setError(err.message); setLoading(false) })
                      }
                    }}
                  >
                    <ListItemIcon sx={{ minWidth: 36 }}>
                      {entry.is_dir
                        ? <FolderIcon fontSize="small" sx={{ color: 'primary.main' }} />
                        : <InsertDriveFileIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                      }
                    </ListItemIcon>
                    <ListItemText
                      primary={entry.name}
                      primaryTypographyProps={{ variant: 'body2' }}
                    />
                  </ListItemButton>
                ))}
              </List>
            )}
          </Box>

          {/* Selected file indicator */}
          {selectedFile && (
            <Chip
              label={selectedFile}
              size="small"
              onDelete={() => setSelectedFile(null)}
              sx={{ alignSelf: 'flex-start' }}
            />
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button
            type="submit"
            variant="contained"
            disabled={loading || !selectedFile}
            fullWidth
            startIcon={loading ? <CircularProgress size={18} color="inherit" /> : null}
          >
            {loading ? 'Loading\u2026' : 'Load Config'}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  )
}
