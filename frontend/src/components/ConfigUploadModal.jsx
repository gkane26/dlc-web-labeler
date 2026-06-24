import React, { useState, useRef } from 'react'
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Alert, CircularProgress, Box, Typography,
} from '@mui/material'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import { uploadConfig } from '../api'

/**
 * ConfigUploadModal — shown after sign-in when the server has no config loaded.
 * Non-closeable MUI Dialog.
 *
 * Props:
 *   onConfigLoaded: fn(taskName) — called after a successful config upload
 *   token: string — raw auth token for the upload request
 */
export default function ConfigUploadModal({ onConfigLoaded, token }) {
  const [file, setFile] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const inputRef = useRef()

  const handleFileChange = (e) => {
    setFile(e.target.files[0] || null)
    setError('')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!file) { setError('Please select a config.yaml file.'); return }
    setError('')
    setLoading(true)
    try {
      const data = await uploadConfig(file, token)
      onConfigLoaded(data.task || '')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open disableEscapeKeyDown onClose={() => {}} PaperProps={{ sx: { minWidth: 420 } }}>
      <DialogTitle>Load DLC Config</DialogTitle>
      <Box component="form" onSubmit={handleSubmit}>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            No configuration is loaded on the server. Please select a DLC{' '}
            <code>config.yaml</code> file to continue.
          </Typography>
          {error && <Alert severity="error">{error}</Alert>}
          <input
            ref={inputRef}
            type="file"
            accept=".yaml,.yml"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
          <Button
            variant="outlined"
            startIcon={<UploadFileIcon />}
            onClick={() => inputRef.current?.click()}
            disabled={loading}
          >
            {file ? file.name : 'Choose config.yaml\u2026'}
          </Button>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            type="submit"
            variant="contained"
            disabled={loading || !file}
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
