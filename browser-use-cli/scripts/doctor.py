#!/usr/bin/env python3
"""Read-only Browser Use installation diagnostics."""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import os
import pathlib
import shutil
import socket
import stat
import subprocess
import sys
import tomllib


def check(value: bool, code: str, checks: list[dict[str, object]]) -> None:
    checks.append({"check": code, "ok": bool(value)})


def sha256(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default=os.environ.get("BROWSER_USE_RUNTIME_CONFIG") or os.path.expanduser("~/.browser-use-cli/browser-use-runtime.toml"))
    parser.add_argument("--state-root", default=os.environ.get("BROWSER_USE_STATE_ROOT") or os.path.expanduser("~/.browser-use-cli"))
    parser.add_argument("--helper", default=os.environ.get("BROWSER_USE_CLI_HELPER") or os.path.expanduser("~/.local/bin/codex-browser-use"))
    args = parser.parse_args()
    config_path = pathlib.Path(args.config).expanduser().resolve()
    state_root = pathlib.Path(args.state_root).expanduser().resolve()
    helper_path = pathlib.Path(args.helper).expanduser()
    package_helper = pathlib.Path(__file__).resolve().parents[1] / "bin" / "codex-browser-use"
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
    helper_regular = helper_path.is_file() and not helper_path.is_symlink()
    helper_target = pathlib.Path(os.path.realpath(helper_path)) if helper_path.exists() else pathlib.Path("")
    package_target = pathlib.Path(os.path.realpath(package_helper)) if package_helper.exists() else pathlib.Path("")
    check(helper_path.exists() and helper_path.is_file(), "browser_use_cli_doctor_helper_present", checks)
    check(helper_path.stat().st_uid == os.getuid() if helper_path.exists() else False, "browser_use_cli_doctor_helper_owner", checks)
    check((helper_path.stat().st_mode & 0o777) == 0o700 if helper_path.exists() else False, "browser_use_cli_doctor_helper_mode", checks)
    check(
        bool(helper_target and package_target and (helper_target == package_target or (helper_regular and sha256(helper_path) == sha256(package_helper)))),
        "browser_use_cli_doctor_helper_source_parity",
        checks,
    )
    source_sha = sha256(package_helper) if package_helper.is_file() else None
    installed_sha = sha256(helper_path) if helper_regular else None
    repo_root = package_helper.resolve().parents[2] if package_helper.is_file() else None
    git_head_sha = None
    git_head_helper_sha = None
    git_provenance_error = None
    if repo_root is not None:
        try:
            head = subprocess.run(
                ["git", "-C", str(repo_root), "rev-parse", "HEAD"],
                capture_output=True,
                text=True,
                check=True,
                timeout=3,
            )
            git_head_sha = head.stdout.strip() or None
            relative_helper = package_helper.resolve().relative_to(repo_root)
            source_at_head = subprocess.run(
                ["git", "-C", str(repo_root), "show", f"HEAD:{relative_helper}"],
                capture_output=True,
                check=True,
                timeout=3,
            )
            git_head_helper_sha = hashlib.sha256(source_at_head.stdout).hexdigest()
        except (OSError, subprocess.SubprocessError, ValueError):
            git_provenance_error = "git_readback_unavailable"
    installed_matches_source = bool(installed_sha and source_sha and installed_sha == source_sha)
    source_matches_git_head = bool(source_sha and git_head_helper_sha and source_sha == git_head_helper_sha)
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
    release_ready = bool(installed_matches_source and source_matches_git_head)
    print(json.dumps({"status": "completed" if all(item["ok"] for item in checks) else "blocked", "checks": checks, "occupied_loopback_ports": occupied, "runtime_ready_for_new_run": not occupied, "runtime_blocker": "browser_use_loopback_port_occupied" if occupied else None, "state_root": str(state_root), "config": str(config_path), "read_only": True, "provenance": {"schema": "browser-use-cli-provenance.v1", "helper_path": str(helper_path), "package_helper": str(package_helper), "source_sha256": source_sha, "installed_sha256": installed_sha, "installed_matches_source": installed_matches_source, "git_root": str(repo_root) if repo_root else None, "git_head_sha": git_head_sha, "git_head_helper_sha256": git_head_helper_sha, "source_matches_git_head": source_matches_git_head, "reproducible_from_git": release_ready, "release_ready": release_ready, "publication_required": not source_matches_git_head, "git_provenance_error": git_provenance_error}}, sort_keys=True))
    return 0 if all(item["ok"] for item in checks) else 1


if __name__ == "__main__":
    raise SystemExit(main())
