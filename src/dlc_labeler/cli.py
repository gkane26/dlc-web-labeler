"""CLI entry point: dlc-web-labeler"""
import argparse
import os
from pathlib import Path
import importlib.resources

HOWTO_MD = importlib.resources.files("dlc_labeler") / "howto.md"

def main():
    parser = argparse.ArgumentParser(
        prog="dlc-web-labeler",
        description="Run the DLC web labeling server.",
    )
    parser.add_argument(
        "--config",
        required=True,
        metavar="PATH",
        help="Path to the DLC config.yaml file.",
    )
    parser.add_argument(
        "--token",
        required=True,
        metavar="TOKEN",
        help="Auth token that labelers must supply to log in.",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=8000,
        metavar="PORT",
        help="TCP port to listen on (default: 8000).",
    )
    parser.add_argument(
        "--host",
        default="0.0.0.0",
        metavar="HOST",
        help="Host / interface to bind to (default: 0.0.0.0).",
    )
    parser.add_argument(
        "--instructions",
        metavar="PATH",
        default="",
        help="Path to a Markdown file shown as labeling instructions.",
    )
    parser.add_argument(
        "--howto",
        metavar="PATH",
        default=HOWTO_MD,
        help="Path to a Markdown file shown as the how-to guide.",
    )

    args = parser.parse_args()

    # Resolve and validate paths
    config_path = Path(args.config).expanduser().resolve()
    if not config_path.exists():
        raise SystemExit(f"Config file not found: {config_path}")

    os.environ["DLC_CONFIG_PATH"] = str(config_path)
    os.environ["DLC_TOKEN"] = args.token

    if args.instructions:
        instructions_path = Path(args.instructions).expanduser().resolve()
        if not instructions_path.exists():
            raise SystemExit(f"Instructions file not found: {instructions_path}")
        os.environ["DLC_INSTRUCTIONS_PATH"] = str(instructions_path)

    if args.howto:
        howto_path = Path(args.howto).expanduser().resolve()
        if not howto_path.exists():
            raise SystemExit(f"How-to file not found: {howto_path}")
        os.environ["DLC_HOWTO_PATH"] = str(howto_path)

    print(f"DLC Labeler running at http://{args.host}:{args.port}")

    import uvicorn
    uvicorn.run(
        "dlc_labeler.backend.api:app",
        host=args.host,
        port=args.port,
        reload=False,
    )
