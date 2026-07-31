#!/usr/bin/env python3
"""Read-only Browser Use installation diagnostics."""

from __future__ import annotations

import argparse
import importlib.metadata
import json
import os
import pathlib
import shutil
import socket
import stat
import sys
import tomllib


def check(value: bool, code: str, checks: list[dict[str, object]]) -> None:
    checks.append({"check": code, "ok": bool(value)})


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default=os.environ.get("BROWSER_USE_RUNTIME_CONFIG") or os.path.expanduser("~/.browser-use-cli/browser-use-runtime.toml"))
    parser.add_argument("--state-root", default=os.environ.get("BROWSER_USE_STATE_ROOT") or os.path.expanduser("~/.browser-use-cli"))
    args = parser.parse_args()
    config_path = pathlib.Path(args.config).expanduser().resolve()
    state_root = pathlib.Path(args.state_root).expanduser().resolve()
    checks: list[dict[str, object]] = []
    if not config_path.is_file():
        print(json.dumps({"status": "blocked", "exact_blocker": "browser_use_cli_doctor_config_missing", "checks": checks}, sort_keys=True))
        return 1
    check(stat.S_IMODE(config_path.stat().st_mode) == 0o600, "browser_use_cli_doctor_config_mode", checks)
    try:
        with config_path.open("rb") as handle:
            config = tomllib.load(handle)
        check(config.get("schema") == "browser-use-runtime.v1", "browser_use_cli_doctor_config_schema", checks)
    except (OSError, tomllib.TOMLDecodeError):
        print(json.dumps({"status": "blocked", "exact_blocker": "browser_use_cli_doctor_config_invalid", "checks": checks}, sort_keys=True))
        return 1

    roots = config.get("roots", {})
    for name, value in roots.items():
        path = pathlib.Path(str(value))
        check(path.is_dir() and stat.S_IMODE(path.stat().st_mode) == 0o700, f"browser_use_cli_doctor_root_{name}", checks)
    for kind, spec in (config.get("executables") or {}).items():
        path = pathlib.Path(str((spec or {}).get("canonical_path", "")))
        check(path.is_file() and not path.is_symlink(), f"browser_use_cli_doctor_executable_{kind}", checks)
        check(path.exists() and os.access(path, os.X_OK), f"browser_use_cli_doctor_executable_{kind}_executable", checks)
    try:
        check(importlib.metadata.version("browser-use") == "0.13.7", "browser_use_cli_doctor_browser_use_version", checks)
    except importlib.metadata.PackageNotFoundError:
        check(False, "browser_use_cli_doctor_browser_use_version", checks)
    check(shutil.which("node") is not None, "browser_use_cli_doctor_node", checks)
    check(pathlib.Path(state_root).is_dir(), "browser_use_cli_doctor_state_root", checks)

    ports = config.get("ports") or {}
    occupied = []
    for port in range(int(ports.get("scheduled_start", 0)), int(ports.get("temporary_end", 0)) + 1):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(0.05)
            if sock.connect_ex(("127.0.0.1", port)) == 0:
                occupied.append(port)
    print(json.dumps({"status": "completed" if all(item["ok"] for item in checks) else "blocked", "checks": checks, "occupied_loopback_ports": occupied, "state_root": str(state_root), "config": str(config_path), "read_only": True}, sort_keys=True))
    return 0 if all(item["ok"] for item in checks) else 1


if __name__ == "__main__":
    raise SystemExit(main())
