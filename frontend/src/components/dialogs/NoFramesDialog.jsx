import React from 'react'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
} from '@mui/material'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'

/**
 * NoFramesDialog — shown when GET /api/frame returns 409 "No free frames available".
 *
 * Props:
 *   open: bool
 *   onClose: fn
 */
export default function NoFramesDialog({ open, onClose }) {
  return (
    <Dialog open={open} onClose={onClose} PaperProps={{ sx: { minWidth: 340 } }}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <InfoOutlinedIcon color="info" />
        No Frames Available
      </DialogTitle>
      <DialogContent>
        <DialogContentText>
          No more unlabeled frames are available in this direction.
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} variant="contained">
          OK
        </Button>
      </DialogActions>
    </Dialog>
  )
}
