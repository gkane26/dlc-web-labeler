import React from 'react'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
} from '@mui/material'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'

/**
 * StaleDialog — shown when the server sends a {type: "stale"} WebSocket message.
 *
 * Props:
 *   open: bool
 *   frameTaken: bool — true if server also sent {type: "frame_taken"} while dialog was open
 *   onContinue: fn — user chooses to keep labeling (overwrite=true on submit)
 *   onGetNextFrame: fn — release frame and fetch next
 */
export default function StaleDialog({ open, frameTaken, onContinue, onGetNextFrame }) {
  const title = frameTaken
    ? 'Frame Taken by Another User'
    : 'Frame Checkout Expired'

  const message = frameTaken
    ? 'Your frame checkout has expired and this frame is now being labeled by another user. You can still submit your labels (they will overwrite the other user\'s work), or move to the next frame.'
    : 'Your frame checkout has expired. You can continue labeling and submit with overwrite, or move to the next frame.'

  return (
    <Dialog
      open={open}
      disableEscapeKeyDown
      onClose={() => {}}
      PaperProps={{ sx: { minWidth: 360 } }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <WarningAmberIcon color="warning" />
        {title}
      </DialogTitle>
      <DialogContent>
        <DialogContentText>{message}</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onGetNextFrame} variant="outlined">
          Get Next Frame
        </Button>
        <Button onClick={onContinue} variant="contained" color="warning">
          Continue Labeling
        </Button>
      </DialogActions>
    </Dialog>
  )
}
