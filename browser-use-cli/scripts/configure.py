#!/usr/bin/env python3
"""Create a machine-local Browser Use runtime config without secrets."""

from __future__ import annotations

import argparse
import importlib.metadata
import os
import pathlib
import plistlib
import shutil
import site
import stat
import subprocess
import sys
import tempfile
from typing import Iterable


PINNED_BROWSER_USE_VERSION = "0.13.7"


def canonical_executable(names: Iterable[str], label: str) -> pathlib.Path:
    for name in names:
        candidate = shutil.which(name)
        if candidate:
            path = pathlib.Path(candidate).resolve()
            if path.is_file() and os.access(path, os.X_OK):
                return path
    raise SystemExit(f"browser_use_cli_configure_{label}_missing")


def chrome_executable() -> pathlib.Path:
    candidates = [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "google-chrome",
        "chromium",
        "chromium-browser",
    ]
    for candidate in candidates:
        path = pathlib.Path(candidate).expanduser()
        if not path.is_absolute():
            found = shutil.which(candidate)
            if found:
                path = pathlib.Path(found)
        if path.exists():
            path = path.resolve()
            if path.is_file() and os.access(path, os.X_OK):
                return path
    raise SystemExit("browser_use_cli_configure_chrome_missing")


def version(path: pathlib.Path, kind: str) -> str:
    import re

    if kind == "browser_use":
        try:
            value = importlib.metadata.version("browser-use")
        except importlib.metadata.PackageNotFoundError as exc:
            raise SystemExit("browser_use_cli_configure_browser_use_package_missing") from exc
        if value != PINNED_BROWSER_USE_VERSION:
            raise SystemExit(f"browser_use_cli_configure_browser_use_version_mismatch:{value}")
        return value
    if kind == "python":
        return f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
    if kind == "chrome":
        # macOS Chrome may block while launched with --version (for example
        # when an existing GUI instance owns the profile). Read the signed
        # bundle metadata instead; this is deterministic and does not launch
        # Chrome. Fall back to the CLI only for non-bundle Chromium installs.
        bundle_info = path.parent.parent / "Info.plist"
        if bundle_info.is_file():
            try:
                with bundle_info.open("rb") as handle:
                    metadata = plistlib.load(handle)
                text = str(metadata.get("CFBundleShortVersionString") or metadata.get("CFBundleVersion") or "")
                match = re.search(r"(\d+\.\d+(?:\.\d+){1,2})", text)
                if match:
                    return match.group(1)
            except (OSError, plistlib.InvalidFileException, ValueError, TypeError):
                pass
    try:
        result = subprocess.run([str(path), "--version"], check=False, capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.SubprocessError) as exc:
        raise SystemExit(f"browser_use_cli_configure_{kind}_version_unavailable") from exc
    text = f"{result.stdout} {result.stderr}"
    match = re.search(r"(\d+\.\d+(?:\.\d+){1,2})", text)
    if not match:
        raise SystemExit(f"browser_use_cli_configure_{kind}_version_unavailable")
    return match.group(1)


def executable_block(path: pathlib.Path, kind: str) -> str:
    mode = stat.S_IMODE(path.stat().st_mode)
    return "\n".join(
        [
            f"path = {str(path)!r}",
            f"canonical_path = {str(path)!r}",
            f"version = {version(path, kind)!r}",
            f"sha256 = {sha256(path)!r}",
            f"mode = {f'{mode:04o}'!r}",
        ]
    )


def sha256(path: pathlib.Path) -> str:
    import hashlib

    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def first_site_packages() -> pathlib.Path:
    candidates = [pathlib.Path(item) for item in site.getsitepackages()]
    candidates.extend(pathlib.Path(item) for item in sys.path if item and "site-packages" in item)
    for candidate in candidates:
        if candidate.is_dir():
            return candidate.resolve()
    return pathlib.Path(sys.prefix).resolve()


def write_config(config_path: pathlib.Path, state_root: pathlib.Path) -> None:
    browser_use = canonical_executable(("browser-use",), "browser_use")
    chrome = chrome_executable()
    python = pathlib.Path(sys.executable).resolve()
    ffprobe = canonical_executable(("ffprobe",), "ffprobe")
    ffmpeg = canonical_executable(("ffmpeg",), "ffmpeg")
    runtime = state_root / "recording-runtime"
    for directory in (
        state_root,
        state_root / "home",
        state_root / "profiles" / "scheduled",
        state_root / "profiles" / "single-use",
        state_root / "profiles" / "temporary",
        state_root / "receipts",
        state_root / "locks",
        state_root / "quarantine",
        state_root / "downloads",
        state_root / "logs",
        state_root / "recordings",
        runtime,
        runtime / "deps",
    ):
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(directory, 0o700)
    sitecustomize = runtime / "sitecustomize.py"
    if not sitecustomize.exists():
        sitecustomize.write_text("# Browser Use recording runtime marker.\n", encoding="utf-8")
    os.chmod(sitecustomize, 0o600)
    site_packages = first_site_packages()
    config_path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(config_path.parent, 0o700)
    blocks = [
        'schema = "browser-use-runtime.v1"',
        "",
        "[executables.browser_use]",
        executable_block(browser_use, "browser_use"),
        "",
        "[executables.chrome]",
        executable_block(chrome, "chrome"),
        "",
        "[executables.ffprobe]",
        executable_block(ffprobe, "ffprobe"),
        "",
        "[executables.ffmpeg]",
        executable_block(ffmpeg, "ffmpeg"),
        "",
        "[executables.python]",
        executable_block(python, "python"),
        "",
        "[roots]",
        f"browser_use_home = {str(state_root / 'home')!r}",
        f"scheduled_profiles = {str(state_root / 'profiles' / 'scheduled')!r}",
        f"single_use_profiles = {str(state_root / 'profiles' / 'single-use')!r}",
        f"temporary_profiles = {str(state_root / 'profiles' / 'temporary')!r}",
        f"receipts = {str(state_root / 'receipts')!r}",
        f"locks = {str(state_root / 'locks')!r}",
        f"quarantine = {str(state_root / 'quarantine')!r}",
        f"downloads = {str(state_root / 'downloads')!r}",
        f"logs = {str(state_root / 'logs')!r}",
        f"recordings = {str(state_root / 'recordings')!r}",
        "",
        "[recording]",
        f"runtime_dir = {str(runtime)!r}",
        f"dependencies_dir = {str(runtime / 'deps')!r}",
        f"site_packages_dir = {str(site_packages)!r}",
        "default_framerate = 12",
        "max_commands = 128",
        "",
        '[network]\nloopback_host = "127.0.0.1"\nremote_debugging_address = "127.0.0.1"',
        "",
        "[ports]",
        "scheduled_start = 19880\nscheduled_end = 19899\nsingle_use_start = 19980\nsingle_use_end = 19999\ntemporary_start = 20080\ntemporary_end = 20099\nmax_parallel = 20",
        "",
        "[limits]",
        "quarantine_ttl_seconds = 86400\ntemporary_ttl_seconds = 86400\nmax_upload_bytes = 52428800\nmax_download_bytes = 52428800",
        "",
        '[commands]\npublic = ["open", "get", "state", "screenshot", "scroll", "wait", "extract", "back", "close-tab"]\nauthorized = ["open", "click", "type", "input", "scroll", "back", "screenshot", "state", "switch", "close-tab", "keys", "select", "upload", "download", "eval", "extract", "hover", "dblclick", "rightclick", "wait", "get", "close"]',
        "",
        '[policy]\nunsafe_path_fragments = ["/logout", "/log-out", "/unsubscribe", "/delete", "/remove-account", "/close-account"]\nreceipt_file_mode = "0600"\nroot_dir_mode = "0700"',
        "",
    ]
    payload = "\n".join(blocks)
    temporary_path: pathlib.Path | None = None
    try:
        temporary_fd, temporary_name = tempfile.mkstemp(
            prefix=f".{config_path.name}.",
            dir=str(config_path.parent),
            text=True,
        )
        temporary_path = pathlib.Path(temporary_name)
        os.fchmod(temporary_fd, 0o600)
        with os.fdopen(temporary_fd, "w", encoding="utf-8") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_path, config_path)
        temporary_path = None
        directory_fd = os.open(config_path.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--state-root", default=os.environ.get("BROWSER_USE_STATE_ROOT") or os.path.expanduser("~/.browser-use-cli"))
    parser.add_argument("--config", default=os.environ.get("BROWSER_USE_RUNTIME_CONFIG"))
    args = parser.parse_args()
    state_root = pathlib.Path(args.state_root).expanduser().resolve()
    config = pathlib.Path(args.config).expanduser().resolve() if args.config else state_root / "browser-use-runtime.toml"
    write_config(config, state_root)
    print(f"configured:{config}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
