"""DLC config parsing and label I/O with pending-labels layer."""
import re
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
import yaml
from filelock import FileLock

_config: Optional[Dict[str, Any]] = None
_project_path: Optional[Path] = None

# video -> frame_filename -> bodypart -> label
_human_label_cache: Dict[str, Dict[str, Dict[str, Optional[Dict[str, Any]]]]] = {}
# video -> set(frame_filename)
_labeled_frame_cache: Dict[str, set] = {}
_cache_loaded: bool = False
_cache_lock = threading.RLock()

# Pending-labels layer: (video, frame_file, username) -> labels_dict
_pending: Dict[Tuple[str, str, str], Dict[str, Optional[Dict[str, Any]]]] = {}
_pending_lock = threading.Lock()

OCCLUDED_SENTINEL = -1.0


def _frame_from_row_key(video: str, row_key: str) -> Optional[str]:
    tail = f"/{video}/"
    key = str(row_key)
    pos = key.rfind(tail)
    if pos == -1:
        return None
    return key[pos + len(tail):]


def _labels_for_row(row: pd.Series, scorer: str, bodyparts: List[str]) -> Dict[str, Optional[Dict[str, Any]]]:
    labels: Dict[str, Optional[Dict[str, Any]]] = {bp: None for bp in bodyparts}
    for bp in bodyparts:
        try:
            x = float(row[(scorer, bp, "x")])
            y = float(row[(scorer, bp, "y")])
            if np.isnan(x) or np.isnan(y):
                continue
            occluded = (x == OCCLUDED_SENTINEL and y == OCCLUDED_SENTINEL)
            labels[bp] = {"x": x, "y": y, "occluded": occluded}
        except (KeyError, TypeError):
            continue
    return labels


def _cache_video_labels(video: str) -> None:
    bodyparts = get_bodyparts()
    frame_map: Dict[str, Dict[str, Optional[Dict[str, Any]]]] = {}
    labeled_frames: set = set()
    d = get_labeled_data_dir(video)
    h5_files = sorted(d.glob("CollectedData_*.h5"))

    for h5 in h5_files:
        try:
            df = pd.read_hdf(str(h5))
        except Exception:
            continue
        scorer = df.columns.get_level_values("scorer")[0]
        for idx in df.index:
            frame = _frame_from_row_key(video, str(idx))
            if not frame:
                continue
            row = df.loc[idx]
            if hasattr(row, "ndim") and row.ndim > 1:
                row = row.iloc[0]
            parsed = _labels_for_row(row, scorer, bodyparts)
            existing = frame_map.get(frame)
            if existing is None:
                existing = {bp: None for bp in bodyparts}
                frame_map[frame] = existing
            for bp in bodyparts:
                if parsed.get(bp) is not None:
                    existing[bp] = parsed[bp]
            if any(existing.get(bp) is not None for bp in bodyparts):
                labeled_frames.add(frame)

    _human_label_cache[video] = frame_map
    _labeled_frame_cache[video] = labeled_frames


def init_human_label_cache() -> None:
    global _cache_loaded
    with _cache_lock:
        _human_label_cache.clear()
        _labeled_frame_cache.clear()
        for video in get_videos():
            _cache_video_labels(video)
        _cache_loaded = True


def _ensure_cache_loaded() -> None:
    if _cache_loaded:
        return
    init_human_label_cache()


def load_config(config_path: str) -> Dict[str, Any]:
    global _config, _project_path
    p = Path(config_path)
    _project_path = p.parent
    with open(p) as f:
        raw = yaml.safe_load(f)
    _config = raw
    return raw


def get_config() -> Dict[str, Any]:
    if _config is None:
        raise RuntimeError("Config not loaded. Call load_config() first.")
    return _config


def get_project_path() -> Path:
    if _project_path is None:
        raise RuntimeError("Config not loaded.")
    return _project_path


def get_bodyparts() -> List[str]:
    return get_config().get("bodyparts", [])


def get_videos() -> List[str]:
    cfg = get_config()
    video_sets = cfg.get("video_sets", {})
    if isinstance(video_sets, dict):
        names = []
        for vpath in video_sets.keys():
            stem = Path(vpath).stem
            names.append(stem)
        return names
    return []


def get_labeled_data_dir(video: str) -> Path:
    return get_project_path() / "labeled-data" / video


def get_frame_dimensions(video: str, frame_filename: str) -> tuple:
    """Read (width, height) from PNG IHDR — no PIL required."""
    import struct
    path = get_labeled_data_dir(video) / frame_filename
    try:
        with open(str(path), "rb") as f:
            f.read(8)   # PNG signature
            f.read(4)   # IHDR chunk length
            f.read(4)   # IHDR type
            w = struct.unpack(">I", f.read(4))[0]
            h = struct.unpack(">I", f.read(4))[0]
        return w, h
    except Exception:
        return 640, 480


def get_frame_files(video: str) -> List[str]:
    d = get_labeled_data_dir(video)
    if not d.exists():
        return []
    files = sorted(f.name for f in d.iterdir() if f.suffix == ".png")
    return files


def _build_empty_df(scorer: str, bodyparts: List[str], img_path: str) -> pd.DataFrame:
    cols = pd.MultiIndex.from_tuples(
        [(scorer, bp, coord) for bp in bodyparts for coord in ("x", "y")],
        names=["scorer", "bodyparts", "coords"],
    )
    return pd.DataFrame(index=[img_path], columns=cols, dtype=float)


def read_human_labels(video: str, frame_filename: str) -> Dict[str, Optional[Dict]]:
    _ensure_cache_loaded()
    bodyparts = get_bodyparts()
    with _cache_lock:
        by_video = _human_label_cache.get(video, {})
        frame_labels = by_video.get(frame_filename)
        if not frame_labels:
            return {bp: None for bp in bodyparts}
        return {
            bp: (dict(frame_labels[bp]) if frame_labels.get(bp) is not None else None)
            for bp in bodyparts
        }


def read_machine_labels(video: str, frame_filename: str) -> Dict[str, Optional[Dict]]:
    d = get_labeled_data_dir(video)
    bodyparts = get_bodyparts()
    cfg = get_config()
    pcutoff = float(cfg.get("pcutoff", 0.6))

    pattern = re.compile(r"machinelabels-iter(\d+)\.h5")
    candidates = [(int(m.group(1)), f) for f in d.iterdir() if (m := pattern.match(f.name))]
    if not candidates:
        return {}

    _, latest = max(candidates, key=lambda t: t[0])
    try:
        df = pd.read_hdf(str(latest))
    except Exception:
        return {}

    row_key = f"labeled-data/{video}/{frame_filename}"
    if row_key not in df.index:
        return {}

    row = df.loc[row_key]
    scorer = df.columns.get_level_values("scorer")[0]
    result: Dict[str, Optional[Dict]] = {}

    for bp in bodyparts:
        try:
            x = float(row[(scorer, bp, "x")])
            y = float(row[(scorer, bp, "y")])
            likelihood = float(row[(scorer, bp, "likelihood")])
            if np.isnan(x) or np.isnan(y):
                result[bp] = None
                continue
            result[bp] = {
                "x": x,
                "y": y,
                "confidence": likelihood,
                "below_pcutoff": likelihood < pcutoff,
            }
        except (KeyError, TypeError):
            result[bp] = None

    return result


def _update_cache(
    video: str,
    frame_filename: str,
    labels: Dict[str, Optional[Dict]],
) -> None:
    """Update the in-memory label cache without touching disk."""
    _ensure_cache_loaded()
    bodyparts = get_bodyparts()
    with _cache_lock:
        by_video = _human_label_cache.setdefault(video, {})
        frame_labels = by_video.setdefault(frame_filename, {bp: None for bp in bodyparts})
        for bp, label in labels.items():
            if bp not in bodyparts or label is None:
                continue
            if label.get("occluded"):
                frame_labels[bp] = {
                    "x": OCCLUDED_SENTINEL,
                    "y": OCCLUDED_SENTINEL,
                    "occluded": True,
                }
            else:
                frame_labels[bp] = {
                    "x": float(label["x"]),
                    "y": float(label["y"]),
                    "occluded": False,
                }
        if any(frame_labels.get(bp) is not None for bp in bodyparts):
            _labeled_frame_cache.setdefault(video, set()).add(frame_filename)


def stage_labels(
    video: str,
    frame_filename: str,
    username: str,
    labels: Dict[str, Optional[Dict]],
) -> None:
    """Stage labels for a frame: update in-memory cache immediately and enqueue for disk write."""
    _update_cache(video, frame_filename, labels)
    key = (video, frame_filename, username)
    with _pending_lock:
        _pending[key] = labels


def write_human_labels(
    video: str,
    frame_filename: str,
    username: str,
    labels: Dict[str, Optional[Dict]],
) -> None:
    """Write labels for one frame to disk (HDF5 + CSV). Thread-safe via filelock.

    Does NOT update the in-memory cache — call _update_cache or stage_labels for that.
    This function is intended to be called from flush_pending_labels.
    """
    d = get_labeled_data_dir(video)
    d.mkdir(parents=True, exist_ok=True)
    bodyparts = get_bodyparts()
    h5_path = d / f"CollectedData_{username}.h5"
    csv_path = d / f"CollectedData_{username}.csv"
    lock_path = d / ".write.lock"
    row_key = f"labeled-data/{video}/{frame_filename}"

    with FileLock(str(lock_path)):
        if h5_path.exists():
            try:
                df = pd.read_hdf(str(h5_path))
            except Exception:
                df = _build_empty_df(username, bodyparts, row_key)
        else:
            df = _build_empty_df(username, bodyparts, row_key)

        if row_key not in df.index:
            new_row = _build_empty_df(username, bodyparts, row_key)
            df = pd.concat([df, new_row])

        for bp, label in labels.items():
            if label is None:
                continue
            if bp not in bodyparts:
                continue
            if label.get("occluded"):
                x, y = OCCLUDED_SENTINEL, OCCLUDED_SENTINEL
            else:
                x, y = float(label["x"]), float(label["y"])
            df.loc[row_key, (username, bp, "x")] = x
            df.loc[row_key, (username, bp, "y")] = y

        df.to_hdf(str(h5_path), key="df", mode="w")
        df.to_csv(str(csv_path))


def flush_pending_labels() -> None:
    """Write all pending (staged) labels to disk and clear the pending queue.

    This function is synchronous and safe to call from an async context via
    asyncio.to_thread().
    """
    with _pending_lock:
        snapshot = dict(_pending)
        _pending.clear()

    for (video, frame_filename, username), labels in snapshot.items():
        try:
            write_human_labels(video, frame_filename, username, labels)
        except Exception as exc:
            # Re-queue on failure so we don't silently lose data
            key = (video, frame_filename, username)
            with _pending_lock:
                _pending.setdefault(key, labels)
            raise exc


def count_labeled_frames(video: str) -> Dict[str, int]:
    """Return labeled and total frame counts for a video."""
    _ensure_cache_loaded()
    frames = get_frame_files(video)
    total = len(frames)
    if total == 0:
        return {"labeled": 0, "total": 0}

    with _cache_lock:
        labeled_set = _labeled_frame_cache.get(video, set())
        labeled = sum(1 for f in frames if f in labeled_set)
    return {"labeled": labeled, "total": total}


def is_frame_labeled(video: str, frame_filename: str) -> bool:
    _ensure_cache_loaded()
    with _cache_lock:
        return frame_filename in _labeled_frame_cache.get(video, set())
