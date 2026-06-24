import React from 'react'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
} from '@mui/material'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline'

/**
 * ServerStoppedDialog — shown when WS sends {type: "server_shutdown"}.
 * Non-dismissible.
 *
 * Props:
 *   open: bool
 */
export default function ServerStoppedDialog({ open }) {
  return (
    <Dialog
      open={open}
      disableEscapeKeyDown
      onClose={() => {}}
      PaperProps={{ sx: { minWidth: 340 } }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <ErrorOutlineIcon color="error" />
        Server Stopped
      </DialogTitle>
      <DialogContent>
        <DialogContentText>
          The server has been stopped. Please contact the administrator or try again later.
        </DialogContentText>
      </DialogContent>
    </Dialog>
  )
}
