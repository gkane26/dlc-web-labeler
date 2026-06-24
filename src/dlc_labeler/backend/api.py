"""FastAPI application for the DLC web labeler."""
import asyncio
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Dict, Optional
from uuid import uuid4

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .dlc_io import (
    count_labeled_frames,
    flush_pending_labels,
    get_bodyparts,
    get_config,
    get_frame_dimensions,
    get_frame_files,
    get_labeled_data_dir,
    get_project_path,
    get_videos,
    init_human_label_cache,
    is_config_loaded,
    is_frame_labeled,
    load_config,
    read_human_labels,
    read_machine_labels,
    stage_labels,
)
from .frame_manager import (
    acquire_frame,
    check_lease,
    heartbeat,
    is_in_flight,
    release_frame,
    set_stale_callback,
)

# ---------------------------------------------------------------------------
# WebSocket connection manager
# ---------------------------------------------------------------------------


class _WSManager:
    def __init__(self) -> None:
        self._connections: Dict[str, WebSocket] = {}

    async def connect(self, client_id: str, ws: WebSocket) -> None:
        await ws.accept()
        self._connections[client_id] = ws

    def disconnect(self, client_id: str) -> None:
        self._connections.pop(client_id, None)

    async def send(self, client_id: str, message: Dict[str, Any]) -> None:
        ws = self._connections.get(client_id)
        if ws is None:
            return
        try:
            await ws.send_json(message)
        except Exception:
            self.disconnect(client_id)

    async def broadcast(self, message: Dict[str, Any]) -> None:
        for client_id in list(self._connections):
            await self.send(client_id, message)

    async def close_all(self) -> None:
        for client_id, ws in list(self._connections.items()):
            try:
                await ws.close()
            except Exception:
                pass
        self._connections.clear()


ws_manager = _WSManager()

# ---------------------------------------------------------------------------
# Stale-notification callback (called from the reaper thread via threadsafe)
# ---------------------------------------------------------------------------


async def _stale_notify(client_id: str, video: str, frame_idx: int, event_type: str) -> None:
    await ws_manager.send(client_id, {"type": event_type, "video": video, "frame_idx": frame_idx})


# ---------------------------------------------------------------------------
# Periodic flush task
# ---------------------------------------------------------------------------

_flush_task: Optional[asyncio.Task] = None
_FLUSH_INTERVAL_SECONDS = 600  # 10 minutes


async def _periodic_flush() -> None:
    while True:
        await asyncio.sleep(_FLUSH_INTERVAL_SECONDS)
        try:
            await asyncio.to_thread(flush_pending_labels)
        except Exception as exc:
            # Log but don't die — will retry next cycle
            import traceback
            traceback.print_exc()


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _flush_task

    # -- Startup --
    config_path = os.environ.get("DLC_CONFIG_PATH", "")
    if config_path:
        load_config(config_path)
        init_human_label_cache()

    # Register stale callback with the running loop
    loop = asyncio.get_running_loop()
    set_stale_callback(_stale_notify, loop)

    # Start periodic flush
    _flush_task = asyncio.create_task(_periodic_flush())

    yield

    # -- Shutdown --
    if _flush_task is not None:
        _flush_task.cancel()
        try:
            await _flush_task
        except asyncio.CancelledError:
            pass

    # Final flush of pending labels
    try:
        await asyncio.to_thread(flush_pending_labels)
    except Exception:
        import traceback
        traceback.print_exc()

    # Notify all connected WS clients
    await ws_manager.broadcast({"type": "server_shutdown"})
    await ws_manager.close_all()


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(lifespan=lifespan)

# ---------------------------------------------------------------------------
# Frontend static files (served after all API routes so catch-all doesn't clash)
# We attach these mounts after the app is created; actual mounting happens below
# after route definitions so StaticFiles doesn't shadow API paths.
# ---------------------------------------------------------------------------


def _get_frontend_dir() -> Optional[Path]:
    frontend_dir_env = os.environ.get("DLC_FRONTEND_DIR")
    if frontend_dir_env:
        p = Path(frontend_dir_env)
        return p if p.exists() else None
    # Default: go up from src/dlc_labeler/backend/ to project root, then frontend/dist
    package_backend = Path(__file__).parent          # .../src/dlc_labeler/backend
    project_root = package_backend.parent.parent.parent  # backend -> dlc_labeler -> src -> project root
    candidate = project_root / "frontend" / "dist"
    return candidate if candidate.exists() else None


# ---------------------------------------------------------------------------
# WebSocket endpoint
# ---------------------------------------------------------------------------


@app.websocket("/ws/{client_id}")
async def websocket_endpoint(websocket: WebSocket, client_id: str) -> None:
    await ws_manager.connect(client_id, websocket)
    try:
        while True:
            # Keep the connection alive; server sends messages, client sends nothing
            await websocket.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect(client_id)
    except Exception:
        ws_manager.disconnect(client_id)


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------


class AuthBody(BaseModel):
    token: str


@app.post("/api/auth")
def post_auth(body: AuthBody):
    expected = os.environ.get("DLC_TOKEN", "")
    if not expected or body.token != expected:
        raise HTTPException(status_code=401, detail="Invalid token")
    return {"ok": True, "client_id": str(uuid4())}


# ---------------------------------------------------------------------------
# Config-loaded guard
# ---------------------------------------------------------------------------


def _require_config():
    """Raise HTTP 503 if no config has been loaded yet."""
    if not is_config_loaded():
        raise HTTPException(
            status_code=503,
            detail="No config loaded. Please upload a config.yaml first.",
        )


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------


@app.get("/api/config/status")
def get_config_status():
    """Lightweight check: has a config been loaded?"""
    return {"loaded": is_config_loaded()}


@app.post("/api/config")
async def upload_config(token: str = Form(...), file: UploadFile = File(...)):
    """Upload a config.yaml file. Protected by the auth token."""
    import tempfile
    import yaml

    # 1. Verify token
    expected = os.environ.get("DLC_TOKEN", "")
    if not expected or token != expected:
        raise HTTPException(status_code=401, detail="Invalid token")

    # 2. Validate file extension
    if not (file.filename or "").lower().endswith((".yaml", ".yml")):
        raise HTTPException(status_code=400, detail="File must be a .yaml or .yml file")

    # 3. Read and parse YAML
    try:
        content = await file.read()
        parsed = yaml.safe_load(content)
        if not isinstance(parsed, dict):
            raise ValueError("Config must be a YAML mapping")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid YAML: {e}")

    # 4. If a config is already loaded, flush pending labels and notify clients
    if is_config_loaded():
        try:
            await asyncio.to_thread(flush_pending_labels)
        except Exception as exc:
            print(f"[config upload] flush_pending_labels failed: {exc}")
        await ws_manager.broadcast({"type": "server_shutdown"})
        await ws_manager.close_all()

    # 5. Save to a stable temp path and reload
    tmp_dir = Path(tempfile.mkdtemp(prefix="dlc_config_"))
    config_path = tmp_dir / (file.filename or "config.yaml")
    config_path.write_bytes(content)

    try:
        await asyncio.to_thread(load_config, str(config_path))
        await asyncio.to_thread(init_human_label_cache)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Config load failed: {e}")

    return {"loaded": True, "task": get_config().get("Task", "")}


@app.get("/api/config")
def get_config_endpoint():
    _require_config()
    cfg = get_config()

    instructions_markdown = ""
    instructions_path = os.environ.get("DLC_INSTRUCTIONS_PATH", "")
    if instructions_path:
        try:
            instructions_markdown = Path(instructions_path).read_text()
        except Exception:
            pass

    howto_markdown = ""
    howto_path = os.environ.get("DLC_HOWTO_PATH", "")
    if howto_path:
        try:
            howto_markdown = Path(howto_path).read_text()
        except Exception:
            pass

    return {
        "task": cfg.get("Task", ""),
        "scorer": cfg.get("scorer", ""),
        "instructions_markdown": instructions_markdown,
        "howto_markdown": howto_markdown,
        "bodyparts": get_bodyparts(),
        "colormap": cfg.get("colormap", "rainbow"),
        "videos": get_videos(),
        "dotsize": cfg.get("dotsize", 6),
        "alphavalue": cfg.get("alphavalue", 0.7),
        "pcutoff": cfg.get("pcutoff", 0.6),
    }


# ---------------------------------------------------------------------------
# Frame
# ---------------------------------------------------------------------------


@app.get("/api/frame")
def get_frame(
    client_id: str = Query(...),
    username: str = Query(...),
    video: str = Query(...),
    only_unlabeled: bool = Query(True),
    frame_idx: Optional[int] = Query(None),
    after_frame_idx: Optional[int] = Query(None),
    before_frame_idx: Optional[int] = Query(None),
):
    _require_config()
    frames = get_frame_files(video)
    if not frames:
        raise HTTPException(status_code=404, detail=f"No frames found for video '{video}'")

    if frame_idx is not None:
        # Specific frame requested (slider jump)
        if frame_idx < 0 or frame_idx >= len(frames):
            raise HTTPException(status_code=400, detail="frame_idx out of range")
        if is_in_flight(video, frame_idx) and check_lease(client_id, video, frame_idx) is None:
            raise HTTPException(
                status_code=409,
                detail="Requested frame is currently being labeled by another user.",
            )
        chosen_idx = frame_idx

    elif before_frame_idx is not None:
        # Navigate backwards
        start = before_frame_idx - 1
        chosen_idx = None
        for offset in range(len(frames)):
            i = start - offset
            if i < 0:
                break  # don't wrap backwards; stop at beginning
            if is_in_flight(video, i) and check_lease(client_id, video, i) is None:
                continue
            if only_unlabeled and is_frame_labeled(video, frames[i]):
                continue
            chosen_idx = i
            break

        if chosen_idx is None:
            raise HTTPException(status_code=409, detail="No free frames available")

    else:
        # Navigate forwards (default or after_frame_idx)
        start = 0
        if after_frame_idx is not None and 0 <= after_frame_idx < len(frames):
            start = after_frame_idx + 1

        chosen_idx = None
        for offset in range(len(frames)):
            i = start + offset
            if i >= len(frames):
                break  # don't wrap around
            if is_in_flight(video, i) and check_lease(client_id, video, i) is None:
                continue
            if only_unlabeled and is_frame_labeled(video, frames[i]):
                continue
            chosen_idx = i
            break

        if chosen_idx is None:
            raise HTTPException(status_code=409, detail="No free frames available")

    chosen_file = frames[chosen_idx]
    acquire_frame(client_id, username, video, chosen_idx)

    human = read_human_labels(video, chosen_file)
    machine = read_machine_labels(video, chosen_file)
    img_w, img_h = get_frame_dimensions(video, chosen_file)

    video_counts = count_labeled_frames(video)
    all_videos = get_videos()
    global_labeled = sum(count_labeled_frames(v)["labeled"] for v in all_videos)
    global_total = sum(count_labeled_frames(v)["total"] for v in all_videos)

    return {
        "video": video,
        "frame_idx": chosen_idx,
        "frame_url": f"/frames/{video}/{chosen_file}",
        "image_width": img_w,
        "image_height": img_h,
        "total_frames": len(frames),
        "human_labels": human,
        "machine_labels": machine,
        "progress": {
            "video_labeled": video_counts["labeled"],
            "video_total": video_counts["total"],
            "global_labeled": global_labeled,
            "global_total": global_total,
        },
    }


# ---------------------------------------------------------------------------
# Labels
# ---------------------------------------------------------------------------


class LabelSubmission(BaseModel):
    client_id: str
    username: str
    video: str
    frame_idx: int
    labels: Dict[str, Optional[Dict[str, Any]]]
    overwrite: bool = False


@app.put("/api/labels")
def put_labels(body: LabelSubmission):
    _require_config()
    frames = get_frame_files(body.video)
    if body.frame_idx < 0 or body.frame_idx >= len(frames):
        raise HTTPException(status_code=400, detail="frame_idx out of range")

    if not body.overwrite:
        lease = check_lease(body.client_id, body.video, body.frame_idx)
        if lease is None:
            raise HTTPException(
                status_code=409,
                detail={
                    "error": "stale_session",
                    "message": "Your session expired.",
                },
            )

    frame_file = frames[body.frame_idx]
    stage_labels(body.video, frame_file, body.username, body.labels)
    release_frame(body.client_id, body.video, body.frame_idx)
    return {"saved": True}


# ---------------------------------------------------------------------------
# Release / Heartbeat
# ---------------------------------------------------------------------------


class ReleaseBody(BaseModel):
    client_id: str
    username: str
    video: str
    frame_idx: int


@app.post("/api/release")
def post_release(body: ReleaseBody):
    _require_config()
    release_frame(body.client_id, body.video, body.frame_idx)
    return {"released": True}


@app.post("/api/heartbeat")
def post_heartbeat(body: ReleaseBody):
    _require_config()
    ok = heartbeat(body.client_id, body.video, body.frame_idx)
    if not ok:
        raise HTTPException(status_code=404, detail="Lease not found or stale")
    return {"ok": True}


# ---------------------------------------------------------------------------
# Frame image serving — must be registered BEFORE the SPA catch-all
# ---------------------------------------------------------------------------

@app.get("/frames/{video}/{filename:path}", include_in_schema=False)
def serve_frame(video: str, filename: str):
    _require_config()
    path = get_labeled_data_dir(video) / filename
    if not path.exists():
        raise HTTPException(status_code=404, detail="Frame not found")
    return FileResponse(str(path))


# ---------------------------------------------------------------------------
# Frontend SPA catch-all (registered last so it doesn't shadow any API routes)
# ---------------------------------------------------------------------------

_frontend_dir = _get_frontend_dir()

if _frontend_dir is not None:
    app.mount("/assets", StaticFiles(directory=str(_frontend_dir / "assets")), name="spa-assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_spa(full_path: str):
        index = _frontend_dir / "index.html"
        if index.exists():
            return FileResponse(str(index))
        raise HTTPException(status_code=404, detail="Frontend not found")
