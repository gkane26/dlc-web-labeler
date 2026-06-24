"""Frame lease manager with stale-notification callback support."""
import asyncio
import threading
import time
from dataclasses import dataclass, field
from typing import Callable, Coroutine, Dict, Literal, Optional, Tuple

LEASE_STALE_SECONDS = 60  # mark stale after this many seconds without heartbeat


@dataclass
class FrameLease:
    video: str
    frame_idx: int
    client_id: str
    username: str
    acquired_at: float
    last_heartbeat: float
    status: Literal["in_flight", "stale"] = "in_flight"


_lock = threading.Lock()
_leases: Dict[Tuple[str, int], FrameLease] = {}

# client_id -> (video, frame_idx) so we can find what a client holds
_client_frame: Dict[str, Tuple[str, int]] = {}

# Async stale-notification callback:
#   async def cb(client_id, video, frame_idx, event_type) -> None
# event_type is "stale" or "frame_taken"
_stale_callback: Optional[Callable[..., Coroutine]] = None
_event_loop: Optional[asyncio.AbstractEventLoop] = None


def set_stale_callback(
    cb: Callable[..., Coroutine],
    loop: asyncio.AbstractEventLoop,
) -> None:
    """Register the async stale-notification callback and the running event loop.

    The reaper thread uses asyncio.run_coroutine_threadsafe to schedule the
    coroutine on the given loop.
    """
    global _stale_callback, _event_loop
    _stale_callback = cb
    _event_loop = loop


def _fire_callback(client_id: str, video: str, frame_idx: int, event_type: str) -> None:
    """Schedule the async callback from the reaper thread (sync context)."""
    if _stale_callback is None or _event_loop is None:
        return
    try:
        asyncio.run_coroutine_threadsafe(
            _stale_callback(client_id, video, frame_idx, event_type),
            _event_loop,
        )
    except Exception:
        pass  # best-effort; do not crash the reaper


def _reaper() -> None:
    """Background daemon: mark leases stale after LEASE_STALE_SECONDS."""
    while True:
        time.sleep(10)  # check every 10 s; stale threshold is 60 s
        now = time.monotonic()
        to_notify = []

        with _lock:
            for key in list(_leases.keys()):
                lease = _leases[key]
                if lease.status == "in_flight" and now - lease.last_heartbeat > LEASE_STALE_SECONDS:
                    lease.status = "stale"
                    to_notify.append((lease.client_id, lease.video, lease.frame_idx, "stale"))

        # Fire callbacks outside the lock so we don't hold it during async scheduling
        for args in to_notify:
            _fire_callback(*args)


_reaper_thread = threading.Thread(target=_reaper, daemon=True)
_reaper_thread.start()


def acquire_frame(client_id: str, username: str, video: str, frame_idx: int) -> FrameLease:
    """Mark a frame as in-flight for a client.

    Releases any previously held frame for this client.
    If the requested frame was stale and owned by a different client, fires a
    "frame_taken" notification to that client before taking over.
    """
    now = time.monotonic()
    frame_taken_notify: Optional[Tuple[str, str, int, str]] = None

    with _lock:
        # Release any frame this client currently holds
        prev = _client_frame.get(client_id)
        if prev and prev in _leases:
            prev_lease = _leases[prev]
            if prev_lease.client_id == client_id:
                del _leases[prev]

        key = (video, frame_idx)
        existing = _leases.get(key)
        if existing is not None and existing.client_id != client_id:
            # Another client had this lease (stale); evict and notify
            frame_taken_notify = (existing.client_id, video, frame_idx, "frame_taken")
            _client_frame.pop(existing.client_id, None)

        lease = FrameLease(
            video=video,
            frame_idx=frame_idx,
            client_id=client_id,
            username=username,
            acquired_at=now,
            last_heartbeat=now,
        )
        _leases[key] = lease
        _client_frame[client_id] = (video, frame_idx)

    if frame_taken_notify is not None:
        _fire_callback(*frame_taken_notify)

    return lease


def release_frame(client_id: str, video: str, frame_idx: int) -> bool:
    with _lock:
        key = (video, frame_idx)
        lease = _leases.get(key)
        if lease and lease.client_id == client_id:
            del _leases[key]
            _client_frame.pop(client_id, None)
            return True
        return False


def heartbeat(client_id: str, video: str, frame_idx: int) -> bool:
    with _lock:
        key = (video, frame_idx)
        lease = _leases.get(key)
        if lease and lease.client_id == client_id:
            lease.last_heartbeat = time.monotonic()
            lease.status = "in_flight"  # revive if it went stale
            return True
        return False


def check_lease(client_id: str, video: str, frame_idx: int) -> Optional[FrameLease]:
    """Return the lease if it belongs to client_id and is still in_flight."""
    with _lock:
        key = (video, frame_idx)
        lease = _leases.get(key)
        if lease and lease.client_id == client_id and lease.status == "in_flight":
            return lease
        return None


def is_in_flight(video: str, frame_idx: int) -> bool:
    """Return True if any active (non-stale) lease exists for this frame."""
    with _lock:
        lease = _leases.get((video, frame_idx))
        return lease is not None and lease.status == "in_flight"
