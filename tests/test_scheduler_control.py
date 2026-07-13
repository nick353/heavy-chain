from __future__ import annotations

from datetime import datetime, timedelta, timezone
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import sqlite3
import subprocess

import pytest

from social_flow.scheduler_control import (
    CONTROL_RECEIPT_SCHEMA,
    SchedulerControlError,
    bridge_binding_from_env,
    claim_control_execution,
    finalize_control_state,
    load_and_consume_trusted_wrapper_receipt,
    load_control_request,
    prepare_control_run,
    transition_control_to_running,
    validate_control_request_registration,
    validate_bridge_receipt_v2,
    validate_trusted_wrapper_env,
    write_control_blocker,
    write_control_cleanup,
)


def _registered_fixture(tmp_path: Path, *, browser_required: bool = True) -> dict[str, Path]:
    codex_home = tmp_path / "codex-home"
    automations_root = codex_home / "automations"
    automation_dir = automations_root / "sample"
    automation_dir.mkdir(parents=True)
    project_cwd = tmp_path / "project"
    project_cwd.mkdir()
    prompt = "Use the registered safe runner."
    automation_toml = automation_dir / "automation.toml"
    automation_toml.write_text(
        "\n".join(
            [
                'id = "sample"',
                f'prompt = "{prompt}"',
                f'cwds = ["{project_cwd}"]',
                'model = "gpt-5.4-mini"',
                'reasoning_effort = "medium"',
                'status = "ACTIVE"',
                "",
            ]
        ),
        encoding="utf-8",
    )
    (automation_dir / "STATE.md").write_text("state\n", encoding="utf-8")
    (automation_dir / "memory.md").write_text("memory\n", encoding="utf-8")
    shared = automations_root / "_shared"
    shared.mkdir()
    capability_registry = shared / "scheduler-control.toml"
    capability_registry.write_text(
        f'version = 1\n[automations.sample]\nbrowser_required = {str(browser_required).lower()}\n',
        encoding="utf-8",
    )
    db_path = codex_home / "sqlite" / "codex-dev.db"
    db_path.parent.mkdir()
    connection = sqlite3.connect(db_path)
    try:
        connection.execute(
            "create table automations (id text primary key, prompt text, cwds text, model text, reasoning_effort text, status text)"
        )
        connection.execute(
            "insert into automations values (?, ?, ?, ?, ?, ?)",
            ("sample", prompt, json.dumps([str(project_cwd)]), "gpt-5.4-mini", "medium", "ACTIVE"),
        )
        connection.commit()
    finally:
        connection.close()
    return {
        "codex_home": codex_home,
        "automations_root": automations_root,
        "control_root": shared / "control-runs",
        "capability_registry": capability_registry,
        "db_path": db_path,
    }


def _prepare(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    paths = _registered_fixture(tmp_path)
    monkeypatch.setenv("CODEX_THREAD_ID", "thread-123")
    monkeypatch.setenv("CODEX_SESSION_ID", "session-123")
    monkeypatch.setenv("CODEX_TURN_ID", "turn-123")
    prepared = prepare_control_run(
        automation_id="sample",
        stage="preflight",
        automations_root=paths["automations_root"],
        control_root=paths["control_root"],
        capability_registry=paths["capability_registry"],
        db_path=paths["db_path"],
    )
    return paths, prepared


def _bind_wrapper_env(monkeypatch: pytest.MonkeyPatch, request: dict[str, object]) -> None:
    env_map = {
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
    monkeypatch.setenv("SOCIAL_FLOW_TRUSTED_BROWSER_WRAPPER_V2", "1")
    for request_key, env_key in env_map.items():
        monkeypatch.setenv(env_key, str(request[request_key]))
    monkeypatch.setenv("SOCIAL_FLOW_CONTROL_EXECUTION_THREAD_ID", "execution-thread")
    monkeypatch.setenv("SOCIAL_FLOW_CONTROL_EXECUTION_TURN_ID", "execution-turn")
    monkeypatch.setenv("CODEX_SESSION_ID", "execution-session")
    monkeypatch.setenv("SOCIAL_FLOW_TRUSTED_BRIDGE_INSTANCE_ID", "bridge-instance")
    monkeypatch.setenv("SOCIAL_FLOW_CHROME_EXTENSION_BRIDGE_URL", "http://127.0.0.1:43123")
    scheduler_run_dir = Path(str(request["scheduler_run_dir"]))
    monkeypatch.setenv("SOCIAL_FLOW_TRUSTED_OWNER_ID", "owner-id")
    monkeypatch.setenv("SOCIAL_FLOW_TRUSTED_OWNER_START_PATH", str(scheduler_run_dir / "trusted-wrapper-owner-start.json"))
    monkeypatch.setenv("SOCIAL_FLOW_TRUSTED_OWNER_HEARTBEAT_PATH", str(scheduler_run_dir / "trusted-wrapper-owner-heartbeat.json"))
    monkeypatch.setenv("SOCIAL_FLOW_TRUSTED_OWNER_TERMINAL_PATH", str(scheduler_run_dir / "trusted-wrapper-owner-terminal.json"))
    monkeypatch.setenv("SOCIAL_FLOW_TRUSTED_OWNER_TIMEOUT_SECONDS", str(request["run_timeout_seconds"]))
    process_manifest_path = scheduler_run_dir / "trusted-wrapper-process-manifest.json"
    monkeypatch.setenv("SOCIAL_FLOW_TRUSTED_PROCESS_MANIFEST_PATH", str(process_manifest_path))
    monkeypatch.setenv("SOCIAL_FLOW_OWNED_PROCESS_MANIFEST_PATH", str(process_manifest_path))


def _write_trusted_wrapper_receipt(
    monkeypatch: pytest.MonkeyPatch,
    request: dict[str, object],
    *,
    overrides: dict[str, object] | None = None,
) -> Path:
    receipt_path = Path(str(request["scheduler_run_dir"])) / "trusted-wrapper-v2-receipt.json"
    owner_start_path = receipt_path.parent / "trusted-wrapper-owner-start.json"
    owner_heartbeat_path = receipt_path.parent / "trusted-wrapper-owner-heartbeat.json"
    owner_common = {
        "owner_id": "owner-id",
        "bridge_instance_id": "bridge-instance",
        "control_run_id": request["control_run_id"],
        "status": "running",
    }
    owner_start_path.write_text(json.dumps({"schema": "scheduler_control_trusted_wrapper_owner_start.v1", **owner_common}), encoding="utf-8")
    owner_heartbeat_path.write_text(
        json.dumps({"schema": "scheduler_control_trusted_wrapper_owner_heartbeat.v1", "updated_at": datetime.now(timezone.utc).isoformat(), **owner_common}),
        encoding="utf-8",
    )
    owner_start_path.chmod(0o600)
    owner_heartbeat_path.chmod(0o600)
    receipt = {
        "schema": "scheduler_control_trusted_wrapper_receipt.v2",
        "receipt_id": "receipt-id",
        "receipt_path": str(receipt_path),
        "request_id": request["request_id"],
        "request_path": request["request_path"],
        "automation_id": request["automation_id"],
        "control_run_id": request["control_run_id"],
        "run_nonce": request["run_nonce"],
        "mode": request["mode"],
        "stage": request["stage"],
        "scheduler_run_id": request["scheduler_run_id"],
        "scheduler_run_dir": request["scheduler_run_dir"],
        "execution_session_id": "execution-session",
        "execution_thread_id": "execution-thread",
        "execution_turn_id": "execution-turn",
        "bridge_instance_id": "bridge-instance",
        "bridge_url": "http://127.0.0.1:43123",
        "backend": "chrome_extension_trusted_bridge",
        "browser_id": "profile-2",
        "browser_name": "Chrome",
        "browser_type": "extension",
        "browser_metadata": {"profileOrdering": 2, "profileName": "Nicky/Profile 2"},
        "owner_id": "owner-id",
        "owner_start_path": str(owner_start_path),
        "owner_heartbeat_path": str(owner_heartbeat_path),
        "owner_terminal_path": str(receipt_path.parent / "trusted-wrapper-owner-terminal.json"),
        "owner_timeout_seconds": request["run_timeout_seconds"],
        "process_manifest_path": str(receipt_path.parent / "trusted-wrapper-process-manifest.json"),
        "owned_process_manifest_path": str(receipt_path.parent / "trusted-wrapper-process-manifest.json"),
        "status": "ready",
        "external_actions": 0,
        "issued_at": datetime.now(timezone.utc).isoformat(),
        "expires_at": request["expires_at"],
    }
    receipt.update(overrides or {})
    receipt_path.write_text(json.dumps(receipt), encoding="utf-8")
    receipt_path.chmod(0o600)
    monkeypatch.setenv("SOCIAL_FLOW_TRUSTED_WRAPPER_RECEIPT_PATH", str(receipt_path))
    return receipt_path


def test_prepare_control_run_binds_registry_identity_and_private_artifacts(monkeypatch, tmp_path) -> None:
    _, prepared = _prepare(monkeypatch, tmp_path)

    assert prepared.request["schema"] == "scheduler_control_request.v2"
    assert prepared.request["browser_required"] is True
    assert prepared.request["run_timeout_seconds"] == 18000
    assert prepared.request["origin_thread_id"] == "thread-123"
    assert prepared.request["origin_turn_id"] == "turn-123"
    assert len(str(prepared.request["run_nonce"])) == 64
    assert prepared.request_path.stat().st_mode & 0o777 == 0o600
    assert prepared.run_dir.stat().st_mode & 0o777 == 0o700
    assert (prepared.run_dir / "registry-readback.json").stat().st_mode & 0o777 == 0o600
    assert (prepared.run_dir / "launch-packet.json").is_file()
    pointer = json.loads((prepared.run_dir / "control-state-current.json").read_text(encoding="utf-8"))
    assert pointer["status"] == "awaiting_trusted_dispatch"
    assert pointer["sequence"] == 1


def test_prepare_control_run_requires_actual_origin_turn_without_thread_fallback(monkeypatch, tmp_path) -> None:
    paths = _registered_fixture(tmp_path)
    monkeypatch.setenv("CODEX_THREAD_ID", "thread-123")
    monkeypatch.setenv("CODEX_SESSION_ID", "session-123")
    monkeypatch.delenv("CODEX_TURN_ID", raising=False)

    with pytest.raises(SchedulerControlError, match="scheduler_control_origin_turn_id_missing"):
        prepare_control_run(
            automation_id="sample",
            stage="preflight",
            automations_root=paths["automations_root"],
            control_root=paths["control_root"],
            capability_registry=paths["capability_registry"],
            db_path=paths["db_path"],
        )


def test_trusted_wrapper_rejects_cross_run_binding(monkeypatch, tmp_path) -> None:
    paths, prepared = _prepare(monkeypatch, tmp_path)
    _bind_wrapper_env(monkeypatch, prepared.request)
    monkeypatch.setenv("SOCIAL_FLOW_CONTROL_RUN_NONCE", "wrong-nonce")

    with pytest.raises(SchedulerControlError, match="trusted_browser_wrapper_binding_mismatch:run_nonce"):
        validate_trusted_wrapper_env(
            request_path=prepared.request_path,
            automation_id="sample",
            stage="preflight",
            automations_root=paths["automations_root"],
        )


def test_trusted_wrapper_rejects_expired_request(monkeypatch, tmp_path) -> None:
    paths, prepared = _prepare(monkeypatch, tmp_path)
    request = json.loads(prepared.request_path.read_text(encoding="utf-8"))
    request["expires_at"] = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
    prepared.request_path.write_text(json.dumps(request), encoding="utf-8")
    _bind_wrapper_env(monkeypatch, request)

    with pytest.raises(SchedulerControlError, match="scheduler_control_request_expired"):
        validate_trusted_wrapper_env(
            request_path=prepared.request_path,
            automation_id="sample",
            stage="preflight",
            automations_root=paths["automations_root"],
        )


def test_bridge_receipt_v2_requires_every_current_run_binding(monkeypatch, tmp_path) -> None:
    _, prepared = _prepare(monkeypatch, tmp_path)
    _bind_wrapper_env(monkeypatch, prepared.request)
    expected = bridge_binding_from_env()
    payload = {"control_schema": CONTROL_RECEIPT_SCHEMA, **expected}
    validate_bridge_receipt_v2(payload)

    payload["origin_thread_id"] = "different-thread"
    with pytest.raises(SchedulerControlError, match="bridge_receipt_v2_binding_mismatch:origin_thread_id"):
        validate_bridge_receipt_v2(payload)


def test_trusted_wrapper_receipt_is_consumed_once(monkeypatch, tmp_path) -> None:
    _, prepared = _prepare(monkeypatch, tmp_path)
    _bind_wrapper_env(monkeypatch, prepared.request)
    _write_trusted_wrapper_receipt(monkeypatch, prepared.request)

    receipt = load_and_consume_trusted_wrapper_receipt(prepared.request)

    assert receipt["receipt_id"] == "receipt-id"
    assert Path(str(receipt["consumption_claim"])).is_file()
    with pytest.raises(SchedulerControlError, match="trusted_wrapper_receipt_already_consumed"):
        load_and_consume_trusted_wrapper_receipt(prepared.request)


def test_trusted_wrapper_receipt_missing_runtime_binding_is_canonical(monkeypatch, tmp_path) -> None:
    _, prepared = _prepare(monkeypatch, tmp_path)
    _bind_wrapper_env(monkeypatch, prepared.request)
    _write_trusted_wrapper_receipt(
        monkeypatch,
        prepared.request,
        overrides={
            "bridge_url": "",
            "bridge_instance_id": "",
            "process_manifest_path": "",
            "owned_process_manifest_path": "",
        },
    )

    with pytest.raises(
        SchedulerControlError,
        match=r"^trusted_wrapper_receipt_runtime_binding_missing:bridge_url,bridge_instance_id,process_manifest_path$",
    ):
        load_and_consume_trusted_wrapper_receipt(prepared.request)


def test_trusted_wrapper_receipt_rejects_process_manifest_alias_drift(monkeypatch, tmp_path) -> None:
    _, prepared = _prepare(monkeypatch, tmp_path)
    _bind_wrapper_env(monkeypatch, prepared.request)
    _write_trusted_wrapper_receipt(
        monkeypatch,
        prepared.request,
        overrides={"owned_process_manifest_path": str(Path(str(prepared.request["scheduler_run_dir"])) / "other.json")},
    )

    with pytest.raises(SchedulerControlError, match="trusted_wrapper_process_manifest_path_invalid"):
        load_and_consume_trusted_wrapper_receipt(prepared.request)


def test_processless_outer_receipt_integrates_with_python_binding_consume_and_nonreuse(monkeypatch, tmp_path) -> None:
    _, prepared = _prepare(monkeypatch, tmp_path)
    _bind_wrapper_env(monkeypatch, prepared.request)
    receipt_path = Path(str(prepared.request["scheduler_run_dir"])) / "trusted-wrapper-v2-receipt.json"
    monkeypatch.setenv("SOCIAL_FLOW_TRUSTED_WRAPPER_RECEIPT_PATH", str(receipt_path))
    bridge_server = Path(__file__).resolve().parents[1] / "scripts/browser_use/chrome_extension_trusted_bridge_server.mjs"
    script = f"""
        import {{ issueTrustedWrapperReceiptSync, startTrustedAutomationOwnerSync }} from {json.dumps(str(bridge_server))};
        const request = {json.dumps(prepared.request)};
        globalThis.process = undefined;
        const bridgeInfo = {{
          bridge_instance_id: "bridge-instance",
          url: "http://127.0.0.1:43123",
        }};
        const ownerBinding = startTrustedAutomationOwnerSync({{ request, bridgeInfo, ownerId: "owner-id", timeoutSeconds: request.run_timeout_seconds }});
        issueTrustedWrapperReceiptSync({{
          request,
          resolvedRequestPath: request.request_path,
          trustedHostMetadata: {{
            session_id: "execution-session",
            thread_id: "execution-thread",
            turn_id: "execution-turn",
          }},
          bridgeInfo,
          ownerBinding,
          browserBinding: {{
            id: "profile-2",
            name: "Chrome",
            type: "extension",
            metadata: {{ profileOrdering: 2, profileName: "Nicky/Profile 2" }},
          }},
        }});
    """
    subprocess.run(["node", "--input-type=module", "-e", script], check=True)

    receipt = load_and_consume_trusted_wrapper_receipt(prepared.request)

    assert receipt["request_id"] == prepared.request["request_id"]
    assert receipt["bridge_instance_id"] == "bridge-instance"
    with pytest.raises(SchedulerControlError, match="trusted_wrapper_receipt_already_consumed"):
        load_and_consume_trusted_wrapper_receipt(prepared.request)


@pytest.mark.parametrize(
    "field,bad_value",
    [
        ("request_id", "other-request"),
        ("request_path", "/tmp/other-request.json"),
        ("automation_id", "other-automation"),
        ("control_run_id", "other-control"),
        ("run_nonce", "other-nonce"),
        ("mode", "execute"),
        ("stage", "execute"),
        ("scheduler_run_id", "other-run"),
        ("scheduler_run_dir", "/tmp/other-run"),
        ("execution_session_id", "other-session"),
        ("execution_thread_id", "other-thread"),
        ("execution_turn_id", "other-turn"),
        ("bridge_instance_id", "other-bridge"),
        ("bridge_url", "http://127.0.0.1:9"),
        ("receipt_path", "/tmp/other-receipt.json"),
    ],
)
def test_trusted_wrapper_receipt_rejects_each_binding_mismatch(
    monkeypatch, tmp_path, field: str, bad_value: str
) -> None:
    _, prepared = _prepare(monkeypatch, tmp_path)
    _bind_wrapper_env(monkeypatch, prepared.request)
    _write_trusted_wrapper_receipt(monkeypatch, prepared.request, overrides={field: bad_value})

    with pytest.raises(SchedulerControlError, match=rf"trusted_wrapper_receipt_binding_mismatch:{field}"):
        load_and_consume_trusted_wrapper_receipt(prepared.request)
    assert not (Path(str(prepared.request["scheduler_run_dir"])) / "trusted-wrapper-v2-receipt-consumed.json").exists()


def test_trusted_wrapper_receipt_rejects_old_symlink_and_outside_path(monkeypatch, tmp_path) -> None:
    _, prepared = _prepare(monkeypatch, tmp_path)
    _bind_wrapper_env(monkeypatch, prepared.request)
    receipt_path = _write_trusted_wrapper_receipt(
        monkeypatch,
        prepared.request,
        overrides={"issued_at": (datetime.now(timezone.utc) - timedelta(minutes=3)).isoformat()},
    )
    with pytest.raises(SchedulerControlError, match="trusted_wrapper_receipt_too_old"):
        load_and_consume_trusted_wrapper_receipt(prepared.request)

    receipt_path.unlink()
    target = tmp_path / "outside-receipt.json"
    target.write_text("{}", encoding="utf-8")
    receipt_path.symlink_to(target)
    with pytest.raises(SchedulerControlError, match="trusted_wrapper_receipt_symlink_rejected"):
        load_and_consume_trusted_wrapper_receipt(prepared.request)

    monkeypatch.setenv("SOCIAL_FLOW_TRUSTED_WRAPPER_RECEIPT_PATH", str(target))
    with pytest.raises(SchedulerControlError, match="trusted_wrapper_receipt_outside_scheduler_run_dir"):
        load_and_consume_trusted_wrapper_receipt(prepared.request)


def test_same_turn_preflight_and_execute_have_distinct_run_bound_receipts(monkeypatch, tmp_path) -> None:
    paths = _registered_fixture(tmp_path)
    monkeypatch.setenv("CODEX_THREAD_ID", "thread-123")
    monkeypatch.setenv("CODEX_SESSION_ID", "session-123")
    monkeypatch.setenv("CODEX_TURN_ID", "same-root-turn")
    prepared = [
        prepare_control_run(
            automation_id="sample",
            stage=stage,
            automations_root=paths["automations_root"],
            control_root=paths["control_root"],
            capability_registry=paths["capability_registry"],
            db_path=paths["db_path"],
        )
        for stage in ("preflight", "execute")
    ]

    assert prepared[0].request["origin_turn_id"] == prepared[1].request["origin_turn_id"] == "same-root-turn"
    assert prepared[0].request["request_id"] != prepared[1].request["request_id"]
    assert prepared[0].request["scheduler_run_dir"] != prepared[1].request["scheduler_run_dir"]
    assert prepared[0].request["mode"] == "preflight"
    assert prepared[1].request["mode"] == "execute"


def _prepare_running_transition_claims(prepared) -> None:
    request = prepared.request
    run_dir = prepared.run_dir
    scheduler_run_dir = Path(str(request["scheduler_run_dir"]))
    (run_dir / "terminal-blocker.json").write_text(
        json.dumps(
            {
                "schema": "automation_stage_observation.v1",
                "status": "blocked",
                "exact_blocker": f"trusted_browser_wrapper_required_for_current_run:request={prepared.request_path}",
            }
        ),
        encoding="utf-8",
    )
    (run_dir / "terminal-blocker.json").chmod(0o600)
    (run_dir / "trusted-dispatch-claim.json").write_text(
        json.dumps(
            {
                "schema": "scheduler_control_trusted_dispatch_claim.v1",
                "request_path": str(prepared.request_path),
            }
        ),
        encoding="utf-8",
    )
    (scheduler_run_dir / "trusted-wrapper-v2-receipt-consumed.json").write_text(
        json.dumps(
            {
                "schema": "scheduler_control_trusted_wrapper_receipt_consumption.v1",
                "request_id": request["request_id"],
                "control_run_id": request["control_run_id"],
            }
        ),
        encoding="utf-8",
    )
    if request["stage"] == "execute":
        claim_control_execution(request)


def test_control_running_transition_commits_claims_and_resolves_initial_blocker(monkeypatch, tmp_path) -> None:
    paths = _registered_fixture(tmp_path)
    monkeypatch.setenv("CODEX_THREAD_ID", "thread")
    monkeypatch.setenv("CODEX_TURN_ID", "turn")
    prepared = prepare_control_run(
        automation_id="sample",
        stage="execute",
        automations_root=paths["automations_root"],
        control_root=paths["control_root"],
        capability_registry=paths["capability_registry"],
        db_path=paths["db_path"],
    )
    _prepare_running_transition_claims(prepared)

    snapshot = transition_control_to_running(prepared.request)

    pointer = json.loads((prepared.run_dir / "control-state-current.json").read_text(encoding="utf-8"))
    resolved = json.loads((prepared.run_dir / "terminal-blocker.resolved.json").read_text(encoding="utf-8"))
    assert pointer["status"] == "running"
    assert pointer["snapshot_path"] == str(snapshot)
    assert resolved["resolved_by"] == "trusted_dispatch_started"
    assert not (prepared.run_dir / "terminal-blocker.json").exists()
    with pytest.raises(SchedulerControlError, match="scheduler_control_artifact_already_exists"):
        transition_control_to_running(prepared.request)


def test_control_running_transition_concurrency_has_one_commit_and_no_half_state(monkeypatch, tmp_path) -> None:
    paths = _registered_fixture(tmp_path)
    monkeypatch.setenv("CODEX_THREAD_ID", "thread")
    monkeypatch.setenv("CODEX_TURN_ID", "turn")
    prepared = prepare_control_run(
        automation_id="sample",
        stage="execute",
        automations_root=paths["automations_root"],
        control_root=paths["control_root"],
        capability_registry=paths["capability_registry"],
        db_path=paths["db_path"],
    )
    _prepare_running_transition_claims(prepared)

    def attempt():
        try:
            return ("ok", str(transition_control_to_running(prepared.request)))
        except Exception as exc:
            return ("error", str(exc))

    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(lambda _: attempt(), range(2)))

    assert [kind for kind, _ in outcomes].count("ok") == 1
    assert [kind for kind, _ in outcomes].count("error") == 1
    pointer = json.loads((prepared.run_dir / "control-state-current.json").read_text(encoding="utf-8"))
    snapshot = json.loads(Path(pointer["snapshot_path"]).read_text(encoding="utf-8"))
    assert pointer["status"] == snapshot["status"] == "running"
    assert pointer["sequence"] == snapshot["sequence"] == 2
    assert not (prepared.run_dir / "terminal-blocker.json").exists()
    assert (prepared.run_dir / "terminal-blocker.resolved.json").is_file()


def test_control_running_transition_failure_keeps_canonical_awaiting_state(monkeypatch, tmp_path) -> None:
    _, prepared = _prepare(monkeypatch, tmp_path)
    (prepared.run_dir / "terminal-blocker.json").write_text("{}", encoding="utf-8")
    (prepared.run_dir / "trusted-dispatch-claim.json").write_text(
        json.dumps(
            {
                "schema": "scheduler_control_trusted_dispatch_claim.v1",
                "request_path": str(prepared.request_path),
            }
        ),
        encoding="utf-8",
    )

    with pytest.raises(SchedulerControlError, match="scheduler_control_receipt_consumption_claim_missing_or_invalid"):
        transition_control_to_running(prepared.request)

    pointer = json.loads((prepared.run_dir / "control-state-current.json").read_text(encoding="utf-8"))
    assert pointer["status"] == "awaiting_trusted_dispatch"
    assert not (prepared.run_dir / "control-state-0002-running.json").exists()


def test_control_final_state_uses_next_versioned_snapshot(monkeypatch, tmp_path) -> None:
    _, prepared = _prepare(monkeypatch, tmp_path)

    snapshot = finalize_control_state(prepared.request, status="blocked", exact_blocker="transport_failed")

    pointer = json.loads((prepared.run_dir / "control-state-current.json").read_text(encoding="utf-8"))
    assert pointer["status"] == "blocked"
    assert pointer["sequence"] == 2
    assert pointer["snapshot_path"] == str(snapshot)


def test_prepare_control_run_rejects_toml_database_drift(monkeypatch, tmp_path) -> None:
    paths = _registered_fixture(tmp_path)
    monkeypatch.setenv("CODEX_THREAD_ID", "thread-123")
    connection = sqlite3.connect(paths["db_path"])
    try:
        connection.execute("update automations set prompt='stale prompt' where id='sample'")
        connection.commit()
    finally:
        connection.close()

    with pytest.raises(SchedulerControlError, match="registered_store_matches_automation_toml_failed"):
        prepare_control_run(
            automation_id="sample",
            stage="preflight",
            automations_root=paths["automations_root"],
            control_root=paths["control_root"],
            capability_registry=paths["capability_registry"],
            db_path=paths["db_path"],
        )


def test_control_request_rejects_browser_capability_tampering(monkeypatch, tmp_path) -> None:
    paths, prepared = _prepare(monkeypatch, tmp_path)
    request = json.loads(prepared.request_path.read_text(encoding="utf-8"))
    request["browser_required"] = False
    prepared.request_path.write_text(json.dumps(request), encoding="utf-8")

    with pytest.raises(SchedulerControlError, match="scheduler_control_request_registration_mismatch:browser_required"):
        validate_control_request_registration(
            request_path=prepared.request_path,
            automation_id="sample",
            stage="preflight",
            automations_root=paths["automations_root"],
            capability_registry=paths["capability_registry"],
            db_path=paths["db_path"],
        )


def test_control_request_rejects_self_consistent_path_outside_allowed_root(monkeypatch, tmp_path) -> None:
    paths, prepared = _prepare(monkeypatch, tmp_path)
    outside_dir = tmp_path / "outside" / str(prepared.request["control_run_id"])
    outside_dir.mkdir(parents=True, mode=0o700)
    outside_dir.chmod(0o700)
    outside_path = outside_dir / "request.json"
    request = dict(prepared.request)
    request["control_run_dir"] = str(outside_dir.resolve())
    request["request_path"] = str(outside_path.resolve())
    outside_path.write_text(json.dumps(request), encoding="utf-8")
    outside_path.chmod(0o600)

    with pytest.raises(SchedulerControlError, match="scheduler_control_request_outside_control_root"):
        load_control_request(outside_path, control_root=paths["control_root"])


def test_execute_request_is_one_shot_even_after_first_attempt(monkeypatch, tmp_path) -> None:
    paths = _registered_fixture(tmp_path)
    monkeypatch.setenv("CODEX_THREAD_ID", "thread-123")
    monkeypatch.setenv("CODEX_TURN_ID", "turn-123")
    prepared = prepare_control_run(
        automation_id="sample",
        stage="execute",
        automations_root=paths["automations_root"],
        control_root=paths["control_root"],
        capability_registry=paths["capability_registry"],
        db_path=paths["db_path"],
    )

    claim_path = claim_control_execution(prepared.request)
    assert claim_path.is_file()
    assert claim_path.stat().st_mode & 0o777 == 0o600
    with pytest.raises(SchedulerControlError, match="scheduler_control_execute_request_already_claimed"):
        claim_control_execution(prepared.request)


def test_success_cleanup_resolves_prior_terminal_blocker(monkeypatch, tmp_path) -> None:
    _, prepared = _prepare(monkeypatch, tmp_path)
    write_control_blocker(prepared.request, "initial_dispatch_required")

    write_control_cleanup(prepared.request, status="preflight_complete")

    assert not (prepared.run_dir / "terminal-blocker.json").exists()
    resolved = json.loads((prepared.run_dir / "terminal-blocker.resolved.json").read_text(encoding="utf-8"))
    assert resolved["status"] == "resolved"
    assert resolved["resolved_by"] == "preflight_complete"


def test_non_clean_cleanup_stays_blocked_and_does_not_resolve_terminal_blocker(monkeypatch, tmp_path) -> None:
    _, prepared = _prepare(monkeypatch, tmp_path)
    write_control_blocker(prepared.request, "dispatch_pending")

    cleanup_path = write_control_cleanup(
        prepared.request,
        status="completed",
        owned_processes_remaining=["workflow_child:pid=123:pgid=123"],
    )

    cleanup = json.loads(cleanup_path.read_text(encoding="utf-8"))
    assert cleanup["status"] == "blocked"
    assert cleanup["exact_blocker"] == "owned_processes_remaining_after_cleanup"
    assert cleanup["owned_processes_remaining"] == ["workflow_child:pid=123:pgid=123"]
    assert (prepared.run_dir / "terminal-blocker.json").is_file()
    assert not (prepared.run_dir / "terminal-blocker.resolved.json").exists()
