import React, { useState } from 'react'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Alert,
  CircularProgress,
  Box,
} from '@mui/material'
import { authUser } from '../api'

/**
 * SignInModal — shown when the user is not yet authenticated.
 * Non-closeable MUI Dialog.
 *
 * Props:
 *   onSignIn: fn({clientId, token}) — called on successful auth
 */
export default function SignInModal({ onSignIn }) {
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!token.trim()) {
      setError('Please enter your token.')
      return
    }
    setError('')
    setLoading(true)
    try {
      const data = await authUser(token.trim())
      if (data.ok) {
        onSignIn({ clientId: data.client_id, token: token.trim() })
      } else {
        setError('Authentication failed. Please check your token.')
      }
    } catch (err) {
      if (err.message === 'Invalid token') {
        setError('Invalid token. Please try again.')
      } else {
        setError(`Error: ${err.message}`)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog
      open
      disableEscapeKeyDown
      onClose={() => {}}
      PaperProps={{ sx: { minWidth: 380 } }}
    >
      <DialogTitle>DeepLabCut Labeler: Sign In</DialogTitle>
      <Box component="form" onSubmit={handleSubmit}>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label="Token"
            type="password"
            value={token}
            onChange={e => setToken(e.target.value)}
            autoFocus
            required
            fullWidth
            disabled={loading}
            inputProps={{ autoComplete: 'current-password' }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            type="submit"
            variant="contained"
            disabled={loading}
            fullWidth
            startIcon={loading ? <CircularProgress size={18} color="inherit" /> : null}
          >
            {loading ? 'Signing In...' : 'Sign In'}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  )
}
