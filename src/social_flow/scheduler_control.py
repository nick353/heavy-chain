from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import secrets
import sqlite3
import stat
import tomllib
import uuid


CONTROL_REQUEST_SCHEMA = "scheduler_control_request.v2"
CONTROL_RECEIPT_SCHEMA = "scheduler_control_receipt.v2"
TRUSTED_WRAPPER_RECEIPT_SCHEMA = "scheduler_control_trusted_wrapper_receipt.v2"
CONTROL_STATE_SCHEMA = "scheduler_control_state.v1"
DEFAULT_AUTOMATIONS_ROOT = Path.home() / ".codex" / "automations"
DEFAULT_CONTROL_ROOT = DEFAULT_AUTOMATIONS_ROOT / "_shared" / "control-runs"
DEFAULT_CAPABILITY_REGISTRY = DEFAULT_AUTOMATIONS_ROOT / "_shared" / "scheduler-control.toml"
DEFAULT_AUTOMATION_DB = Path.home() / ".codex" / "sqlite" / "codex-dev.db"
LIVE_STAGES = {"preflight", "execute"}
STAGES = {"dry-run", *LIVE_STAGES}


class SchedulerControlError(RuntimeError):
    pass


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _atomic_write_json(path: Path, payload: dict[str, object], *, mode: int = 0o600) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        path.parent.chmod(0o700)
    except OSError:
        pass
    temp_path = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temp_path.chmod(mode)
    temp_path.replace(path)
    path.chmod(mode)
    return path


def _write_json_o_excl(path: Path, payload: dict[str, object], *, mode: int = 0o600) -> Path:
    descriptor = None
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
        os.write(descriptor, (json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
        os.fsync(descriptor)
    except FileExistsError as exc:
        raise SchedulerControlError(f"scheduler_control_artifact_already_exists:{path}") from exc
    finally:
        if descriptor is not None:
            os.close(descriptor)
    path.chmod(mode)
    return path


def _control_state_pointer_path(request: dict[str, object]) -> Path:
    return Path(str(request["control_run_dir"])).resolve() / "control-state-current.json"


def _write_control_state_snapshot(
    request: dict[str, object],
    *,
    sequence: int,
    status: str,
    exact_blocker: str = "",
    resolved_terminal_blocker: dict[str, object] | None = None,
    publish_pointer: bool = True,
) -> Path:
    run_dir = Path(str(request["control_run_dir"])).resolve()
    snapshot_path = run_dir / f"control-state-{sequence:04d}-{status}.json"
    payload: dict[str, object] = {
        "schema": CONTROL_STATE_SCHEMA,
        "sequence": sequence,
        "status": status,
        "request_id": request["request_id"],
        "automation_id": request["automation_id"],
        "control_run_id": request["control_run_id"],
        "scheduler_run_id": request["scheduler_run_id"],
        "scheduler_run_dir": request["scheduler_run_dir"],
        "stage": request["stage"],
        "exact_blocker": exact_blocker,
        "updated_at": _utc_now().isoformat(),
    }
    if resolved_terminal_blocker is not None:
        payload["resolved_terminal_blocker"] = resolved_terminal_blocker
    _write_json_o_excl(snapshot_path, payload)
    if publish_pointer:
        _publish_control_state_pointer(request, snapshot_path=snapshot_path, sequence=sequence, status=status)
    return snapshot_path


def _publish_control_state_pointer(
    request: dict[str, object],
    *,
    snapshot_path: Path,
    sequence: int,
    status: str,
) -> Path:
    return _atomic_write_json(
        _control_state_pointer_path(request),
        {
            "schema": "scheduler_control_state_pointer.v1",
            "sequence": sequence,
            "status": status,
            "snapshot_path": str(snapshot_path),
            "request_id": request["request_id"],
            "control_run_id": request["control_run_id"],
            "updated_at": _utc_now().isoformat(),
        },
    )


def _automation_paths(automation_id: str, automations_root: Path) -> tuple[Path, Path, Path]:
    automation_dir = automations_root / automation_id
    return automation_dir / "automation.toml", automation_dir / "STATE.md", automation_dir / "memory.md"


def _load_automation(automation_id: str, automations_root: Path) -> tuple[Path, dict[str, object]]:
    automation_toml, state_path, memory_path = _automation_paths(automation_id, automations_root)
    if not automation_toml.is_file():
        raise SchedulerControlError(f"automation_toml_not_found:{automation_toml}")
    if not state_path.is_file():
        raise SchedulerControlError(f"automation_state_not_found:{state_path}")
    if not memory_path.is_file():
        raise SchedulerControlError(f"automation_memory_not_found:{memory_path}")
    try:
        automation = tomllib.loads(automation_toml.read_text(encoding="utf-8"))
    except Exception as exc:
        raise SchedulerControlError(f"automation_toml_invalid:{automation_toml}:{exc}") from exc
    if str(automation.get("id") or "").strip() != automation_id:
        raise SchedulerControlError(
            f"automation_id_mismatch:requested={automation_id}:registered={automation.get('id') or 'missing'}"
        )
    return automation_toml, automation


def _registered_cwd(automation: dict[str, object]) -> Path:
    cwds = automation.get("cwds")
    if not isinstance(cwds, list) or not cwds or not str(cwds[0]).strip():
        raise SchedulerControlError("registered_automation_cwd_missing")
    return Path(str(cwds[0])).expanduser().resolve()


def _load_capabilities(registry_path: Path) -> dict[str, dict[str, object]]:
    if not registry_path.is_file():
        return {}
    try:
        payload = tomllib.loads(registry_path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise SchedulerControlError(f"scheduler_capability_registry_invalid:{registry_path}:{exc}") from exc
    automations = payload.get("automations")
    if not isinstance(automations, dict):
        return {}
    return {str(key): value for key, value in automations.items() if isinstance(value, dict)}


def _db_readback(automation_id: str, db_path: Path) -> dict[str, object]:
    if not db_path.is_file():
        raise SchedulerControlError(f"registered_automation_db_missing:{db_path}")
    connection = sqlite3.connect(str(db_path))
    try:
        row = connection.execute(
            "select prompt, cwds, model, reasoning_effort, status from automations where id=?",
            (automation_id,),
        ).fetchone()
    finally:
        connection.close()
    if row is None:
        raise SchedulerControlError(f"registered_automation_store_missing:{automation_id}")
    prompt, cwds, model, reasoning_effort, status = row
    try:
        parsed_cwds = json.loads(cwds)
    except Exception as exc:
        raise SchedulerControlError(f"registered_automation_store_cwds_invalid:{automation_id}:{exc}") from exc
    return {
        "prompt": prompt,
        "cwds": parsed_cwds,
        "model": model,
        "reasoning_effort": reasoning_effort,
        "status": status,
    }


def _validate_registry_parity(
    automation_id: str,
    automation: dict[str, object],
    db_path: Path,
) -> dict[str, object]:
    db_row = _db_readback(automation_id, db_path)
    fields = ("prompt", "cwds", "model", "reasoning_effort", "status")
    matches = {field: db_row.get(field) == automation.get(field) for field in fields}
    if not all(matches.values()):
        raise SchedulerControlError(
            "registered_store_matches_automation_toml_failed:"
            + json.dumps(matches, ensure_ascii=False, sort_keys=True)
        )
    return {"ok": True, "matches": matches, "db": db_row}


def _origin_identity() -> dict[str, str]:
    thread_id = str(os.environ.get("CODEX_THREAD_ID") or "").strip()
    session_id = str(os.environ.get("CODEX_SESSION_ID") or thread_id).strip() or thread_id
    turn_id = str(os.environ.get("CODEX_TURN_ID") or "").strip()
    if not thread_id:
        raise SchedulerControlError("scheduler_control_origin_thread_id_missing")
    if not turn_id:
        raise SchedulerControlError("scheduler_control_origin_turn_id_missing")
    return {"thread_id": thread_id, "session_id": session_id, "turn_id": turn_id}


@dataclass(frozen=True)
class PreparedControlRun:
    request_path: Path
    run_dir: Path
    request: dict[str, object]


def prepare_control_run(
    *,
    automation_id: str,
    stage: str,
    automations_root: Path = DEFAULT_AUTOMATIONS_ROOT,
    control_root: Path = DEFAULT_CONTROL_ROOT,
    capability_registry: Path = DEFAULT_CAPABILITY_REGISTRY,
    db_path: Path = DEFAULT_AUTOMATION_DB,
    ttl_seconds: int = 18000,
) -> PreparedControlRun:
    if stage not in STAGES:
        raise SchedulerControlError(f"scheduler_control_stage_invalid:{stage}")
    automation_toml, automation = _load_automation(automation_id, automations_root)
    parity = _validate_registry_parity(automation_id, automation, db_path)
    status = str(automation.get("status") or "").strip().upper()
    if stage in LIVE_STAGES and status != "ACTIVE":
        raise SchedulerControlError(f"automation_not_active_for_live_stage:{automation_id}:status={status or 'missing'}")
    registered_cwd = _registered_cwd(automation)
    if not registered_cwd.is_dir():
        raise SchedulerControlError(f"registered_automation_cwd_not_found:{registered_cwd}")
    capabilities = _load_capabilities(capability_registry).get(automation_id, {})
    browser_required = bool(capabilities.get("browser_required", automation_id == "job-application-manager"))
    configured_timeout = int(capabilities.get("run_timeout_seconds") or ttl_seconds)
    if configured_timeout < 60 or configured_timeout > 18000:
        raise SchedulerControlError("scheduler_control_run_timeout_seconds_invalid")
    identity = _origin_identity()
    now = _utc_now()
    expires_at = now + timedelta(seconds=configured_timeout)
    control_run_id = f"{now.strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:12]}"
    run_nonce = secrets.token_hex(32)
    prompt = str(automation.get("prompt") or "")
    prompt_sha = _sha256_text(prompt)
    launch_message = json.dumps(
        {
            "automation_id": automation_id,
            "control_run_id": control_run_id,
            "registered_cwd": str(registered_cwd),
            "registered_prompt_sha256": prompt_sha,
            "run_nonce": run_nonce,
            "stage": stage,
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    run_dir = (control_root / control_run_id).resolve()
    request_path = run_dir / "request.json"
    request_id = uuid.uuid4().hex
    scheduler_run_id = f"{now.strftime('%Y%m%d-%H%M%S-%f')}-{uuid.uuid4().hex[:8]}"
    scheduler_run_dir = (
        registered_cwd
        / "artifacts"
        / "run-summaries"
        / f"codex-app-{automation_id}-{scheduler_run_id}"
    ).resolve()
    scheduler_run_dir.mkdir(parents=True, exist_ok=False, mode=0o700)
    scheduler_run_dir.chmod(0o700)
    request: dict[str, object] = {
        "schema": CONTROL_REQUEST_SCHEMA,
        "request_id": request_id,
        "automation_id": automation_id,
        "control_run_id": control_run_id,
        "stage": stage,
        "mode": stage,
        "browser_required": browser_required,
        "run_timeout_seconds": configured_timeout,
        "origin_thread_id": identity["thread_id"],
        "origin_session_id": identity["session_id"],
        "origin_turn_id": identity["turn_id"],
        "run_nonce": run_nonce,
        "registered_prompt_sha256": prompt_sha,
        "launch_message_sha256": _sha256_text(launch_message),
        "registered_cwd": str(registered_cwd),
        "automation_toml": str(automation_toml.resolve()),
        "control_run_dir": str(run_dir),
        "scheduler_run_id": scheduler_run_id,
        "scheduler_run_dir": str(scheduler_run_dir),
        "request_path": str(request_path),
        "issued_at": now.isoformat(),
        "expires_at": expires_at.isoformat(),
    }
    _atomic_write_json(request_path, request)
    _write_control_state_snapshot(
        request,
        sequence=1,
        status="awaiting_trusted_dispatch" if browser_required else "prepared",
    )
    _atomic_write_json(
        run_dir / "registry-readback.json",
        {
            "schema": "scheduler_registry_readback.v1",
            "automation_id": automation_id,
            "automation_toml": str(automation_toml.resolve()),
            "registered_cwd": str(registered_cwd),
            "status": status,
            "browser_required": browser_required,
            "registered_prompt_sha256": prompt_sha,
            "parity": parity,
            "created_at": now.isoformat(),
        },
    )
    _atomic_write_json(
        run_dir / "launch-packet.json",
        {
            "schema": "scheduler_control_launch_packet.v1",
            "automation_id": automation_id,
            "control_run_id": control_run_id,
            "stage": stage,
            "registered_cwd": str(registered_cwd),
            "registered_prompt_sha256": prompt_sha,
            "launch_message_sha256": request["launch_message_sha256"],
            "request_path": str(request_path),
        },
    )
    return PreparedControlRun(request_path=request_path, run_dir=run_dir, request=request)


def load_control_request(
    request_path: Path,
    *,
    control_root: Path = DEFAULT_CONTROL_ROOT,
) -> dict[str, object]:
    resolved = request_path.expanduser().resolve()
    try:
        request = json.loads(resolved.read_text(encoding="utf-8"))
    except Exception as exc:
        raise SchedulerControlError(f"scheduler_control_request_unreadable:{resolved}:{exc}") from exc
    if not isinstance(request, dict) or request.get("schema") != CONTROL_REQUEST_SCHEMA:
        raise SchedulerControlError(f"scheduler_control_request_schema_invalid:{resolved}")
    expected_path = Path(str(request.get("request_path") or "")).expanduser().resolve()
    run_dir = Path(str(request.get("control_run_dir") or "")).expanduser().resolve()
    if resolved != expected_path or resolved.parent != run_dir or resolved.name != "request.json":
        raise SchedulerControlError(f"scheduler_control_request_path_binding_invalid:{resolved}")
    expected_control_root = control_root.expanduser().resolve()
    if run_dir.parent != expected_control_root:
        raise SchedulerControlError(f"scheduler_control_request_outside_control_root:{resolved}")
    request_stat = resolved.stat()
    run_dir_stat = run_dir.stat()
    if request_stat.st_uid != os.getuid() or run_dir_stat.st_uid != os.getuid():
        raise SchedulerControlError("scheduler_control_request_owner_invalid")
    if request_stat.st_mode & 0o777 != 0o600 or run_dir_stat.st_mode & 0o777 != 0o700:
        raise SchedulerControlError("scheduler_control_request_permissions_invalid")
    try:
        expires_at = datetime.fromisoformat(str(request.get("expires_at") or ""))
    except ValueError as exc:
        raise SchedulerControlError("scheduler_control_request_expiry_invalid") from exc
    if expires_at.tzinfo is None or expires_at <= _utc_now():
        raise SchedulerControlError("scheduler_control_request_expired")
    required = (
        "automation_id",
        "request_id",
        "control_run_id",
        "stage",
        "mode",
        "origin_thread_id",
        "origin_session_id",
        "origin_turn_id",
        "run_nonce",
        "registered_prompt_sha256",
        "launch_message_sha256",
        "registered_cwd",
        "scheduler_run_id",
        "scheduler_run_dir",
        "issued_at",
        "expires_at",
        "run_timeout_seconds",
    )
    missing = [field for field in required if not str(request.get(field) or "").strip()]
    if missing:
        raise SchedulerControlError("scheduler_control_request_binding_missing:" + ",".join(missing))
    return request


def load_and_consume_trusted_wrapper_receipt(request: dict[str, object]) -> dict[str, object]:
    receipt_path_text = str(os.environ.get("SOCIAL_FLOW_TRUSTED_WRAPPER_RECEIPT_PATH") or "").strip()
    if not receipt_path_text:
        raise SchedulerControlError("trusted_wrapper_receipt_missing")
    scheduler_run_dir = Path(str(request.get("scheduler_run_dir") or "")).expanduser().absolute()
    expected_scheduler_root = (
        Path(str(request.get("registered_cwd") or "")).expanduser().resolve()
        / "artifacts"
        / "run-summaries"
    )
    expected_scheduler_name = f"codex-app-{request.get('automation_id')}-{request.get('scheduler_run_id')}"
    try:
        scheduler_metadata = scheduler_run_dir.lstat()
        scheduler_real_dir = scheduler_run_dir.resolve(strict=True)
    except OSError as exc:
        raise SchedulerControlError("trusted_wrapper_scheduler_run_dir_missing") from exc
    if (
        stat.S_ISLNK(scheduler_metadata.st_mode)
        or not stat.S_ISDIR(scheduler_metadata.st_mode)
        or scheduler_real_dir != scheduler_run_dir
        or scheduler_run_dir.parent != expected_scheduler_root
        or scheduler_run_dir.name != expected_scheduler_name
        or scheduler_metadata.st_uid != os.getuid()
        or scheduler_metadata.st_mode & 0o777 != 0o700
    ):
        raise SchedulerControlError("trusted_wrapper_scheduler_run_dir_invalid")
    receipt_path = Path(receipt_path_text).expanduser().absolute()
    if receipt_path.parent != scheduler_run_dir or receipt_path.name != "trusted-wrapper-v2-receipt.json":
        raise SchedulerControlError("trusted_wrapper_receipt_outside_scheduler_run_dir")
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(receipt_path, flags)
    except FileNotFoundError as exc:
        raise SchedulerControlError("trusted_wrapper_receipt_missing") from exc
    except OSError as exc:
        if exc.errno in {getattr(os, "ELOOP", 62), 62}:
            raise SchedulerControlError("trusted_wrapper_receipt_symlink_rejected") from exc
        raise SchedulerControlError(f"trusted_wrapper_receipt_open_failed:{exc.errno}") from exc
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode):
            raise SchedulerControlError("trusted_wrapper_receipt_not_regular_file")
        if metadata.st_uid != os.getuid() or metadata.st_mode & 0o777 != 0o600:
            raise SchedulerControlError("trusted_wrapper_receipt_permissions_invalid")
        chunks: list[bytes] = []
        while True:
            chunk = os.read(descriptor, 65536)
            if not chunk:
                break
            chunks.append(chunk)
        try:
            receipt = json.loads(b"".join(chunks).decode("utf-8"))
        except Exception as exc:
            raise SchedulerControlError("trusted_wrapper_receipt_invalid_json") from exc
    finally:
        os.close(descriptor)
    if not isinstance(receipt, dict) or receipt.get("schema") != TRUSTED_WRAPPER_RECEIPT_SCHEMA:
        raise SchedulerControlError("trusted_wrapper_receipt_schema_invalid")
    # These values are the trusted wrapper's run-bound runtime identity.  They
    # must come from the receipt itself: inheriting a bridge URL/instance or a
    # process-manifest path from the controller environment would allow a
    # stale/copied receipt to bind to a different runtime.  Keep the order
    # stable because this blocker is consumed by the scheduler/readback layer.
    missing_runtime_fields = [
        field
        for field in ("bridge_url", "bridge_instance_id", "process_manifest_path")
        if not str(receipt.get(field) or "").strip()
    ]
    if missing_runtime_fields:
        raise SchedulerControlError(
            "trusted_wrapper_receipt_runtime_binding_missing:" + ",".join(missing_runtime_fields)
        )
    process_manifest_path_text = str(receipt.get("process_manifest_path") or "").strip()
    owned_process_manifest_path_text = str(receipt.get("owned_process_manifest_path") or "").strip()
    if not owned_process_manifest_path_text:
        raise SchedulerControlError("trusted_wrapper_receipt_process_manifest_alias_missing")
    process_manifest_path = Path(process_manifest_path_text).expanduser().absolute()
    owned_process_manifest_path = Path(owned_process_manifest_path_text).expanduser().absolute()
    canonical_process_manifest_path = scheduler_run_dir / "trusted-wrapper-process-manifest.json"
    if (
        process_manifest_path != canonical_process_manifest_path
        or owned_process_manifest_path != canonical_process_manifest_path
    ):
        raise SchedulerControlError("trusted_wrapper_process_manifest_path_invalid")
    if process_manifest_path_text != owned_process_manifest_path_text:
        raise SchedulerControlError("trusted_wrapper_process_manifest_alias_mismatch")
    # An ambient value may be present as a consistency check, but it is never
    # used to fill a missing receipt field.  This catches a stale wrapper
    # environment before owner-artifact checks can obscure the exact binding.
    for field, env_key in (
        ("bridge_url", "SOCIAL_FLOW_CHROME_EXTENSION_BRIDGE_URL"),
        ("bridge_instance_id", "SOCIAL_FLOW_TRUSTED_BRIDGE_INSTANCE_ID"),
        ("process_manifest_path", "SOCIAL_FLOW_TRUSTED_PROCESS_MANIFEST_PATH"),
    ):
        ambient = str(os.environ.get(env_key) or "").strip()
        if ambient and ambient != str(receipt.get(field) or "").strip():
            raise SchedulerControlError(
                f"trusted_wrapper_receipt_binding_mismatch:{field}:expected={ambient}:actual={receipt.get(field) or 'missing'}"
            )
    expected = {
        "request_id": str(request.get("request_id") or ""),
        "request_path": str(request.get("request_path") or ""),
        "automation_id": str(request.get("automation_id") or ""),
        "control_run_id": str(request.get("control_run_id") or ""),
        "run_nonce": str(request.get("run_nonce") or ""),
        "mode": str(request.get("mode") or ""),
        "stage": str(request.get("stage") or ""),
        "scheduler_run_id": str(request.get("scheduler_run_id") or ""),
        "scheduler_run_dir": str(request.get("scheduler_run_dir") or ""),
        "execution_session_id": str(os.environ.get("CODEX_SESSION_ID") or ""),
        "execution_thread_id": str(os.environ.get("SOCIAL_FLOW_CONTROL_EXECUTION_THREAD_ID") or ""),
        "execution_turn_id": str(os.environ.get("SOCIAL_FLOW_CONTROL_EXECUTION_TURN_ID") or ""),
        "bridge_instance_id": str(receipt.get("bridge_instance_id") or ""),
        "bridge_url": str(receipt.get("bridge_url") or ""),
        "owner_id": str(os.environ.get("SOCIAL_FLOW_TRUSTED_OWNER_ID") or ""),
        "owner_start_path": str(os.environ.get("SOCIAL_FLOW_TRUSTED_OWNER_START_PATH") or ""),
        "owner_heartbeat_path": str(os.environ.get("SOCIAL_FLOW_TRUSTED_OWNER_HEARTBEAT_PATH") or ""),
        "owner_terminal_path": str(os.environ.get("SOCIAL_FLOW_TRUSTED_OWNER_TERMINAL_PATH") or ""),
        "receipt_path": str(receipt_path),
        "process_manifest_path": process_manifest_path_text,
        "owned_process_manifest_path": owned_process_manifest_path_text,
    }
    for field, expected_value in expected.items():
        actual = str(receipt.get(field) or "")
        if not expected_value or actual != expected_value:
            raise SchedulerControlError(
                f"trusted_wrapper_receipt_binding_mismatch:{field}:expected={expected_value or 'missing'}:actual={actual or 'missing'}"
            )
    if receipt.get("status") != "ready" or receipt.get("external_actions") != 0:
        raise SchedulerControlError("trusted_wrapper_receipt_state_invalid")
    if receipt.get("owner_timeout_seconds") != request.get("run_timeout_seconds"):
        raise SchedulerControlError("trusted_wrapper_receipt_binding_mismatch:owner_timeout_seconds")
    terminal_path = Path(str(receipt.get("owner_terminal_path") or "")).expanduser().absolute()
    if terminal_path.parent != scheduler_run_dir or terminal_path.name != "trusted-wrapper-owner-terminal.json":
        raise SchedulerControlError("trusted_wrapper_owner_artifact_outside_scheduler_run_dir:owner_terminal_path")
    if terminal_path.exists():
        raise SchedulerControlError("trusted_wrapper_owner_terminal_before_child_start")
    owner_artifacts = {
        "owner_start_path": ("trusted-wrapper-owner-start.json", "scheduler_control_trusted_wrapper_owner_start.v1"),
        "owner_heartbeat_path": ("trusted-wrapper-owner-heartbeat.json", "scheduler_control_trusted_wrapper_owner_heartbeat.v1"),
    }
    for field, (expected_name, schema) in owner_artifacts.items():
        owner_path = Path(str(receipt.get(field) or "")).expanduser().absolute()
        if owner_path.parent != scheduler_run_dir or owner_path.name != expected_name:
            raise SchedulerControlError(f"trusted_wrapper_owner_artifact_outside_scheduler_run_dir:{field}")
        try:
            owner_meta = owner_path.lstat()
        except OSError as exc:
            raise SchedulerControlError(f"trusted_wrapper_owner_artifact_missing:{field}") from exc
        if (
            not stat.S_ISREG(owner_meta.st_mode)
            or stat.S_ISLNK(owner_meta.st_mode)
            or owner_meta.st_uid != os.getuid()
            or owner_meta.st_mode & 0o777 != 0o600
            or owner_meta.st_nlink != 1
        ):
            raise SchedulerControlError(f"trusted_wrapper_owner_artifact_invalid:{field}")
        owner_payload = _read_json_object(owner_path, f"trusted_wrapper_owner_artifact_unreadable:{field}")
        if (
            owner_payload.get("schema") != schema
            or owner_payload.get("status") != "running"
            or str(owner_payload.get("owner_id") or "") != expected["owner_id"]
            or str(owner_payload.get("bridge_instance_id") or "") != expected["bridge_instance_id"]
            or str(owner_payload.get("control_run_id") or "") != expected["control_run_id"]
        ):
            raise SchedulerControlError(f"trusted_wrapper_owner_artifact_binding_mismatch:{field}")
    try:
        issued_at = datetime.fromisoformat(str(receipt.get("issued_at") or ""))
        expires_at = datetime.fromisoformat(str(receipt.get("expires_at") or ""))
    except ValueError as exc:
        raise SchedulerControlError("trusted_wrapper_receipt_time_invalid") from exc
    now = _utc_now()
    if issued_at.tzinfo is None or expires_at.tzinfo is None or issued_at > now or now - issued_at > timedelta(seconds=120):
        raise SchedulerControlError("trusted_wrapper_receipt_too_old")
    if expires_at <= now or str(receipt.get("expires_at")) != str(request.get("expires_at")):
        raise SchedulerControlError("trusted_wrapper_receipt_expired_or_request_mismatch")
    consume_path = scheduler_run_dir / "trusted-wrapper-v2-receipt-consumed.json"
    consume_payload = {
        "schema": "scheduler_control_trusted_wrapper_receipt_consumption.v1",
        "request_id": expected["request_id"],
        "control_run_id": expected["control_run_id"],
        "receipt_path": str(receipt_path),
        "receipt_sha256": hashlib.sha256(json.dumps(receipt, sort_keys=True).encode("utf-8")).hexdigest(),
        "owner_id": expected["owner_id"],
        "consumed_at": now.isoformat(),
    }
    try:
        consume_descriptor = os.open(consume_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError as exc:
        raise SchedulerControlError("trusted_wrapper_receipt_already_consumed") from exc
    try:
        os.write(consume_descriptor, (json.dumps(consume_payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
        os.fsync(consume_descriptor)
    finally:
        os.close(consume_descriptor)
    consume_path.chmod(0o600)
    return {**receipt, "consumption_claim": str(consume_path)}


def validate_control_request_registration(
    *,
    request_path: Path,
    automation_id: str,
    stage: str,
    automations_root: Path = DEFAULT_AUTOMATIONS_ROOT,
    capability_registry: Path | None = None,
    db_path: Path | None = None,
) -> dict[str, object]:
    request = load_control_request(request_path, control_root=automations_root / "_shared" / "control-runs")
    automation_toml, automation = _load_automation(automation_id, automations_root)
    resolved_capability_registry = capability_registry or (automations_root / "_shared" / "scheduler-control.toml")
    resolved_db_path = db_path or (automations_root.parent / "sqlite" / "codex-dev.db")
    _validate_registry_parity(automation_id, automation, resolved_db_path)
    registered_cwd = _registered_cwd(automation)
    prompt_sha = _sha256_text(str(automation.get("prompt") or ""))
    status = str(automation.get("status") or "").strip().upper()
    if stage in LIVE_STAGES and status != "ACTIVE":
        raise SchedulerControlError(f"automation_not_active_for_live_stage:{automation_id}:status={status or 'missing'}")
    capabilities = _load_capabilities(resolved_capability_registry).get(automation_id, {})
    browser_required = bool(capabilities.get("browser_required", automation_id == "job-application-manager"))
    expected = {
        "automation_id": automation_id,
        "stage": stage,
        "automation_toml": str(automation_toml.resolve()),
        "registered_cwd": str(registered_cwd),
        "registered_prompt_sha256": prompt_sha,
        "browser_required": browser_required,
        "run_timeout_seconds": int(capabilities.get("run_timeout_seconds") or 18000),
    }
    for field, expected_value in expected.items():
        if request.get(field) != expected_value:
            raise SchedulerControlError(
                f"scheduler_control_request_registration_mismatch:{field}:expected={expected_value}:actual={request.get(field)}"
            )
    return request


def claim_control_execution(request: dict[str, object]) -> Path:
    if str(request.get("stage") or "") != "execute":
        raise SchedulerControlError("scheduler_control_execute_claim_wrong_stage")
    run_dir = Path(str(request["control_run_dir"])).resolve()
    claim_path = run_dir / "execute-claim.json"
    payload = {
        "schema": "scheduler_control_execute_claim.v1",
        "automation_id": request["automation_id"],
        "control_run_id": request["control_run_id"],
        "run_nonce": request["run_nonce"],
        "claimed_at": _utc_now().isoformat(),
    }
    try:
        descriptor = os.open(claim_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError as exc:
        raise SchedulerControlError(f"scheduler_control_execute_request_already_claimed:{claim_path}") from exc
    try:
        os.write(descriptor, (json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
    finally:
        os.close(descriptor)
    claim_path.chmod(0o600)
    return claim_path


def _read_json_object(path: Path, exact_blocker: str) -> dict[str, object]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise SchedulerControlError(f"{exact_blocker}:{path}") from exc
    if not isinstance(payload, dict):
        raise SchedulerControlError(f"{exact_blocker}:{path}")
    return payload


def transition_control_to_running(request: dict[str, object]) -> Path:
    run_dir = Path(str(request["control_run_dir"])).resolve()
    scheduler_run_dir = Path(str(request["scheduler_run_dir"])).resolve()
    transition_claim = run_dir / "trusted-running-transition-claim.json"
    _write_json_o_excl(
        transition_claim,
        {
            "schema": "scheduler_control_running_transition_claim.v1",
            "request_id": request["request_id"],
            "control_run_id": request["control_run_id"],
            "claimed_at": _utc_now().isoformat(),
        },
    )
    pointer = _read_json_object(_control_state_pointer_path(request), "scheduler_control_state_pointer_unreadable")
    if (
        pointer.get("schema") != "scheduler_control_state_pointer.v1"
        or pointer.get("status") != "awaiting_trusted_dispatch"
        or pointer.get("sequence") != 1
        or str(pointer.get("request_id") or "") != str(request["request_id"])
        or str(pointer.get("control_run_id") or "") != str(request["control_run_id"])
    ):
        raise SchedulerControlError("scheduler_control_running_transition_source_invalid")
    dispatch_claim = _read_json_object(run_dir / "trusted-dispatch-claim.json", "scheduler_control_dispatch_claim_missing_or_invalid")
    if (
        dispatch_claim.get("schema") != "scheduler_control_trusted_dispatch_claim.v1"
        or str(dispatch_claim.get("request_path") or "") != str(request["request_path"])
    ):
        raise SchedulerControlError("scheduler_control_dispatch_claim_binding_invalid")
    receipt_claim = _read_json_object(
        scheduler_run_dir / "trusted-wrapper-v2-receipt-consumed.json",
        "scheduler_control_receipt_consumption_claim_missing_or_invalid",
    )
    if (
        receipt_claim.get("schema") != "scheduler_control_trusted_wrapper_receipt_consumption.v1"
        or str(receipt_claim.get("request_id") or "") != str(request["request_id"])
        or str(receipt_claim.get("control_run_id") or "") != str(request["control_run_id"])
    ):
        raise SchedulerControlError("scheduler_control_receipt_consumption_claim_binding_invalid")
    if request.get("stage") == "execute":
        execute_claim = _read_json_object(run_dir / "execute-claim.json", "scheduler_control_execute_claim_missing_or_invalid")
        if (
            execute_claim.get("schema") != "scheduler_control_execute_claim.v1"
            or str(execute_claim.get("control_run_id") or "") != str(request["control_run_id"])
            or str(execute_claim.get("run_nonce") or "") != str(request["run_nonce"])
        ):
            raise SchedulerControlError("scheduler_control_execute_claim_binding_invalid")
    blocker_path = run_dir / "terminal-blocker.json"
    blocker = _read_json_object(blocker_path, "scheduler_control_initial_terminal_blocker_missing_or_invalid")
    resolved_at = _utc_now().isoformat()
    resolved_blocker = {
        **blocker,
        "status": "resolved",
        "resolved_by": "trusted_dispatch_started",
        "resolved_at": resolved_at,
    }
    snapshot_path = _write_control_state_snapshot(
        request,
        sequence=2,
        status="running",
        resolved_terminal_blocker=resolved_blocker,
        publish_pointer=False,
    )
    _write_json_o_excl(run_dir / "terminal-blocker.resolved.json", resolved_blocker)
    blocker_path.unlink()
    _publish_control_state_pointer(
        request,
        snapshot_path=snapshot_path,
        sequence=2,
        status="running",
    )
    return snapshot_path


def finalize_control_state(
    request: dict[str, object],
    *,
    status: str,
    exact_blocker: str = "",
) -> Path:
    if status not in {"completed", "preflight_complete", "blocked"}:
        raise SchedulerControlError(f"scheduler_control_final_status_invalid:{status}")
    pointer = _read_json_object(_control_state_pointer_path(request), "scheduler_control_state_pointer_unreadable")
    sequence = int(pointer.get("sequence") or 0) + 1
    return _write_control_state_snapshot(
        request,
        sequence=sequence,
        status=status,
        exact_blocker=exact_blocker,
    )


_ENV_BINDINGS = {
    "request_id": "SOCIAL_FLOW_CONTROL_REQUEST_ID",
    "automation_id": "SOCIAL_FLOW_CONTROL_AUTOMATION_ID",
    "control_run_id": "SOCIAL_FLOW_CONTROL_RUN_ID",
    "origin_thread_id": "SOCIAL_FLOW_CONTROL_ORIGIN_THREAD_ID",
    "origin_session_id": "SOCIAL_FLOW_CONTROL_ORIGIN_SESSION_ID",
    "origin_turn_id": "SOCIAL_FLOW_CONTROL_ORIGIN_TURN_ID",
    "run_nonce": "SOCIAL_FLOW_CONTROL_RUN_NONCE",
    "registered_prompt_sha256": "SOCIAL_FLOW_CONTROL_REGISTERED_PROMPT_SHA256",
    "launch_message_sha256": "SOCIAL_FLOW_CONTROL_LAUNCH_MESSAGE_SHA256",
    "registered_cwd": "SOCIAL_FLOW_CONTROL_REGISTERED_CWD",
    "stage": "SOCIAL_FLOW_CONTROL_STAGE",
    "mode": "SOCIAL_FLOW_CONTROL_MODE",
    "scheduler_run_id": "SOCIAL_FLOW_CONTROL_SCHEDULER_RUN_ID",
    "scheduler_run_dir": "SOCIAL_FLOW_CONTROL_SCHEDULER_RUN_DIR",
    "issued_at": "SOCIAL_FLOW_CONTROL_ISSUED_AT",
    "expires_at": "SOCIAL_FLOW_CONTROL_EXPIRES_AT",
}


def validate_trusted_wrapper_env(
    *,
    request_path: Path,
    automation_id: str,
    stage: str,
    automations_root: Path = DEFAULT_AUTOMATIONS_ROOT,
    capability_registry: Path | None = None,
    db_path: Path | None = None,
) -> dict[str, object]:
    request = validate_control_request_registration(
        request_path=request_path,
        automation_id=automation_id,
        stage=stage,
        automations_root=automations_root,
        capability_registry=capability_registry,
        db_path=db_path,
    )
    if os.environ.get("SOCIAL_FLOW_TRUSTED_BROWSER_WRAPPER_V2") != "1":
        raise SchedulerControlError("trusted_browser_wrapper_required_for_current_run")
    for request_key, env_key in _ENV_BINDINGS.items():
        expected = str(request.get(request_key) or "")
        actual = str(os.environ.get(env_key) or "")
        if not actual or actual != expected:
            raise SchedulerControlError(
                f"trusted_browser_wrapper_binding_mismatch:{request_key}:expected={expected or 'missing'}:actual={actual or 'missing'}"
            )
    if str(request.get("automation_id")) != automation_id or str(request.get("stage")) != stage:
        raise SchedulerControlError("trusted_browser_wrapper_request_target_mismatch")
    execution_thread_id = str(os.environ.get("SOCIAL_FLOW_CONTROL_EXECUTION_THREAD_ID") or "").strip()
    execution_turn_id = str(os.environ.get("SOCIAL_FLOW_CONTROL_EXECUTION_TURN_ID") or "").strip()
    bridge_instance_id = str(os.environ.get("SOCIAL_FLOW_TRUSTED_BRIDGE_INSTANCE_ID") or "").strip()
    bridge_url = str(os.environ.get("SOCIAL_FLOW_CHROME_EXTENSION_BRIDGE_URL") or "").strip()
    owner_id = str(os.environ.get("SOCIAL_FLOW_TRUSTED_OWNER_ID") or "").strip()
    owner_heartbeat_path = str(os.environ.get("SOCIAL_FLOW_TRUSTED_OWNER_HEARTBEAT_PATH") or "").strip()
    process_manifest_path = str(os.environ.get("SOCIAL_FLOW_TRUSTED_PROCESS_MANIFEST_PATH") or "").strip()
    owned_process_manifest_path = str(os.environ.get("SOCIAL_FLOW_OWNED_PROCESS_MANIFEST_PATH") or "").strip()
    missing_runtime_fields = [
        field
        for field, value in (
            ("bridge_url", bridge_url),
            ("bridge_instance_id", bridge_instance_id),
            ("process_manifest_path", process_manifest_path),
        )
        if not value
    ]
    if missing_runtime_fields:
        raise SchedulerControlError(
            "trusted_wrapper_receipt_runtime_binding_missing:" + ",".join(missing_runtime_fields)
        )
    if not owned_process_manifest_path:
        raise SchedulerControlError("trusted_browser_wrapper_process_manifest_alias_missing")
    if not execution_thread_id or not execution_turn_id or not owner_id or not owner_heartbeat_path:
        raise SchedulerControlError("trusted_browser_wrapper_runtime_binding_missing")
    automation_toml, automation = _load_automation(automation_id, automations_root)
    registered_cwd = _registered_cwd(automation)
    prompt_sha = _sha256_text(str(automation.get("prompt") or ""))
    if str(request.get("automation_toml")) != str(automation_toml.resolve()):
        raise SchedulerControlError("trusted_browser_wrapper_automation_toml_changed")
    if str(request.get("registered_cwd")) != str(registered_cwd):
        raise SchedulerControlError("trusted_browser_wrapper_registered_cwd_changed")
    if str(request.get("registered_prompt_sha256")) != prompt_sha:
        raise SchedulerControlError("trusted_browser_wrapper_registered_prompt_changed")
    manifest_path = Path(process_manifest_path).expanduser().absolute()
    owned_manifest_path = Path(owned_process_manifest_path).expanduser().absolute()
    scheduler_run_dir = Path(str(request.get("scheduler_run_dir") or "")).expanduser().resolve()
    canonical_manifest_path = scheduler_run_dir / "trusted-wrapper-process-manifest.json"
    if (
        manifest_path != canonical_manifest_path
        or owned_manifest_path != canonical_manifest_path
    ):
        raise SchedulerControlError("trusted_wrapper_process_manifest_path_invalid")
    if process_manifest_path != owned_process_manifest_path:
        raise SchedulerControlError("trusted_wrapper_process_manifest_alias_mismatch")
    return {
        **request,
        "execution_thread_id": execution_thread_id,
        "execution_turn_id": execution_turn_id,
        "bridge_instance_id": bridge_instance_id,
        "bridge_url": bridge_url,
        "owner_id": owner_id,
        "owner_heartbeat_path": owner_heartbeat_path,
        "process_manifest_path": process_manifest_path,
        "owned_process_manifest_path": owned_process_manifest_path,
    }


def bridge_binding_from_env() -> dict[str, str]:
    mapping = {
        "automation_id": "SOCIAL_FLOW_CONTROL_AUTOMATION_ID",
        "control_run_id": "SOCIAL_FLOW_CONTROL_RUN_ID",
        "origin_thread_id": "SOCIAL_FLOW_CONTROL_ORIGIN_THREAD_ID",
        "origin_session_id": "SOCIAL_FLOW_CONTROL_ORIGIN_SESSION_ID",
        "origin_turn_id": "SOCIAL_FLOW_CONTROL_ORIGIN_TURN_ID",
        "execution_thread_id": "SOCIAL_FLOW_CONTROL_EXECUTION_THREAD_ID",
        "execution_turn_id": "SOCIAL_FLOW_CONTROL_EXECUTION_TURN_ID",
        "run_nonce": "SOCIAL_FLOW_CONTROL_RUN_NONCE",
        "registered_prompt_sha256": "SOCIAL_FLOW_CONTROL_REGISTERED_PROMPT_SHA256",
        "launch_message_sha256": "SOCIAL_FLOW_CONTROL_LAUNCH_MESSAGE_SHA256",
        "registered_cwd": "SOCIAL_FLOW_CONTROL_REGISTERED_CWD",
        "control_stage": "SOCIAL_FLOW_CONTROL_STAGE",
        "bridge_instance_id": "SOCIAL_FLOW_TRUSTED_BRIDGE_INSTANCE_ID",
        "bridge_url": "SOCIAL_FLOW_CHROME_EXTENSION_BRIDGE_URL",
        "issued_at": "SOCIAL_FLOW_CONTROL_ISSUED_AT",
        "expires_at": "SOCIAL_FLOW_CONTROL_EXPIRES_AT",
    }
    result = {key: str(os.environ.get(env_key) or "").strip() for key, env_key in mapping.items()}
    # Process-manifest bindings are part of the trusted wrapper contract only.
    # Nontrusted/diagnostic bridge probes intentionally retain their smaller
    # historical binding set.
    if os.environ.get("SOCIAL_FLOW_TRUSTED_BROWSER_WRAPPER_V2") == "1":
        result["process_manifest_path"] = str(
            os.environ.get("SOCIAL_FLOW_TRUSTED_PROCESS_MANIFEST_PATH") or ""
        ).strip()
        result["owned_process_manifest_path"] = str(
            os.environ.get("SOCIAL_FLOW_OWNED_PROCESS_MANIFEST_PATH") or ""
        ).strip()
    return result


def validate_bridge_receipt_v2(payload: dict[str, object]) -> None:
    expected = bridge_binding_from_env()
    missing_expected = [key for key, value in expected.items() if not value]
    if missing_expected:
        raise SchedulerControlError("bridge_receipt_v2_expected_binding_missing:" + ",".join(missing_expected))
    if payload.get("control_schema") != CONTROL_RECEIPT_SCHEMA:
        raise SchedulerControlError("bridge_receipt_v2_schema_invalid")
    for key, expected_value in expected.items():
        actual = str(payload.get(key) or "").strip()
        if actual != expected_value:
            raise SchedulerControlError(
                f"bridge_receipt_v2_binding_mismatch:{key}:expected={expected_value}:actual={actual or 'missing'}"
            )


def write_control_blocker(request: dict[str, object], exact_blocker: str) -> Path:
    run_dir = Path(str(request["control_run_dir"])).resolve()
    return _atomic_write_json(
        run_dir / "terminal-blocker.json",
        {
            "schema": "automation_stage_observation.v1",
            "workflow": "scheduler-control",
            "run_id": request["control_run_id"],
            "stage": request["stage"],
            "attempt_no": 1,
            "status": "blocked",
            "exact_blocker": exact_blocker,
            "artifact_uri": str(run_dir),
            "finished_at": _utc_now().isoformat(),
        },
    )


def write_control_cleanup(
    request: dict[str, object],
    *,
    status: str,
    exact_blocker: str = "",
    owned_processes_remaining: list[str] | None = None,
) -> Path:
    run_dir = Path(str(request["control_run_dir"])).resolve()
    remaining = list(owned_processes_remaining or [])
    # A terminal success status is only truthful when cleanup is clean.  Keep
    # the cleanup artifact as the source of truth and do not resolve the
    # initial blocker when a residual process or blocker is present.
    effective_status = status
    effective_blocker = exact_blocker
    if remaining or effective_blocker:
        if not effective_blocker:
            effective_blocker = "owned_processes_remaining_after_cleanup" if remaining else "cleanup_blocked"
        if effective_status in {"preflight_complete", "completed"}:
            effective_status = "blocked"
    cleanup_path = _atomic_write_json(
        run_dir / "cleanup-proof.json",
        {
            "schema": "scheduler_control_cleanup.v1",
            "control_run_id": request["control_run_id"],
            "automation_id": request["automation_id"],
            "status": effective_status,
            "exact_blocker": effective_blocker,
            "owned_processes_remaining": remaining,
            "finished_at": _utc_now().isoformat(),
        },
    )
    if effective_status in {"preflight_complete", "completed"}:
        blocker_path = run_dir / "terminal-blocker.json"
        if blocker_path.is_file():
            try:
                blocker = json.loads(blocker_path.read_text(encoding="utf-8"))
            except Exception:
                blocker = {"exact_blocker": "terminal_blocker_unreadable_during_resolution"}
            _atomic_write_json(
                run_dir / "terminal-blocker.resolved.json",
                {
                    **blocker,
                    "status": "resolved",
                    "resolved_by": status,
                    "resolved_at": _utc_now().isoformat(),
                },
            )
            blocker_path.unlink()
    return cleanup_path
