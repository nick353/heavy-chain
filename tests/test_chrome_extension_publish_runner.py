import csv
import json
import os
import socket
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer, ThreadingHTTPServer
from datetime import datetime, timedelta, timezone
from pathlib import Path


RUNNER_PATH = Path(__file__).resolve().parents[1] / "scripts/browser_use/chrome_extension_publish_runner.mjs"
ENGAGEMENT_RUNNER_PATH = Path(__file__).resolve().parents[1] / "scripts/browser_use/chrome_extension_engagement_runner.mjs"
BRIDGE_CLIENT_PATH = Path(__file__).resolve().parents[1] / "scripts/browser_use/chrome_extension_trusted_bridge_client.mjs"
BRIDGE_SERVER_PATH = Path(__file__).resolve().parents[1] / "scripts/browser_use/chrome_extension_trusted_bridge_server.mjs"
IAB_HELPERS_PATH = Path(__file__).resolve().parents[1] / "scripts/job_applications/iab_linkedin_easy_apply_helpers.mjs"


def _media_date_token() -> str:
    return datetime.now(timezone(timedelta(hours=9))).date().isoformat()


def _write_queue(path: Path, rows: list[dict[str, str]]) -> None:
    fieldnames = [
        "id",
        "status",
        "quality_score",
        "keep_priority",
        "review_status",
        "scheduled_at",
        "source_url",
        "media_plan",
        "media_receipt",
        "x_text",
        "x_post_id",
        "x_post_url",
        "x_published_at",
        "linkedin_text",
        "linkedin_post_id",
        "linkedin_post_url",
        "linkedin_published_at",
        "published_at",
        "error",
        "review_notes",
        "next_action",
    ]
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, delimiter="\t", lineterminator="\n")
        writer.writeheader()
        for row in rows:
            writer.writerow({name: row.get(name, "") for name in fieldnames})


def _run_publish_runner(queue_path: Path, lane_resolution: dict[str, object] | None = None) -> subprocess.CompletedProcess[str]:
    lane_json = json.dumps(lane_resolution)
    script = """
      const { pathToFileURL } = await import("node:url");
      const runnerUrl = pathToFileURL(process.argv[1]).href;
      const { sendApprovedPublishCandidatesChromeExtension } = await import(runnerUrl);
      try {
        const result = await sendApprovedPublishCandidatesChromeExtension({
          queuePath: process.argv[2],
          maxActions: 1,
          laneResolution: JSON.parse(process.argv[3]),
          pluginRoot: "/definitely/missing/chrome/plugin"
        });
        console.log(JSON.stringify({ ok: true, result }));
      } catch (error) {
        console.log(JSON.stringify({ ok: false, error: String(error?.message || error) }));
        process.exitCode = 2;
      }
    """
    return subprocess.run(
        ["node", "--input-type=module", "-e", script, str(RUNNER_PATH), str(queue_path), lane_json],
        check=False,
        text=True,
        capture_output=True,
    )


def _profile2_lane_resolution(busy: bool = False) -> dict[str, object]:
    return {
        "lane": "chrome_extension_profile2_fallback",
        "fallback_allowed": True,
        "lane_status": {"busy": busy, "stop_reason": ""},
    }


def _write_browser_client(plugin_root: Path, source: str) -> None:
    scripts_dir = plugin_root / "scripts"
    scripts_dir.mkdir(parents=True, exist_ok=True)
    (scripts_dir / "browser-client.mjs").write_text(source, encoding="utf-8")


def _run_node_module(script: str, *args: str, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["node", "--input-type=module", "-e", script, *args],
        check=False,
        text=True,
        capture_output=True,
        env=env,
    )


def test_trusted_bridge_client_forwards_publish_payload_to_local_bridge() -> None:
    seen: dict[str, object] = {}

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:  # noqa: N802
            body = self.rfile.read(int(self.headers.get("content-length", "0")))
            seen["path"] = self.path
            seen["token"] = self.headers.get("x-social-flow-bridge-token")
            seen["payload"] = json.loads(body.decode("utf-8"))
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"published":0,"skipped":0,"receipts":[]}\n')

        def log_message(self, format: str, *args: object) -> None:
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    payload = {"queuePath": "/tmp/queue.tsv", "maxActions": 1, "allowWithoutBusy": True}
    result = subprocess.run(
        ["node", str(BRIDGE_CLIENT_PATH), "publish"],
        input=json.dumps(payload),
        text=True,
        capture_output=True,
        check=False,
        env={
            **os.environ,
            "SOCIAL_FLOW_CHROME_EXTENSION_BRIDGE_URL": f"http://127.0.0.1:{server.server_port}",
            "SOCIAL_FLOW_CHROME_EXTENSION_BRIDGE_TOKEN": "test-token",
        },
    )
    server.shutdown()
    thread.join(timeout=5)
    server.server_close()

    assert result.returncode == 0
    assert json.loads(result.stdout)["published"] == 0
    assert seen["path"] == "/publish"
    assert seen["token"] == "test-token"
    seen_payload = seen["payload"]
    assert isinstance(seen_payload, dict)
    assert seen_payload["queuePath"] == payload["queuePath"]
    assert seen_payload["maxActions"] == payload["maxActions"]
    assert seen_payload["allowWithoutBusy"] is payload["allowWithoutBusy"]


def test_trusted_bridge_client_probe_hits_probe_endpoint() -> None:
    seen: dict[str, object] = {}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            seen["health_path"] = self.path
            if self.path != "/health":
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"ok":true,"backend":"chrome_extension_trusted_bridge"}\n')

        def do_POST(self) -> None:  # noqa: N802
            body = self.rfile.read(int(self.headers.get("content-length", "0")))
            seen["path"] = self.path
            seen["payload"] = json.loads(body.decode("utf-8") or "{}")
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.end_headers()
            self.wfile.write(
                b'{"ok":true,"ready":true,"stage":"job_manager_bridge_readiness_probe","bridge_run_id":"probe-run","bridge_receipt_path":"probe.json"}\n'
            )

        def log_message(self, format: str, *args: object) -> None:
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    result = subprocess.run(
        ["node", str(BRIDGE_CLIENT_PATH), "probe"],
        input=json.dumps({"runId": "probe-run", "artifactDir": "/tmp/probe-artifacts"}),
        text=True,
        capture_output=True,
        check=False,
        env={
            **os.environ,
            "SOCIAL_FLOW_CHROME_EXTENSION_BRIDGE_URL": f"http://127.0.0.1:{server.server_port}",
            "SOCIAL_FLOW_CHROME_EXTENSION_BRIDGE_TOKEN": "test-token",
        },
    )
    server.shutdown()
    thread.join(timeout=5)
    server.server_close()

    assert result.returncode == 0
    assert json.loads(result.stdout)["ready"] is True
    assert seen["health_path"] == "/health"
    assert seen["path"] == "/probe"
    assert seen["payload"]["runId"] == "probe-run"
    assert seen["payload"]["receiptDir"] == "/tmp/probe-artifacts"
    assert seen["payload"]["externalActionCount"] == 0


def test_trusted_bridge_client_probe_validates_completed_receipt_after_queued_response(tmp_path: Path) -> None:
    receipt_path = tmp_path / "probe-run.json"

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            if self.path == "/health":
                payload = {"ok": True, "backend": "chrome_extension_trusted_bridge"}
            elif self.path.startswith("/runs/probe-run"):
                payload = {
                    "ok": True,
                    "status": "succeeded",
                    "receipt_path": str(receipt_path),
                    "result": {
                        "ok": True,
                        "ready": True,
                        "stage": "job_manager_bridge_readiness_probe",
                        "bridge_run_id": "probe-run",
                        "bridge_receipt_path": str(receipt_path),
                    },
                }
            else:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.end_headers()
            self.wfile.write((json.dumps(payload) + "\n").encode("utf-8"))

        def do_POST(self) -> None:  # noqa: N802
            self.rfile.read(int(self.headers.get("content-length", "0")))
            payload = {
                "ok": True,
                "backend": "chrome_extension_trusted_bridge",
                "status": "queued",
                "bridge_run_id": "probe-run",
                "bridge_receipt_path": str(receipt_path),
                "receipt_dir": str(tmp_path),
            }
            self.send_response(202)
            self.send_header("content-type", "application/json")
            self.end_headers()
            self.wfile.write((json.dumps(payload) + "\n").encode("utf-8"))

        def log_message(self, format: str, *args: object) -> None:
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    result = subprocess.run(
        ["node", str(BRIDGE_CLIENT_PATH), "probe"],
        input=json.dumps({"runId": "probe-run", "artifactDir": str(tmp_path)}),
        text=True,
        capture_output=True,
        check=False,
        env={
            **os.environ,
            "SOCIAL_FLOW_CHROME_EXTENSION_BRIDGE_URL": f"http://127.0.0.1:{server.server_port}",
            "SOCIAL_FLOW_CHROME_EXTENSION_BRIDGE_POLL_INTERVAL_MS": "10",
        },
    )
    server.shutdown()
    thread.join(timeout=5)
    server.server_close()

    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["ok"] is True
    assert payload["ready"] is True
    assert payload["stage"] == "job_manager_bridge_readiness_probe"


def test_trusted_bridge_server_import_is_safe_without_process_global() -> None:
    server = BRIDGE_SERVER_PATH.read_text(encoding="utf-8")
    assert 'function runtimeEnv()' in server
    assert 'function runtimeCwd()' in server
    assert 'typeof process !== "undefined"' in server
    assert 'export async function runRegisteredAutomationWithTrustedBridge' in server


def test_trusted_bridge_client_probe_injects_codex_metadata_from_env() -> None:
    seen: dict[str, object] = {}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            seen["health_path"] = self.path
            if self.path != "/health":
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"ok":true,"backend":"chrome_extension_trusted_bridge"}\n')

        def do_POST(self) -> None:  # noqa: N802
            body = self.rfile.read(int(self.headers.get("content-length", "0")))
            seen["path"] = self.path
            seen["payload"] = json.loads(body.decode("utf-8") or "{}")
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.end_headers()
            self.wfile.write(
                b'{"ok":true,"ready":true,"stage":"job_manager_bridge_readiness_probe","bridge_run_id":"probe-run","bridge_receipt_path":"probe.json"}\n'
            )

        def log_message(self, format: str, *args: object) -> None:
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    result = subprocess.run(
        ["node", str(BRIDGE_CLIENT_PATH), "probe"],
        input=json.dumps({"runId": "probe-run", "artifactDir": "/tmp/probe-artifacts"}),
        text=True,
        capture_output=True,
        check=False,
        env={
            **os.environ,
            "SOCIAL_FLOW_CHROME_EXTENSION_BRIDGE_URL": f"http://127.0.0.1:{server.server_port}",
            "SOCIAL_FLOW_CHROME_EXTENSION_BRIDGE_TOKEN": "test-token",
            "CODEX_THREAD_ID": "thread-from-env",
            "CODEX_TURN_ID": "turn-from-env",
        },
    )
    server.shutdown()
    thread.join(timeout=5)
    server.server_close()

    assert result.returncode == 0
    assert json.loads(result.stdout)["ready"] is True
    assert seen["health_path"] == "/health"
    assert seen["path"] == "/probe"
    assert seen["payload"]["codexThreadId"] == "thread-from-env"
    assert seen["payload"]["codexTurnId"] == "turn-from-env"
    assert seen["payload"]["codexSessionId"] == "thread-from-env"


def test_trusted_bridge_client_probe_retries_once_by_default_before_succeeding(tmp_path: Path) -> None:
    seen: dict[str, object] = {}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            seen["health_path"] = self.path
            if self.path != "/health":
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"ok":true,"backend":"chrome_extension_trusted_bridge"}\n')

        def do_POST(self) -> None:  # noqa: N802
            body = self.rfile.read(int(self.headers.get("content-length", "0")))
            seen["path"] = self.path
            seen["payload"] = json.loads(body.decode("utf-8") or "{}")
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.end_headers()
            self.wfile.write(
                b'{"ok":true,"ready":true,"stage":"job_manager_bridge_readiness_probe","bridge_run_id":"probe-run","bridge_receipt_path":"probe.json"}\n'
            )

        def log_message(self, format: str, *args: object) -> None:
            return

    port_socket = socket.socket()
    port_socket.bind(("127.0.0.1", 0))
    port = port_socket.getsockname()[1]
    port_socket.close()

    def start_server_later() -> None:
        time.sleep(0.15)
        server = HTTPServer(("127.0.0.1", port), Handler)
        server.handle_request()
        server.handle_request()
        server.server_close()

    thread = threading.Thread(target=start_server_later, daemon=True)
    thread.start()

    result = subprocess.run(
        ["node", str(BRIDGE_CLIENT_PATH), "probe"],
        input=json.dumps({"runId": "probe-run", "artifactDir": str(tmp_path / "probe-artifacts")}),
        text=True,
        capture_output=True,
        check=False,
        env={
            **os.environ,
            "SOCIAL_FLOW_CHROME_EXTENSION_BRIDGE_URL": f"http://127.0.0.1:{port}",
            "SOCIAL_FLOW_CHROME_EXTENSION_BRIDGE_TIMEOUT_MS": "10000",
        },
    )

    thread.join(timeout=5)

    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout)["ready"] is True
    assert seen["health_path"] == "/health"
    assert seen["path"] == "/probe"
    assert seen["payload"]["runId"] == "probe-run"


def test_trusted_bridge_client_probe_retries_until_delayed_readiness_without_reopening_visible_profile2_window(tmp_path: Path) -> None:
    seen: dict[str, object] = {}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            seen["health_path"] = self.path
            if self.path != "/health":
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"ok":true,"backend":"chrome_extension_trusted_bridge"}\n')

        def do_POST(self) -> None:  # noqa: N802
            body = self.rfile.read(int(self.headers.get("content-length", "0")))
            seen["path"] = self.path
            seen["payload"] = json.loads(body.decode("utf-8") or "{}")
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.end_headers()
            self.wfile.write(
                b'{"ok":true,"ready":true,"stage":"job_manager_bridge_readiness_probe","bridge_run_id":"probe-run","bridge_receipt_path":"probe.json"}\n'
            )

        def log_message(self, format: str, *args: object) -> None:
            return

    port_socket = socket.socket()
    port_socket.bind(("127.0.0.1", 0))
    port = port_socket.getsockname()[1]
    port_socket.close()

    def start_server_after_warmup() -> None:
        time.sleep(0.6)
        server = HTTPServer(("127.0.0.1", port), Handler)
        server.handle_request()
        server.handle_request()
        server.server_close()

    thread = threading.Thread(target=start_server_after_warmup, daemon=True)
    thread.start()

    result = subprocess.run(
        ["node", str(BRIDGE_CLIENT_PATH), "probe"],
        input=json.dumps({"runId": "probe-run", "artifactDir": str(tmp_path / "probe-artifacts")}),
        text=True,
        capture_output=True,
        check=False,
        env={
            **os.environ,
            "SOCIAL_FLOW_CHROME_EXTENSION_BRIDGE_URL": f"http://127.0.0.1:{port}",
            "SOCIAL_FLOW_CHROME_EXTENSION_BRIDGE_TIMEOUT_MS": "2000",
        },
    )

    thread.join(timeout=5)

    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout)["ready"] is True
    assert seen["health_path"] == "/health"
    assert seen["path"] == "/probe"
    assert seen["payload"]["runId"] == "probe-run"
    assert "open-chrome-window.js" not in result.stderr


def test_trusted_bridge_client_probe_retries_after_abort_error_without_reopening_visible_profile2_window(tmp_path: Path) -> None:
    seen: dict[str, object] = {"count": 0, "paths": []}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            seen["health_path"] = self.path
            if self.path != "/health":
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"ok":true,"backend":"chrome_extension_trusted_bridge"}\n')

        def do_POST(self) -> None:  # noqa: N802
            seen["count"] = int(seen["count"]) + 1
            body = self.rfile.read(int(self.headers.get("content-length", "0")))
            seen["paths"].append(self.path)
            payload = json.loads(body.decode("utf-8") or "{}")
            if seen["count"] == 1:
                time.sleep(1.5)
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.end_headers()
            self.wfile.write(
                b'{"ok":true,"ready":true,"stage":"job_manager_bridge_readiness_probe","bridge_run_id":"probe-run","bridge_receipt_path":"probe.json"}\n'
            )
            seen["payload"] = payload

        def log_message(self, format: str, *args: object) -> None:
            return

    class Server(ThreadingHTTPServer):
        daemon_threads = True

    port_socket = socket.socket()
    port_socket.bind(("127.0.0.1", 0))
    port = port_socket.getsockname()[1]
    port_socket.close()

    server = Server(("127.0.0.1", port), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    result = subprocess.run(
        ["node", str(BRIDGE_CLIENT_PATH), "probe"],
        input=json.dumps({"runId": "probe-run", "artifactDir": str(tmp_path / "probe-artifacts")}),
        text=True,
        capture_output=True,
        check=False,
        env={
            **os.environ,
            "SOCIAL_FLOW_CHROME_EXTENSION_BRIDGE_URL": f"http://127.0.0.1:{port}",
            "SOCIAL_FLOW_CHROME_EXTENSION_BRIDGE_TIMEOUT_MS": "5000",
            "SOCIAL_FLOW_CHROME_EXTENSION_BRIDGE_FETCH_ATTEMPT_TIMEOUT_MS": "1000",
        },
    )

    server.shutdown()
    thread.join(timeout=5)
    server.server_close()

    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout)["ready"] is True
    assert int(seen["count"]) >= 2
    assert seen["health_path"] == "/health"
    assert seen["paths"][0] == "/probe"
    assert seen["payload"]["runId"] == "probe-run"
    assert "open-chrome-window.js" not in result.stderr


def test_trusted_bridge_client_job_fallback_writes_blocker_artifact(tmp_path: Path) -> None:
    artifact_dir = tmp_path / "artifacts"
    outcomes_path = tmp_path / "outcomes.jsonl"
    payload = {
        "runId": "job-fallback-test",
        "artifactDir": str(artifact_dir),
        "outcomesJsonl": str(outcomes_path),
        "company": "Example Co",
        "role": "SEO Specialist",
        "jobUrl": "https://www.linkedin.com/jobs/view/123/",
        "jobKey": "linkedin-123",
    }
    result = subprocess.run(
        ["node", str(BRIDGE_CLIENT_PATH), "job"],
        input=json.dumps(payload),
        text=True,
        capture_output=True,
        check=False,
        env={
            **os.environ,
            "SOCIAL_FLOW_CHROME_EXTENSION_BRIDGE_URL": "http://127.0.0.1:9",
            "SOCIAL_FLOW_CHROME_EXTENSION_BRIDGE_TIMEOUT_MS": "1000",
        },
    )

    assert result.returncode == 0, result.stderr
    response = json.loads(result.stdout)
    assert response["ok"] is False
    assert response["stop_reason"] == "trusted_runner_bridge_unavailable_before_job_artifact"
    assert "trusted_chrome_runtime_unavailable" in response["exact_blocker"]
    artifact_path = Path(response["artifact_uri"])
    assert artifact_path.exists()
    artifact = json.loads(artifact_path.read_text(encoding="utf-8"))
    assert artifact["workflow"] == "job-applications"
    assert artifact["target_hint"]["company"] == "Example Co"
    outcome = json.loads(outcomes_path.read_text(encoding="utf-8").strip())
    assert outcome["pipelineRow"]["state"] == "retryable"
    assert outcome["pipelineRow"]["blocker_reason"] == "chrome_node_tool_timeout_before_artifact"


def test_trusted_bridge_client_retries_transient_fetch_failure_before_succeeding(tmp_path: Path) -> None:
    seen: dict[str, object] = {}

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:  # noqa: N802
            body = self.rfile.read(int(self.headers.get("content-length", "0")))
            seen["path"] = self.path
            seen["payload"] = json.loads(body.decode("utf-8"))
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"ok":true,"published":0,"skipped":0,"receipts":[]}\n')

        def log_message(self, format: str, *args: object) -> None:
            return

    port_socket = socket.socket()
    port_socket.bind(("127.0.0.1", 0))
    port = port_socket.getsockname()[1]
    port_socket.close()

    def start_server_later() -> None:
        time.sleep(0.9)
        server = HTTPServer(("127.0.0.1", port), Handler)
        server.handle_request()
        server.server_close()

    thread = threading.Thread(target=start_server_later, daemon=True)
    thread.start()

    payload = {
        "runId": "job-retry-test",
        "artifactDir": str(tmp_path / "artifacts"),
        "company": "Example Co",
        "role": "SEO Specialist",
        "jobUrl": "https://example.com/job",
        "jobKey": "example-1",
    }
    result = subprocess.run(
        ["node", str(BRIDGE_CLIENT_PATH), "official-job"],
        input=json.dumps(payload),
        text=True,
        capture_output=True,
        check=False,
        env={
            **os.environ,
            "SOCIAL_FLOW_CHROME_EXTENSION_BRIDGE_URL": f"http://127.0.0.1:{port}",
            "SOCIAL_FLOW_CHROME_EXTENSION_BRIDGE_TIMEOUT_MS": "10000",
            "SOCIAL_FLOW_CHROME_EXTENSION_BRIDGE_CONNECT_ATTEMPTS": "6",
            "SOCIAL_FLOW_CHROME_EXTENSION_BRIDGE_CONNECT_RETRY_DELAY_MS": "100",
        },
    )

    thread.join(timeout=5)

    assert result.returncode == 0, result.stderr
    response = json.loads(result.stdout)
    assert response["ok"] is True
    assert response["published"] == 0
    assert seen["path"] == "/official-job"
    assert seen["payload"]["runId"] == payload["runId"]
    assert seen["payload"]["company"] == payload["company"]
    assert seen["payload"]["jobUrl"] == payload["jobUrl"]


def test_trusted_bridge_server_returns_running_receipt_without_waiting_for_runner(tmp_path: Path) -> None:
    receipt_dir = tmp_path / "receipts"
    server = HTTPServer(("127.0.0.1", 0), BaseHTTPRequestHandler)
    port = server.server_port
    server.server_close()
    script = """
      const { pathToFileURL } = await import("node:url");
      const serverUrl = pathToFileURL(process.argv[1]).href;
      const { startChromeExtensionTrustedBridge, stopChromeExtensionTrustedBridge } = await import(serverUrl);
      const port = Number.parseInt(process.argv[2], 10);
      const receiptDir = process.argv[3];
      const globals = {
        __socialFlowChromeExtensionBridgeRunners: {
          publish: async () => {
            await new Promise((resolve) => setTimeout(resolve, 250));
            return {backend: "chrome_extension_profile2_fallback", published: 0, skipped: 0, receipts: []};
          }
        }
      };
      const info = await startChromeExtensionTrustedBridge({ port, token: "test-token", globals });
      try {
        const started = Date.now();
        const response = await fetch(`${info.url}/publish`, {
          method: "POST",
          headers: {"content-type": "application/json", "x-social-flow-bridge-token": "test-token"},
          body: JSON.stringify({
            queuePath: "posting_queue.tsv",
            maxActions: 1,
            allowWithoutBusy: true,
            bridgeRunId: "running-test",
            receiptDir,
            candidateIds: ["candidate"]
          })
        });
        const result = await response.json();
        console.log(JSON.stringify({status: response.status, elapsed: Date.now() - started, result}));
      } finally {
        await stopChromeExtensionTrustedBridge({ globals });
      }
    """
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script, str(BRIDGE_SERVER_PATH), str(port), str(receipt_dir)],
        check=False,
        text=True,
        capture_output=True,
    )

    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["status"] == 202
    assert payload["elapsed"] < 2000
    assert payload["result"]["status"] == "queued"
    receipt = json.loads((receipt_dir / "running-test.json").read_text(encoding="utf-8"))
    assert receipt["status"] in {"queued", "running", "succeeded"}
    assert receipt["candidate_ids"] == ["candidate"]


def test_trusted_bridge_server_background_job_updates_receipt(tmp_path: Path) -> None:
    queue_path = tmp_path / "posting_queue.tsv"
    receipt_dir = tmp_path / "receipts"
    _write_queue(
        queue_path,
        [
            {
                "id": "candidate",
                "status": "approved",
                "quality_score": "10",
                "keep_priority": "ship_now",
                "source_url": "https://example.com/source",
                "media_plan": "X本文+URL型",
                "x_text": "copy https://example.com/source",
                "review_notes": "Local automation profile publish candidate",
            }
        ],
    )
    server = HTTPServer(("127.0.0.1", 0), BaseHTTPRequestHandler)
    port = server.server_port
    server.server_close()
    script = """
      const { pathToFileURL } = await import("node:url");
      const serverUrl = pathToFileURL(process.argv[1]).href;
      const { startChromeExtensionTrustedBridge, stopChromeExtensionTrustedBridge } = await import(serverUrl);
      const port = Number.parseInt(process.argv[2], 10);
      const queuePath = process.argv[3];
      const receiptDir = process.argv[4];
      const globals = {};
      const info = await startChromeExtensionTrustedBridge({ port, token: "test-token", globals });
      try {
        const response = await fetch(`${info.url}/publish`, {
          method: "POST",
          headers: {"content-type": "application/json", "x-social-flow-bridge-token": "test-token"},
          body: JSON.stringify({
            queuePath,
            maxActions: 1,
            dryRun: true,
            allowWithoutBusy: true,
            bridgeRunId: "receipt-test",
            receiptDir,
            candidateIds: ["candidate"]
          })
        });
        const accepted = await response.json();
        let receipt = null;
        for (let attempt = 0; attempt < 50; attempt += 1) {
          const poll = await fetch(`${info.url}/runs/receipt-test?receiptDir=${encodeURIComponent(receiptDir)}`, {
            headers: {"x-social-flow-bridge-token": "test-token"}
          });
          receipt = await poll.json();
          if (receipt.status === "succeeded" || receipt.status === "failed") break;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        console.log(JSON.stringify({status: response.status, accepted, receipt}));
      } finally {
        await stopChromeExtensionTrustedBridge({ globals });
      }
    """
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script, str(BRIDGE_SERVER_PATH), str(port), str(queue_path), str(receipt_dir)],
        check=False,
        text=True,
        capture_output=True,
    )

    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["status"] == 202
    assert payload["accepted"]["status"] == "queued"
    receipt = json.loads((receipt_dir / "receipt-test.json").read_text(encoding="utf-8"))
    assert receipt["status"] == "succeeded"
    assert receipt["candidate_ids"] == ["candidate"]
    assert receipt["result"]["dry_run"] is True
    assert receipt["result"]["receipts"][0]["id"] == "candidate"
    assert payload["receipt"]["status"] == "succeeded"


def test_chrome_extension_runtime_gate_reports_missing_agent(tmp_path: Path) -> None:
    plugin_root = tmp_path / "chrome-plugin"
    scripts_dir = plugin_root / "scripts"
    scripts_dir.mkdir(parents=True)
    (scripts_dir / "browser-client.mjs").write_text(
        'export async function setupBrowserRuntime() { return {ok: true}; }\n',
        encoding="utf-8",
    )
    script = """
      const { pathToFileURL } = await import("node:url");
      const runnerUrl = pathToFileURL(process.argv[1]).href;
      const { setupChromeExtensionProfile2Runtime } = await import(runnerUrl);
      try {
        await setupChromeExtensionProfile2Runtime({
          pluginRoot: process.argv[2],
          globals: {}
        });
      } catch (error) {
        console.log(String(error?.message || error));
        process.exitCode = 0;
      }
      if (process.exitCode !== 0) process.exitCode = 1;
    """
    result = subprocess.run(
        [
            "node",
            "--input-type=module",
            "-e",
            script,
            str(ENGAGEMENT_RUNNER_PATH),
            str(plugin_root),
        ],
        check=False,
        text=True,
        capture_output=True,
    )

    assert result.returncode == 0, result.stderr
    assert "trusted_chrome_runtime_unavailable" in result.stdout
    assert "chrome_extension_runtime_unavailable" in result.stdout
    assert "fresh_visible_codex_chrome_runtime_required" in result.stdout
    assert "hasAgent=false" in result.stdout
    assert "safe_fallback=official_trusted_ats" in result.stdout


def test_chrome_extension_runtime_shims_codex_turn_metadata_from_env(tmp_path: Path) -> None:
    plugin_root = tmp_path / "chrome-plugin"
    scripts_dir = plugin_root / "scripts"
    scripts_dir.mkdir(parents=True)
    (scripts_dir / "browser-client.mjs").write_text(
        """
        export async function setupBrowserRuntime({ globals }) {
          const meta = globals?.nodeRepl?.requestMeta?.["x-codex-turn-metadata"];
          if (!meta?.session_id || !meta?.turn_id) {
            throw new Error("Missing required Codex turn metadata: session_id, turn_id");
          }
          globals.agent = {
            browsers: {
              list: async () => [{ id: "ext1", type: "extension", name: "Chrome", metadata: { profileOrdering: 2, profileName: "Nicky" } }],
              get: async (id) => ({ selectedId: id })
            }
          };
          return { ok: true };
        }
        """,
        encoding="utf-8",
    )
    script = """
      const { pathToFileURL } = await import("node:url");
      const runnerUrl = pathToFileURL(process.argv[1]).href;
      const { setupChromeExtensionProfile2Runtime } = await import(runnerUrl);
      const globals = {};
      const result = await setupChromeExtensionProfile2Runtime({
        pluginRoot: process.argv[2],
        globals
      });
      console.log(JSON.stringify({
        id: result.browser.id,
        turn: globals.nodeRepl.requestMeta["x-codex-turn-metadata"],
        env: {
          session: globals.process.env.CODEX_SESSION_ID,
          thread: globals.process.env.CODEX_THREAD_ID,
          turn: globals.process.env.CODEX_TURN_ID
        }
      }));
    """
    env = os.environ.copy()
    env.pop("CODEX_TURN_ID", None)
    env["CODEX_THREAD_ID"] = "thread-from-env"
    result = subprocess.run(
        [
            "node",
            "--input-type=module",
            "-e",
            script,
            str(ENGAGEMENT_RUNNER_PATH),
            str(plugin_root),
        ],
        check=False,
        text=True,
        capture_output=True,
        env=env,
    )

    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["id"] == "ext1"
    assert payload["turn"]["session_id"] == "thread-from-env"
    assert payload["turn"]["turn_id"] == "thread-from-env"
    assert payload["env"]["session"] == "thread-from-env"
    assert payload["env"]["thread"] == "thread-from-env"
    assert payload["env"]["turn"] == "thread-from-env"


def test_runtime_replaces_incomplete_existing_header_with_explicit_codex_turn_metadata(tmp_path: Path) -> None:
    plugin_root = tmp_path / "chrome-plugin"
    _write_browser_client(
        plugin_root,
        """
        import assert from "node:assert/strict";

        export async function setupBrowserRuntime({ globals }) {
          assert.deepEqual(globals?.nodeRepl?.requestMeta?.["x-codex-turn-metadata"], {
            session_id: "fresh-session",
            thread_id: "fresh-session",
            turn_id: "fresh-turn"
          });
          globals.agent = {
            browsers: {
              list: async () => [
                { id: "ext2", type: "extension", name: "Chrome", metadata: { profileOrdering: 2, profileName: "Nicky" } }
              ],
              get: async (id) => ({ selectedId: id })
            }
          };
          return { ok: true };
        }
        """,
    )
    script = """
      const { pathToFileURL } = await import("node:url");
      const runnerUrl = pathToFileURL(process.argv[1]).href;
      const { setupChromeExtensionProfile2Runtime } = await import(runnerUrl);
      const globals = {
        nodeRepl: {
          requestMeta: {
            "x-codex-turn-metadata": {
              session_id: "stale-session"
            }
          }
        },
        agent: {
          browsers: {
            list: async () => [
              { id: "ext2", type: "extension", name: "Chrome", metadata: { profileOrdering: 2, profileName: "Nicky" } }
            ],
            get: async (id) => ({ selectedId: id })
          }
        }
      };
      const result = await setupChromeExtensionProfile2Runtime({
        pluginRoot: process.argv[2],
        globals,
        codexTurnMetadata: {
          session_id: "fresh-session",
          thread_id: "fresh-session",
          turn_id: "fresh-turn"
        }
      });
      console.log(JSON.stringify({
        id: result.browser.id,
        metadata: globals.nodeRepl.requestMeta["x-codex-turn-metadata"]
      }));
    """
    result = _run_node_module(script, str(ENGAGEMENT_RUNNER_PATH), str(plugin_root))

    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["id"] == "ext2"
    assert payload["metadata"] == {
        "session_id": "fresh-session",
        "thread_id": "fresh-session",
        "turn_id": "fresh-turn",
    }


def test_runtime_copies_root_metadata_into_distinct_globals_request_meta_before_setup(tmp_path: Path) -> None:
    plugin_root = tmp_path / "chrome-plugin"
    _write_browser_client(
        plugin_root,
        """
        import assert from "node:assert/strict";

        export async function setupBrowserRuntime({ globals }) {
          assert.deepEqual(globals?.nodeRepl?.requestMeta?.["x-codex-turn-metadata"], {
            session_id: "root-session",
            thread_id: "root-session",
            turn_id: "root-turn"
          });
          globals.agent = {
            browsers: {
              list: async () => [
                { id: "ext2", type: "extension", name: "Chrome", metadata: { profileOrdering: 2, profileName: "Nicky" } }
              ],
              get: async (id) => ({ selectedId: id })
            }
          };
          return { ok: true };
        }
        """,
    )
    script = """
      const { pathToFileURL } = await import("node:url");
      const runnerUrl = pathToFileURL(process.argv[1]).href;
      const { setupChromeExtensionProfile2Runtime } = await import(runnerUrl);
      globalThis.nodeRepl = {
        requestMeta: {
          "x-codex-turn-metadata": {
            session_id: "root-session",
            turn_id: "root-turn"
          }
        }
      };
      const globals = {
        nodeRepl: {
          requestMeta: {}
        },
        agent: {
          browsers: {
            list: async () => [
              { id: "ext2", type: "extension", name: "Chrome", metadata: { profileOrdering: 2, profileName: "Nicky" } }
            ],
            get: async (id) => ({ selectedId: id })
          }
        }
      };
      const result = await setupChromeExtensionProfile2Runtime({
        pluginRoot: process.argv[2],
        globals,
        codexTurnMetadata: {
          session_id: "root-session",
          thread_id: "root-session",
          turn_id: "root-turn"
        }
      });
      console.log(JSON.stringify({
        id: result.browser.id,
        metadata: globals.nodeRepl.requestMeta["x-codex-turn-metadata"] ?? null
      }));
    """
    result = _run_node_module(script, str(ENGAGEMENT_RUNNER_PATH), str(plugin_root))

    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["id"] == "ext2"
    assert payload["metadata"] == {
        "session_id": "root-session",
        "thread_id": "root-session",
        "turn_id": "root-turn",
    }


def test_runtime_ignores_read_only_root_metadata_sync_when_globals_sync_succeeds(tmp_path: Path) -> None:
    plugin_root = tmp_path / "chrome-plugin"
    _write_browser_client(
        plugin_root,
        """
        import assert from "node:assert/strict";

        export async function setupBrowserRuntime({ globals }) {
          assert.deepEqual(globals?.nodeRepl?.requestMeta?.["x-codex-turn-metadata"], {
            session_id: "fresh-session",
            thread_id: "fresh-session",
            turn_id: "fresh-turn"
          });
          globals.agent = {
            browsers: {
              list: async () => [
                { id: "ext3", type: "extension", name: "Chrome", metadata: { profileOrdering: 2, profileName: "Nicky" } }
              ],
              get: async (id) => ({ selectedId: id })
            }
          };
          return { ok: true };
        }
        """,
    )
    script = """
      const { pathToFileURL } = await import("node:url");
      const runnerUrl = pathToFileURL(process.argv[1]).href;
      const { setupChromeExtensionProfile2Runtime } = await import(runnerUrl);
      Object.defineProperty(globalThis, "nodeRepl", {
        value: {
          requestMeta: {
            "x-codex-turn-metadata": {
              session_id: "immutable-root-session",
              turn_id: "immutable-root-turn"
            }
          }
        },
        configurable: false,
        writable: false
      });
      const globals = {};
      const result = await setupChromeExtensionProfile2Runtime({
        pluginRoot: process.argv[2],
        globals,
        codexTurnMetadata: {
          session_id: "fresh-session",
          thread_id: "fresh-session",
          turn_id: "fresh-turn"
        }
      });
      console.log(JSON.stringify({
        id: result.browser.id,
        metadata: globals.nodeRepl.requestMeta["x-codex-turn-metadata"]
      }));
    """
    result = _run_node_module(script, str(ENGAGEMENT_RUNNER_PATH), str(plugin_root))

    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["id"] == "ext3"
    assert payload["metadata"] == {
        "session_id": "fresh-session",
        "thread_id": "fresh-session",
        "turn_id": "fresh-turn",
    }


def test_chrome_extension_runtime_shims_bare_process_for_browser_client(tmp_path: Path) -> None:
    plugin_root = tmp_path / "chrome-plugin"
    scripts_dir = plugin_root / "scripts"
    scripts_dir.mkdir(parents=True)
    (scripts_dir / "browser-client.mjs").write_text(
        """
        if (typeof process === "undefined") {
          throw new Error("process is not defined");
        }
        export async function setupBrowserRuntime({ globals }) {
          globals.agent = {
            browsers: {
              list: async () => [{ id: "ext1", type: "extension", name: "Chrome", metadata: { profileOrdering: 2, profileName: "Nicky" } }],
              get: async (id) => ({ selectedId: id })
            }
          };
          return { ok: true, processEnvKeys: Object.keys(process.env || {}) };
        }
        """,
        encoding="utf-8",
    )
    script = """
      const { pathToFileURL } = await import("node:url");
      const runnerUrl = pathToFileURL(process.argv[1]).href;
      const { setupChromeExtensionProfile2Runtime } = await import(runnerUrl);
      const globals = {};
      const result = await setupChromeExtensionProfile2Runtime({
        pluginRoot: process.argv[2],
        globals
      });
      console.log(JSON.stringify({
        id: result.browser.id,
        hasProcess: typeof globals.process !== "undefined"
      }));
    """
    result = subprocess.run(
        [
            "node",
            "--input-type=module",
            "-e",
            script,
            str(ENGAGEMENT_RUNNER_PATH),
            str(plugin_root),
        ],
        check=False,
        text=True,
        capture_output=True,
    )

    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["id"] == "ext1"
    assert payload["hasProcess"] is True


def test_chrome_extension_runtime_restores_env_after_browser_client_shim_overwrite(tmp_path: Path) -> None:
    plugin_root = tmp_path / "chrome-plugin"
    scripts_dir = plugin_root / "scripts"
    scripts_dir.mkdir(parents=True)
    (scripts_dir / "browser-client.mjs").write_text(
        """
        globalThis.process = {
          env: {},
          cwd: () => "/",
          versions: { node: "20.0.0" },
        };
        export async function setupBrowserRuntime({ globals }) {
          globals.agent = {
            browsers: {
              list: async () => [{ id: "ext1", type: "extension", name: "Chrome", metadata: { profileOrdering: 2, profileName: "Nicky" } }],
              get: async (id) => ({ selectedId: id })
            }
          };
          return { ok: true, processEnvKeys: Object.keys(process.env || {}) };
        }
        """,
        encoding="utf-8",
    )
    script = """
      const { pathToFileURL } = await import("node:url");
      const runnerUrl = pathToFileURL(process.argv[1]).href;
      const { setupChromeExtensionProfile2Runtime } = await import(runnerUrl);
      const globals = {};
      const result = await setupChromeExtensionProfile2Runtime({
        pluginRoot: process.argv[2],
        globals
      });
      console.log(JSON.stringify({
        id: result.browser.id,
        hasThreadId: result.handle?.selectedId === "ext1",
        thread: globals.process.env.CODEX_THREAD_ID || "",
        envKeys: result.handle?.selectedId ? Object.keys(globals.process.env || {}) : []
      }));
    """
    env = os.environ.copy()
    env["CODEX_THREAD_ID"] = "thread-from-env"
    env.pop("CODEX_TURN_ID", None)
    result = subprocess.run(
        [
            "node",
            "--input-type=module",
            "-e",
            script,
            str(ENGAGEMENT_RUNNER_PATH),
            str(plugin_root),
        ],
        check=False,
        text=True,
        capture_output=True,
        env=env,
    )

    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["id"] == "ext1"
    assert payload["thread"] == "thread-from-env"


def test_chrome_extension_runtime_selects_profile2_with_normalized_metadata(tmp_path: Path) -> None:
    plugin_root = tmp_path / "chrome-plugin"
    scripts_dir = plugin_root / "scripts"
    scripts_dir.mkdir(parents=True)
    (scripts_dir / "browser-client.mjs").write_text(
        'export async function setupBrowserRuntime() { return {ok: true}; }\n',
        encoding="utf-8",
    )
    script = """
      const { pathToFileURL } = await import("node:url");
      const runnerUrl = pathToFileURL(process.argv[1]).href;
      const { setupChromeExtensionProfile2Runtime } = await import(runnerUrl);
      const globals = {
        agent: {
          browsers: {
            list: async () => [
              {id: "iab", type: "iab", name: "Codex In-app Browser", metadata: {}},
              {id: "ext1", type: "extension", name: "Chrome", metadata: {profileOrdering: 1, profileName: "Other", profileIsLastUsed: false}},
              {id: "ext2", type: "extension", name: "Chrome", metadata: {profileOrdering: 2, profileName: "Nicky", profileIsLastUsed: true}}
            ],
            get: async (id) => ({selectedId: id})
          }
        },
        browser: {}
      };
      const result = await setupChromeExtensionProfile2Runtime({
        pluginRoot: process.argv[2],
        globals
      });
      console.log(JSON.stringify({id: result.browser.id, handle: result.handle}));
    """
    result = subprocess.run(
        [
            "node",
            "--input-type=module",
            "-e",
            script,
            str(ENGAGEMENT_RUNNER_PATH),
            str(plugin_root),
        ],
        check=False,
        text=True,
        capture_output=True,
    )

    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["id"] == "ext2"
    assert payload["handle"]["selectedId"] == "ext2"


def test_chrome_extension_runtime_reuses_initialized_browser_client(tmp_path: Path) -> None:
    plugin_root = tmp_path / "chrome-plugin"
    scripts_dir = plugin_root / "scripts"
    scripts_dir.mkdir(parents=True)
    (scripts_dir / "browser-client.mjs").write_text(
        'export async function setupBrowserRuntime() { throw new Error("browser runtime must not be reinitialized"); }\n',
        encoding="utf-8",
    )
    script = """
      const { pathToFileURL } = await import("node:url");
      const runnerUrl = pathToFileURL(process.argv[1]).href;
      const { setupChromeExtensionProfile2Runtime } = await import(runnerUrl);
      const globals = {
        agent: {
          browsers: {
            list: async () => [
              {id: "ext2", type: "extension", name: "Chrome", metadata: {profileOrdering: 2, profileName: "Nicky"}}
            ],
            get: async (id) => ({selectedId: id})
          }
        },
        process: {env: {CODEX_THREAD_ID: "stale-thread"}}
      };
      Object.defineProperty(globals, "nodeRepl", {
        value: {requestMeta: {}},
        configurable: false,
        writable: false
      });
      const result = await setupChromeExtensionProfile2Runtime({
        pluginRoot: process.argv[2],
        globals,
        codexTurnMetadata: {
          session_id: "fresh-thread",
          thread_id: "fresh-thread",
          turn_id: "fresh-turn"
        }
      });
      console.log(JSON.stringify({
        id: result.browser.id,
        selectedId: result.handle.selectedId,
        thread: globals.process.env.CODEX_THREAD_ID,
        turn: globals.process.env.CODEX_TURN_ID,
        shadowTurn: globals.__codexTurnMetadata.turn_id,
        nodeReplStillHostOwned: globals.nodeRepl.requestMeta["x-codex-turn-metadata"] == null
      }));
    """
    result = subprocess.run(
        [
            "node",
            "--input-type=module",
            "-e",
            script,
            str(ENGAGEMENT_RUNNER_PATH),
            str(plugin_root),
        ],
        check=False,
        text=True,
        capture_output=True,
        env={**os.environ, "CODEX_THREAD_ID": "existing-runtime-thread"},
    )

    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload == {
        "id": "ext2",
        "selectedId": "ext2",
        "thread": "fresh-thread",
        "turn": "fresh-turn",
        "shadowTurn": "fresh-turn",
        "nodeReplStillHostOwned": False,
    }


def test_chrome_extension_runtime_reuses_preselected_browser_without_rediscovery(tmp_path: Path) -> None:
    plugin_root = tmp_path / "chrome-plugin"
    scripts_dir = plugin_root / "scripts"
    scripts_dir.mkdir(parents=True)
    (scripts_dir / "browser-client.mjs").write_text(
        'export async function setupBrowserRuntime() { return {ok: true}; }\n',
        encoding="utf-8",
    )
    script = """
      const { pathToFileURL } = await import("node:url");
      const runnerUrl = pathToFileURL(process.argv[1]).href;
      const { setupChromeExtensionProfile2Runtime } = await import(runnerUrl);
      const globals = {
        agent: {
          browsers: {
            list: async () => { throw new Error("list should not be called"); },
            get: async () => { throw new Error("get should not be called"); }
          }
        },
        browser: { browserId: "preselected-extension", tabs: {}, user: {} },
        __socialFlowChromeExtensionProfile2Verified: true
      };
      const result = await setupChromeExtensionProfile2Runtime({
        pluginRoot: process.argv[2],
        globals
      });
      console.log(JSON.stringify({
        id: result.browser.id,
        source: result.browser.metadata.source,
        sameHandle: result.handle === globals.browser
      }));
    """
    result = subprocess.run(
        [
            "node",
            "--input-type=module",
            "-e",
            script,
            str(ENGAGEMENT_RUNNER_PATH),
            str(plugin_root),
        ],
        check=False,
        text=True,
        capture_output=True,
    )

    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["id"] == "preselected-extension"
    assert payload["source"] == "preselected_globals_browser"
    assert payload["sameHandle"] is True


def test_chrome_extension_runtime_reuses_verified_browser_without_agent_runtime(tmp_path: Path) -> None:
    plugin_root = tmp_path / "chrome-plugin"
    scripts_dir = plugin_root / "scripts"
    scripts_dir.mkdir(parents=True)
    (scripts_dir / "browser-client.mjs").write_text(
        'export async function setupBrowserRuntime() { throw new Error("verified browser must not be reinitialized"); }\n',
        encoding="utf-8",
    )
    script = """
      const { pathToFileURL } = await import("node:url");
      const runnerUrl = pathToFileURL(process.argv[1]).href;
      const { setupChromeExtensionProfile2Runtime } = await import(runnerUrl);
      const globals = {
        browser: { browserId: "verified-extension", tabs: {}, user: {} },
        __socialFlowChromeExtensionProfile2Verified: true,
        process: {env: {CODEX_THREAD_ID: "stale-thread"}}
      };
      const result = await setupChromeExtensionProfile2Runtime({
        pluginRoot: process.argv[2],
        globals,
        codexTurnMetadata: {
          session_id: "fresh-thread",
          thread_id: "fresh-thread",
          turn_id: "fresh-turn"
        }
      });
      console.log(JSON.stringify({
        id: result.browser.id,
        sameHandle: result.handle === globals.browser,
        thread: globals.process.env.CODEX_THREAD_ID,
        turn: globals.process.env.CODEX_TURN_ID
      }));
    """
    result = subprocess.run(
        [
            "node",
            "--input-type=module",
            "-e",
            script,
            str(ENGAGEMENT_RUNNER_PATH),
            str(plugin_root),
        ],
        check=False,
        text=True,
        capture_output=True,
    )

    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) == {
        "id": "verified-extension",
        "sameHandle": True,
        "thread": "fresh-thread",
        "turn": "fresh-turn",
    }


def test_chrome_extension_runtime_with_browser_id_without_verification_still_discovers_profile2(tmp_path: Path) -> None:
    plugin_root = tmp_path / "chrome-plugin"
    scripts_dir = plugin_root / "scripts"
    scripts_dir.mkdir(parents=True)
    (scripts_dir / "browser-client.mjs").write_text(
        'export async function setupBrowserRuntime() { return {ok: true}; }\n',
        encoding="utf-8",
    )
    script = """
      const { pathToFileURL } = await import("node:url");
      const runnerUrl = pathToFileURL(process.argv[1]).href;
      const { setupChromeExtensionProfile2Runtime } = await import(runnerUrl);
      let listCalls = 0;
      const globals = {
        agent: {
          browsers: {
            list: async () => {
              listCalls += 1;
              return [
                {id: "ext2", type: "extension", name: "Chrome", metadata: {profileOrdering: 2, profileName: "Nicky", profileIsLastUsed: true}}
              ];
            },
            get: async (id) => ({selectedId: id})
          }
        },
        browser: { browserId: "preselected-extension", tabs: {}, user: {} }
      };
      const result = await setupChromeExtensionProfile2Runtime({
        pluginRoot: process.argv[2],
        globals
      });
      console.log(JSON.stringify({id: result.browser.id, sameHandle: result.handle.selectedId === "ext2", listCalls}));
    """
    result = subprocess.run(
        [
            "node",
            "--input-type=module",
            "-e",
            script,
            str(ENGAGEMENT_RUNNER_PATH),
            str(plugin_root),
        ],
        check=False,
        text=True,
        capture_output=True,
    )

    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["id"] == "ext2"
    assert payload["sameHandle"] is True
    assert payload["listCalls"] == 1


def test_chrome_extension_runtime_fails_closed_after_extension_unavailable(tmp_path: Path) -> None:
    plugin_root = tmp_path / "chrome-plugin"
    scripts_dir = plugin_root / "scripts"
    scripts_dir.mkdir(parents=True)
    (scripts_dir / "browser-client.mjs").write_text(
        'export async function setupBrowserRuntime() { return {ok: true}; }\n',
        encoding="utf-8",
    )
    script = """
      const { pathToFileURL } = await import("node:url");
      const runnerUrl = pathToFileURL(process.argv[1]).href;
      const { setupChromeExtensionProfile2Runtime } = await import(runnerUrl);
      let getCalls = 0;
      let reopenCalls = 0;
      const globals = {
        agent: {
          browsers: {
            list: async () => [
              {id: "ext2", type: "extension", name: "Chrome", metadata: {profileOrdering: 2, profileName: "Nicky", profileIsLastUsed: true}}
            ],
            get: async (id) => {
              getCalls += 1;
              if (getCalls === 1) throw new Error("Browser is not available: extension");
              return {selectedId: id};
            }
          }
        },
        browser: {}
      };
      try {
        await setupChromeExtensionProfile2Runtime({
          pluginRoot: process.argv[2],
          globals,
          reopenProfile2Window: async () => { reopenCalls += 1; }
        });
        console.log(JSON.stringify({error: "", getCalls, reopenCalls}));
      } catch (error) {
        console.log(JSON.stringify({error: String(error.message || error), getCalls, reopenCalls}));
      }
    """
    result = subprocess.run(
        [
            "node",
            "--input-type=module",
            "-e",
            script,
            str(ENGAGEMENT_RUNNER_PATH),
            str(plugin_root),
        ],
        check=False,
        text=True,
        capture_output=True,
    )

    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["getCalls"] == 1
    assert payload["reopenCalls"] == 0
    assert "Browser is not available: extension" in payload["error"]


def test_chrome_extension_runtime_does_not_run_open_chrome_window_script_without_explicit_recovery(tmp_path: Path) -> None:
    plugin_root = tmp_path / "chrome-plugin"
    scripts_dir = plugin_root / "scripts"
    scripts_dir.mkdir(parents=True)
    marker_path = tmp_path / "profile2-reopen-marker.json"
    (scripts_dir / "browser-client.mjs").write_text(
        'export async function setupBrowserRuntime() { return {ok: true}; }\n',
        encoding="utf-8",
    )
    (scripts_dir / "open-chrome-window.js").write_text(
        "const fs = require('node:fs');\n"
        f"fs.writeFileSync({json.dumps(str(marker_path))}, JSON.stringify({{'opened': true}}));\n",
        encoding="utf-8",
    )
    script = """
      const { pathToFileURL } = await import("node:url");
      const fs = await import("node:fs");
      const runnerUrl = pathToFileURL(process.argv[1]).href;
      const { setupChromeExtensionProfile2Runtime } = await import(runnerUrl);
      let getCalls = 0;
      const started = Date.now();
      const globals = {
        agent: {
          browsers: {
            list: async () => [
              {id: "ext2", type: "extension", name: "Chrome", metadata: {profileOrdering: 2, profileName: "Nicky", profileIsLastUsed: true}}
            ],
            get: async (id) => {
              getCalls += 1;
              if (getCalls === 1) throw new Error("Browser is not available: extension");
              return {selectedId: id};
            }
          }
        },
        browser: {}
      };
      try {
        await setupChromeExtensionProfile2Runtime({
          pluginRoot: process.argv[2],
          globals
        });
        console.log(JSON.stringify({
          error: "",
          getCalls,
          elapsedMs: Date.now() - started,
          markerExists: fs.existsSync(process.argv[3])
        }));
      } catch (error) {
        console.log(JSON.stringify({
          error: String(error.message || error),
          getCalls,
          elapsedMs: Date.now() - started,
          markerExists: fs.existsSync(process.argv[3])
        }));
      }
    """
    result = subprocess.run(
        [
            "node",
            "--input-type=module",
            "-e",
            script,
            str(ENGAGEMENT_RUNNER_PATH),
            str(plugin_root),
            str(marker_path),
        ],
        check=False,
        text=True,
        capture_output=True,
    )

    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["getCalls"] == 1
    assert payload["markerExists"] is False
    assert payload["elapsedMs"] < 1900
    assert "Browser is not available: extension" in payload["error"]


def test_chrome_extension_runtime_recovers_with_default_profile2_helper_when_missing(tmp_path: Path) -> None:
    plugin_root = tmp_path / "chrome-plugin"
    scripts_dir = plugin_root / "scripts"
    scripts_dir.mkdir(parents=True)
    marker_path = tmp_path / "profile2-reopen-marker.json"
    (scripts_dir / "browser-client.mjs").write_text(
        'export async function setupBrowserRuntime() { return {ok: true}; }\n',
        encoding="utf-8",
    )
    (scripts_dir / "open-chrome-window.js").write_text(
        "const fs = require('node:fs');\n"
        f"fs.writeFileSync({json.dumps(str(marker_path))}, JSON.stringify({{'opened': true}}));\n",
        encoding="utf-8",
    )
    script = """
      const { pathToFileURL } = await import("node:url");
      const fs = await import("node:fs");
      const runnerUrl = pathToFileURL(process.argv[1]).href;
      const { setupChromeExtensionProfile2Runtime } = await import(runnerUrl);
      let listCalls = 0;
      const globals = {
        agent: {
          browsers: {
            list: async () => {
              listCalls += 1;
              if (!fs.existsSync(process.argv[3])) return [];
              return [
                {id: "ext2", type: "extension", name: "Chrome", metadata: {profileOrdering: 2, profileName: "Nicky", profileIsLastUsed: true}}
              ];
            },
            get: async (id) => ({selectedId: id})
          }
        },
        browser: {}
      };
      const result = await setupChromeExtensionProfile2Runtime({
        pluginRoot: process.argv[2],
        globals,
        recoverProfile2Window: true
      });
      console.log(JSON.stringify({
        id: result.browser.id,
        markerExists: fs.existsSync(process.argv[3]),
        listCalls
      }));
    """
    result = subprocess.run(
        [
            "node",
            "--input-type=module",
            "-e",
            script,
            str(ENGAGEMENT_RUNNER_PATH),
            str(plugin_root),
            str(marker_path),
        ],
        check=False,
        text=True,
        capture_output=True,
    )

    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["id"] == "ext2"
    assert payload["markerExists"] is True
    assert payload["listCalls"] >= 2


def test_chrome_extension_runtime_selects_nicky_profile_name_without_ordering(tmp_path: Path) -> None:
    plugin_root = tmp_path / "chrome-plugin"
    scripts_dir = plugin_root / "scripts"
    scripts_dir.mkdir(parents=True)
    (scripts_dir / "browser-client.mjs").write_text(
        'export async function setupBrowserRuntime() { return {ok: true}; }\n',
        encoding="utf-8",
    )
    script = """
      const { pathToFileURL } = await import("node:url");
      const runnerUrl = pathToFileURL(process.argv[1]).href;
      const { setupChromeExtensionProfile2Runtime } = await import(runnerUrl);
      const globals = {
        agent: {
          browsers: {
            list: async () => [
              {id: "ext1", type: "extension", name: "Chrome", metadata: {profileName: "Other"}},
              {id: "ext2", type: "extension", name: "Chrome", metadata: {profileName: "Nicky"}}
            ],
            get: async (id) => ({selectedId: id})
          }
        },
        browser: {}
      };
      const result = await setupChromeExtensionProfile2Runtime({
        pluginRoot: process.argv[2],
        globals
      });
      console.log(JSON.stringify({id: result.browser.id, handle: result.handle}));
    """
    result = subprocess.run(
        [
            "node",
            "--input-type=module",
            "-e",
            script,
            str(ENGAGEMENT_RUNNER_PATH),
            str(plugin_root),
        ],
        check=False,
        text=True,
        capture_output=True,
    )

    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["id"] == "ext2"
    assert payload["handle"]["selectedId"] == "ext2"


def test_chrome_extension_runtime_selects_nicky_profile2_name_without_ordering(tmp_path: Path) -> None:
    plugin_root = tmp_path / "chrome-plugin"
    scripts_dir = plugin_root / "scripts"
    scripts_dir.mkdir(parents=True)
    (scripts_dir / "browser-client.mjs").write_text(
        'export async function setupBrowserRuntime() { return {ok: true}; }\n',
        encoding="utf-8",
    )
    script = """
      const { pathToFileURL } = await import("node:url");
      const runnerUrl = pathToFileURL(process.argv[1]).href;
      const { setupChromeExtensionProfile2Runtime } = await import(runnerUrl);
      const globals = {
        agent: {
          browsers: {
            list: async () => [
              {id: "ext1", type: "extension", name: "Chrome", metadata: {profileName: "Other"}},
              {id: "ext2", type: "extension", name: "Chrome", metadata: {profileName: "Nicky/Profile 2"}}
            ],
            get: async (id) => ({selectedId: id})
          }
        },
        browser: {}
      };
      const result = await setupChromeExtensionProfile2Runtime({
        pluginRoot: process.argv[2],
        globals
      });
      console.log(JSON.stringify({id: result.browser.id, handle: result.handle}));
    """
    result = subprocess.run(
        [
            "node",
            "--input-type=module",
            "-e",
            script,
            str(ENGAGEMENT_RUNNER_PATH),
            str(plugin_root),
        ],
        check=False,
        text=True,
        capture_output=True,
    )

    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["id"] == "ext2"
    assert payload["handle"]["selectedId"] == "ext2"


def test_chrome_extension_runtime_rejects_last_used_without_profile2_identity(tmp_path: Path) -> None:
    plugin_root = tmp_path / "chrome-plugin"
    scripts_dir = plugin_root / "scripts"
    scripts_dir.mkdir(parents=True)
    (scripts_dir / "browser-client.mjs").write_text(
        'export async function setupBrowserRuntime() { return {ok: true}; }\n',
        encoding="utf-8",
    )
    script = """
      const { pathToFileURL } = await import("node:url");
      const runnerUrl = pathToFileURL(process.argv[1]).href;
      const { setupChromeExtensionProfile2Runtime } = await import(runnerUrl);
      const globals = {
        agent: {
          browsers: {
            list: async () => [
              {id: "ext1", type: "extension", name: "Chrome", metadata: {profileName: "Other", profileIsLastUsed: false}},
              {id: "ext2", type: "extension", name: "Chrome", metadata: {profileName: "Unknown", profileIsLastUsed: true}}
            ],
            get: async (id) => ({selectedId: id})
          }
        },
        browser: {}
      };
      try {
        await setupChromeExtensionProfile2Runtime({
          pluginRoot: process.argv[2],
          globals
        });
      } catch (error) {
        console.log(String(error?.message || error));
        process.exitCode = 0;
      }
      if (process.exitCode !== 0) process.exitCode = 1;
    """
    result = subprocess.run(
        [
            "node",
            "--input-type=module",
            "-e",
            script,
            str(ENGAGEMENT_RUNNER_PATH),
            str(plugin_root),
        ],
        check=False,
        text=True,
        capture_output=True,
    )

    assert result.returncode == 0, result.stderr
    assert "chrome_extension_profile2_unavailable" in result.stdout
    assert "observed_browsers=" in result.stdout


def test_chrome_extension_runtime_does_not_select_unidentified_extension(tmp_path: Path) -> None:
    plugin_root = tmp_path / "chrome-plugin"
    scripts_dir = plugin_root / "scripts"
    scripts_dir.mkdir(parents=True)
    (scripts_dir / "browser-client.mjs").write_text(
        'export async function setupBrowserRuntime() { return {ok: true}; }\n',
        encoding="utf-8",
    )
    script = """
      const { pathToFileURL } = await import("node:url");
      const runnerUrl = pathToFileURL(process.argv[1]).href;
      const { setupChromeExtensionProfile2Runtime } = await import(runnerUrl);
      const globals = {
        agent: {
          browsers: {
            list: async () => [
              {id: "ext1", type: "extension", name: "Chrome", metadata: {profileName: "Other"}}
            ],
            get: async (id) => ({selectedId: id})
          }
        },
        browser: {}
      };
      try {
        await setupChromeExtensionProfile2Runtime({
          pluginRoot: process.argv[2],
          globals
        });
      } catch (error) {
        console.log(String(error?.message || error));
        process.exitCode = 0;
      }
      if (process.exitCode !== 0) process.exitCode = 1;
    """
    result = subprocess.run(
        [
            "node",
            "--input-type=module",
            "-e",
            script,
            str(ENGAGEMENT_RUNNER_PATH),
            str(plugin_root),
        ],
        check=False,
        text=True,
        capture_output=True,
    )

    assert result.returncode == 0, result.stderr
    assert "chrome_extension_profile2_unavailable" in result.stdout
    assert "observed_browsers=" in result.stdout


def test_trusted_runtime_boundary_is_not_reported_as_profile2_unavailable(tmp_path: Path) -> None:
    queue = tmp_path / "queue.tsv"
    queue.write_text(
        "id\tengagement_status\tengagement_action\tengagement_targets\tcomment_draft\n"
        "candidate\tapproved\tcomment_candidate\thttps://www.linkedin.com/feed/update/urn:li:activity:1/\tNice point.\n",
        encoding="utf-8",
    )
    plugin_root = tmp_path / "chrome-plugin"
    scripts_dir = plugin_root / "scripts"
    scripts_dir.mkdir(parents=True)
    (scripts_dir / "browser-client.mjs").write_text(
        'export async function setupBrowserRuntime() { return {ok: true}; }\n',
        encoding="utf-8",
    )
    script = """
      const { pathToFileURL } = await import("node:url");
      const runnerUrl = pathToFileURL(process.argv[1]).href;
      const { sendApprovedEngagementCandidatesChromeExtension } = await import(runnerUrl);
      try {
        await sendApprovedEngagementCandidatesChromeExtension({
          queuePath: process.argv[2],
          pluginRoot: process.argv[3],
          laneResolution: {lane: "chrome_extension_profile2_fallback", fallback_allowed: true},
          globals: {}
        });
      } catch (error) {
        console.log(String(error?.message || error));
        process.exitCode = 0;
      }
      if (process.exitCode === undefined) {
        console.log("NO_ERROR");
        process.exitCode = 1;
      }
    """
    result = subprocess.run(
        [
            "node",
            "--input-type=module",
            "-e",
            script,
            str(ENGAGEMENT_RUNNER_PATH),
            str(queue),
            str(plugin_root),
        ],
        check=False,
        text=True,
        capture_output=True,
    )

    assert result.returncode == 0, result.stderr
    assert "trusted_chrome_runtime_unavailable" in result.stdout
    assert "fresh_visible_codex_chrome_runtime_required" in result.stdout
    assert not result.stdout.startswith("chrome_extension_profile2_unavailable")


def test_publish_runner_preserves_trusted_runtime_boundary(tmp_path: Path) -> None:
    queue = tmp_path / "queue.tsv"
    _write_queue(
        queue,
        [
            {
                "id": "candidate",
                "status": "approved",
                "quality_score": "10",
                "keep_priority": "ship_now",
                "review_status": "ready",
                "linkedin_text": "LinkedIn post body",
                "media_plan": "LinkedInリンクカード型",
                "review_notes": "Chrome Extension Profile 2 publish candidate",
            }
        ],
    )
    plugin_root = tmp_path / "chrome-plugin"
    scripts_dir = plugin_root / "scripts"
    scripts_dir.mkdir(parents=True)
    (scripts_dir / "browser-client.mjs").write_text(
        'export async function setupBrowserRuntime() { return {ok: true}; }\n',
        encoding="utf-8",
    )
    script = """
      const { pathToFileURL } = await import("node:url");
      const runnerUrl = pathToFileURL(process.argv[1]).href;
      const { sendApprovedPublishCandidatesChromeExtension } = await import(runnerUrl);
      try {
        await sendApprovedPublishCandidatesChromeExtension({
          queuePath: process.argv[2],
          pluginRoot: process.argv[3],
          laneResolution: {lane: "chrome_extension_profile2_fallback", fallback_allowed: true},
          globals: {}
        });
      } catch (error) {
        console.log(String(error?.message || error));
        process.exitCode = 0;
      }
      if (process.exitCode === undefined) {
        console.log("NO_ERROR");
        process.exitCode = 1;
      }
    """
    result = subprocess.run(
        [
            "node",
            "--input-type=module",
            "-e",
            script,
            str(RUNNER_PATH),
            str(queue),
            str(plugin_root),
        ],
        check=False,
        text=True,
        capture_output=True,
    )

    assert result.returncode == 0, result.stderr
    assert "trusted_chrome_runtime_unavailable" in result.stdout
    assert "fresh_visible_codex_chrome_runtime_required" in result.stdout
    assert not result.stdout.startswith("chrome_extension_profile2_unavailable")


def test_trusted_bridge_server_finalizes_stale_running_receipt_on_poll(tmp_path: Path) -> None:
    receipt_dir = tmp_path / "receipts"
    receipt_dir.mkdir()
    (receipt_dir / "stale-run.json").write_text(
        json.dumps(
            {
                "ok": False,
                "status": "running",
                "mode": "publish",
                "started_at": "2026-06-02T00:00:00.000Z",
                "updated_at": "2026-06-02T00:00:00.000Z",
            }
        ),
        encoding="utf-8",
    )
    server = HTTPServer(("127.0.0.1", 0), BaseHTTPRequestHandler)
    port = server.server_port
    server.server_close()
    script = """
      const { pathToFileURL } = await import("node:url");
      const serverUrl = pathToFileURL(process.argv[1]).href;
      const { startChromeExtensionTrustedBridge, stopChromeExtensionTrustedBridge } = await import(serverUrl);
      const port = Number.parseInt(process.argv[2], 10);
      const receiptDir = process.argv[3];
      const globals = {};
      const info = await startChromeExtensionTrustedBridge({ port, token: "test-token", globals });
      try {
        const response = await fetch(`${info.url}/runs/stale-run?receiptDir=${encodeURIComponent(receiptDir)}`, {
          headers: {"x-social-flow-bridge-token": "test-token"}
        });
        const receipt = await response.json();
        console.log(JSON.stringify({status: response.status, receipt}));
      } finally {
        await stopChromeExtensionTrustedBridge({ globals });
      }
    """
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script, str(BRIDGE_SERVER_PATH), str(port), str(receipt_dir)],
        check=False,
        text=True,
        capture_output=True,
        env={
            **os.environ,
            "SOCIAL_FLOW_CHROME_EXTENSION_BRIDGE_STALE_RECEIPT_SECONDS": "1",
        },
    )

    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["status"] == 200
    assert payload["receipt"]["status"] == "failed"
    assert payload["receipt"]["stale_watchdog"] is True
    assert "trusted_runner_bridge_running_receipt_stale" in payload["receipt"]["error"]


def test_trusted_bridge_has_official_job_mode() -> None:
    server = BRIDGE_SERVER_PATH.read_text(encoding="utf-8")
    client = BRIDGE_CLIENT_PATH.read_text(encoding="utf-8")

    assert '"/official-job"' in server
    assert "detectOfficialAts" in server
    assert "OFFICIAL_JOB_ADAPTERS" in server
    assert "runOfficialJobApplicationChromeExtension" in server
    assert "runOfficialAshbyApplicationChromeExtension" in server
    assert "captureAshbyPreSubmitReview" in server
    assert "02-pre-submit-final-review.png" in server
    assert "02-pre-submit-final-review-checks.json" in server
    assert "02-semantic-question-review.json" in server
    assert 'getAttribute?.("data-state") === "checked"' in server
    assert 'getAttribute?.("data-selected") === "true"' in server
    assert 'getAttribute?.("data-checked") === "true"' in server
    assert "selectedClassPattern" not in server
    assert "ashby_pre_submit_final_review_failed_before_submit" in server
    assert "firecrawl_americas_no_playwright_click" in server
    assert "unsafe_required_fields_before_submit:americas_location_requirement_not_met" in server
    assert "americas_location_requirement_not_met" in server
    assert "runOfficialGreenhouseApplicationChromeExtension" in server
    assert "captureOfficialVisibleOpenProof" in server
    assert "normalizeOfficialVisibleRoleMarker" in server
    assert "apply_form_dom_missing" in server
    assert "stopOnOfficialVisibleOpenFailure" in server
    assert "appendOfficialJobUnexpectedFailureOutcome" in server
    assert "officialUserActionBlockerFor" in server
    assert "writeOfficialUserActionTabManifest" in server
    assert "official_job_trusted_bridge_user_action" in server
    assert "closed_user_only_skip" in server
    assert "blocked_captcha_ready_for_user" in server
    assert "needs_user_action" in server
    assert "visible_open_check_failed_before_form_mutation" in server
    assert "chrome_node_tool_timeout_before_artifact" in server
    assert "official_job_unexpected_exception_before_artifact" in server
    assert "site-open-check" in server
    assert "uploadAshbyResume" in server
    assert "uploadGreenhouseResume" in server
    assert "greenhouse_filechooser_unavailable_direct_input_fallback" in server
    assert 'waitForEvent("filechooser", { timeoutMs: 10000 })' in server
    assert "selectGreenhouseReactOption" in server
    assert "selectGreenhouseReactOptionByLabel" in server
    assert "aria-labelledby" in server
    assert "allowKeyboardFallback = false" in server
    assert "allowKeyboardFallback: false" in server
    assert "if (!allowKeyboardFallback) {" in server
    assert "const clicked = await option.click" in server
    assert "if (clicked) return true;" in server
    assert ".select__menu [role='option']" in server
    assert "tab.cua.click({ x: visibleOption.x, y: visibleOption.y })" in server
    assert 'locator.press("Escape")' in server
    assert "locatedCountryByLabel" in server
    assert "Located Elsewhere" in server
    assert "employmentRestrictionsByLabel" in server
    assert "workAuthorizationByLabel" in server
    assert "previousGitLabWorkByLabel" in server
    assert "currentCountryResidenceByLabel" in server
    assert "genderMaleByLabel" in server
    assert "Male" in server
    assert "user_security_code_required_greenhouse_antibot" in server
    assert "Acknowledge" in server
    assert "Japan +81" in server
    assert "officialApplicationUrl" in server
    assert "payload.job_url" in server
    assert "desiredCompensation" in server
    assert "desired_compensation" in server
    assert "compensationExpectations" in server or "compensation expectations" in server
    assert "official_job_adapter_missing" in server
    assert "greenhouse" in server
    assert "lever" in server
    assert "workday" in server
    assert "official_resume_upload_not_reflected" in server
    assert "official_submit_completion_not_verified" in server
    assert "ashby_required_fields_unfilled_after_submit_attempt" in server
    assert "correctionRequired" in server
    assert "const submittedConfirmed = submitted && !userActionBlocker && !correctionRequired;" in server
    assert 'submittedConfirmed ? "submitted_confirmed" : blockerReason' in server
    assert 'commandText.includes("official-job") || commandText.includes("platform-inbox-sweep") || commandText.includes(" job")' in server
    assert "submitted_confirmed" in server
    assert "your application is in" in server
    assert "application (has been )?(submitted|received|is in)" in server
    assert 'mode === "official-job"' in client
    assert '"/official-job"' in client
    assert 'mode === "official-job" || mode === "job" || mode === "platform-inbox-sweep" ? "900000" : "600000"' in client
    assert 'mode === "official-job" || mode === "job" || mode === "platform-inbox-sweep" ? "900" : "180"' in client


def test_all_job_bridge_runtime_call_sites_forward_payload_codex_turn_metadata() -> None:
    server = BRIDGE_SERVER_PATH.read_text(encoding="utf-8")

    assert server.count("codexTurnMetadata: codexTurnMetadataFromPayload(payload),") == 7
    assert "__socialFlowChromeExtensionRequireExistingBrowserRuntime = true" in server
    assert "recoverProfile2Window: false" in server


def test_ashby_pre_submit_ignores_failed_sponsorship_probe_as_question_presence() -> None:
    server = BRIDGE_SERVER_PATH.read_text(encoding="utf-8")

    assert 'const sponsorshipOperationAttempted = nestedFieldResults.some(' in server
    assert "/^visa_sponsorship_yes_locator_click$/.test(String(result?.key || \"\"))" in server
    assert "/^visa_sponsorship_yes_safe_fact(_following)?$/.test(String(result?.key || \"\"))" in server
    assert 'const relocationOperationAttempted = nestedFieldResults.some(' in server
    assert "/^relocation_yes_locator_click$/.test(String(result?.key || \"\"))" in server
    assert "/^relocation_yes_safe_fact(_following)?$/.test(String(result?.key || \"\"))" in server
    assert "visa_sponsorship_yes_safe_fact_explicit" in server
    assert 'const sponsorshipExplicitRequested = nestedFieldResults.some(' in server
    assert 'const relocationExplicitRequested = nestedFieldResults.some(' in server
    assert "Boolean(pageState.choiceReadback?.sponsorship?.present) || sponsorshipOperationAttempted" in server
    assert "Boolean(pageState.choiceReadback?.relocation?.present) || relocationOperationAttempted" in server
    assert "sponsorshipOperationAttempted || sponsorshipExplicitRequested" not in server
    assert "relocationOperationAttempted || relocationExplicitRequested" not in server
    assert "selectedClassPattern" not in server
    assert "selectedAncestor" not in server
    assert 'if (/group|radiogroup/i.test(element.getAttribute("role") || "")) {' in server
    assert 'element.querySelectorAll?.("[aria-checked=\'true\'], input:checked")' in server
    assert '(candidate.closest?.("[role=\'radiogroup\'], [role=\'group\'], fieldset") || element) === element' in server
    read_choice_block = server.split("const readChoice = (patterns) => {", 1)[1].split(
        "const choiceReadback = {",
        1,
    )[0]
    assert "const isYesChoice = (element) => {" in read_choice_block
    assert "!/(^|\\b)(no|いいえ)(\\b|$)/i.test(text)" in read_choice_block
    assert "const selectedByButtonClass = (element) => {" in read_choice_block
    assert '!/^(BUTTON|LABEL)$/i.test(element?.tagName || "")' in read_choice_block
    assert '!/(radio|checkbox|option)/i.test(element?.getAttribute?.("role") || "")' in read_choice_block
    assert "div[tabindex]" not in read_choice_block
    assert "span[tabindex]" not in read_choice_block
    assert "_active_|_selected_|_checked_" in read_choice_block
    assert "_inactive_|_unselected_|_unchecked_" in read_choice_block
    assert 'const labels = Array.from(document.querySelectorAll("label, p, span, h1, h2, h3, h4"));' in read_choice_block
    assert 'const boundaryNodes = Array.from(document.querySelectorAll("label, p, span, div, h1, h2, h3, h4"));' in read_choice_block
    assert "const nextQuestionTop = followingQuestions.length ? Math.min(...followingQuestions) : Number.POSITIVE_INFINITY;" in read_choice_block
    assert "rect.top >= labelRect.bottom - 4" in read_choice_block
    assert "rect.top - labelRect.bottom <= 180" in read_choice_block
    assert "rect.top < nextQuestionTop - 4" in read_choice_block
    assert ".filter(inQuestionBand)" in read_choice_block
    assert (
        "const sponsorshipYesSelected =\n"
        "    !sponsorshipQuestionPresent || pageState.choiceReadback?.sponsorship?.yes_selected === true;"
    ) in server
    assert (
        "const relocationYesSelected =\n"
        "    !relocationQuestionPresent || pageState.choiceReadback?.relocation?.yes_selected === true;"
    ) in server


def test_official_visible_open_role_marker_normalizes_location_suffixes() -> None:
    server = BRIDGE_SERVER_PATH.read_text(encoding="utf-8")

    assert "function normalizeOfficialVisibleRoleMarker" in server
    assert "Remote|Hybrid|On-?site|Onsite" in server
    assert "United States|USA|US|United Kingdom|UK|EMEA|APAC|Japan|Singapore|Europe" in server
    assert "normalizeOfficialVisibleRoleMarker(officialRoleFor(payload))" in server


def test_greenhouse_resume_filechooser_has_direct_input_fallback() -> None:
    server = BRIDGE_SERVER_PATH.read_text(encoding="utf-8")

    assert 'waitForEvent("filechooser", { timeoutMs: 10000 })' in server
    assert "clickGreenhouseResumeUploadFallback" in server
    assert "clickGreenhouseResumeControlForInputIndex" in server
    assert "input_id: id" in server
    assert 'matched_by: "label_for_input"' in server
    assert "rect.width > 2" in server
    assert "!String(node.className || \"\").includes(\"visually-hidden\")" in server
    assert "const beforeReflection = await readReflection(resumeFileInputIndexes[0]);" in server
    assert "upload_input_index: resumeFileInputIndexes[0]" in server
    greenhouse_block = server.split("async function uploadGreenhouseResume", 1)[1].split("async function fillLeverField", 1)[0]
    assert 'getByRole("button", { name: "添付", exact: true })' not in greenhouse_block
    assert "resumeButtonNames" not in greenhouse_block
    assert "fallbackInputIndexes" in server
    assert "greenhouse_filechooser_unavailable_direct_input_fallback" in server
    assert "filechooser_resume_input" in server
    assert 'directChooser.setFiles([filePath], { timeoutMs: 12000 })' in server
    assert 'input.setInputFiles([filePath], { timeout: 12000 })' in greenhouse_block
    assert 'const directInputSet = await input.setInputFiles([filePath], { timeout: 12000 }).then(() => true).catch(() => false);' in greenhouse_block
    assert "reflectionOk(reflected)" in server
    assert "greenhouse_resume_manual_text_reflected_but_file_upload_required" in server
    assert "reflected.bodyIncludes ||" not in server.split("async function uploadGreenhouseResume", 1)[1].split("async function fillLeverField", 1)[0]
    assert "resumeSectionIncludes" in server
    assert "resumeSectionText" in server
    assert "targetIsResumeSection" in server
    assert "reflected.targetIsResumeSection === true" in server
    assert "wrapperText" in server
    assert "isCoverLetterText" in server
    assert ".filter((item) => isResumeText(item.normText) && !isCoverLetterText(item.normText))" in server
    assert ".filter((item) => isResumeText(item.context) && !isCoverLetterText(item.wrapperText))" in server
    assert '".file-upload, [role=\'group\'][aria-labelledby], fieldset, [data-testid*=\'resume\' i], [id*=\'resume\' i], [class*=\'resume\' i]"' in server
    assert 'document.body.innerText.includes(name)' not in server.split("async function uploadGreenhouseResume", 1)[1].split("async function fillLeverField", 1)[0]
    assert 'querySelectorAll(".file-upload, [role=\'group\'], fieldset, section, div")' not in server.split("async function uploadGreenhouseResume", 1)[1].split("async function fillLeverField", 1)[0]
    assert "const fileInputCount = await allFileInputs.count().catch(() => 0);" in server
    assert "greenhouse_resume_file_input_not_identified" in server
    assert "const genericSingleInputButtonNames = fileInputCount === 1" not in server
    assert "if (inputs.length === 1) return [0];" not in server
    assert "const reflected = await readReflection(resumeFileInputIndexes[0]);" in server
    assert "return [];" in server


def test_greenhouse_safe_known_facts_fill_current_standard_identity_fields() -> None:
    server = BRIDGE_SERVER_PATH.read_text(encoding="utf-8")
    greenhouse_block = server.split("async function autofillGreenhouseSafeKnownFacts", 1)[1].split(
        "async function fillFirecrawlAshbyRequiredFallback", 1
    )[0]

    assert '"greenhouse_first_name"' in greenhouse_block
    assert "'#first_name'" in greenhouse_block
    assert '"greenhouse_last_name"' in greenhouse_block
    assert "'#last_name'" in greenhouse_block
    assert '"greenhouse_email"' in greenhouse_block
    assert "'#email'" in greenhouse_block
    assert "preferredLastName:" in greenhouse_block
    assert '|| "Tanaka"' in greenhouse_block


def test_greenhouse_safe_known_facts_avoids_throwing_on_getter_only_value_assignment() -> None:
    server = BRIDGE_SERVER_PATH.read_text(encoding="utf-8")
    greenhouse_block = server.split("async function autofillGreenhouseSafeKnownFacts", 1)[1].split(
        "async function fillFirecrawlAshbyRequiredFallback", 1
    )[0]

    assert "if (setter) setter.call(element, text);" in greenhouse_block
    assert "try {" in greenhouse_block
    assert "element.value = text;" in greenhouse_block
    assert "return false;" in greenhouse_block


def test_greenhouse_runs_generic_required_repair_before_pre_submit_gate() -> None:
    server = BRIDGE_SERVER_PATH.read_text(encoding="utf-8")
    greenhouse_runner = server.split("async function runOfficialGreenhouseApplicationChromeExtension", 1)[1].split(
        "async function runOfficialAshbyApplicationChromeExtension", 1
    )[0]

    assert "repairOfficialRequiredFieldsGeneric" in server
    assert "greenhouse_pre_submit_generic_required_repair_" in greenhouse_runner
    assert greenhouse_runner.index("repairOfficialRequiredFieldsGeneric(tab, fields") < greenhouse_runner.index("const preSubmit = await")
    assert "preRepairUserActionBlocker = officialUserActionBlockerFor" in greenhouse_runner
    assert "if (preRepairUserActionBlocker)" in greenhouse_runner
    assert "attemptNo <= 2" in greenhouse_runner


def test_greenhouse_pre_input_survey_blocks_human_required_before_mutation() -> None:
    server = BRIDGE_SERVER_PATH.read_text(encoding="utf-8")
    survey_block = server.split("async function captureGreenhousePreInputSurvey", 1)[1].split(
        "async function repairOfficialRequiredFieldsGeneric",
        1,
    )[0]

    assert 'path.join(proofDir, "00-pre-input-form-survey.png")' in survey_block
    assert 'path.join(proofDir, "00-pre-input-form-survey.json")' in survey_block
    assert 'path.join(proofDir, "00-input-plan.json")' in survey_block
    assert 'path.join(proofDir, "00-input-plan-review.json")' in survey_block
    assert 'schema: "ats_universal_input_plan.v1"' in survey_block
    assert 'ats: "greenhouse"' in survey_block
    assert "items: (survey.fields || []).map" in survey_block
    assert "planned_count:" in survey_block
    assert "ok_to_mutate: !survey.error && survey.hard_stop_count === 0 && survey.human_required_count === 0" in survey_block
    assert "human_input_required_with_evidence" in survey_block
    assert 'element.closest("label, fieldset, [role=\'group\'], [role=\'radiogroup\']")' in survey_block
    assert 'element.closest("label, fieldset, [role=\'group\'], [role=\'radiogroup\'], section, div")' not in survey_block
    assert 'required && unsafe\n            ? "hard_stop"' in survey_block
    assert '"optional_unsafe_observed"' in survey_block
    assert 'workAuthorization: explicit(["workAuthorization", "work_authorization", "authorizedToWork", "authorized_to_work"]),' in survey_block
    assert 'workAuthorization: explicit(["workAuthorization", "work_authorization", "authorizedToWork", "authorized_to_work"]) || "Yes"' not in survey_block
    assert "compensation_or_signature" in survey_block
    assert "roleIsJapan" in survey_block
    assert "country in which you are applying|country where you are applying|country this role is located" in survey_block
    assert "if (roleIsJapan && labelIsJapan && profile.workAuthorization)" in survey_block


def test_greenhouse_official_intelligence_allows_japan_work_authorization_known_fact() -> None:
    server = BRIDGE_SERVER_PATH.read_text(encoding="utf-8")
    intelligence_block = server.split("async function captureOfficialFormIntelligence", 1)[1].split(
        "function officialAtsIframeOpenCandidate",
        1,
    )[0]

    assert "isSafeJapanWorkAuthorizationKnownFact" in intelligence_block
    assert "pageIsJapanRole" in intelligence_block
    assert "{ roleContext: officialRoleFor(payload) }" in intelligence_block
    assert "`${roleContext || \"\"}`" in intelligence_block
    assert "document.title} ${roleContext" not in intelligence_block
    assert "document.title} ${body" not in intelligence_block
    assert "country in which you are applying" in intelligence_block
    assert "authori[sz]ed to work|work authorization|right to work" in intelligence_block
    assert "visa|sponsorship|sponsor|future|require.*support" in intelligence_block
    assert "visa sponsorship|work authorization|authorized to work|right to work" in intelligence_block
    assert intelligence_block.index("isSafeJapanWorkAuthorizationKnownFact(label)") < intelligence_block.index(
        "unsafePattern.test(label)"
    )


def test_greenhouse_safe_known_facts_do_not_auto_answer_generic_work_authorization_or_yes_sponsorship() -> None:
    server = BRIDGE_SERVER_PATH.read_text(encoding="utf-8")
    greenhouse_block = server.split("async function autofillGreenhouseSafeKnownFacts", 1)[1].split(
        "async function fillFirecrawlAshbyRequiredFallback",
        1,
    )[0]

    assert "pageIsJapanRole" in greenhouse_block
    assert "roleContext:" in greenhouse_block
    assert "`${safeValues.roleContext || \"\"}`" in greenhouse_block
    assert "document.title} ${safeValues.roleContext" not in greenhouse_block
    assert "document.title} ${document.body" not in greenhouse_block
    assert "country in which you are applying" in greenhouse_block
    assert "unsafe_generic_work_authorization_not_auto_answered" in greenhouse_block
    assert 'chooseIfValue("greenhouse_visa_sponsorship", [/require visa sponsorship/i], safeValues.visaSponsorship);' in greenhouse_block
    assert 'chooseIfValue("greenhouse_visa_sponsorship", [/require visa sponsorship/i], safeValues.visaSponsorship, [/^yes$/i]);' not in greenhouse_block
    assert 'chooseIfValue("greenhouse_authorized_current_country", [/legally authorized to work/i], safeValues.authorizedCurrentCountry, [/^yes$/i]);' not in greenhouse_block
    greenhouse_runner = server.split("async function runOfficialGreenhouseApplicationChromeExtension", 1)[1].split(
        "async function runOfficialAshbyApplicationChromeExtension",
        1,
    )[0]
    assert "greenhouseRoleIsJapan" in greenhouse_runner
    assert 'const workAuthorizationValue = greenhouseRoleIsJapan ? fields.workAuthorization || fields.work_authorization || "" : "";' in greenhouse_runner
    assert 'fields.visaSponsorship || fields.visa_sponsorship || (greenhouseRoleIsJapan ? "No" : "")' in greenhouse_runner
    assert "work authorization|authorized to work" not in greenhouse_runner.split('key: "workAuthorizationByLabel"', 1)[1].split(
        'const visaSponsorshipValue',
        1,
    )[0]


def test_greenhouse_pre_input_survey_plans_uploads_and_avoids_select_noise() -> None:
    server = BRIDGE_SERVER_PATH.read_text(encoding="utf-8")
    survey_block = server.split("async function captureGreenhousePreInputSurvey", 1)[1].split(
        "async function repairOfficialRequiredFieldsGeneric",
        1,
    )[0]

    assert "isResumeUploadControl" in survey_block
    assert "isResumeUploadGroup" in survey_block
    assert "isReactSelectInternalInput" in survey_block
    assert 'answer_key: "resumeFile"' in survey_block
    assert 'source: "profile_file"' in survey_block
    assert 'status: required ? "planned_upload" : "optional_or_blank"' in survey_block
    assert 'field.status === "planned" || field.status === "planned_upload"' in survey_block
    assert "addReactSelectControlFromInternalInput" in survey_block
    assert 'if (isReactSelectInternalInput(element, label)) {' in survey_block
    assert "addReactSelectControlFromInternalInput(element);" in survey_block
    assert "/react-select/i.test(technicalName)" in survey_block
    assert "addResumeUploadWrapper" in survey_block
    assert "kind: \"upload_group\"" in survey_block
    assert ".file-upload, [data-testid*='resume' i], [id*='resume' i], [class*='resume' i]" in survey_block


def test_greenhouse_pre_input_survey_orders_sensitive_classification_before_location() -> None:
    server = BRIDGE_SERVER_PATH.read_text(encoding="utf-8")
    survey_block = server.split("async function captureGreenhousePreInputSurvey", 1)[1].split(
        "async function repairOfficialRequiredFieldsGeneric",
        1,
    )[0]

    assert survey_block.index("if (/sponsorship|visa/i.test(label))") < survey_block.index("if (/city|location|where.*located")
    assert survey_block.index("if (/hispanic|latino/i.test(label))") < survey_block.index("if (/city|location|where.*located")
    assert 'answer_key: "visaSponsorship"' in survey_block
    assert 'profile.visaSponsorship || "No"' in survey_block
    assert 'answer_key: "eeo_hispanic_optional"' in survey_block
    assert 'answer.source === "optional_blank"' in survey_block
    assert 'if (/^country\\b/i.test(label) && /phone country/i.test(label))' in survey_block
    assert 'answer_key: "phone_country_optional_ui"' in survey_block


def test_greenhouse_select_option_accepts_yes_no_prefix_options() -> None:
    server = BRIDGE_SERVER_PATH.read_text(encoding="utf-8")
    selector_block = server.split("async function selectGreenhouseReactOption", 1)[1].split(
        "async function selectGreenhouseReactOptionByLabel",
        1,
    )[0]

    assert "/^(yes|no)$/i.test(expected)" in selector_block
    assert 'new RegExp(`^${expected}\\\\b`, "i").test(actual)' in selector_block


def test_greenhouse_runner_stops_with_specific_human_required_input_plan_blocker() -> None:
    server = BRIDGE_SERVER_PATH.read_text(encoding="utf-8")
    greenhouse_runner = server.split("async function runOfficialGreenhouseApplicationChromeExtension", 1)[1].split(
        "async function runOfficialAshbyApplicationChromeExtension",
        1,
    )[0]

    assert greenhouse_runner.index("captureGreenhousePreInputSurvey") < greenhouse_runner.index("const fieldResults = []")
    assert "greenhouse_required_input_plan_human_required_before_mutation" in greenhouse_runner
    assert "preInputSurvey.inputPlan?.answer_map" in greenhouse_runner


def test_greenhouse_result_preserves_pre_input_artifacts_after_fill_paths() -> None:
    server = BRIDGE_SERVER_PATH.read_text(encoding="utf-8")
    greenhouse_runner = server.split("async function runOfficialGreenhouseApplicationChromeExtension", 1)[1].split(
        "async function runOfficialAshbyApplicationChromeExtension",
        1,
    )[0]

    assert greenhouse_runner.count("pre_input_survey: preInputSurvey.artifact_paths") >= 5
    assert greenhouse_runner.count("pre_input_review: preInputSurvey.review") >= 5
    assert "extra: { pre_input_survey: preInputSurvey.artifact_paths, pre_input_review: preInputSurvey.review }" in greenhouse_runner


def test_generic_required_repair_keeps_security_and_assessment_fields_unsafe() -> None:
    server = BRIDGE_SERVER_PATH.read_text(encoding="utf-8")
    repair_block = server.split("async function repairOfficialRequiredFieldsGeneric", 1)[1].split(
        "async function uploadGreenhouseResume", 1
    )[0]

    assert "verification code" in repair_block
    assert "security code" in repair_block
    assert "otp" in repair_block
    assert "captcha" in repair_block
    assert "assessment" in repair_block
    assert "test" in repair_block
    assert "safe_answer_not_available" in repair_block
    assert 'firstName: explicit(["firstName", "first_name"])' in repair_block
    assert 'salary: explicit(["compensationExpectations"' in repair_block
    assert '"90000"' not in repair_block
    assert "visaValue = explicit" in repair_block
    assert 'if (/gender|性別/i.test(label) && /^male$/i.test(profile.gender)) wanted.push' in repair_block
    assert 'if (/gender|性別/i.test(label) && /^male$/i.test(profile.gender)) optionPatterns.push' in repair_block


def test_security_code_blocker_requires_code_context() -> None:
    server = BRIDGE_SERVER_PATH.read_text(encoding="utf-8")
    blocker_block = server.split("function officialUserActionBlockerFor", 1)[1].split(
        "function shouldPreserveOfficialTabForUser",
        1,
    )[0]
    platform_block = server.split("function platformInboxSweepBlockerFor", 1)[1].split(
        "async function capturePlatformInboxPage",
        1,
    )[0]
    greenhouse_block = server.split("async function runOfficialGreenhouseApplicationChromeExtension", 1)[1].split(
        "async function runOfficialAshbyApplicationChromeExtension",
        1,
    )[0]

    assert "securityCodeRequirementRe.test(haystack)" in blocker_block
    assert "securityCodeRequirementRe.test(haystack)" in platform_block
    assert "one[- ]time\\s+(?:code|password|passcode)" in server
    assert "\\botp\\b" in server
    assert "/otp|one-time|security code|verification code|認証コード|確認コード|8文字/i" not in server
    assert "/otp|one-time|security code|verification code|認証コード|確認コード/i" not in server
    assert "one[- ]?time|otp" not in greenhouse_block


def test_greenhouse_pre_input_signature_gate_precedes_compensation_autofill() -> None:
    server = BRIDGE_SERVER_PATH.read_text(encoding="utf-8")
    answer_block = server.split("const answerFor = (label, tagName = \"\", type = \"\") => {", 1)[1].split(
        "return { value: \"\", answer_key: \"unknown_required\", source: \"human_required\" };",
        1,
    )[0]
    repair_block = server.split("async function repairOfficialRequiredFieldsGeneric", 1)[1].split(
        "async function uploadGreenhouseResume",
        1,
    )[0]

    assert "certification_or_signature" in answer_block
    assert "compensationExpectations" in answer_block
    assert answer_block.index("certification_or_signature") < answer_block.index("compensationExpectations")
    assert "certification|confidentiality|initialing|initials|i certify|signature" in repair_block


def test_greenhouse_post_upload_does_not_run_ashby_compensation_defaults() -> None:
    server = BRIDGE_SERVER_PATH.read_text(encoding="utf-8")
    greenhouse_runner = server.split("async function runOfficialGreenhouseApplicationChromeExtension", 1)[1].split(
        "async function runOfficialAshbyApplicationChromeExtension",
        1,
    )[0]

    assert "post_upload_ashby_safe_known_facts" not in greenhouse_runner
    assert "autofillAshbySafeKnownFacts(tab, fields)" not in greenhouse_runner
    assert "post_upload_greenhouse_safe_known_facts" in greenhouse_runner


def test_ashby_location_readback_gate_runs_before_submit() -> None:
    server = BRIDGE_SERVER_PATH.read_text(encoding="utf-8")
    ashby_runner = server.split("async function runOfficialAshbyApplicationChromeExtension", 1)[1].split(
        "async function runOfficialLeverApplicationChromeExtension",
        1,
    )[0]
    pre_submit_review = server.split("async function captureAshbyPreSubmitReview", 1)[1].split(
        "async function captureAshbyInitialFormStructureMap",
        1,
    )[0]

    assert "async function readbackAshbyRequiredLocation" in server
    assert "async function selectAshbyVisibleLocationWidget" in server
    assert "Start typing" in server or "start typing" in server
    assert 'return await selectAshbyVisibleLocationWidget(tab, value);' in server
    assert 'button, [role=\'button\'], [role=\'combobox\'], [aria-haspopup], [class*=\'select\']' in server
    assert "async function clickAshbyLocationAutocompleteOption" in server
    assert "rect.top - labelRect.bottom <= 160" in server
    assert "tab.playwright.mouse.click" in server
    assert "if (!value || !tab?.cua) return false;" not in server
    assert "getByText(String(value), { exact: true })" not in server
    assert "clickAshbyLocationAutocompleteOption(tab, value," in server
    autocomplete = server.split("async function clickAshbyLocationAutocompleteOption", 1)[1].split(
        "async function selectAshbyVisibleLocationWidget",
        1,
    )[0]
    assert "anchorSelector" in autocomplete
    assert 'if (!anchor) return "";' in autocomplete
    assert "[role='option'], [aria-selected='true'], [data-selected='true']" in autocomplete
    assert '"button"' not in autocomplete
    assert "[role='button']" not in autocomplete
    assert '"div"' not in autocomplete
    assert "tokenHits >= Math.min(tokens.length, 2)" in autocomplete
    readback = server.split("async function readbackAshbyRequiredLocation", 1)[1].split(
        "async function clickAshbyExactVisibleText",
        1,
    )[0]
    assert "ok: reflected" in readback
    assert "const locationScopedValues" in readback
    assert "locationScopedValues.some((value) => lower(value) === expectedCountry)" in readback
    assert "reflected || (!hasRequiredLocation && values.some(Boolean))" not in readback
    assert "submit application|privacy policy|security|vulnerability disclosure|powered by" in readback
    assert "const preSubmitLocationReadback = await readbackAshbyRequiredLocation(tab, fields.location);" in ashby_runner
    assert 'key: "pre_submit_location_readback"' in ashby_runner
    assert ashby_runner.index("pre_submit_location_readback") < ashby_runner.index("const preSubmitReview = await captureAshbyPreSubmitReview")
    assert "const missingRequiredAshbyLocation = hasMissingAshbyPreSubmitLocationReadback(fieldResults);" in pre_submit_review
    assert "ashby_location_readback_missing_before_submit" in pre_submit_review
    assert "ashby_location_readback_ok: !missingRequiredAshbyLocation" in pre_submit_review


def test_ashby_location_readback_values_reject_submit_button_false_positive() -> None:
    script = f"""
        import {{ evaluateAshbyLocationReadbackValues, hasMissingAshbyPreSubmitLocationReadback }} from {json.dumps(str(BRIDGE_SERVER_PATH))};
        const falsePositive = evaluateAshbyLocationReadbackValues({{
          expected: "Naha, Okinawa, Japan",
          values: ["Submit Application"],
          hasRequiredLocation: false
        }});
        const reflected = evaluateAshbyLocationReadbackValues({{
          expected: "Naha, Okinawa, Japan",
          values: ["Naha Okinawa Japan"],
          hasRequiredLocation: true
        }});
        const countryOnly = evaluateAshbyLocationReadbackValues({{
          expected: "Naha, Okinawa, Japan",
          values: ["Japan"],
          hasRequiredLocation: false
        }});
        const missingPreSubmit = hasMissingAshbyPreSubmitLocationReadback([
          {{ key: "pre_submit_location_readback", ok: false, details: falsePositive }}
        ]);
        const satisfiedPreSubmit = hasMissingAshbyPreSubmitLocationReadback([
          {{ key: "pre_submit_location_readback", ok: true, details: reflected }}
        ]);
        const countryOnlyPreSubmit = hasMissingAshbyPreSubmitLocationReadback([
          {{ key: "pre_submit_location_readback", ok: countryOnly.ok, details: countryOnly }}
        ]);
        console.log(JSON.stringify({{ falsePositive, reflected, countryOnly, missingPreSubmit, satisfiedPreSubmit, countryOnlyPreSubmit }}));
    """
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        check=False,
        text=True,
        capture_output=True,
    )

    assert result.returncode == 0, result.stderr
    response = json.loads(result.stdout)
    assert response["falsePositive"]["ok"] is False
    assert response["falsePositive"]["has_required_location"] is False
    assert response["falsePositive"]["values"] == ["Submit Application"]
    assert response["reflected"]["ok"] is True
    assert response["reflected"]["accepted_level"] == "full_location"
    assert response["countryOnly"]["ok"] is True
    assert response["countryOnly"]["accepted_level"] == "country_only"
    assert response["missingPreSubmit"] is True
    assert response["satisfiedPreSubmit"] is False
    assert response["countryOnlyPreSubmit"] is False


def test_official_bridge_does_not_default_missing_gender_to_male() -> None:
    server = BRIDGE_SERVER_PATH.read_text(encoding="utf-8")

    assert 'fields.gender || "Male"' not in server
    assert "gender: fields.gender || \"\"" in server


def test_lever_card_safe_selects_cover_resume_facts_without_salary_default() -> None:
    server = BRIDGE_SERVER_PATH.read_text(encoding="utf-8")
    lever_block = server.split("async function autofillLeverKnownFactsWithLocators", 1)[1].split(
        "async function runOfficialLeverApplicationChromeExtension",
        1,
    )[0]

    assert "currentResidenceCountryName" in lever_block
    assert "nationalityName" in lever_block
    assert "language1Name" in lever_block
    assert "language2Name" in lever_block
    assert '"current_residence_country_locator"' in lever_block
    assert '"nationality_country_locator"' in lever_block
    assert '"language_1_japanese_locator"' in lever_block
    assert '"language_2_english_locator"' in lever_block
    assert "controls.evaluateAll" in lever_block
    assert "tab.playwright\n          .evaluate((sel)" in lever_block
    assert "inferQuestionText" in lever_block
    assert "select[required], input[required], textarea[required]" in lever_block
    assert "requiredCardSelects" in lever_block
    assert "countrySelectNames" in lever_block
    assert "languageSelectNames" in lever_block
    assert "unsafeSelectContext" in lever_block
    assert "legally authorized|authorized to work|authorization to work|work authorization|right to work" in lever_block
    assert "language assessment|proficiency test" in lever_block
    assert "USD 95,000 - 120,000" not in lever_block
    assert "unsafe_salary_or_compensation_not_auto_answered" in lever_block
    assert "salaryExpectationName && values.salaryExpectation" not in lever_block
    assert "United States of America" not in lever_block
    assert "unsafe_non_japan_work_authorization_not_auto_answered" in lever_block
    assert "unsafe_generic_work_authorization_not_auto_answered" in lever_block
    assert "unsafe_advertised_country_work_authorization_not_auto_answered" in lever_block
    assert "/Japan/i.test(text)" in lever_block
    assert "legally (?:allowed|authorized)" in lever_block


def test_official_job_form_intelligence_reach_architecture_is_connected() -> None:
    server = BRIDGE_SERVER_PATH.read_text(encoding="utf-8")

    assert "async function captureOfficialFormIntelligence" in server
    assert "async function reachOfficialApplicationForm" in server
    assert "async function stopOnOfficialReachFailure" in server
    assert "safe_known_fact_candidate" in server
    assert "unknown_required" in server
    assert "hard_stop" in server
    assert "form_unreachable_after_apply_button_probe" in server
    assert 'document.querySelector("form") ||' not in server.split("async function captureOfficialFormIntelligence", 1)[1].split("async function reachOfficialApplicationForm", 1)[0]
    assert "mainSurface.control_count >= 3 && mainSurface.has_application_marker" in server
    assert 'document.querySelector("#first_name") && document.querySelector("#last_name") && document.querySelector("#email")' in server
    assert 'document.querySelector("#first_name, #last_name, #email, #phone")' not in server.split("async function captureOfficialFormIntelligence", 1)[1].split("async function reachOfficialApplicationForm", 1)[0]
    assert "first name|last name|email|phone|履歴書" not in server.split("has_form_surface: Boolean(", 1)[1].split("),", 1)[0]
    assert "apply now|quick apply|apply for this job|submit application|応募する|申し込" in server
    assert "submit application|apply|応募する" not in server.split("if (!clicked.clicked) {", 1)[1].split(".catch(() => ({ clicked: false }))", 1)[0]
    assert "quick apply" in server
    assert "skip to|main content|#main|open roles|job alert|create alert" in server
    assert "window.scrollBy" in server
    assert "scrolled_for_apply_candidate" in server
    assert "clickExactApplyAndObserve" in server
    assert 'getByRole(role, { name, exact: true })' in server
    assert "getByText(name, { exact: true })" not in server
    assert "modal_surfaces" in server
    assert "iframe_surfaces" in server
    assert "page_signature" in server
    assert "contentDocument" in server
    assert 'waitForEvent("popup"' in server
    assert 'metadata.type === "submit"' in server
    assert "metadata.inside_form" in server
    assert "mailto:|tel:|javascript:" in server
    assert "cross_origin_form_iframe_detected_after_apply_click" in server
    assert "cross_origin_form_iframe_detected_before_mutation" in server
    assert "officialAtsIframeOpenCandidate" in server
    assert 'ats !== "greenhouse"' in server
    assert "url.username || url.password" in server
    assert 'url.hostname !== "job-boards.greenhouse.io"' in server
    assert "job-boards\\.greenhouse\\.io\\/embed\\/job_app" in server
    assert "(?:[?#]|$)" in server
    assert "(?:[/?#]|$)" not in server
    assert "official_ats_iframe_open_candidates" in server
    assert "official_ats_iframe_form_surface_reached" in server
    assert "apply_click_no_effect_after_exact_candidate" in server
    assert "new_tab_form_surface_reached" in server
    assert "modal_form_surface_reached" in server
    assert "iframe_form_surface_reached" in server
    assert "unsafe_apply_candidate_before_click" in server
    assert "security code|verification code|identity verification|assessment" in server
    assert "salary|compensation|signature|initials|i certify|confidentiality" in server
    assert "blocked_before_apply_click" in server
    assert "officialUserActionBlockerFor({" in server
    assert "hard_stop_control_seen_before_apply_click" in server
    assert "hard_stop_control_seen_on_form_before_mutation" in server
    assert "unsafe_salary_or_compensation_not_auto_answered" in server
    assert "USD 120,000 annually" not in server
    ashby_safe_known_facts = server.split("async function autofillAshbySafeKnownFacts", 1)[1].split(
        "async function autofillGreenhouseSafeKnownFacts",
        1,
    )[0]
    assert "safeValues.compensationExpectations" not in ashby_safe_known_facts
    assert "desiredCompensation || fields.desired_compensation" not in ashby_safe_known_facts
    reach_function = server.split("async function reachOfficialApplicationForm", 1)[1].split(
        "async function stopOnOfficialVisibleOpenFailure",
        1,
    )[0]
    stop_reach_function = server.split("async function stopOnOfficialReachFailure", 1)[1].split(
        "function officialUserActionBlockerFor",
        1,
    )[0]
    assert 'reach.reason === "form_unreachable_after_apply_button_probe"' not in stop_reach_function
    assert reach_function.index("officialUserActionBlockerFor({") < reach_function.index("if (intelligence.has_form_surface) {")
    assert reach_function.index("hard_stop_control_seen_on_form_before_mutation") < reach_function.index(
        "if (intelligence.has_form_surface) {"
    )
    assert reach_function.index("const postClickBlocker = stopForPostClickBlocker") < reach_function.index("const postClickReason = classifyPostClickIntelligence")
    assert reach_function.index("cross_origin_form_iframe_detected_before_mutation") < reach_function.index("let clicked = await clickExactApplyAndObserve")
    assert reach_function.index("officialAtsIframeOpenCandidate") < reach_function.index("cross_origin_form_iframe_detected_before_mutation")
    assert reach_function.index("await tab.goto(officialIframeCandidate.url)") < reach_function.index("official_ats_iframe_form_surface_reached")
    assert "context.newPage" not in reach_function
    assert reach_function.index("const iframeBlocker = stopForPostClickBlocker") < reach_function.index("if (iframeIntelligence.has_form_surface)")
    assert '"cross_origin_form_iframe_detected_after_apply_click"]), reason: postClickReason' not in reach_function
    assert 'const okReasons = new Set(["new_tab_form_surface_reached"])' not in reach_function
    assert "return { ok: false, reason: clicked.reason, attempts, ats }" in reach_function
    scroll_retry_block = reach_function.split("if (clicked?.scrolled_for_apply_candidate)", 1)[1].split("if (!clicked?.clicked) break;", 1)[0]
    assert "scrolled_for_apply_candidate" in scroll_retry_block
    assert "continue;" in scroll_retry_block
    assert "desired total.*annual compensation|compensation requirements|compensation expectations|salary expectation" not in server.split(
        "async function runOfficialAshbyApplicationChromeExtension",
        1,
    )[1].split("const ashbySafeKnownFacts", 1)[0]

    greenhouse_runner = server.split("async function runOfficialGreenhouseApplicationChromeExtension", 1)[1].split(
        "async function runOfficialAshbyApplicationChromeExtension",
        1,
    )[0]
    lever_runner = server.split("async function runOfficialLeverApplicationChromeExtension", 1)[1].split(
        "async function runOfficialGreenhouseApplicationChromeExtension",
        1,
    )[0]
    ashby_runner = server.split("async function runOfficialAshbyApplicationChromeExtension", 1)[1].split(
        "const OFFICIAL_ATS_RUNNERS",
        1,
    )[0]

    assert 'reachOfficialApplicationForm(tab, { payload, receiptPath, ats: "greenhouse" })' in greenhouse_runner
    assert 'reachOfficialApplicationForm(tab, { payload, receiptPath, ats: "lever" })' in lever_runner
    assert 'reachOfficialApplicationForm(tab, { payload, receiptPath, ats: "ashby" })' in ashby_runner
    assert "visibleOpenProof.reach = reach" in greenhouse_runner
    assert "visibleOpenProof.reach = reach" in lever_runner
    assert "visibleOpenProof.reach = reach" in ashby_runner
    assert greenhouse_runner.index("stopOnOfficialReachFailure") < greenhouse_runner.index("stopOnOfficialVisibleOpenFailure")
    assert lever_runner.index("stopOnOfficialReachFailure") < lever_runner.index("stopOnOfficialVisibleOpenFailure")
    assert ashby_runner.index("stopOnOfficialReachFailure") < ashby_runner.index("stopOnOfficialVisibleOpenFailure")


def test_greenhouse_pre_submit_readback_accepts_react_select_and_resume_reflection() -> None:
    server = BRIDGE_SERVER_PATH.read_text(encoding="utf-8")
    greenhouse_runner = server.split("async function runOfficialGreenhouseApplicationChromeExtension", 1)[1].split(
        "async function runOfficialAshbyApplicationChromeExtension", 1
    )[0]

    assert "const reactSelectHasValue = (element) =>" in greenhouse_runner
    assert "const semanticComboLabelFor = (element) =>" in greenhouse_runner
    assert "if (!semanticLabel) continue;" in greenhouse_runner
    assert "const hasReactSelectSignal = Boolean(" in greenhouse_runner
    assert "const uploadGroupHasReflection = (element) =>" in greenhouse_runner
    assert "reactSelectHasValue(element)" in greenhouse_runner
    assert 'if (reactSelectHasValue(element)) continue;' in greenhouse_runner
    assert "/question_|country|select/i.test(element.id || element.name || \"\")" not in greenhouse_runner
    assert "uploadGroupHasReflection(element)" in greenhouse_runner
    assert "uploadGroupHasReflection(group)" in greenhouse_runner


def test_official_job_uploads_accept_nested_fields_resume_path() -> None:
    server = BRIDGE_SERVER_PATH.read_text(encoding="utf-8")

    assert "payload.fields?.resumeFile || payload.fields?.resumePath" in server
    assert "uploadLeverResume" in server
    assert "uploadGreenhouseResume" in server
    assert "uploadAshbyResume" in server


def test_official_job_submit_authorized_enables_final_submit() -> None:
    server = BRIDGE_SERVER_PATH.read_text(encoding="utf-8")
    script = """
      const { pathToFileURL } = await import("node:url");
      const serverUrl = pathToFileURL(process.argv[1]).href;
      const { officialAutoSubmitFinal } = await import(serverUrl);
      const cases = [
        [{ autoSubmitFinal: true }, true],
        [{ autoSubmitFinal: "true" }, true],
        [{ submitAuthorized: true }, true],
        [{ submit_authorized: "true" }, true],
        [{ autoSubmitFinal: false }, false],
        [{ autoSubmitFinal: "false" }, false],
        [{ submitAuthorized: "0" }, false],
        [{ submit_authorized: 0 }, false],
        [{}, false],
      ];
      const results = cases.map(([payload, expected]) => ({ payload, expected, actual: officialAutoSubmitFinal(payload) }));
      const failed = results.filter((result) => result.actual !== result.expected);
      console.log(JSON.stringify({ ok: failed.length === 0, results, failed }));
      if (failed.length) process.exitCode = 1;
    """
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script, str(BRIDGE_SERVER_PATH)],
        check=False,
        text=True,
        capture_output=True,
    )

    assert result.returncode == 0, result.stdout + result.stderr
    assert json.loads(result.stdout)["ok"] is True
    assert "export function officialAutoSubmitFinal(payload = {})" in server
    assert 'value === true || String(value || "").trim().toLowerCase() === "true"' in server
    assert "enabled(payload.autoSubmitFinal) || enabled(payload.submitAuthorized) || enabled(payload.submit_authorized)" in server
    assert "Boolean(payload.autoSubmitFinal || payload.submitAuthorized || payload.submit_authorized)" not in server
    assert server.count("if (!officialAutoSubmitFinal(payload))") >= 3


def test_ashby_safe_known_facts_fill_crypto_trading_experience() -> None:
    server = BRIDGE_SERVER_PATH.read_text(encoding="utf-8")
    short_function = server.split("const fillShortFollowingQuestionInput = (patterns, value, key) =>", 1)[1].split(
        "const chooseFollowingQuestionYes", 1
    )[0]

    assert "cryptoTradingExperience" in server
    assert "crypto_trading_experience_safe_generated_template" in server
    assert "const fillShortFollowingQuestionInput = (patterns, value, key) =>" in server
    assert 'document.querySelectorAll("label, p, span, h1, h2, h3, h4")' in server
    assert "if (!labelText || labelText.length > 220) continue;" in server
    assert 'const labelFor = label.getAttribute?.("for") || "";' in short_function
    assert "document.getElementById(labelFor)" in short_function
    assert "const compactScope = label.parentElement && textFor(label.parentElement).length < 700 ? label.parentElement : null;" in short_function
    assert "const shortAnswerCandidate = (candidate) =>" in short_function
    assert "hidden|file|checkbox|radio|submit|button|reset|image" in short_function
    assert 'const candidateRank = (candidate) => (/^TEXTAREA$/i.test(candidate.tagName || "") ? 0 : 1);' in short_function
    assert 'querySelectorAll?.("input, textarea")' in short_function
    assert "[contenteditable" not in short_function
    assert "[role='textbox']" not in short_function
    assert "short_following_question_input" in server
    assert "/crypto\\/trading experience|crypto.*trading.*experience/i" in server
    assert "fillShortFollowingQuestionInput(\n        [/crypto\\/trading experience|crypto.*trading.*experience/i]" in server
    assert "|trading.*experience/]" not in server
    assert "rather than a claim of professional trading performance" in server


def test_ashby_safe_known_facts_dispatch_events_has_create_event_fallback() -> None:
    server = BRIDGE_SERVER_PATH.read_text(encoding="utf-8")
    dispatch_function = server.split("const dispatchFormEvents = (element) =>", 1)[1].split(
        "const setNativeValue = (element, value) =>", 1
    )[0]

    assert 'element.ownerDocument?.createEvent?.("Event")' in dispatch_function
    assert "event?.initEvent?.(eventName, true, false);" in dispatch_function
    assert "if (event) element.dispatchEvent(event);" in dispatch_function
    assert "element.dispatchEvent(new EventCtor(eventName, { bubbles: true }));" not in dispatch_function


def test_ashby_crypto_trading_experience_has_locator_fill_fallback() -> None:
    server = BRIDGE_SERVER_PATH.read_text(encoding="utf-8")
    ashby_runner = server.split("async function runOfficialAshbyApplicationChromeExtension", 1)[1].split(
        "const OFFICIAL_JOB_ADAPTERS =",
        1,
    )[0]
    pre_submit_call = ashby_runner.split("const preSubmitReview = await captureAshbyPreSubmitReview(tab, {", 1)[1].split(
        "});",
        1,
    )[0]

    assert "async function fillAshbyCryptoTradingExperienceWithLocator(tab, value)" in server
    assert 'document.querySelectorAll("label, p, span, h1, h2, h3, h4")' in server
    assert "/crypto\\/trading experience|crypto.*trading.*experience/i.test(text)" in server
    assert 'document.querySelectorAll("textarea[required]")' in server
    assert "rect.top >= labelBottom - 4" in server
    assert "const nextQuestionTop = followingQuestions.length ? Math.min(...followingQuestions.map((item) => item.top)) : Number.POSITIVE_INFINITY;" in server
    assert "rect.top < nextQuestionTop - 4" in server
    assert "await tab.playwright.locator(selector).first().fill(String(value));" in server
    assert 'key: "crypto_trading_experience_locator_fill"' in ashby_runner
    assert ashby_runner.index('key: "post_upload_ashby_safe_known_facts"') < ashby_runner.index(
        'key: "crypto_trading_experience_locator_fill"'
    )
    assert ashby_runner.index('key: "crypto_trading_experience_locator_fill"') < ashby_runner.index(
        "const preSubmitReview = await captureAshbyPreSubmitReview"
    )
    assert "ok: await fillAshbyCryptoTradingExperienceWithLocator(tab, fields.cryptoTradingExperience)" in ashby_runner
    assert "fieldResults," in pre_submit_call


def test_ashby_recruiting_privacy_policy_consent_checked_before_pre_submit() -> None:
    server = BRIDGE_SERVER_PATH.read_text(encoding="utf-8")
    ashby_runner = server.split("async function runOfficialAshbyApplicationChromeExtension", 1)[1].split(
        "const OFFICIAL_JOB_ADAPTERS =",
        1,
    )[0]

    assert "async function checkAshbyRecruitingPrivacyConsent(tab)" in server
    assert 'document.querySelectorAll(\'input[type="checkbox"]\')' in server
    assert "privacy notice|candidate privacy|applicant privacy|personal information|personal data|data processing" in server
    assert "||\n          /cpra/i.test(text)" not in server
    assert "/i agree|acknowledge|read/i.test(text)" not in server
    assert "/i agree|privacy policy|recruiting privacy/i.test(text)" not in server
    assert "await tab.playwright.locator(selector).first().check({ timeout: 5000 });" in server
    assert "privacy_acknowledgement_user_authorized_auto_consent: true" in server
    assert 'key: "recruiting_privacy_policy_consent_checkbox"' in ashby_runner
    assert ashby_runner.index('key: "recruiting_privacy_policy_consent_checkbox"') < ashby_runner.index(
        "const preSubmitReview = await captureAshbyPreSubmitReview"
    )


def test_ashby_sponsorship_relocation_use_locator_click_before_pre_submit() -> None:
    server = BRIDGE_SERVER_PATH.read_text(encoding="utf-8")
    ashby_runner = server.split("async function runOfficialAshbyApplicationChromeExtension", 1)[1].split(
        "const OFFICIAL_JOB_ADAPTERS =",
        1,
    )[0]

    assert "async function clickAshbyFollowingQuestionChoiceWithLocator" in server
    assert '"visa_sponsorship_yes_locator_click"' in ashby_runner
    assert '"relocation_yes_locator_click"' in ashby_runner
    assert "await tab.cua.click({ x: prepared.click.x, y: prepared.click.y });" in server
    assert 'document.querySelectorAll("label, p, span, h1, h2, h3, h4")' in server
    assert 'const boundaryNodes = Array.from(document.querySelectorAll("label, p, span, div, h1, h2, h3, h4"));' in server
    assert "compareDocumentPosition" not in server.split("async function clickAshbyFollowingQuestionChoiceWithLocator", 1)[1].split(
        "async function uploadAshbyResume",
        1,
    )[0]
    assert "/^(do|are|is|if|what|please|have|can|will)\\b/i.test(text)" in server
    assert "const nextQuestionTop = followingQuestions.length ? Math.min(...followingQuestions) : Number.POSITIVE_INFINITY;" in server
    assert "rect.top >= labelRect.bottom - 4" in server
    assert "rect.top - labelRect.bottom <= 180" in server
    assert "rect.top < nextQuestionTop - 4" in server
    assert "const beforeCount = candidates.length;" in server
    assert "const added = candidates.slice(beforeCount);" in server
    assert "return choicePattern.test(text) && !/(^|\\b)(no|いいえ)(\\b|$)/i.test(text) && !rejectChoicePattern?.test(text);" in server
    assert "if (added.some((candidate) => visible(candidate) && isTargetChoice(candidate))) break;" in server
    assert "const choices = controlsFor(label).filter((candidate) => visible(candidate) && isTargetChoice(candidate));" in server
    assert "if (choices.length !== 1)" in server
    assert "following_question_choice_count_" in server
    assert "coordinate_following_question_choice" in server
    click_helper = server.split("async function clickAshbyFollowingQuestionChoiceWithLocator", 1)[1].split(
        "async function uploadAshbyResume",
        1,
    )[0]
    assert "setAttribute" not in click_helper
    assert "choice?.className" not in click_helper
    assert "const selectedByButtonClass = (element) => {" in click_helper
    assert '!/^(BUTTON|LABEL)$/i.test(element?.tagName || "")' in click_helper
    assert '!/(radio|checkbox|option)/i.test(element?.getAttribute?.("role") || "")' in click_helper
    assert "div[tabindex]" not in click_helper
    assert "span[tabindex]" not in click_helper
    assert "selectedByButtonClass(choice)" in click_helper
    assert "following_question_yes_choice_helper_requires_yes_pattern" in click_helper
    assert "choice_click_coordinates_outside_safe_viewport_after_scroll" in click_helper
    assert "choice_click_x_coordinates_outside_safe_viewport" in click_helper
    assert "choice.getAttribute?.(\"data-state\") === \"checked\"" in click_helper
    assert "verify_choice_count_" in click_helper
    assert 'const labels = Array.from(document.querySelectorAll("label, p, span, h1, h2, h3, h4"));' in click_helper
    assert 'const boundaryNodes = Array.from(document.querySelectorAll("label, p, span, div, h1, h2, h3, h4"));' in click_helper
    assert ").filter((control) => inQuestionBand(control) && isTargetChoice(control));" in click_helper
    assert "flatAshbySafeFactResults.some" in ashby_runner
    assert "visaSponsorshipChoice:" in server
    assert "fields.visaSponsorship" in server
    assert "relocationChoice:" in server
    assert "fields.relocation" in server
    assert '"visa_sponsorship_yes_safe_fact_explicit"' in server
    assert '"relocation_yes_safe_fact_explicit"' in server
    assert "explicit_yes_not_provided" in server
    assert 'const labels = Array.from(document.querySelectorAll("label, p, span, h1, h2, h3, h4"));' in server.split(
        "const chooseFollowingQuestionYes = (patterns, key) => {",
        1,
    )[1].split("const chooseFollowingQuestionNo = (patterns, key) => {", 1)[0]
    assert 'const labels = Array.from(document.querySelectorAll("label, p, span, h1, h2, h3, h4"));' in server.split(
        "const chooseFollowingQuestionNo = (patterns, key) => {",
        1,
    )[1].split("const chooseYesFor = (patterns, key) => {", 1)[0]
    sponsorship_block = server.split('if (/^yes$/i.test(String(safeValues.visaSponsorshipChoice || "").trim())) {', 1)[1].split(
        "} else {",
        1,
    )[0]
    relocation_block = server.split('if (/^yes$/i.test(String(safeValues.relocationChoice || "").trim())) {', 1)[1].split(
        "} else {",
        1,
    )[0]
    assert "chooseFollowingQuestionYes" not in sponsorship_block
    assert "chooseYesFor" not in sponsorship_block
    assert "chooseFollowingQuestionYes" not in relocation_block
    assert "chooseYesFor" not in relocation_block
    assert ashby_runner.index('"visa_sponsorship_yes_locator_click"') < ashby_runner.index(
        "const preSubmitReview = await captureAshbyPreSubmitReview"
    )
    assert ashby_runner.index('"relocation_yes_locator_click"') < ashby_runner.index(
        "const preSubmitReview = await captureAshbyPreSubmitReview"
    )


def test_trusted_bridge_has_platform_inbox_sweep_read_only_mode() -> None:
    server = BRIDGE_SERVER_PATH.read_text(encoding="utf-8")
    client = BRIDGE_CLIENT_PATH.read_text(encoding="utf-8")

    assert '"/platform-inbox-sweep"' in server
    assert 'mode === "platform-inbox-sweep"' in client
    assert "runPlatformInboxSweepChromeExtension" in server
    assert "capturePlatformInboxPage" in server
    assert "platformInboxSweepBlockerFor" in server
    assert "follow_up_platform_inbox_sweep_trusted_bridge_read_only" in server
    assert "read_only: true" in server
    assert "platform_inbox_user_action_or_auth_blocker_observed" in server
    assert "blocked_captcha_ready_for_user" in server
    assert "user_security_code_required" in server
    assert "assessment_required" in server
    assert "platformSweepArtifact" in server
    assert "platform-inbox-sweep" in client
    assert "platform-inbox-sweep" in server
    assert "platform-inbox-sweep" in server.split("function writeBridgeReceipt", 1)[1]


def test_platform_inbox_sweep_writes_valid_blocker_artifact_when_runtime_unavailable(tmp_path: Path) -> None:
    receipt_dir = tmp_path / "receipts"
    artifact_dir = tmp_path / "run"
    summary_path = artifact_dir / "platform-follow-up" / "platform-sweep-summary.json"
    script = """
      const { pathToFileURL } = await import("node:url");
      const serverUrl = pathToFileURL(process.argv[1]).href;
      const { startChromeExtensionTrustedBridge, stopChromeExtensionTrustedBridge } = await import(serverUrl);
      const port = Number.parseInt(process.argv[2], 10);
      const receiptDir = process.argv[3];
      const artifactDir = process.argv[4];
      const summaryPath = process.argv[5];
      const globals = {
        __platformInboxSweepRuntimeFactory: () => {
          throw new Error("browser_client_not_trusted_or_missing; safe_fallback=official_trusted_ats");
        }
      };
      const info = await startChromeExtensionTrustedBridge({ port, token: "test-token", globals });
      try {
        const response = await fetch(`${info.url}/platform-inbox-sweep`, {
          method: "POST",
          headers: {"content-type": "application/json", "x-social-flow-bridge-token": "test-token"},
          body: JSON.stringify({
            bridgeRunId: "platform-target-runtime-unavailable",
            runId: "codex-app-job-application-manager-20260626-platform-target-runtime-unavailable",
            receiptDir,
            artifactDir,
            platformSweepArtifact: summaryPath,
            runtimeSetupTimeoutMs: 250,
            targets: [{platform: "Green", company: "Example", url: "https://www.green-japan.com/messages/example"}]
          })
        });
        let receipt = null;
        for (let i = 0; i < 50; i += 1) {
          await new Promise((resolve) => setTimeout(resolve, 20));
          const poll = await fetch(`${info.url}/runs/platform-target-runtime-unavailable?receiptDir=${encodeURIComponent(receiptDir)}`, {
            headers: {"x-social-flow-bridge-token": "test-token"}
          });
          receipt = await poll.json();
          if (receipt.status === "succeeded" || receipt.status === "failed") break;
        }
        console.log(JSON.stringify({status: response.status, receipt}));
      } finally {
        await stopChromeExtensionTrustedBridge({ globals });
      }
    """
    server = HTTPServer(("127.0.0.1", 0), BaseHTTPRequestHandler)
    port = server.server_port
    server.server_close()

    result = subprocess.run(
        [
            "node",
            "--input-type=module",
            "-e",
            script,
            str(BRIDGE_SERVER_PATH),
            str(port),
            str(receipt_dir),
            str(artifact_dir),
            str(summary_path),
        ],
        check=False,
        text=True,
        capture_output=True,
    )

    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["status"] == 202
    assert payload["receipt"]["status"] == "succeeded"
    assert payload["receipt"]["result"]["platform_sweep_artifact"] == str(summary_path)
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    assert summary["platform_indications_present"] is True
    assert summary["exact_blocker"].startswith("trusted_chrome_runtime_unavailable:")
    assert not summary["exact_blocker"].startswith("trusted_chrome_runtime_unavailable: trusted_chrome_runtime_unavailable:")
    assert len(summary["items"]) == 1
    item = summary["items"][0]
    assert item["classification"] == "user_only_or_blocked"
    assert item["platform"] == "Green"
    assert item["company"] == "Example"
    assert item["message_url"] == "https://www.green-japan.com/messages/example"
    assert Path(item["artifact_uri"]).exists()


def test_platform_inbox_sweep_client_writes_blocker_artifact_when_bridge_absent(tmp_path: Path) -> None:
    artifact_dir = tmp_path / "run" / "platform-follow-up" / "trusted-bridge"
    summary_path = tmp_path / "run" / "platform-follow-up" / "platform-sweep-summary.json"
    payload = {
        "runId": "codex-app-job-application-manager-client-bridge-absent",
        "artifactDir": str(artifact_dir),
        "platformSweepArtifact": str(summary_path),
        "targets": [
            {
                "platform": "Green",
                "company": "Example",
                "message_url": "https://www.green-japan.com/messages/example",
            }
        ],
    }
    server = HTTPServer(("127.0.0.1", 0), BaseHTTPRequestHandler)
    base_url = f"http://127.0.0.1:{server.server_port}"
    server.server_close()

    result = subprocess.run(
        ["node", str(BRIDGE_CLIENT_PATH), "platform-inbox-sweep"],
        input=json.dumps(payload),
        check=False,
        text=True,
        capture_output=True,
        env={
            **os.environ,
            "SOCIAL_FLOW_CHROME_EXTENSION_BRIDGE_URL": base_url,
            "SOCIAL_FLOW_CHROME_EXTENSION_BRIDGE_CONNECT_ATTEMPTS": "1",
            "SOCIAL_FLOW_CHROME_EXTENSION_BRIDGE_CONNECT_RETRY_DELAY_MS": "10",
            "SOCIAL_FLOW_CHROME_EXTENSION_BRIDGE_FETCH_ATTEMPT_TIMEOUT_MS": "100",
            "SOCIAL_FLOW_CHROME_EXTENSION_BRIDGE_TIMEOUT_MS": "1000",
            "SOCIAL_FLOW_CHROME_EXTENSION_BRIDGE_POLL_INTERVAL_MS": "50",
        },
    )

    assert result.returncode == 0, result.stderr
    response = json.loads(result.stdout)
    assert response["platform_sweep_artifact"] == str(summary_path)
    assert response["item_count"] == 1
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    assert summary["platform_indications_present"] is True
    assert summary["exact_blocker"].startswith("trusted_chrome_runtime_unavailable:")
    item = summary["items"][0]
    assert item["classification"] == "user_only_or_blocked"
    assert item["platform"] == "Green"
    assert item["company"] == "Example"
    assert item["message_url"] == "https://www.green-japan.com/messages/example"
    assert Path(item["artifact_uri"]).exists()


def test_platform_inbox_sweep_target_parsing_accepts_snake_case_target_urls(tmp_path: Path) -> None:
    artifact_dir = tmp_path / "run"
    summary_path = artifact_dir / "platform-follow-up" / "platform-sweep-summary.json"
    script = """
      const { pathToFileURL } = await import("node:url");
      const serverUrl = pathToFileURL(process.argv[1]).href;
      const { runPlatformInboxSweepChromeExtension } = await import(serverUrl);
      const artifactDir = process.argv[2];
      const summaryPath = process.argv[3];
      const result = await runPlatformInboxSweepChromeExtension({
        payload: {
          runId: "codex-app-job-application-manager-snake-case-targets",
          artifactDir,
          platformSweepArtifact: summaryPath,
          runtimeSetupTimeoutMs: 250,
          targets: [
            {platform: "Green", company: "Thread", thread_url: "https://www.green-japan.com/messages/thread"},
            {platform: "Wantedly", company: "Message", message_url: "https://www.wantedly.com/messages/message"},
            {platform: "求人ボックス", company: "Target", target_url: "https://求人ボックス.com/my/message/R1-8667-8738-0998"}
          ]
        },
        globals: {
          __platformInboxSweepRuntimeFactory: () => {
            throw new Error("browser_client_not_trusted_or_missing; safe_fallback=official_trusted_ats");
          }
        },
        runId: "snake-case-targets",
        receiptPath: ""
      });
      console.log(JSON.stringify(result));
    """

    result = subprocess.run(
        [
            "node",
            "--input-type=module",
            "-e",
            script,
            str(BRIDGE_SERVER_PATH),
            str(artifact_dir),
            str(summary_path),
        ],
        check=False,
        text=True,
        capture_output=True,
    )

    assert result.returncode == 0, result.stderr
    response = json.loads(result.stdout)
    assert response["item_count"] == 3
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    assert [item["message_url"] for item in summary["items"]] == [
        "https://www.green-japan.com/messages/thread",
        "https://www.wantedly.com/messages/message",
        "https://求人ボックス.com/my/message/R1-8667-8738-0998",
    ]


def test_official_job_missing_workday_adapter_does_not_submit(tmp_path: Path) -> None:
    outcomes_path = tmp_path / "official-outcomes.jsonl"
    script = f"""
        import {{ detectOfficialAts, runOfficialJobApplicationChromeExtension }} from {json.dumps(str(BRIDGE_SERVER_PATH))};
        const payload = {{
          applicationUrl: "https://example.myworkdayjobs.com/example/job/123",
          company: "Example",
          role: "Marketing Manager",
          jobKey: "official-workday-example-123",
          outcomesJsonl: {json.dumps(str(outcomes_path))},
          autoSubmitFinal: true
        }};
        const result = await runOfficialJobApplicationChromeExtension({{
          payload,
          globals: {{}},
          runId: "missing-adapter-test",
          receiptPath: ""
        }});
        console.log(JSON.stringify({{ats: detectOfficialAts(payload), result}}));
    """
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        check=False,
        text=True,
        capture_output=True,
    )

    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["ats"] == "workday"
    assert payload["result"]["stop_reason"] == "official_job_adapter_missing"
    assert payload["result"]["submitted_confirmed_count"] == 0
    outcome = json.loads(outcomes_path.read_text(encoding="utf-8").strip())
    row = outcome["pipelineRow"]
    assert row["state"] == "needs_user_review"
    assert row["blocker_reason"] == "official_job_adapter_missing"
    assert row["job_id_or_canonical_key"] == "official-workday-example-123"


def test_official_job_lever_adapter_is_registered() -> None:
    server = BRIDGE_SERVER_PATH.read_text(encoding="utf-8")
    assert "runOfficialLeverApplicationChromeExtension" in server
    assert "lever: runOfficialLeverApplicationChromeExtension" in server
    assert "lever_required_fields_unfilled_before_submit" in server
    assert "autofillLeverKnownFactsWithLocators" in server
    assert 'name: "Nichika Tanaka"' in server
    assert 'email: "nichika2000823@gmail.com"' in server
    assert 'phone: "+81 90-8834-3768"' in server
    assert 'location: "Naha, Okinawa, Japan"' in server
    assert "setInputFiles([filePath], { timeout: 12000 })" in server
    assert "setInputFiles([filePath], { timeoutMs: 12000 })" not in server
    assert 'inputCount > 0 ? "lever_resume_direct_file_input_unavailable" : "lever_resume_upload_button_missing"' in server
    assert "priorApplicationAlreadyReceived" in server
    assert "prior_application_already_received" in server
    assert "Official Lever application submitted with verified completion text" in server


def test_official_job_accepts_job_url_alias_for_ats_detection() -> None:
    script = f"""
        import {{ detectOfficialAts }} from {json.dumps(str(BRIDGE_SERVER_PATH))};
        const checks = [
          detectOfficialAts({{ job_url: "https://jobs.ashbyhq.com/Cambly/example/application" }}) === "ashby",
          detectOfficialAts({{ job_url: "https://boards.greenhouse.io/example/jobs/123" }}) === "greenhouse",
          detectOfficialAts({{ job_url: "https://jobs.lever.co/example/123" }}) === "lever",
        ];
        if (checks.some((value) => !value)) process.exit(1);
    """
    subprocess.run(["node", "--input-type=module", "-e", script], check=True)


def test_official_job_reuses_current_task_group_first_and_claims_exact_open_tab_object() -> None:
    script = f"""
        import assert from "node:assert/strict";
        import {{ selectReusableChromeExtensionTab }} from {json.dumps(str(BRIDGE_SERVER_PATH))};

        const calls = [];
        const sameTaskGroupTab = {{
          id: "user-same-task-group",
          title: "Recruiting inbox",
          url: "https://jobs.example.com/apply/123",
          tabGroup: "求人応募管理",
          lastOpened: "2026-07-11T09:00:00.000Z",
        }};
        const exactUrlTab = {{
          id: "user-exact-url",
          title: "Application detail",
          url: "https://jobs.example.com/apply/123?view=details",
          tabGroup: "Other",
          lastOpened: "2026-07-11T09:05:00.000Z",
        }};
        const hostTab = {{
          id: "user-host",
          title: "Jobs board",
          url: "https://jobs.example.com/search",
          lastOpened: "2026-07-11T09:10:00.000Z",
        }};
        const taskTab = {{
          id: "user-task",
          title: "Official job application",
          url: "https://other.example.com/notes",
          lastOpened: "2026-07-11T09:15:00.000Z",
        }};
        const generalTab = {{
          id: "user-general",
          title: "General browser tab",
          url: "https://example.com/",
          lastOpened: "2026-07-11T09:20:00.000Z",
        }};

        let claimedTab = null;
        const browser = {{
          async nameSession(label) {{
            calls.push(["nameSession", label]);
          }},
          user: {{
            async openTabs() {{
              calls.push(["openTabs"]);
              return [sameTaskGroupTab, exactUrlTab, hostTab, taskTab, generalTab];
            }},
            async claimTab(tab) {{
              calls.push(["claimTab", tab]);
              claimedTab = tab;
              return {{ claimed: true, tab }};
            }},
          }},
          tabs: {{
            async list() {{
              calls.push(["tabs.list"]);
              return [];
            }},
            async get() {{
              calls.push(["tabs.get"]);
              throw new Error("tabs.get should not be called");
            }},
            async new() {{
              calls.push(["tabs.new"]);
              throw new Error("tabs.new should not be called");
            }},
            async selected() {{
              calls.push(["tabs.selected"]);
              throw new Error("tabs.selected should not be called");
            }},
          }},
        }};

        const result = await selectReusableChromeExtensionTab(browser, {{
          applicationUrl: "https://jobs.example.com/apply/123",
          taskName: "official job",
        }});

        assert.equal(calls[0][0], "nameSession");
        assert.equal(calls[0][1], "🧵 求人応募管理");
        assert.equal(calls[1][0], "openTabs");
        assert.equal(claimedTab, sameTaskGroupTab);
        assert.equal(calls.some(([name]) => name === "tabs.selected"), false);
        assert.equal(calls.some(([name]) => name === "tabs.get"), false);
        assert.equal(calls.filter(([name]) => name === "claimTab").length, 1);
        assert.equal(result.claimed, true);
        assert.equal(calls.findIndex(([name]) => name === "openTabs") < calls.findIndex(([name]) => name === "tabs.list"), true);
    """
    subprocess.run(["node", "--input-type=module", "-e", script], check=True)


def test_official_job_creates_blank_tab_when_no_reusable_tab_exists_and_registers_lifecycle() -> None:
    script = f"""
        import assert from "node:assert/strict";
        import {{ selectReusableChromeExtensionTab }} from {json.dumps(str(BRIDGE_SERVER_PATH))};

        const calls = [];
        const lifecycleCalls = [];
        const browser = {{
          async nameSession(label) {{
            calls.push(["nameSession", label]);
          }},
          __socialFlowChromeExtensionRequestLifecycle: {{
            async ensureSessionNamed() {{
              lifecycleCalls.push(["ensureSessionNamed"]);
            }},
            registerTab(tab, meta) {{
              lifecycleCalls.push(["registerTab", tab, meta]);
            }},
            keepTab(tab, status) {{
              lifecycleCalls.push(["keepTab", tab, status]);
            }},
          }},
          user: {{
            async openTabs() {{
              calls.push(["openTabs"]);
              return [];
            }},
            async claimTab(tab) {{
              calls.push(["claimTab", tab]);
              throw new Error("claimTab should not be called");
            }},
          }},
          tabs: {{
            async list() {{
              calls.push(["tabs.list"]);
              return [];
            }},
            async get(id) {{
              calls.push(["tabs.get", id]);
              throw new Error("tabs.get should not be called");
            }},
            async new() {{
              calls.push(["tabs.new"]);
              return {{ id: "created-tab", url: "about:blank" }};
            }},
            async selected() {{
              calls.push(["tabs.selected"]);
              throw new Error("tabs.selected should not be called");
            }},
          }},
        }};

        try {{
          const result = await selectReusableChromeExtensionTab(browser, {{
            taskName: "official job",
          }});
          assert.equal(result.id, "created-tab");
          assert.equal(calls.some(([name]) => name === "openTabs"), true);
          assert.equal(calls.some(([name]) => name === "tabs.list"), true);
          assert.equal(calls.some(([name]) => name === "tabs.new"), true);
          assert.equal(calls.some(([name]) => name === "claimTab"), false);
          assert.equal(calls.some(([name]) => name === "tabs.get"), false);
          assert.equal(calls.some(([name]) => name === "tabs.selected"), false);
          assert.equal(lifecycleCalls.some(([name]) => name === "ensureSessionNamed"), true);
          assert.equal(lifecycleCalls.some(([name]) => name === "registerTab"), true);
          assert.equal(lifecycleCalls.some(([name]) => name === "keepTab"), false);
        }} catch (error) {{
          assert.fail(String(error?.message || error));
        }}
    """
    subprocess.run(["node", "--input-type=module", "-e", script], check=True)


def test_iab_connect_reuses_selected_tab_and_registers_created_fallback_with_lifecycle() -> None:
    script = f"""
        import assert from "node:assert/strict";
        import {{ connectIab }} from {json.dumps(str(IAB_HELPERS_PATH))};

        const lifecycleCalls = [];
        const browser = {{
          async nameSession(label) {{
            lifecycleCalls.push(["nameSession", label]);
          }},
          tabs: {{
            async selected() {{
              lifecycleCalls.push(["tabs.selected"]);
              return null;
            }},
            async list() {{
              lifecycleCalls.push(["tabs.list"]);
              return [];
            }},
            async new() {{
              lifecycleCalls.push(["tabs.new"]);
              return {{ id: "iab-created", url: "about:blank" }};
            }},
          }},
        }};
        const globals = {{
          agent: {{}},
          browser,
          __socialFlowChromeExtensionRequestLifecycle: {{
            async ensureSessionNamed() {{
              lifecycleCalls.push(["ensureSessionNamed"]);
            }},
            registerTab(tab, meta) {{
              lifecycleCalls.push(["registerTab", tab, meta]);
            }},
            keepTab(tab, status) {{
              lifecycleCalls.push(["keepTab", tab, status]);
            }},
          }},
        }};

        const tab = await connectIab(globals, "Job applications");
        assert.equal(tab.id, "iab-created");
        assert.equal(lifecycleCalls.some(([name]) => name === "ensureSessionNamed"), true);
        assert.equal(lifecycleCalls.findIndex(([name]) => name === "tabs.new") > lifecycleCalls.findIndex(([name]) => name === "tabs.list"), true);
        assert.equal(lifecycleCalls.some(([name]) => name === "registerTab"), true);
    """
    subprocess.run(["node", "--input-type=module", "-e", script], check=True)


def test_official_job_reused_user_tab_is_not_closed_on_finalize() -> None:
    script = f"""
        import assert from "node:assert/strict";
        import {{ createChromeExtensionRequestLifecycle }} from {json.dumps(str(BRIDGE_SERVER_PATH))};

        const closeCalls = [];
        const lifecycle = createChromeExtensionRequestLifecycle({{}}, {{
          sessionName: "Official job application",
          taskName: "official job",
        }});
        const reusedUserTab = {{
          id: "reused-user-tab",
          url: "https://jobs.example.com/apply/123",
          close: async () => {{
            closeCalls.push("close");
          }},
        }};

        lifecycle.registerTab(reusedUserTab, {{ kind: "claimed", keep: false, status: "deliverable" }});
        const cleanup = await lifecycle.finalize();

        assert.equal(closeCalls.length, 0);
        assert.equal(cleanup.ok, true);
        assert.deepEqual(cleanup.claimed_tab_ids, ["reused-user-tab"]);
        assert.deepEqual(cleanup.closed_tab_ids, []);
        assert.deepEqual(cleanup.tabs_closed, []);
        assert.deepEqual(cleanup.tabs_kept, []);
        assert.deepEqual(cleanup.skipped_tab_ids, ["reused-user-tab"]);
        assert.equal(cleanup.cleanup_failed, false);
    """
    subprocess.run(["node", "--input-type=module", "-e", script], check=True)


def test_official_job_created_and_replacement_blank_tabs_are_closed_on_finalize() -> None:
    script = f"""
        import assert from "node:assert/strict";
        import {{ createChromeExtensionRequestLifecycle }} from {json.dumps(str(BRIDGE_SERVER_PATH))};

        const closeCalls = [];
        const lifecycle = createChromeExtensionRequestLifecycle({{}}, {{
          sessionName: "Official job application",
          taskName: "official job",
        }});
        const createdTab = {{
          id: "created-blank-tab",
          close: async () => {{
            closeCalls.push("created");
          }},
        }};
        const replacementTab = {{
          id: "replacement-blank-tab",
          playwright: {{
            close: async () => {{
              closeCalls.push("replacement");
            }},
          }},
        }};

        lifecycle.registerTab(createdTab, {{ kind: "created", keep: false, status: "handoff" }});
        lifecycle.registerTab(replacementTab, {{ kind: "replacement", keep: false, status: "handoff" }});
        const cleanup = await lifecycle.finalize();

        assert.deepEqual(closeCalls.sort(), ["created", "replacement"]);
        assert.equal(cleanup.ok, true);
        assert.deepEqual(cleanup.created_tab_ids, ["created-blank-tab"]);
        assert.deepEqual(cleanup.replacement_tab_ids, ["replacement-blank-tab"]);
        assert.deepEqual(cleanup.closed_tab_ids.sort(), ["created-blank-tab", "replacement-blank-tab"]);
        assert.deepEqual(cleanup.tabs_closed.sort(), ["created-blank-tab", "replacement-blank-tab"]);
        assert.equal(cleanup.cleanup_failed, false);
    """
    subprocess.run(["node", "--input-type=module", "-e", script], check=True)


def test_replace_poisoned_tab_keeps_reused_user_owned_tab_open() -> None:
    script = f"""
        import assert from "node:assert/strict";
        import {{ replacePoisonedTab }} from {json.dumps(str(RUNNER_PATH))};

        const lifecycleCalls = [];
        const lifecycle = {{
          keepTab(tab, status) {{
            lifecycleCalls.push(["keepTab", tab.id, status]);
          }},
          registerTab(tab, meta) {{
            lifecycleCalls.push(["registerTab", tab.id, meta]);
          }},
        }};
        const globals = {{
          browser: {{
            tabs: {{
              async new() {{
                return {{ id: "fresh-replacement-tab" }};
              }},
            }},
          }},
          __socialFlowChromeExtensionRequestLifecycle: lifecycle,
        }};
        const reusedUserTab = {{
          id: "reused-user-tab",
          __socialFlowChromeExtensionTabOwnership: "reused-existing",
          close: async () => {{
            throw new Error("reused user-owned tab should not be closed");
          }},
        }};

        const replacement = await replacePoisonedTab(globals, reusedUserTab);

        assert.equal(replacement.id, "fresh-replacement-tab");
        assert.deepEqual(lifecycleCalls, [
          ["keepTab", "reused-user-tab", "poisoned_reused_existing"],
          ["registerTab", "fresh-replacement-tab", {{ kind: "replacement", keep: false, status: "deliverable" }}],
        ]);
    """
    subprocess.run(["node", "--input-type=module", "-e", script], check=True)


def test_official_job_unrelated_user_tab_is_not_reused() -> None:
    script = f"""
        import assert from "node:assert/strict";
        import {{ selectReusableChromeExtensionTab }} from {json.dumps(str(BRIDGE_SERVER_PATH))};

        const calls = [];
        const unrelatedTab = {{
          id: "unrelated-user-tab",
          title: "Calendar",
          url: "https://calendar.example.com/week",
          lastOpened: "2026-07-11T09:00:00.000Z",
        }};
        const browser = {{
          async nameSession(label) {{
            calls.push(["nameSession", label]);
          }},
          user: {{
            async openTabs() {{
              calls.push(["openTabs"]);
              return [unrelatedTab];
            }},
            async claimTab(tab) {{
              calls.push(["claimTab", tab]);
              throw new Error("claimTab should not be called for unrelated tabs");
            }},
          }},
          tabs: {{
            async list() {{
              calls.push(["tabs.list"]);
              return [];
            }},
            async new() {{
              calls.push(["tabs.new"]);
              return {{ id: "created-blank-tab", url: "about:blank" }};
            }},
            async get(id) {{
              calls.push(["tabs.get", id]);
              throw new Error("tabs.get should not be called");
            }},
            async selected() {{
              calls.push(["tabs.selected"]);
              throw new Error("tabs.selected should not be called");
            }},
          }},
        }};

        const tab = await selectReusableChromeExtensionTab(browser, {{
          taskName: "official job",
        }});

        assert.equal(tab.id, "created-blank-tab");
        assert.equal(calls.some(([name]) => name === "claimTab"), false);
        assert.equal(calls.some(([name]) => name === "tabs.new"), true);
        assert.equal(calls.findIndex(([name]) => name === "openTabs") < calls.findIndex(([name]) => name === "tabs.new"), true);
    """
    subprocess.run(["node", "--input-type=module", "-e", script], check=True)


def test_official_job_cleanup_failure_is_recorded_on_finalize() -> None:
    script = f"""
        import assert from "node:assert/strict";
        import {{ createChromeExtensionRequestLifecycle }} from {json.dumps(str(BRIDGE_SERVER_PATH))};

        const lifecycle = createChromeExtensionRequestLifecycle({{}}, {{
          sessionName: "Official job application",
          taskName: "official job",
        }});
        const brokenTab = {{
          id: "broken-created-tab",
          close: async () => {{
            throw new Error("close failed");
          }},
        }};

        lifecycle.registerTab(brokenTab, {{ kind: "created", keep: false, status: "handoff" }});
        const cleanup = await lifecycle.finalize();

        assert.equal(cleanup.ok, false);
        assert.equal(cleanup.cleanup_failed, true);
        assert.deepEqual(cleanup.closed_tab_ids, []);
        assert.deepEqual(cleanup.close_failures, [{{ tab_id: "broken-created-tab" }}]);
        assert.deepEqual(cleanup.tabs_closed, []);
        assert.deepEqual(cleanup.tabs_kept, []);
    """
    subprocess.run(["node", "--input-type=module", "-e", script], check=True)


def test_trusted_bridge_concurrent_requests_keep_request_local_metadata(tmp_path: Path) -> None:
    script = """
      const { pathToFileURL } = await import("node:url");
      const { startChromeExtensionTrustedBridge, stopChromeExtensionTrustedBridge } = await import(pathToFileURL(process.argv[1]).href);
      const receiptDir = process.argv[2];
      const port = Number(process.argv[3]);
      const seen = [];
      const globals = {
        __socialFlowChromeExtensionBridgeRunners: {
          publish: async ({ codexTurnMetadata }) => {
            seen.push({ ...codexTurnMetadata });
            await new Promise((resolve) => setTimeout(resolve, 20));
            return { published: 0, skipped: 0, receipts: [] };
          }
        }
      };
      const info = await startChromeExtensionTrustedBridge({ port, token: "race-token", globals });
      const send = async (runId, sessionId, turnId) => fetch(`${info.url}/publish`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-social-flow-bridge-token": "race-token" },
        body: JSON.stringify({
          bridgeRunId: runId,
          receiptDir,
          queuePath: `${receiptDir}/${runId}.tsv`,
          session_id: sessionId,
          thread_id: sessionId,
          turn_id: turnId,
          codexThreadId: sessionId,
          codexSessionId: sessionId,
          codexTurnId: turnId
        })
      }).then((response) => response.json());
      const [first, second] = await Promise.all([
        send("first", "session-first", "turn-first"),
        send("second", "session-second", "turn-second")
      ]);
      const waitForDone = async (start) => {
        for (let i = 0; i < 100; i += 1) {
          const value = await fetch(`${info.url}/runs/${start.bridge_run_id}?receiptDir=${encodeURIComponent(receiptDir)}`, {
            headers: { "x-social-flow-bridge-token": "race-token" }
          }).then((response) => response.json());
          if (["succeeded", "failed"].includes(value.status)) return value;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        throw new Error("bridge jobs did not finish");
      };
      await Promise.all([waitForDone(first), waitForDone(second)]);
      await stopChromeExtensionTrustedBridge({ globals });
      console.log(JSON.stringify(seen));
    """
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as available:
        available.bind(("127.0.0.1", 0))
        port = available.getsockname()[1]
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script, str(BRIDGE_SERVER_PATH), str(tmp_path), str(port)],
        check=False,
        text=True,
        capture_output=True,
        timeout=30,
    )

    assert result.returncode == 0, result.stderr
    assert sorted(json.loads(result.stdout), key=lambda item: item["session_id"]) == [
        {
            "session_id": "session-first",
            "thread_id": "session-first",
            "thread_source": "bridge_payload",
            "turn_id": "turn-first",
        },
        {
            "session_id": "session-second",
            "thread_id": "session-second",
            "thread_source": "bridge_payload",
            "turn_id": "turn-second",
        },
    ]


def test_trusted_bridge_publish_and_engagement_runners_receive_request_local_metadata() -> None:
    publish_source = RUNNER_PATH.read_text(encoding="utf-8")
    engagement_source = ENGAGEMENT_RUNNER_PATH.read_text(encoding="utf-8")
    server_source = BRIDGE_SERVER_PATH.read_text(encoding="utf-8")

    assert "codexTurnMetadata = null" in publish_source
    assert "codexTurnMetadata = null" in engagement_source
    assert server_source.count("codexTurnMetadata,") >= 1
    assert "ensureNodeReplCodexTurnMetadata(payload);" not in server_source


def test_profile2_publish_and_engagement_runners_claim_exact_open_tab_object() -> None:
    publish_source = RUNNER_PATH.read_text(encoding="utf-8")
    engagement_source = ENGAGEMENT_RUNNER_PATH.read_text(encoding="utf-8")

    assert "claimTab(preferred)" in publish_source
    assert "claimTab(preferred.id)" not in publish_source
    assert "claimTab(preferred)" in engagement_source
    assert "claimTab(preferred.id)" not in engagement_source
    assert "return await handle.tabs.new();" not in publish_source
    assert "return await handle.tabs.new();" not in engagement_source


def test_official_cleanup_skips_non_agent_owned_tabs() -> None:
    source = BRIDGE_SERVER_PATH.read_text(encoding="utf-8")

    assert "__socialFlowChromeExtensionTabOwnership" in source
    assert "reused-existing" in source
    assert "cleanup_skipped_non_stale_tab" in source
    assert "agent-created" not in source


def test_profile2_runtime_does_not_recover_window_by_default(tmp_path: Path) -> None:
    plugin_root = tmp_path / "chrome-plugin"
    _write_browser_client(plugin_root, 'export async function setupBrowserRuntime() { throw new Error("unexpected setup"); }\n')
    script = """
      const { pathToFileURL } = await import("node:url");
      const { setupChromeExtensionProfile2Runtime } = await import(pathToFileURL(process.argv[1]).href);
      let reopened = 0;
      const globals = { agent: { browsers: { list: async () => [], get: async () => null } } };
      try {
        await setupChromeExtensionProfile2Runtime({
          pluginRoot: process.argv[2],
          globals,
          reopenProfile2Window: async () => { reopened += 1; }
        });
      } catch (error) {
        console.log(JSON.stringify({ reopened, error: String(error.message || error) }));
      }
    """
    result = _run_node_module(script, str(ENGAGEMENT_RUNNER_PATH), str(plugin_root))

    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["reopened"] == 0
    assert "profile2" in payload["error"].lower()


def test_profile2_runtime_requires_existing_browser_runtime_when_marked(tmp_path: Path) -> None:
    plugin_root = tmp_path / "chrome-plugin"
    _write_browser_client(plugin_root, 'export async function setupBrowserRuntime() { throw new Error("unexpected bootstrap"); }\n')
    script = """
      const { pathToFileURL } = await import("node:url");
      const runnerUrl = pathToFileURL(process.argv[1]).href;
      const { setupChromeExtensionProfile2Runtime } = await import(runnerUrl);
      try {
        await setupChromeExtensionProfile2Runtime({
          pluginRoot: process.argv[2],
          globals: { __socialFlowChromeExtensionRequireExistingBrowserRuntime: true }
        });
      } catch (error) {
        console.log(JSON.stringify({ error: String(error.message || error) }));
      }
    """
    result = _run_node_module(script, str(ENGAGEMENT_RUNNER_PATH), str(plugin_root))

    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["error"] == "trusted_bridge_must_be_started_in_codex_chrome_lane"


def test_profile2_runtime_recovery_uses_default_helper_when_profile2_is_missing() -> None:
    source = ENGAGEMENT_RUNNER_PATH.read_text(encoding="utf-8")

    assert "recoverProfile2Window = false" in source
    assert "recoverProfile2Window: true" in source
    assert "open-chrome-window.js" in source
    assert "reopenVisibleChromeProfile2WindowOnce" in source


def test_trusted_bridge_client_probe_never_opens_chrome_window_implicitly() -> None:
    source = BRIDGE_CLIENT_PATH.read_text(encoding="utf-8")

    assert "open-chrome-window.js" not in source
    assert "reopenVisibleChromeProfile2WindowOnce" not in source


def test_trusted_bridge_command_finalizes_running_receipt_before_shutdown(tmp_path: Path) -> None:
    queue_path = tmp_path / "posting_queue.tsv"
    receipt_dir = tmp_path / "receipts"
    _write_queue(
        queue_path,
        [
            {
                "id": "candidate",
                "status": "approved",
                "quality_score": "10",
                "keep_priority": "ship_now",
                "source_url": "https://example.com/source",
                "media_plan": "X本文+URL型",
                "x_text": "copy https://example.com/source",
                "review_notes": "Local automation profile publish candidate",
            }
        ],
    )
    server = HTTPServer(("127.0.0.1", 0), BaseHTTPRequestHandler)
    port = server.server_port
    server.server_close()
    script = """
      const { pathToFileURL } = await import("node:url");
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const serverUrl = pathToFileURL(process.argv[1]).href;
      const { runChromeExtensionTrustedBridgeCommand } = await import(serverUrl);
      const port = Number.parseInt(process.argv[2], 10);
      const queuePath = process.argv[3];
      const receiptDir = process.argv[4];
      const childCode = `
        const response = await fetch(process.env.SOCIAL_FLOW_CHROME_EXTENSION_BRIDGE_URL + "/publish", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-social-flow-bridge-token": process.env.SOCIAL_FLOW_CHROME_EXTENSION_BRIDGE_TOKEN
          },
          body: JSON.stringify({
            queuePath: process.env.TEST_QUEUE_PATH,
            maxActions: 1,
            allowWithoutBusy: true,
            bridgeRunId: "runtime-boundary-test",
            receiptDir: process.env.TEST_RECEIPT_DIR,
            candidateIds: ["candidate"]
          })
        });
        if (response.status !== 202) process.exitCode = 2;
        console.log(await response.text());
      `;
      const globals = {
        __socialFlowChromeExtensionBridgeRunners: {
          publish: async () => {
            await new Promise((resolve) => {
              const timer = setTimeout(resolve, 10000);
              if (timer.unref) timer.unref();
            });
            return {backend: "chrome_extension_profile2_fallback", published: 1, skipped: 0, receipts: []};
          }
        }
      };
      const result = await runChromeExtensionTrustedBridgeCommand({
        command: ["node", "--input-type=module", "-e", childCode],
        port,
        token: "test-token",
        globals,
        env: {
          SOCIAL_FLOW_CHROME_EXTENSION_BRIDGE_STOP_GRACE_MS: "20",
          TEST_QUEUE_PATH: queuePath,
          TEST_RECEIPT_DIR: receiptDir
        }
      });
      const receiptPath = path.join(receiptDir, "runtime-boundary-test.json");
      const receipt = JSON.parse(await fs.readFile(receiptPath, "utf8"));
      console.log(JSON.stringify({result: {ok: result.ok, code: result.code}, receipt}));
    """
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script, str(BRIDGE_SERVER_PATH), str(port), str(queue_path), str(receipt_dir)],
        check=False,
        text=True,
        capture_output=True,
    )

    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["result"] == {"ok": True, "code": 0}
    receipt = payload["receipt"]
    assert receipt["status"] == "failed"
    assert receipt["ok"] is False
    assert "trusted_runner_bridge_runtime_boundary" in receipt["stop_reason"]
    assert receipt["candidate_ids"] == ["candidate"]


def test_trusted_bridge_command_passes_stdin_payload() -> None:
    script = """
      const { pathToFileURL } = await import("node:url");
      const serverUrl = pathToFileURL(process.argv[1]).href;
      const { runChromeExtensionTrustedBridgeCommand } = await import(serverUrl);
      const childCode = `
        const chunks = [];
        for await (const chunk of process.stdin) chunks.push(chunk);
        process.stdout.write(Buffer.concat(chunks).toString("utf8"));
      `;
      const result = await runChromeExtensionTrustedBridgeCommand({
        command: ["node", "--input-type=module", "-e", childCode],
        input: JSON.stringify({company: "Forma", mode: "official-job"})
      });
      console.log(JSON.stringify({ok: result.ok, stdout: result.stdout}));
    """
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script, str(BRIDGE_SERVER_PATH)],
        check=False,
        text=True,
        capture_output=True,
    )

    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["ok"] is True
    echoed = json.loads(payload["stdout"])
    assert echoed["company"] == "Forma"
    assert echoed["mode"] == "official-job"


def test_official_job_ashby_defaults_safe_known_english_fields() -> None:
    source = BRIDGE_SERVER_PATH.read_text(encoding="utf-8")

    assert 'name: "Nichika Tanaka"' in source
    assert 'email: payload.contactEmail || "nichika2000823@gmail.com"' in source
    assert 'phone: "+81 90-8834-3768"' in source
    assert 'location: "Naha, Okinawa, Japan"' in source
    assert 'linkedin: "https://www.linkedin.com/in/nichika-tanaka-471693226/"' in source
    assert 'key: `${key}_label`' in source
    assert 'key: "location_label"' in source
    assert "planning to work" in source


def test_lever_location_autofill_has_value_fallback_without_inputvalue_api() -> None:
    source = BRIDGE_SERVER_PATH.read_text(encoding="utf-8")

    assert 'const readLocatorValue = async (locator, selector = "") => {' in source
    assert 'typeof locator.inputValue === "function"' in source
    assert 'document.querySelector(sel)' in source
    assert 'element.dispatchEvent(new Event(eventName, { bubbles: true }))' in source


def test_trusted_bridge_server_passes_candidate_ids_as_publish_only_ids(tmp_path: Path) -> None:
    receipt_dir = tmp_path / "receipts"
    server = HTTPServer(("127.0.0.1", 0), BaseHTTPRequestHandler)
    port = server.server_port
    server.server_close()
    script = """
      const { pathToFileURL } = await import("node:url");
      const serverUrl = pathToFileURL(process.argv[1]).href;
      const { startChromeExtensionTrustedBridge, stopChromeExtensionTrustedBridge } = await import(serverUrl);
      const port = Number.parseInt(process.argv[2], 10);
      const receiptDir = process.argv[3];
      const globals = {
        __socialFlowChromeExtensionBridgeRunners: {
          publish: async ({ onlyIds }) => ({
            backend: "chrome_extension_profile2_fallback",
            published: 0,
            skipped: 0,
            onlyIds,
            receipts: [],
          })
        }
      };
      const info = await startChromeExtensionTrustedBridge({ port, token: "test-token", globals });
      try {
        await fetch(`${info.url}/publish`, {
          method: "POST",
          headers: {"content-type": "application/json", "x-social-flow-bridge-token": "test-token"},
          body: JSON.stringify({
            queuePath: "posting_queue.tsv",
            maxActions: 3,
            allowWithoutBusy: true,
            bridgeRunId: "only-ids-test",
            receiptDir,
            candidateIds: ["a", "b"]
          })
        });
        let receipt = null;
        for (let attempt = 0; attempt < 50; attempt += 1) {
          const poll = await fetch(`${info.url}/runs/only-ids-test?receiptDir=${encodeURIComponent(receiptDir)}`, {
            headers: {"x-social-flow-bridge-token": "test-token"}
          });
          receipt = await poll.json();
          if (receipt.status === "succeeded" || receipt.status === "failed") break;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        console.log(JSON.stringify(receipt));
      } finally {
        await stopChromeExtensionTrustedBridge({ globals });
      }
    """
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script, str(BRIDGE_SERVER_PATH), str(port), str(receipt_dir)],
        check=False,
        text=True,
        capture_output=True,
    )

    assert result.returncode == 0, result.stderr
    receipt = json.loads(result.stdout)
    assert receipt["status"] == "succeeded"
    assert receipt["result"]["onlyIds"] == ["a", "b"]


def test_trusted_bridge_client_polls_receipt_after_accepted(tmp_path: Path) -> None:
    receipt_dir = tmp_path / "receipts"
    receipt_dir.mkdir()
    receipt_path = receipt_dir / "client-poll.json"
    seen: dict[str, object] = {"polls": 0}

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:  # noqa: N802
            self.rfile.read(int(self.headers.get("content-length", "0")))
            self.send_response(202)
            self.send_header("content-type", "application/json")
            self.end_headers()
            self.wfile.write(
                json.dumps(
                    {
                        "ok": True,
                        "status": "running",
                        "bridge_run_id": "client-poll",
                        "bridge_receipt_path": str(receipt_path),
                        "receipt_dir": str(receipt_dir),
                    }
                ).encode("utf-8")
                + b"\n"
            )

        def do_GET(self) -> None:  # noqa: N802
            seen["polls"] = int(seen["polls"]) + 1
            status = "running" if int(seen["polls"]) == 1 else "succeeded"
            payload = {
                "ok": status == "succeeded",
                "status": status,
                "receipt_path": str(receipt_path),
                "result": {"published": 1, "skipped": 0, "receipts": [{"id": "candidate"}]},
            }
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(payload).encode("utf-8") + b"\n")

        def log_message(self, format: str, *args: object) -> None:
            return

    server = HTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    result = subprocess.run(
        ["node", str(BRIDGE_CLIENT_PATH), "publish"],
        input=json.dumps({"queuePath": "/tmp/queue.tsv"}),
        text=True,
        capture_output=True,
        check=False,
        env={
            **os.environ,
            "SOCIAL_FLOW_CHROME_EXTENSION_BRIDGE_URL": f"http://127.0.0.1:{server.server_port}",
            "SOCIAL_FLOW_CHROME_EXTENSION_BRIDGE_POLL_SECONDS": "2",
            "SOCIAL_FLOW_CHROME_EXTENSION_BRIDGE_POLL_INTERVAL_MS": "20",
        },
    )
    server.shutdown()
    thread.join(timeout=5)
    server.server_close()

    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["published"] == 1
    assert payload["bridge_run_id"] == "client-poll"
    assert payload["bridge_receipt_path"] == str(receipt_path)
    assert int(seen["polls"]) >= 2


def test_trusted_bridge_client_preserves_trusted_runtime_failure_prefix(tmp_path: Path) -> None:
    receipt_dir = tmp_path / "receipts"
    receipt_dir.mkdir()
    receipt_path = receipt_dir / "client-runtime-failed.json"

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:  # noqa: N802
            self.rfile.read(int(self.headers.get("content-length", "0")))
            self.send_response(202)
            self.send_header("content-type", "application/json")
            self.end_headers()
            self.wfile.write(
                json.dumps(
                    {
                        "ok": True,
                        "status": "running",
                        "bridge_run_id": "client-runtime-failed",
                        "bridge_receipt_path": str(receipt_path),
                        "receipt_dir": str(receipt_dir),
                    }
                ).encode("utf-8")
                + b"\n"
            )

        def do_GET(self) -> None:  # noqa: N802
            payload = {
                "ok": False,
                "status": "failed",
                "receipt_path": str(receipt_path),
                "error": (
                    "trusted_chrome_runtime_unavailable: chrome_extension_runtime_unavailable: "
                    "browser_client_not_trusted_or_missing; safe_fallback=official_trusted_ats"
                ),
            }
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(payload).encode("utf-8") + b"\n")

        def log_message(self, format: str, *args: object) -> None:
            return

    server = HTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    artifact_dir = tmp_path / "job-runtime-fallback"
    result = subprocess.run(
        ["node", str(BRIDGE_CLIENT_PATH), "job"],
        input=json.dumps({"queuePath": "/tmp/queue.tsv", "runId": "client-runtime-failed", "artifactDir": str(artifact_dir)}),
        text=True,
        capture_output=True,
        check=False,
        env={
            **os.environ,
            "SOCIAL_FLOW_CHROME_EXTENSION_BRIDGE_URL": f"http://127.0.0.1:{server.server_port}",
            "SOCIAL_FLOW_CHROME_EXTENSION_BRIDGE_POLL_SECONDS": "2",
            "SOCIAL_FLOW_CHROME_EXTENSION_BRIDGE_POLL_INTERVAL_MS": "20",
        },
    )
    server.shutdown()
    thread.join(timeout=5)
    server.server_close()

    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["ok"] is False
    assert payload["stop_reason"] == "trusted_runner_bridge_unavailable_before_job_artifact"
    assert payload["exact_blocker"].startswith("trusted_chrome_runtime_unavailable")
    assert "browser_client_not_trusted_or_missing" in payload["exact_blocker"]
    assert "safe_fallback=official_trusted_ats" in payload["exact_blocker"]
    assert Path(payload["artifact_uri"]).exists()


def test_trusted_bridge_probe_unavailable_writes_diagnostic_artifact_and_exits(tmp_path: Path) -> None:
    artifact_dir = tmp_path / "bridge-probe"
    result = subprocess.run(
        ["node", str(BRIDGE_CLIENT_PATH), "probe"],
        input=json.dumps({"runId": "probe-unavailable", "artifactDir": str(artifact_dir)}),
        text=True,
        capture_output=True,
        check=False,
        timeout=10,
        env={
            **os.environ,
            "SOCIAL_FLOW_CHROME_EXTENSION_BRIDGE_URL": "http://127.0.0.1:9",
            "SOCIAL_FLOW_CHROME_EXTENSION_BRIDGE_TIMEOUT_MS": "600",
            "SOCIAL_FLOW_CHROME_EXTENSION_BRIDGE_POLL_INTERVAL_MS": "50",
            "SOCIAL_FLOW_CHROME_EXTENSION_BRIDGE_CONNECT_RETRY_DELAY_MS": "10",
        },
    )

    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["ok"] is False
    assert payload["ready"] is False
    assert payload["stop_reason"] == "trusted_runner_bridge_unavailable_before_probe_artifact"
    assert payload["exact_blocker"] == "trusted_bridge_must_be_started_in_codex_chrome_lane"
    assert payload["failure_category"] in {
        "bridge_endpoint_not_listening",
        "bridge_fetch_failed_unknown_network",
        "bridge_request_timeout_or_aborted",
    }
    artifact_path = Path(payload["artifact_uri"])
    assert artifact_path.exists()
    artifact = json.loads(artifact_path.read_text(encoding="utf-8"))
    assert artifact["bridge_url"] == "http://127.0.0.1:9"
    assert artifact["failure_category"] == payload["failure_category"]
    assert artifact["exact_blocker"] == "trusted_bridge_must_be_started_in_codex_chrome_lane"
    assert artifact["external_action_count"] == 0
    assert payload["external_action_count"] == 0


def test_trusted_bridge_probe_hung_endpoint_times_out_with_artifact(tmp_path: Path) -> None:
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            if self.path != "/health":
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"ok":true,"backend":"chrome_extension_trusted_bridge"}\n')

        def do_POST(self) -> None:  # noqa: N802
            self.rfile.read(int(self.headers.get("content-length", "0")))
            time.sleep(2)

        def log_message(self, format: str, *args: object) -> None:
            return

    server = HTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    artifact_dir = tmp_path / "bridge-probe-hung"
    result = subprocess.run(
        ["node", str(BRIDGE_CLIENT_PATH), "probe"],
        input=json.dumps({"runId": "probe-hung", "artifactDir": str(artifact_dir)}),
        text=True,
        capture_output=True,
        check=False,
        timeout=10,
        env={
            **os.environ,
            "SOCIAL_FLOW_CHROME_EXTENSION_BRIDGE_URL": f"http://127.0.0.1:{server.server_port}",
            "SOCIAL_FLOW_CHROME_EXTENSION_BRIDGE_TIMEOUT_MS": "1000",
            "SOCIAL_FLOW_CHROME_EXTENSION_BRIDGE_FETCH_ATTEMPT_TIMEOUT_MS": "100",
            "SOCIAL_FLOW_CHROME_EXTENSION_BRIDGE_POLL_INTERVAL_MS": "50",
            "SOCIAL_FLOW_CHROME_EXTENSION_BRIDGE_CONNECT_RETRY_DELAY_MS": "10",
        },
    )
    server.shutdown()
    thread.join(timeout=5)
    server.server_close()

    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["ok"] is False
    assert payload["stop_reason"] == "trusted_runner_bridge_unavailable_before_probe_artifact"
    assert payload["failure_category"] == "bridge_request_timeout_or_aborted"
    artifact = json.loads(Path(payload["artifact_uri"]).read_text(encoding="utf-8"))
    assert artifact["failure_category"] == "bridge_request_timeout_or_aborted"
    assert "category=bridge_request_timeout_or_aborted" in artifact["exact_blocker"]


def test_trusted_bridge_client_probe_checks_health_before_probe_endpoint(tmp_path: Path) -> None:
    seen: list[str] = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            seen.append(self.path)
            if self.path != "/health":
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"ok":true,"backend":"chrome_extension_trusted_bridge"}\n')

        def do_POST(self) -> None:  # noqa: N802
            seen.append(self.path)
            body = self.rfile.read(int(self.headers.get("content-length", "0")))
            payload = json.loads(body.decode("utf-8") or "{}")
            assert payload["runId"] == "probe-run"
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.end_headers()
            self.wfile.write(
                b'{"ok":true,"ready":true,"stage":"job_manager_bridge_readiness_probe","bridge_run_id":"probe-run","bridge_receipt_path":"probe.json"}\n'
            )

        def log_message(self, format: str, *args: object) -> None:
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    result = subprocess.run(
        ["node", str(BRIDGE_CLIENT_PATH), "probe"],
        input=json.dumps({"runId": "probe-run", "artifactDir": str(tmp_path / "probe-artifacts")}),
        text=True,
        capture_output=True,
        check=False,
        env={
            **os.environ,
            "SOCIAL_FLOW_CHROME_EXTENSION_BRIDGE_URL": f"http://127.0.0.1:{server.server_port}",
            "SOCIAL_FLOW_CHROME_EXTENSION_BRIDGE_TOKEN": "test-token",
        },
    )
    server.shutdown()
    thread.join(timeout=5)
    server.server_close()

    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout)["ready"] is True
    assert seen == ["/health", "/probe"]


def test_trusted_bridge_client_default_poll_window_covers_publish_completion() -> None:
    source = BRIDGE_CLIENT_PATH.read_text(encoding="utf-8")

    assert 'mode === "probe" ? "4" : "2"' in source
    assert 'mode === "official-job" || mode === "job" || mode === "platform-inbox-sweep" ? "900" : "180"' in source
    assert "Number.isFinite(pollSeconds) ? pollSeconds : 180" in source
    assert 'SOCIAL_FLOW_CHROME_EXTENSION_BRIDGE_CONNECT_ATTEMPTS || (mode === "probe" ? "4" : "2")' in source


def test_trusted_bridge_command_default_grace_matches_publish_poll_window() -> None:
    source = BRIDGE_SERVER_PATH.read_text(encoding="utf-8")

    assert 'commandText.includes("official-job") || commandText.includes("platform-inbox-sweep") || commandText.includes(" job")' in source


def _run_publish_runner_dry_run(queue_path: Path) -> subprocess.CompletedProcess[str]:
    script = """
      const { pathToFileURL } = await import("node:url");
      const runnerUrl = pathToFileURL(process.argv[1]).href;
      const { sendApprovedPublishCandidatesChromeExtension } = await import(runnerUrl);
      const laneResolution = {
        lane: "chrome_extension_profile2_fallback",
        fallback_allowed: true,
        lane_status: { busy: true },
        stop_reason: "local_automation_profile_busy"
      };
      const result = await sendApprovedPublishCandidatesChromeExtension({
        queuePath: process.argv[2],
        maxActions: 1,
        laneResolution,
        pluginRoot: "/definitely/missing/chrome/plugin",
        dryRun: true
      });
      console.log(JSON.stringify(result));
    """
    return subprocess.run(
        ["node", "--input-type=module", "-e", script, str(RUNNER_PATH), str(queue_path)],
        check=False,
        text=True,
        capture_output=True,
    )


def _run_link_reflection_check(snapshot: dict[str, list[str]], source_url: str) -> bool:
    script = """
      const { pathToFileURL } = await import("node:url");
      const runnerUrl = pathToFileURL(process.argv[1]).href;
      const { hasLinkedInLinkReflectionSnapshot } = await import(runnerUrl);
      const snapshot = JSON.parse(process.argv[2]);
      console.log(JSON.stringify({
        ok: hasLinkedInLinkReflectionSnapshot(snapshot, process.argv[3])
      }));
    """
    result = subprocess.run(
        [
            "node",
            "--input-type=module",
            "-e",
            script,
            str(RUNNER_PATH),
            json.dumps(snapshot),
            source_url,
        ],
        check=True,
        text=True,
        capture_output=True,
    )
    return bool(json.loads(result.stdout)["ok"])


def _run_link_reflection_dom_check(case_name: str, scope_text: str, source_url: str) -> dict[str, object]:
    script = """
      const { pathToFileURL } = await import("node:url");
      const runnerUrl = pathToFileURL(process.argv[1]).href;
      const { hasLinkedInLinkReflectionSnapshot, linkedInLinkReflectionSnapshot } = await import(runnerUrl);

      class FakeNode {
        constructor({ text = "", href = "", role = "", className = "", children = [], inEditor = false } = {}) {
          this.textContent = text;
          this.innerText = text;
          this.href = href;
          this.role = role;
          this.className = className;
          this.children = children;
          this.inEditor = inEditor;
        }
        getBoundingClientRect() {
          return { width: 240, height: 120 };
        }
        getAttribute(name) {
          if (name === "href") return this.href || null;
          if (name === "role") return this.role || null;
          if (name === "class") return this.className || null;
          return null;
        }
        closest(selector) {
          if (selector.includes("contenteditable") || selector.includes(".ql-editor")) {
            return this.inEditor ? this : null;
          }
          return null;
        }
        querySelectorAll(selector) {
          const all = [];
          const visit = (node) => {
            for (const child of node.children || []) {
              all.push(child);
              visit(child);
            }
          };
          visit(this);
          if (selector === "a[href]") return all.filter((node) => node.href);
          if (selector.includes("preview")) return all.filter((node) => node.className.includes("preview"));
          return [];
        }
      }
      class FakeLocator {
        constructor(nodes) {
          this.nodes = nodes.filter(Boolean);
        }
        async count() {
          return this.nodes.length;
        }
        nth(index) {
          return new FakeLocator([this.nodes[index]]);
        }
        async isVisible() {
          const rect = this.nodes[0]?.getBoundingClientRect?.();
          return Boolean(rect && rect.width > 0 && rect.height > 0);
        }
        async textContent() {
          const node = this.nodes[0];
          return node ? (node.innerText || node.textContent || "") : "";
        }
        async getAttribute(name) {
          return this.nodes[0]?.getAttribute?.(name) || "";
        }
        locator(selector) {
          return new FakeLocator(this.nodes.flatMap((node) => node.querySelectorAll(selector)));
        }
      }

      const sourceUrl = process.argv[4];
      const staleRoot = new FakeNode({
        text: `${process.argv[3]} OpenAI example preview openai.com`,
        role: "dialog",
        children: [
          new FakeNode({ href: sourceUrl }),
          new FakeNode({ text: "OpenAI example preview openai.com", className: "share-article-preview" }),
        ],
      });
      const activeRootWithoutPreview = new FakeNode({ text: process.argv[3], role: "dialog", children: [] });
      const activeRootWithPreview = new FakeNode({
        text: `${process.argv[3]} OpenAI example preview openai.com`,
        role: "dialog",
        children: [new FakeNode({ text: "OpenAI example preview openai.com", className: "share-article-preview" })],
      });
      const activeRoot = process.argv[2] === "active_preview"
        ? activeRootWithPreview
        : activeRootWithoutPreview;
      const roots = process.argv[2] === "stale_after"
        ? [activeRoot, staleRoot]
        : [staleRoot, activeRoot];
      globalThis.document = {
        querySelectorAll(selector) {
          if (selector === '[role="dialog"]') return roots;
          return [];
        },
      };
      const tab = {
        playwright: {
          evaluate: async (callback, expectedScopeText) => callback(expectedScopeText),
        },
      };
      const snapshot = await linkedInLinkReflectionSnapshot(tab, process.argv[3], new FakeLocator([activeRoot]));
      console.log(JSON.stringify({
        snapshot,
        ok: hasLinkedInLinkReflectionSnapshot(snapshot, sourceUrl),
      }));
    """
    result = subprocess.run(
        [
            "node",
            "--input-type=module",
            "-e",
            script,
            str(RUNNER_PATH),
            case_name,
            scope_text,
            source_url,
        ],
        check=True,
        text=True,
        capture_output=True,
    )
    return json.loads(result.stdout)


def _run_linkedin_reaction_state_snapshot() -> dict[str, str]:
    script = """
      const { pathToFileURL } = await import("node:url");
      const runnerUrl = pathToFileURL(process.argv[1]).href;
      const { linkedInReactionState } = await import(runnerUrl);
      class FakeButton {
        constructor() {
          this.innerText = "Like";
          this.textContent = "Like";
        }
        getBoundingClientRect() {
          return { width: 80, height: 32 };
        }
        getAttribute(name) {
          if (name === "aria-label") return "Reaction button state: no reaction";
          if (name === "aria-pressed") return "false";
          return null;
        }
      }
      globalThis.document = {
        querySelectorAll(selector) {
          if (selector.includes(":has-text")) {
            throw new Error(`invalid selector reached: ${selector}`);
          }
          if (selector === "button") return [new FakeButton()];
          return [];
        },
      };
      const tab = {
        playwright: {
          evaluate: async (callback) => callback(),
        },
      };
      console.log(JSON.stringify(await linkedInReactionState(tab)));
    """
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script, str(ENGAGEMENT_RUNNER_PATH)],
        check=True,
        text=True,
        capture_output=True,
    )
    return json.loads(result.stdout)


def _run_publish_state_update(function_name: str, row: dict[str, str], receipt: dict[str, str]) -> dict[str, str]:
    script = """
      const { pathToFileURL } = await import("node:url");
      const runnerUrl = pathToFileURL(process.argv[1]).href;
      const mod = await import(runnerUrl);
      const row = JSON.parse(process.argv[3]);
      const receipt = JSON.parse(process.argv[4]);
      mod[process.argv[2]](row, receipt);
      console.log(JSON.stringify(row));
    """
    result = subprocess.run(
        [
            "node",
            "--input-type=module",
            "-e",
            script,
            str(RUNNER_PATH),
            function_name,
            json.dumps(row),
            json.dumps(receipt),
        ],
        check=True,
        text=True,
        capture_output=True,
    )
    return dict(json.loads(result.stdout))


def _run_candidate_builder(rows: list[dict[str, str]], max_actions: int = 2) -> list[dict[str, str]]:
    script = """
      const { pathToFileURL } = await import("node:url");
      const runnerUrl = pathToFileURL(process.argv[1]).href;
      const { buildChromeExtensionPublishCandidates } = await import(runnerUrl);
      const rows = JSON.parse(process.argv[2]);
      const candidates = buildChromeExtensionPublishCandidates(rows, { maxActions: Number(process.argv[3]) });
      console.log(JSON.stringify(candidates.map((candidate) => ({
        id: candidate.row.id,
        platform: candidate.platform,
        surface: candidate.surface
      }))));
    """
    result = subprocess.run(
        [
            "node",
            "--input-type=module",
            "-e",
            script,
            str(RUNNER_PATH),
            json.dumps(rows),
            str(max_actions),
        ],
        check=True,
        text=True,
        capture_output=True,
    )
    return list(json.loads(result.stdout))


def _run_generated_media_receipt_validation(
    row: dict[str, str], platform: str, paths: list[str], receipt_text: str, date_token: str = "2026-06-01"
) -> dict[str, str]:
    script = """
      const { pathToFileURL } = await import("node:url");
      const runnerUrl = pathToFileURL(process.argv[1]).href;
      const { validateGeneratedMediaReceipt } = await import(runnerUrl);
      try {
        validateGeneratedMediaReceipt(
          JSON.parse(process.argv[2]),
          process.argv[3],
          JSON.parse(process.argv[4]),
          process.argv[5],
          process.argv[6]
        );
        console.log(JSON.stringify({ ok: true }));
      } catch (error) {
        console.log(JSON.stringify({ ok: false, error: String(error?.message || error) }));
      }
    """
    result = subprocess.run(
        [
            "node",
            "--input-type=module",
            "-e",
            script,
            str(RUNNER_PATH),
            json.dumps(row),
            platform,
            json.dumps(paths),
            receipt_text,
            date_token,
        ],
        check=True,
        text=True,
        capture_output=True,
    )
    return dict(json.loads(result.stdout))


def _run_generated_media_path_resolution(row: dict[str, str], platform: str, min_count: int = 1, max_count: int = 1) -> dict:
    script = """
      const { pathToFileURL } = await import("node:url");
      const runnerUrl = pathToFileURL(process.argv[1]).href;
      const { resolveGeneratedMediaPaths } = await import(runnerUrl);
      try {
        const paths = await resolveGeneratedMediaPaths(JSON.parse(process.argv[2]), {
          platform: process.argv[3],
          minCount: Number(process.argv[4]),
          maxCount: Number(process.argv[5])
        });
        console.log(JSON.stringify({ ok: true, paths }));
      } catch (error) {
        console.log(JSON.stringify({ ok: false, error: String(error?.message || error) }));
      }
    """
    result = subprocess.run(
        [
            "node",
            "--input-type=module",
            "-e",
            script,
            str(RUNNER_PATH),
            json.dumps(row),
            platform,
            str(min_count),
            str(max_count),
        ],
        check=True,
        text=True,
        capture_output=True,
    )
    return dict(json.loads(result.stdout))


def test_profile2_publish_runner_preserves_platform_for_dual_surface_row() -> None:
    candidates = _run_candidate_builder(
        [
            {
                "id": "dual-surface",
                "status": "approved",
                "quality_score": "10",
                "keep_priority": "ship_now",
                "source_url": "https://openai.com/index/example/",
                "media_plan": "X本文+URL型 | LinkedInリンクカード型",
                "x_text": "Valid X candidate https://openai.com/index/example/",
                "linkedin_text": "Valid LinkedIn candidate https://openai.com/index/example/",
                "review_notes": "Local automation profile publish candidate",
            }
        ]
    )

    assert candidates == [
        {"id": "dual-surface", "platform": "x", "surface": "X本文+URL型"},
        {"id": "dual-surface", "platform": "linkedin", "surface": "LinkedInリンクカード型"},
    ]


def test_profile2_publish_runner_uses_two_actions_for_same_dual_surface_row() -> None:
    rows = [
        {
            "id": "first-dual",
            "status": "approved",
            "quality_score": "10",
            "keep_priority": "ship_now",
            "source_url": "https://example.com/first",
            "media_plan": "X本文+URL型 | LinkedInリンクカード型",
            "x_text": "First X https://example.com/first",
            "linkedin_text": "First LinkedIn https://example.com/first",
            "review_notes": "Daily AI Browser Use-native publish candidate",
        },
        {
            "id": "second-dual",
            "status": "approved",
            "quality_score": "10",
            "keep_priority": "ship_now",
            "source_url": "https://example.com/second",
            "media_plan": "X本文+URL型 | LinkedInリンクカード型",
            "x_text": "Second X https://example.com/second",
            "linkedin_text": "Second LinkedIn https://example.com/second",
            "review_notes": "Daily AI Browser Use-native publish candidate",
        },
    ]

    candidates = _run_candidate_builder(rows, max_actions=2)

    assert candidates == [
        {"id": "first-dual", "platform": "x", "surface": "X本文+URL型"},
        {"id": "first-dual", "platform": "linkedin", "surface": "LinkedInリンクカード型"},
    ]


def test_profile2_publish_runner_prioritizes_missing_linkedin_for_partial_row() -> None:
    candidates = _run_candidate_builder(
        [
            {
                "id": "partial-linkedin",
                "status": "partially_published",
                "quality_score": "10",
                "keep_priority": "ship_now",
                "source_url": "https://example.com/partial",
                "media_plan": "X本文+URL型 | LinkedInリンクカード型",
                "x_text": "Already posted on X https://example.com/partial",
                "x_post_url": "https://x.com/nichika2000823/status/123",
                "x_published_at": "2026-06-03T18:32:07.534Z",
                "linkedin_text": "Missing LinkedIn https://example.com/partial",
                "review_notes": "Daily AI Browser Use-native publish candidate",
            },
            {
                "id": "new-dual",
                "status": "approved",
                "quality_score": "10",
                "keep_priority": "ship_now",
                "source_url": "https://example.com/new",
                "media_plan": "X本文+URL型 | LinkedInリンクカード型",
                "x_text": "New X https://example.com/new",
                "linkedin_text": "New LinkedIn https://example.com/new",
                "review_notes": "Daily AI Browser Use-native publish candidate",
            },
        ],
        max_actions=2,
    )

    assert candidates == [
        {"id": "partial-linkedin", "platform": "linkedin", "surface": "LinkedInリンクカード型"},
    ]


def test_profile2_publish_runner_treats_x_source_link_card_as_text_url_surface() -> None:
    candidates = _run_candidate_builder(
        [
            {
                "id": "x-source-link-card",
                "status": "approved",
                "quality_score": "10",
                "keep_priority": "ship_now",
                "source_url": "https://aws.amazon.com/blogs/machine-learning/example/",
                "media_plan": "X uses x_source_link_card with the official source URL",
                "x_text": "Source-specific copy https://aws.amazon.com/blogs/machine-learning/example/",
                "review_notes": "Local automation profile publish candidate",
            }
        ]
    )

    assert candidates == [
        {"id": "x-source-link-card", "platform": "x", "surface": "X本文+URL型"},
    ]


def test_profile2_publish_runner_blocks_x_source_link_card_for_demo_breakdown() -> None:
    candidates = _run_candidate_builder(
        [
            {
                "id": "blocked-source-link-card",
                "status": "approved",
                "quality_score": "10",
                "keep_priority": "ship_now",
                "content_format": "official_demo_breakdown",
                "source_url": "https://aws.amazon.com/blogs/machine-learning/example/",
                "media_plan": "X uses x_source_link_card with the official source URL",
                "x_text": "Source-specific copy https://aws.amazon.com/blogs/machine-learning/example/",
                "review_notes": "Local automation profile publish candidate",
            }
        ]
    )

    assert candidates == []


def test_profile2_publish_runner_builds_all_named_surface_candidates() -> None:
    candidates = _run_candidate_builder(
        [
            {
                "id": "x-text-url",
                "status": "approved",
                "quality_score": "10",
                "keep_priority": "ship_now",
                "source_url": "https://example.com/a",
                "media_plan": "X本文+URL型",
                "x_text": "X text https://example.com/a",
                "review_notes": "Local automation profile publish candidate",
            },
            {
                "id": "x-self-card",
                "status": "approved",
                "quality_score": "10",
                "keep_priority": "ship_now",
                "source_url": "https://example.com/b",
                "media_plan": "X自作判断カード型",
                "x_text": "X card body",
                "review_notes": "Local automation profile publish candidate",
            },
            {
                "id": "x-quote-card",
                "status": "approved",
                "quality_score": "10",
                "keep_priority": "ship_now",
                "source_url": "https://example.com/c",
                "media_plan": "X引用解釈カード型",
                "x_text": "X quote body",
                "review_notes": "Local automation profile publish candidate",
            },
            {
                "id": "linkedin-link",
                "status": "approved",
                "quality_score": "10",
                "keep_priority": "ship_now",
                "source_url": "https://example.com/d",
                "media_plan": "LinkedInリンクカード型",
                "linkedin_text": "LinkedIn link https://example.com/d",
                "review_notes": "Local automation profile publish candidate",
            },
            {
                "id": "linkedin-square",
                "status": "approved",
                "quality_score": "10",
                "keep_priority": "ship_now",
                "source_url": "https://example.com/e",
                "media_plan": "LinkedIn正方形1枚画像型",
                "linkedin_text": "LinkedIn square https://example.com/e",
                "review_notes": "Local automation profile publish candidate",
            },
            {
                "id": "linkedin-carousel",
                "status": "approved",
                "quality_score": "10",
                "keep_priority": "ship_now",
                "source_url": "https://example.com/f",
                "media_plan": "LinkedInカルーセル型",
                "linkedin_text": "LinkedIn carousel https://example.com/f",
                "review_notes": "Local automation profile publish candidate",
            },
        ],
        max_actions=10,
    )

    assert candidates == [
        {"id": "x-text-url", "platform": "x", "surface": "X本文+URL型"},
        {"id": "x-self-card", "platform": "x", "surface": "X自作判断カード型"},
        {"id": "x-quote-card", "platform": "x", "surface": "X引用解釈カード型"},
        {"id": "linkedin-link", "platform": "linkedin", "surface": "LinkedInリンクカード型"},
        {"id": "linkedin-square", "platform": "linkedin", "surface": "LinkedIn正方形1枚画像型"},
        {"id": "linkedin-carousel", "platform": "linkedin", "surface": "LinkedInカルーセル型"},
    ]


def test_daily_ai_direct_builder_skips_hold_surface_blocked_linkedin_candidate() -> None:
    candidates = _run_candidate_builder(
        [
            {
                "id": "linkedin-square-held",
                "status": "drafted",
                "review_status": "hold",
                "quality_score": "10",
                "keep_priority": "ship_now",
                "source_url": "https://example.com/e",
                "media_plan": "LinkedIn正方形1枚画像型",
                "linkedin_text": "LinkedIn square https://example.com/e",
                "review_notes": "Daily AI Browser Use-native publish candidate | Surface contract incomplete before publish",
                "error": "surface_missing: direct_cli_linkedin_surface_not_enabled:linkedin_square_image",
                "next_action": "Hold before publishing: posting surface is not ready.",
            }
        ],
        max_actions=10,
    )

    assert candidates == []


def test_profile2_publish_runner_requires_x_generated_media_japanese_receipt() -> None:
    path = "/tmp/artifacts/generated-media/2026-06-01-x-card-x-decision.png"
    valid = _run_generated_media_receipt_validation(
        {"id": "x-card"},
        "x",
        [path],
        f"{path} platform=x model=gpt-image-2 size=1024x1024 visual_style=decision_card language=ja prompt=日本語の判断カード",
    )
    invalid = _run_generated_media_receipt_validation(
        {"id": "x-card"},
        "x",
        [path],
        f"{path} platform=x model=gpt-image-2 size=1024x1024 visual_style=decision_card language=en prompt=English card",
    )

    assert valid == {"ok": True}
    assert invalid["ok"] is False
    assert "generated_media_language_ja_missing" in invalid["error"]


def test_profile2_publish_runner_requires_linkedin_generated_media_english_receipt() -> None:
    path = "/tmp/artifacts/generated-media/2026-06-01-li-card-linkedin-square.png"
    valid = _run_generated_media_receipt_validation(
        {"id": "li-card"},
        "linkedin",
        [path],
        f"{path} platform=linkedin model=gpt-image-2 size=1024x1024 visual_style=comparison_card language=en prompt=English explanatory image",
    )
    invalid = _run_generated_media_receipt_validation(
        {"id": "li-card"},
        "linkedin",
        [path],
        f"{path} platform=linkedin model=gpt-image-2 size=1024x1024 visual_style=comparison_card language=ja prompt=日本語画像",
    )

    assert valid == {"ok": True}
    assert invalid["ok"] is False
    assert "generated_media_language_en_missing" in invalid["error"]


def test_profile2_publish_runner_requires_explicit_language_field() -> None:
    path = "/tmp/artifacts/generated-media/2026-06-01-li-card-linkedin-square.png"
    result = _run_generated_media_receipt_validation(
        {"id": "li-card"},
        "linkedin",
        [path],
        f"{path} platform=linkedin model=gpt-image-2 size=1024x1024 visual_style=comparison_card prompt=English explanatory image",
    )

    assert result["ok"] is False
    assert "generated_media_language_en_missing" in result["error"]


def test_profile2_publish_runner_rejects_blank_generated_media_prompt() -> None:
    path = "/tmp/artifacts/generated-media/2026-06-01-li-card-linkedin-square.png"
    result = _run_generated_media_receipt_validation(
        {"id": "li-card"},
        "linkedin",
        [path],
        f"{path} platform=linkedin model=gpt-image-2 size=1024x1024 visual_style=comparison_card language=en prompt=",
    )

    assert result["ok"] is False
    assert "generated_media_prompt_missing" in result["error"]


def test_profile2_publish_runner_rejects_blank_prompt_before_next_field() -> None:
    path = "/tmp/artifacts/generated-media/2026-06-01-li-card-linkedin-square.png"
    result = _run_generated_media_receipt_validation(
        {"id": "li-card"},
        "linkedin",
        [path],
        f"{path} platform=linkedin model=gpt-image-2 size=1024x1024 visual_style=comparison_card prompt= language=en",
    )

    assert result["ok"] is False
    assert "generated_media_prompt_missing" in result["error"]


def test_profile2_publish_runner_checks_prompt_language_matches_platform() -> None:
    x_path = "/tmp/artifacts/generated-media/2026-06-01-x-card-x-decision.png"
    linkedin_path = "/tmp/artifacts/generated-media/2026-06-01-li-card-linkedin-square.png"
    x_result = _run_generated_media_receipt_validation(
        {"id": "x-card"},
        "x",
        [x_path],
        f"{x_path} platform=x model=gpt-image-2 size=1024x1024 visual_style=decision_card language=ja prompt=English decision card",
    )
    linkedin_result = _run_generated_media_receipt_validation(
        {"id": "li-card"},
        "linkedin",
        [linkedin_path],
        f"{linkedin_path} platform=linkedin model=gpt-image-2 size=1024x1024 visual_style=comparison_card language=en prompt=日本語画像",
    )

    assert x_result["ok"] is False
    assert "generated_media_prompt_ja_missing" in x_result["error"]
    assert linkedin_result["ok"] is False
    assert "generated_media_prompt_en_missing" in linkedin_result["error"]


def test_profile2_publish_runner_rejects_mixed_prompt_language_shortcuts() -> None:
    x_path = "/tmp/artifacts/generated-media/2026-06-01-x-card-x-decision.png"
    linkedin_path = "/tmp/artifacts/generated-media/2026-06-01-li-card-linkedin-square.png"
    x_result = _run_generated_media_receipt_validation(
        {"id": "x-card"},
        "x",
        [x_path],
        f"{x_path} platform=x model=gpt-image-2 size=1024x1024 visual_style=decision_card language=ja prompt=English decision card 日本語",
    )
    linkedin_result = _run_generated_media_receipt_validation(
        {"id": "li-card"},
        "linkedin",
        [linkedin_path],
        f"{linkedin_path} platform=linkedin model=gpt-image-2 size=1024x1024 visual_style=comparison_card language=en prompt=AI比較カード",
    )

    assert x_result["ok"] is False
    assert "generated_media_prompt_ja_missing" in x_result["error"]
    assert linkedin_result["ok"] is False
    assert "generated_media_prompt_en_missing" in linkedin_result["error"]


def test_profile2_publish_runner_requires_generated_media_model_style_and_row_freshness() -> None:
    path = "/tmp/artifacts/generated-media/2026-06-01-li-card-linkedin-square.png"
    stale_path = "/tmp/artifacts/generated-media/2026-05-31-other-linkedin-square.png"
    missing_style = _run_generated_media_receipt_validation(
        {"id": "li-card"},
        "linkedin",
        [path],
        f"{path} platform=linkedin model=gpt-image-2 size=1024x1024 language=en prompt=English explanatory image",
    )
    stale = _run_generated_media_receipt_validation(
        {"id": "li-card"},
        "linkedin",
        [stale_path],
        f"{stale_path} platform=linkedin model=gpt-image-2 size=1024x1024 visual_style=comparison_card language=en prompt=English explanatory image",
    )

    assert "generated_media_visual_style_missing" in missing_style["error"]
    assert "generated_media_not_fresh_for_row" in stale["error"]


def test_profile2_publish_runner_rejects_blank_visual_style() -> None:
    path = "/tmp/artifacts/generated-media/2026-06-01-li-card-linkedin-square.png"
    result = _run_generated_media_receipt_validation(
        {"id": "li-card"},
        "linkedin",
        [path],
        f"{path} platform=linkedin model=gpt-image-2 size=1024x1024 visual_style= language=en prompt=English explanatory image",
    )

    assert result["ok"] is False
    assert "generated_media_visual_style_missing" in result["error"]


def test_profile2_publish_runner_does_not_fallback_to_other_platform_media(tmp_path: Path) -> None:
    x_only = tmp_path / "artifacts" / "generated-media" / "2026-06-01-dual-x-card.png"
    x_only.parent.mkdir(parents=True)
    x_only.write_bytes(b"fake image")
    row = {
        "id": "dual",
        "media_plan": "X自作判断カード型 | LinkedIn正方形1枚画像型",
        "reference_media_notes": (
            f"{x_only} model=gpt-image-2 size=1024x1024 "
            "platform=x visual_style=decision_card language=en prompt=English receipt text mixed with x-only path"
        ),
    }

    result = _run_generated_media_path_resolution(row, "linkedin")

    assert result["ok"] is False
    assert "generated_media_required_linkedin_1_platform_marked_found_0" in result["error"]


def test_profile2_publish_runner_accepts_platform_receipt_without_filename_marker(tmp_path: Path) -> None:
    media_path = tmp_path / "artifacts" / "generated-media" / f"{_media_date_token()}-dual-card.png"
    media_path.parent.mkdir(parents=True)
    media_path.write_bytes(b"fake linkedin image")
    row = {
        "id": "dual",
        "media_plan": "LinkedIn正方形1枚画像型",
        "reference_media_notes": (
            f"{media_path} platform=linkedin model=gpt-image-2 size=1024x1024 "
            "visual_style=comparison_card language=en prompt=English explanatory image"
        ),
    }

    result = _run_generated_media_path_resolution(row, "linkedin")

    assert result["ok"] is True
    assert result["paths"] == [str(media_path)]


def test_profile2_publish_runner_requires_metadata_on_selected_media_entry(tmp_path: Path) -> None:
    linkedin_path = tmp_path / "artifacts" / "generated-media" / f"{_media_date_token()}-dual-linkedin-square.png"
    x_path = tmp_path / "artifacts" / "generated-media" / f"{_media_date_token()}-dual-x-card.png"
    linkedin_path.parent.mkdir(parents=True)
    linkedin_path.write_bytes(b"fake linkedin image")
    x_path.write_bytes(b"fake x image")
    row = {
        "id": "dual",
        "media_plan": "X自作判断カード型 | LinkedIn正方形1枚画像型",
        "reference_media_notes": (
            f"{linkedin_path} | "
            f"{x_path} platform=x model=gpt-image-2 size=1024x1024 visual_style=decision_card language=en prompt=metadata belongs to x path"
        ),
    }

    result = _run_generated_media_path_resolution(row, "linkedin")

    assert result["ok"] is False
    assert "generated_media_latest_model_missing" in result["error"]


def test_linkedin_link_reflection_does_not_count_composer_body_text() -> None:
    assert not _run_link_reflection_check(
        {
            "links": [],
            "previewTexts": [],
        },
        "https://openai.com/index/example/",
    )


def test_linkedin_link_reflection_counts_external_preview_or_link() -> None:
    assert _run_link_reflection_check(
        {
            "links": ["https://www.linkedin.com/redir/redirect?url=https%3A%2F%2Fopenai.com%2Findex%2Fexample%2F"],
            "previewTexts": [],
        },
        "https://openai.com/index/example/",
    )
    assert _run_link_reflection_check(
        {
            "links": [],
            "previewTexts": ["OpenAI example preview openai.com"],
        },
        "https://openai.com/index/example/",
    )


def test_linkedin_link_reflection_snapshot_ignores_stale_page_preview() -> None:
    result = _run_link_reflection_dom_check(
        "stale_only",
        "Fresh LinkedIn composer body without a reflected card",
        "https://openai.com/index/example/",
    )

    assert result["ok"] is False
    assert result["snapshot"] == {"links": [], "previewTexts": []}


def test_linkedin_link_reflection_snapshot_ignores_later_stale_same_body_preview() -> None:
    result = _run_link_reflection_dom_check(
        "stale_after",
        "Fresh LinkedIn composer body without a reflected card",
        "https://openai.com/index/example/",
    )

    assert result["ok"] is False
    assert result["snapshot"] == {"links": [], "previewTexts": []}


def test_linkedin_link_reflection_snapshot_counts_active_composer_preview() -> None:
    result = _run_link_reflection_dom_check(
        "active_preview",
        "Fresh LinkedIn composer body with the official card",
        "https://openai.com/index/example/",
    )

    assert result["ok"] is True
    assert result["snapshot"]["links"] == []
    assert result["snapshot"]["previewTexts"] == ["OpenAI example preview openai.com"]


def test_profile2_publish_runner_ignores_rows_below_daily_ai_quality_gate(tmp_path: Path) -> None:
    queue_path = tmp_path / "posting_queue.tsv"
    _write_queue(
        queue_path,
        [
            {
                "id": "weak-linkedin",
                "status": "approved",
                "quality_score": "9",
                "keep_priority": "ship_now",
                "source_url": "https://openai.com/index/example/",
                "media_plan": "LinkedInリンクカード型",
                "linkedin_text": "Weak candidate https://openai.com/index/example/",
                "review_notes": "Local automation profile publish candidate",
            }
        ],
    )

    result = _run_publish_runner(queue_path)
    payload = json.loads(result.stdout)

    assert result.returncode == 0
    assert payload["ok"] is True
    assert payload["result"]["published"] == 0
    assert "No X or LinkedIn publish candidates" in payload["result"]["message"]


def test_profile2_publish_runner_requires_profile2_lane_for_valid_candidate(tmp_path: Path) -> None:
    queue_path = tmp_path / "posting_queue.tsv"
    _write_queue(
        queue_path,
        [
            {
                "id": "valid-linkedin",
                "status": "approved",
                "quality_score": "10",
                "source_url": "https://openai.com/index/example/",
                "media_plan": "LinkedInリンクカード型",
                "linkedin_text": "Valid candidate https://openai.com/index/example/",
                "review_notes": "Local automation profile publish candidate",
            }
        ],
    )

    result = _run_publish_runner(queue_path)
    payload = json.loads(result.stdout)

    assert result.returncode == 2
    assert payload["ok"] is False
    assert "profile2_lane_resolution_required" in payload["error"]


def test_profile2_publish_runner_accepts_profile2_lane_without_busy_owner(tmp_path: Path) -> None:
    queue_path = tmp_path / "posting_queue.tsv"
    _write_queue(
        queue_path,
        [
            {
                "id": "valid-linkedin",
                "status": "approved",
                "quality_score": "10",
                "keep_priority": "ship_now",
                "source_url": "https://openai.com/index/example/",
                "media_plan": "LinkedInリンクカード型",
                "linkedin_text": "Valid candidate https://openai.com/index/example/",
                "review_notes": "Local automation profile publish candidate",
            }
        ],
    )

    result = _run_publish_runner(queue_path, lane_resolution=_profile2_lane_resolution(busy=False))
    payload = json.loads(result.stdout)

    assert result.returncode == 2
    assert payload["ok"] is False
    assert "trusted_chrome_runtime_unavailable" in payload["error"]
    assert "profile2_lane_resolution_required" not in payload["error"]


def test_profile2_publish_runner_dry_run_skips_external_runtime(tmp_path: Path) -> None:
    queue_path = tmp_path / "posting_queue.tsv"
    _write_queue(
        queue_path,
        [
            {
                "id": "valid-linkedin",
                "status": "approved",
                "quality_score": "10",
                "keep_priority": "ship_now",
                "source_url": "https://openai.com/index/example/",
                "media_plan": "LinkedInリンクカード型",
                "linkedin_text": "Valid candidate https://openai.com/index/example/",
                "review_notes": "Local automation profile publish candidate",
            }
        ],
    )

    result = _run_publish_runner_dry_run(queue_path)
    payload = json.loads(result.stdout)
    rows = list(csv.DictReader(queue_path.open(encoding="utf-8"), delimiter="\t"))

    assert result.returncode == 0
    assert payload["dry_run"] is True
    assert payload["published"] == 0
    assert payload["receipts"][0]["dry_run"] is True
    assert rows[0]["linkedin_post_url"] == ""
    assert rows[0]["status"] == "approved"


def test_profile2_publish_runner_keeps_busy_lane_gate_for_valid_x_candidate(tmp_path: Path) -> None:
    queue_path = tmp_path / "posting_queue.tsv"
    _write_queue(
        queue_path,
        [
            {
                "id": "valid-x",
                "status": "approved",
                "quality_score": "10",
                "keep_priority": "ship_now",
                "source_url": "https://openai.com/index/example/",
                "media_plan": "X本文+URL型",
                "x_text": "Valid X candidate https://openai.com/index/example/",
                "review_notes": "Local automation profile publish candidate",
            }
        ],
    )

    result = _run_publish_runner(queue_path)
    payload = json.loads(result.stdout)

    assert result.returncode == 2
    assert payload["ok"] is False
    assert "profile2_lane_resolution_required" in payload["error"]


def test_profile2_publish_runner_ignores_x_candidate_without_text_url_surface(tmp_path: Path) -> None:
    queue_path = tmp_path / "posting_queue.tsv"
    _write_queue(
        queue_path,
        [
            {
                "id": "invalid-x",
                "status": "approved",
                "quality_score": "10",
                "keep_priority": "ship_now",
                "source_url": "https://openai.com/index/example/",
                "media_plan": "LinkedInリンクカード型",
                "x_text": "Valid X candidate https://openai.com/index/example/",
                "review_notes": "Local automation profile publish candidate",
            }
        ],
    )

    result = _run_publish_runner(queue_path)
    payload = json.loads(result.stdout)

    assert result.returncode == 0
    assert payload["ok"] is True
    assert payload["result"]["published"] == 0
    assert "No X or LinkedIn publish candidates" in payload["result"]["message"]


def test_profile2_publish_runner_preserves_rows_after_unquoted_double_quote(tmp_path: Path) -> None:
    queue_path = tmp_path / "posting_queue.tsv"
    _write_queue(
        queue_path,
        [
            {
                "id": "earlier-row",
                "status": "approved",
                "quality_score": "10",
                "source_url": "https://openai.com/index/example/",
                "media_plan": "LinkedInリンクカード型",
                "linkedin_text": 'A row with a natural "quoted" phrase but no candidate marker.',
            },
            {
                "id": "valid-linkedin",
                "status": "approved",
                "quality_score": "10",
                "source_url": "https://openai.com/index/example/",
                "media_plan": "LinkedInリンクカード型",
                "linkedin_text": "Valid candidate https://openai.com/index/example/",
                "review_notes": "Local automation profile publish candidate",
            },
        ],
    )

    result = _run_publish_runner(queue_path)
    payload = json.loads(result.stdout)

    assert result.returncode == 2
    assert payload["ok"] is False
    assert "profile2_lane_resolution_required" in payload["error"]


def test_profile2_publish_runner_ignores_future_scheduled_candidate_without_ready_status(tmp_path: Path) -> None:
    queue_path = tmp_path / "posting_queue.tsv"
    _write_queue(
        queue_path,
        [
            {
                "id": "future-linkedin",
                "status": "scheduled",
                "quality_score": "10",
                "scheduled_at": "2099-01-01T00:00:00+00:00",
                "source_url": "https://openai.com/index/example/",
                "media_plan": "LinkedInリンクカード型",
                "linkedin_text": "Future candidate https://openai.com/index/example/",
                "review_notes": "Local automation profile publish candidate",
            }
        ],
    )

    result = _run_publish_runner(queue_path)
    payload = json.loads(result.stdout)

    assert result.returncode == 0
    assert payload["ok"] is True
    assert payload["result"]["published"] == 0
    assert "No X or LinkedIn publish candidates" in payload["result"]["message"]


def test_profile2_publish_runner_allows_linkedin_retry_when_only_x_is_do_not_repost(tmp_path: Path) -> None:
    queue_path = tmp_path / "posting_queue.tsv"
    _write_queue(
        queue_path,
        [
            {
                "id": "partial-linkedin",
                "status": "partially_published",
                "quality_score": "10",
                "keep_priority": "ship_now",
                "source_url": "https://www.microsoft.com/en-us/microsoft-365/blog/example/",
                "media_plan": "X本文+URL型 | LinkedInリンクカード型",
                "linkedin_text": "PowerPoint usage is up 43%. https://www.microsoft.com/en-us/microsoft-365/blog/example/",
                "review_notes": "Local automation profile publish candidate",
                "next_action": "LinkedIn pending. Do not repost X.",
            }
        ],
    )

    result = _run_publish_runner(queue_path)
    payload = json.loads(result.stdout)

    assert result.returncode == 2
    assert payload["ok"] is False
    assert "profile2_lane_resolution_required" in payload["error"]


def test_profile2_publish_runner_allows_linkedin_after_x_url_capture_reconciled() -> None:
    candidates = _run_candidate_builder(
        [
            {
                "id": "partial-linkedin-after-x-url",
                "status": "partially_published",
                "quality_score": "10",
                "keep_priority": "ship_now",
                "source_url": "https://www.microsoft.com/en-us/security/blog/example/",
                "media_plan": "X本文+URL型 | LinkedInリンクカード型",
                "x_post_url": "https://x.com/nichika2000823/status/123",
                "linkedin_text": "Agent inventory is now a security problem. https://www.microsoft.com/en-us/security/blog/example/",
                "review_notes": "Local automation profile publish candidate",
                "next_action": (
                    "X URL capture pending after possible accepted submit; "
                    "Do not repost until URL reconciliation completes. LinkedIn remains pending."
                ),
            }
        ],
        max_actions=1,
    )

    assert candidates == [
        {
            "id": "partial-linkedin-after-x-url",
            "platform": "linkedin",
            "surface": "LinkedInリンクカード型",
        }
    ]


def test_profile2_publish_runner_blocks_linkedin_scoped_url_capture_pending() -> None:
    candidates = _run_candidate_builder(
        [
            {
                "id": "linkedin-blocked",
                "status": "partially_published",
                "quality_score": "10",
                "keep_priority": "ship_now",
                "source_url": "https://www.microsoft.com/en-us/security/blog/example/",
                "media_plan": "LinkedInリンクカード型",
                "x_post_url": "https://x.com/nichika2000823/status/123",
                "linkedin_text": "Agent inventory is now a security problem. https://www.microsoft.com/en-us/security/blog/example/",
                "review_notes": "Local automation profile publish candidate",
                "next_action": "LinkedIn URL capture pending after possible accepted submit; Do not repost until URL reconciliation completes.",
            }
        ],
        max_actions=1,
    )

    assert candidates == []


def test_profile2_publish_runner_allows_partial_linkedin_retry_below_quality_10() -> None:
    candidates = _run_candidate_builder(
        [
            {
                "id": "partial-linkedin-quality-nine",
                "status": "partially_published",
                "quality_score": "9",
                "keep_priority": "ship_now",
                "source_url": "https://www.microsoft.com/en-us/security/blog/example/",
                "media_plan": "X本文+URL型 | LinkedInリンクカード型",
                "x_post_url": "https://x.com/nichika2000823/status/123",
                "linkedin_text": "Agent inventory is now a security problem. https://www.microsoft.com/en-us/security/blog/example/",
                "review_notes": "Local automation profile publish candidate",
                "next_action": "X posted. LinkedIn remains pending.",
            }
        ],
        max_actions=2,
    )

    assert candidates == [
        {
            "id": "partial-linkedin-quality-nine",
            "platform": "linkedin",
            "surface": "LinkedInリンクカード型",
        }
    ]


def test_profile2_publish_runner_recognizes_linkedin_link_card_natural_language_surface() -> None:
    candidates = _run_candidate_builder(
        [
            {
                "id": "partial-linkedin-natural-language-link-card",
                "status": "partially_published",
                "quality_score": "10",
                "keep_priority": "ship_now",
                "source_url": "https://aws.amazon.com/blogs/machine-learning/example/",
                "media_plan": "X本文+URL型 | LinkedInはAWSブログのソースリンクカードを使用し、X投稿はソース/リンクカードを添付して公開する",
                "x_post_url": "https://x.com/nichika2000823/status/123",
                "linkedin_text": "SageMaker now supports OpenAI-compatible endpoint calls. https://aws.amazon.com/blogs/machine-learning/example/",
                "review_notes": "Daily AI Browser Use-native publish candidate",
                "next_action": "Publish LinkedIn as an original post via Browser Use-native registered runner.",
            }
        ],
        max_actions=2,
    )

    assert candidates == [
        {
            "id": "partial-linkedin-natural-language-link-card",
            "platform": "linkedin",
            "surface": "LinkedInリンクカード型",
        }
    ]


def test_profile2_publish_runner_does_not_infer_linkedin_link_card_from_negative_instruction() -> None:
    candidates = _run_candidate_builder(
        [
            {
                "id": "partial-linkedin-no-link-card",
                "status": "partially_published",
                "quality_score": "10",
                "keep_priority": "ship_now",
                "source_url": "https://aws.amazon.com/blogs/machine-learning/example/",
                "media_plan": "X本文+URL型 | LinkedInはリンクカードを使わない。本文だけでは送らず画像surfaceを修理する",
                "x_post_url": "https://x.com/nichika2000823/status/123",
                "linkedin_text": "SageMaker now supports OpenAI-compatible endpoint calls. https://aws.amazon.com/blogs/machine-learning/example/",
                "review_notes": "Daily AI Browser Use-native publish candidate",
                "next_action": "Repair LinkedIn image surface before publishing.",
            }
        ],
        max_actions=2,
    )

    assert candidates == []


def test_profile2_publish_runner_does_not_infer_linkedin_link_card_when_card_is_x_only() -> None:
    candidates = _run_candidate_builder(
        [
            {
                "id": "partial-linkedin-x-only-link-card",
                "status": "partially_published",
                "quality_score": "10",
                "keep_priority": "ship_now",
                "source_url": "https://aws.amazon.com/blogs/machine-learning/example/",
                "media_plan": "X本文+URL型 | LinkedInは画像型、リンクカードはXのみ",
                "x_post_url": "https://x.com/nichika2000823/status/123",
                "linkedin_text": "SageMaker now supports OpenAI-compatible endpoint calls. https://aws.amazon.com/blogs/machine-learning/example/",
                "review_notes": "Daily AI Browser Use-native publish candidate",
                "next_action": "Repair LinkedIn image surface before publishing.",
            }
        ],
        max_actions=2,
    )

    assert candidates == []


def test_profile2_publish_runner_does_not_infer_explicit_linkedin_link_card_when_forbidden() -> None:
    candidates = _run_candidate_builder(
        [
            {
                "id": "partial-linkedin-explicit-link-card-forbidden",
                "status": "partially_published",
                "quality_score": "10",
                "keep_priority": "ship_now",
                "source_url": "https://aws.amazon.com/blogs/machine-learning/example/",
                "media_plan": "X本文+URL型 | LinkedInリンクカード型は使わない",
                "x_post_url": "https://x.com/nichika2000823/status/123",
                "linkedin_text": "SageMaker now supports OpenAI-compatible endpoint calls. https://aws.amazon.com/blogs/machine-learning/example/",
                "review_notes": "Daily AI Browser Use-native publish candidate",
                "next_action": "Repair LinkedIn image surface before publishing.",
            }
        ],
        max_actions=2,
    )

    assert candidates == []


def test_profile2_publish_runner_prioritizes_partial_linkedin_over_new_x_candidate() -> None:
    candidates = _run_candidate_builder(
        [
            {
                "id": "partial-linkedin",
                "status": "partially_published",
                "quality_score": "9",
                "keep_priority": "ship_now",
                "source_url": "https://www.microsoft.com/en-us/security/blog/example/",
                "media_plan": "X本文+URL型 | LinkedInリンクカード型",
                "x_post_url": "https://x.com/nichika2000823/status/123",
                "linkedin_text": "Agent inventory is now a security problem. https://www.microsoft.com/en-us/security/blog/example/",
                "review_notes": "Local automation profile publish candidate",
                "next_action": "X posted. LinkedIn remains pending.",
            },
            {
                "id": "new-x",
                "status": "approved",
                "quality_score": "12",
                "keep_priority": "ship_now",
                "source_url": "https://openai.com/index/example/",
                "media_plan": "X本文+URL型 | LinkedInリンクカード型",
                "x_text": "New X copy https://openai.com/index/example/",
                "linkedin_text": "New LinkedIn copy https://openai.com/index/example/",
                "review_notes": "Local automation profile publish candidate",
            },
        ],
        max_actions=2,
    )

    assert candidates == [
        {
            "id": "partial-linkedin",
            "platform": "linkedin",
            "surface": "LinkedInリンクカード型",
        }
    ]


def test_profile2_publish_runner_ignores_stale_linkedin_surface_failure_after_revalidation() -> None:
    candidates = _run_candidate_builder(
        [
            {
                "id": "drafted-x-done-linkedin-pending",
                "status": "drafted",
                "quality_score": "10",
                "keep_priority": "ship_now",
                "review_status": "ready_morning",
                "source_url": "https://www.bullhorn.com/news-and-press/press-releases/example/",
                "media_plan": "LinkedInリンクカード型：公式URLのプレビューカードを表示する",
                "x_text": "Already posted on X https://www.bullhorn.com/news-and-press/press-releases/example/",
                "x_post_url": "https://x.com/nichika2000823/status/123",
                "linkedin_text": "LinkedIn remains pending https://www.bullhorn.com/news-and-press/press-releases/example/",
                "review_notes": (
                    "2026-06-01T06:11:53Z: LinkedIn Profile 2 publish skipped: "
                    "link_card_not_reflected: LinkedIn official source link card was not visible | "
                    "Revalidated existing ship_now candidate because the publish run needed a 3-item buffer "
                    "and the surface contract was clear. | "
                    "Daily AI Browser Use-native publish candidate"
                ),
                "next_action": "Publish LinkedIn as an original post via Browser Use-native registered runner.",
            },
            {
                "id": "new-dual",
                "status": "approved",
                "quality_score": "10",
                "keep_priority": "ship_now",
                "source_url": "https://example.com/new",
                "media_plan": "X本文+URL型 | LinkedInリンクカード型",
                "x_text": "New X https://example.com/new",
                "linkedin_text": "New LinkedIn https://example.com/new",
                "review_notes": "Daily AI Browser Use-native publish candidate",
            },
        ],
        max_actions=2,
    )

    assert candidates == [
        {
            "id": "drafted-x-done-linkedin-pending",
            "platform": "linkedin",
            "surface": "LinkedInリンクカード型",
        }
    ]


def test_profile2_publish_runner_keeps_current_linkedin_surface_failure_blocked() -> None:
    candidates = _run_candidate_builder(
        [
            {
                "id": "current-linkedin-failure",
                "status": "drafted",
                "quality_score": "10",
                "keep_priority": "ship_now",
                "review_status": "ready_morning",
                "source_url": "https://www.bullhorn.com/news-and-press/press-releases/example/",
                "media_plan": "LinkedInリンクカード型：公式URLのプレビューカードを表示する",
                "x_text": "Already posted on X https://www.bullhorn.com/news-and-press/press-releases/example/",
                "x_post_url": "https://x.com/nichika2000823/status/123",
                "linkedin_text": "LinkedIn remains pending https://www.bullhorn.com/news-and-press/press-releases/example/",
                "review_notes": (
                    "Daily AI Browser Use-native publish candidate | "
                    "2026-06-01T06:11:53Z: LinkedIn publish skipped: "
                    "link_card_not_reflected: LinkedIn official source link card was not visible"
                ),
            }
        ],
        max_actions=2,
    )

    assert candidates == []


def test_profile2_publish_runner_prioritizes_oldest_partial_before_newer_partial() -> None:
    candidates = _run_candidate_builder(
        [
            {
                "id": "newer-partial",
                "status": "partially_published",
                "quality_score": "12",
                "keep_priority": "ship_now",
                "source_url": "https://openai.com/index/example/",
                "media_plan": "X本文+URL型 | LinkedInリンクカード型",
                "x_post_url": "https://x.com/nichika2000823/status/456",
                "x_published_at": "2026-06-01T23:29:35+00:00",
                "linkedin_text": "Newer partial https://openai.com/index/example/",
                "review_notes": "Local automation profile publish candidate",
            },
            {
                "id": "older-partial",
                "status": "partially_published",
                "quality_score": "9",
                "keep_priority": "ship_now",
                "source_url": "https://www.microsoft.com/en-us/security/blog/example/",
                "media_plan": "X本文+URL型 | LinkedInリンクカード型",
                "x_post_url": "https://x.com/nichika2000823/status/123",
                "x_published_at": "2026-06-01T23:04:54+00:00",
                "linkedin_text": "Older partial https://www.microsoft.com/en-us/security/blog/example/",
                "review_notes": "Local automation profile publish candidate",
            },
        ],
        max_actions=1,
    )

    assert candidates == [
        {
            "id": "older-partial",
            "platform": "linkedin",
            "surface": "LinkedInリンクカード型",
        }
    ]


def test_profile2_publish_runner_allows_partial_x_retry_below_quality_10() -> None:
    candidates = _run_candidate_builder(
        [
            {
                "id": "partial-x-quality-nine",
                "status": "partially_published",
                "quality_score": "9",
                "keep_priority": "ship_now",
                "source_url": "https://openai.com/index/example/",
                "media_plan": "X本文+URL型 | LinkedInリンクカード型",
                "x_text": "X resume copy https://openai.com/index/example/",
                "linkedin_post_url": "https://www.linkedin.com/feed/update/urn:li:share:999/",
                "review_notes": "Local automation profile publish candidate",
                "next_action": "LinkedIn posted. X remains pending.",
            }
        ],
        max_actions=2,
    )

    assert candidates == [
        {
            "id": "partial-x-quality-nine",
            "platform": "x",
            "surface": "X本文+URL型",
        }
    ]


def test_profile2_publish_runner_allows_partial_x_retry_with_blank_keep_priority() -> None:
    candidates = _run_candidate_builder(
        [
            {
                "id": "partial-x-blank-priority",
                "status": "partially_published",
                "quality_score": "9",
                "source_url": "https://openai.com/index/example/",
                "media_plan": "X本文+URL型 | LinkedInリンクカード型",
                "x_text": "X resume copy https://openai.com/index/example/",
                "linkedin_post_url": "https://www.linkedin.com/feed/update/urn:li:share:999/",
                "review_notes": "Local automation profile publish candidate",
                "next_action": "LinkedIn posted. X remains pending.",
            }
        ],
        max_actions=2,
    )

    assert candidates == [
        {
            "id": "partial-x-blank-priority",
            "platform": "x",
            "surface": "X本文+URL型",
        }
    ]


def test_profile2_publish_runner_disables_tab_scoped_cua_linkedin_composer_fallback() -> None:
    runner = RUNNER_PATH.read_text(encoding="utf-8")

    assert "openLinkedInComposerWithTabCua" not in runner
    assert "tab.cua.click" not in runner
    assert 'Start a post|投稿を開始' in runner


def test_profile2_publish_runner_disables_visual_cua_keypress_publish_fallback() -> None:
    runner = RUNNER_PATH.read_text(encoding="utf-8")

    assert "publishLinkedInLinkCardWithVisualCua" in runner
    assert "keypressText" not in runner
    assert "keyForLinkedInCua" not in runner
    assert "coordinate CUA fallback is disabled for publishing" in runner
    assert "linkedin_recent_activity_already_reflected" not in runner
    assert "excludedRecentActivityUrns" in runner
    assert "postBefore.urns" in runner
    assert "!excluded.includes(urn)" in runner
    assert "linkUrns" in runner
    assert "href.includes(urn)" in runner


def test_profile2_publish_runner_has_generated_media_surface_routes() -> None:
    runner = RUNNER_PATH.read_text(encoding="utf-8")

    assert "publishXWithGeneratedMedia" in runner
    assert "openXNativeQuoteComposer" in runner
    assert "attachXMedia" in runner
    assert "publishLinkedInGeneratedMedia" in runner
    assert "uploadLinkedInMediaViaPhotoRoute" in runner
    assert "visibleLinkedInPhotoButtons" in runner
    assert 'waitForEvent("filechooser", { timeoutMs })' in runner
    assert "const initialInputCount" in runner
    assert "inputCount > initialInputCount" in runner
    assert '"existing_input_set_files"' not in runner
    assert 'root.locator(selector)' in runner
    assert "const { button: photoButton, root } = photoButtons[index]" in runner
    assert "const inputs = root.locator('input[type=\"file\"]')" in runner
    assert "resolveLinkedInComposerRootAfterMediaUpload" in runner
    assert "advanceLinkedInMediaEditorIfPresent" in runner
    assert "return await resolveLinkedInComposerRootAfterMediaUpload(tab, root, initialUploadRootCount, mediaPaths.length)" in runner
    assert "isLinkedInShareComposerText" in runner
    assert "return /Start a post|投稿を開始/i.test(value) && /Photo|写真/i.test(value)" in runner
    assert "/Start a post|投稿を開始|Post|投稿/" not in runner
    assert 'section[aria-label="Primary content"]' in runner
    assert 'main[role="main"]' in runner
    assert "broadRootSelectors" in runner
    assert "isCompactLinkedInShareComposerText" in runner
    assert "Recommended for you" in runner
    assert "Start a post\\s*Video\\s*Photo\\s*Write article" in runner
    assert "投稿を開始\\s*(動画|ビデオ)\\s*写真" in runner
    assert "value.length < 160" in runner
    assert "for (let index = 0; index < photoButtons.length; index += 1)" in runner
    assert "return root" in runner
    assert "linkedin_file_input_not_materialized_after_photo_route${suffix}" in runner
    assert 'const suffix = sawFileChooserTimeout ? "_after_filechooser_timeout" : ""' in runner
    assert "waitForLinkedInMediaReflection" in runner
    assert "waitForLinkedInMediaReflection(tab, composerRoot, mediaPaths.length)" in runner
    assert "hasLinkedInMediaReflection(tab, root" in runner
    assert "findLinkedInPostEditor(tab, composerRoot)" in runner
    assert "findLinkedInPostButton(tab, { strictShareScope: true, root: composerRoot, editor, expectedBody: body })" in runner
    assert "resolveGeneratedMediaPaths" in runner
    assert "validateGeneratedMediaReceipt" in runner
    assert "surface_missing: generated_media_required" in runner
    assert "coordinate CUA fallback is disabled for publishing" in runner
    assert "pressSequentially(chunk" in runner
    linkedin_input_body = runner.split("async function clearAndTypeLinkedInBody", 1)[1].split(
        "\nasync function waitForLinkedInLinkReflection", 1
    )[0]
    assert "innerHTML" not in linkedin_input_body
    assert "InputEvent" not in linkedin_input_body
    assert "link_card_not_reflected: LinkedInリンクカード型 requires official source URL" in runner
    assert "link_card_reflected: true" in runner
    assert "generated_media_language_${expectedLanguage}_missing" in runner
    assert "surface_missing: generated_media_visual_style_missing" in runner
    assert "surface_missing: generated_media_not_fresh_for_row" in runner


def test_profile2_publish_runner_x_account_check_uses_active_account_ui_not_profile_page() -> None:
    runner = RUNNER_PATH.read_text(encoding="utf-8")
    function_body = runner.split("async function verifyXAccount", 1)[1].split(
        "\nasync function publishXTextUrl", 1
    )[0]

    assert 'await tab.goto("https://x.com/home")' in function_body
    assert "`https://x.com/${expected}`" in function_body
    assert 'a[data-testid="AppTabBar_Profile_Link"]' in function_body
    assert 'SideNav_AccountSwitcher_Button' in function_body
    assert "own_profile_edit_button_fallback" in function_body
    assert "edit profile|プロフィールを編集" in function_body
    assert "document.body?.innerText" not in function_body


def test_profile2_linkedin_body_input_uses_press_sequentially_not_dom_injection() -> None:
    runner = RUNNER_PATH.read_text(encoding="utf-8")
    function_body = runner.split("async function clearAndTypeLinkedInBody", 1)[1].split(
        "\nasync function waitForLinkedInLinkReflection", 1
    )[0]

    assert "pressSequentially(chunk" in function_body
    assert ".type(" not in function_body
    assert "innerHTML" not in function_body
    assert "InputEvent" not in function_body


def test_profile2_publish_runner_x_text_url_shortens_and_captures_new_status_only() -> None:
    runner = RUNNER_PATH.read_text(encoding="utf-8")

    assert "function fitXTextUrlBody" in runner
    assert "function xWeightedLengthWithUrls" in runner
    assert 'replace(/https?:\\/\\/\\S+/g, "xxxxxxxxxxxxxxxxxxxxxxx")' in runner
    assert "captureXExistingStatusIds(tab, expectedHandle)" in runner
    assert "excludeStatusIds: existingStatusIds" in runner
    capture_body = runner.split("async function captureXCompletion", 1)[1].split(
        "\nexport function markXPublished", 1
    )[0]
    assert "postUrl: \"\"" in capture_body
    assert "location.href" in capture_body
    assert "snippets.some" in capture_body
    assert "sourceMatched" in capture_body
    assert "!excludedIds.includes" in capture_body
    assert "Boolean(host && hrefs.some" not in capture_body
    assert "if (!completion.postUrl)" in runner
    assert "x_success_reflected" not in runner


def test_profile2_publish_runner_x_composer_uses_staged_url_readback_and_reset() -> None:
    runner = RUNNER_PATH.read_text(encoding="utf-8")
    x_text_body = runner.split("async function publishXTextUrl", 1)[1].split(
        "\nasync function publishXBySurface", 1
    )[0]
    x_media_body = runner.split("async function publishXWithGeneratedMedia", 1)[1].split(
        "\nasync function openXNativeQuoteComposer", 1
    )[0]
    helper_body = runner.split("async function insertAndVerifyXComposerBody", 1)[1].split(
        "\nasync function clearAndTypeXBody", 1
    )[0]

    assert "insertAndVerifyXComposerBody(tab, body, { sourceUrl, allowReset: true })" in x_text_body
    assert "insertAndVerifyXComposerBody(tab, body, { sourceUrl: bodySourceUrl, allowReset: !quote })" in x_media_body
    assert "findXPostButton(tab)" in x_text_body
    assert "captureXCompletion(tab, body, expectedHandle" in x_text_body
    assert "readXComposerBody(tab)" in helper_body
    assert "containsXComposerBody(readback, body, sourceUrl)" in helper_body
    assert "insertXBodyViaContentEditable(tab, body)" in helper_body
    assert "resetXComposer(tab)" in helper_body
    assert "node.dispatchEvent(new InputEvent(\"input\"" in runner
    assert "anchor.href || anchor.getAttribute(\"href\")" in runner


def test_profile2_publish_runner_x_media_uses_extension_filechooser_not_set_input_files() -> None:
    runner = RUNNER_PATH.read_text(encoding="utf-8")
    function_body = runner.split("async function attachXMedia", 1)[1].split(
        "\nasync function waitForXMediaReflection", 1
    )[0]

    assert "waitForFileChooser(tab, 15000)" in function_body
    assert "fileChooser.setFiles(mediaPaths)" in function_body
    assert "uploadChromeExtensionInputViaFileChooser(tab, fileInput, mediaPaths)" in function_body
    assert ".setInputFiles(" not in function_body


def test_profile2_engagement_runner_x_account_check_uses_active_account_ui_not_profile_page() -> None:
    runner = ENGAGEMENT_RUNNER_PATH.read_text(encoding="utf-8")
    function_body = runner.split("async function verifyXAccount", 1)[1].split(
        "\nasync function verifyLinkedInAccount", 1
    )[0]

    assert 'await tab.goto("https://x.com/home")' in function_body
    assert "`https://x.com/${expected}`" not in function_body
    assert 'a[data-testid="AppTabBar_Profile_Link"]' in function_body
    assert 'SideNav_AccountSwitcher_Button' in function_body
    assert "location.pathname" not in function_body
    assert "document.body?.innerText" not in function_body


def test_profile2_engagement_x_reply_uses_hardened_editor_input() -> None:
    runner = ENGAGEMENT_RUNNER_PATH.read_text(encoding="utf-8")
    send_body = runner.split('if (action === "comment_candidate" || action === "reply_to_own_post")', 1)[1].split(
        "\n  throw new Error(`unsupported_browser_engagement_action", 1
    )[0]
    function_body = runner.split("async function setXReplyEditorBody", 1)[1].split(
        "\nasync function sendLinkedInEngagement", 1
    )[0]

    assert "xReplyEditor(tab)" in runner
    assert "function fitXReplyBody" in runner
    assert "xWeightedLengthWithUrls" in runner
    assert "const replyBody = fitXReplyBody(comment)" in send_body
    assert "setXReplyEditorBody(tab, editor, replyBody)" in send_body
    assert "replyBody.slice(0, 20)" in send_body
    assert "{ targetUrl, comment: replyBody }" in send_body
    assert "click({ force: true })" in function_body
    assert "pressSequentially" in function_body
    assert "InputEvent" in function_body


def test_profile2_engagement_x_like_accepts_state_change_reflection() -> None:
    runner = ENGAGEMENT_RUNNER_PATH.read_text(encoding="utf-8")
    function_body = runner.split('if (action === "like_candidate")', 1)[1].split(
        '\n  if (action === "save_candidate")', 1
    )[0]

    assert 'getAttribute("aria-pressed")' in function_body
    assert 'getAttribute("aria-label")' in function_body
    assert "afterState !== beforeState" in function_body
    assert "X like state did not change" in function_body


def test_profile2_engagement_runner_normalizes_external_quote_to_comment() -> None:
    runner = ENGAGEMENT_RUNNER_PATH.read_text(encoding="utf-8")

    assert "normalizeExternalQuoteEngagement(row)" in runner
    function_body = runner.split("function normalizeExternalQuoteEngagement", 1)[1].split(
        "\nfunction isSkippableUnsupportedAction", 1
    )[0]
    assert 'row.engagement_action = "comment_candidate"' in function_body
    assert 'engagementPlatform(firstEngagementTarget(row)) !== "x"' in function_body
    assert "normalized external quote_candidate to comment_candidate" in function_body
    assert 'const UNSUPPORTED_SKIPPABLE_ACTIONS = new Set([])' in runner


def test_profile2_engagement_linkedin_like_reflection_uses_page_level_snapshot() -> None:
    runner = ENGAGEMENT_RUNNER_PATH.read_text(encoding="utf-8")
    function_body = runner.split("async function sendLinkedInEngagement", 1)[1].split(
        "\nasync function linkedInReactionState", 1
    )[0]
    helper_body = runner.split("async function linkedInReactionState", 1)[1].split(
        "\nasync function waitSettled", 1
    )[0]

    assert "const beforeState = await linkedInReactionState(tab)" in function_body
    assert "const afterState = await linkedInReactionState(tab)" in function_body
    assert "afterState.label !== beforeState.label" in function_body
    assert "tab.playwright.evaluate(" in helper_body
    assert ":has-text" not in helper_body
    assert "locator.evaluate(" not in helper_body

    result = _run_linkedin_reaction_state_snapshot()
    assert result == {"label": "Reaction button state: no reaction", "pressed": "false"}


def test_linkedin_generated_media_route_stays_on_one_composer_root() -> None:
    runner = RUNNER_PATH.read_text(encoding="utf-8")
    upload_body = runner.split("async function uploadLinkedInMediaViaPhotoRoute", 1)[1].split(
        "\nasync function visibleLinkedInPhotoButtons", 1
    )[0]
    reflection_body = runner.split("async function waitForLinkedInMediaReflection", 1)[1].split(
        "\nasync function closeStaleLinkedInAlerts", 1
    )[0]
    editor_body = runner.split("async function findLinkedInPostEditor", 1)[1].split(
        "\nasync function readEditorText", 1
    )[0]
    post_button_body = runner.split("async function findLinkedInPostButton", 1)[1].split(
        "\nasync function captureLinkedInCompletion", 1
    )[0]

    assert "root.locator('input[type=\"file\"]')" in upload_body
    assert "const allInputs = tab.playwright.locator('input[type=\"file\"]')" in upload_body
    assert "const initialGlobalInputCount = await allInputs.count().catch(() => 0)" in upload_body
    assert "globalInputCount > initialGlobalInputCount &&" in upload_body
    assert "uploadChromeExtensionInputViaFileChooser(tab, allInputs.nth(globalInputCount - 1), mediaPaths)" in upload_body
    assert "const initialUploadRootCount = await linkedInUploadComposerRoots(tab).count().catch(() => 0)" in upload_body
    assert "await advanceLinkedInMediaEditorIfPresent(tab, root, initialUploadRootCount, mediaPaths.length)" in upload_body
    assert "return await resolveLinkedInComposerRootAfterMediaUpload(tab, root, initialUploadRootCount, mediaPaths.length)" in upload_body
    assert "LINKEDIN_MEDIA_PREVIEW_SELECTORS" in reflection_body
    assert '"media-preview"' in reflection_body
    assert "root.locator(selector)" in reflection_body
    assert "imageCount >= expectedCount" in reflection_body
    assert "allowCountOnly || imageCount > 0" in reflection_body
    assert '[class*="media"], [class*="preview"]' not in reflection_body
    assert "document.querySelectorAll" not in reflection_body
    assert "waitSettled(tab" not in reflection_body
    assert "setTimeout(resolve, 1000)" in reflection_body
    assert "if (root)" in editor_body
    assert "root.locator(selector).last()" in editor_body
    assert "if (options.root)" in post_button_body
    assert "isLinkedInComposerRootForSubmit(options.root, options)" in post_button_body
    assert "findLinkedInPostButtonInRoot(tab, options.root, selectors)" in post_button_body


def test_x_generated_media_route_uses_filechooser_before_input_fallback() -> None:
    runner = RUNNER_PATH.read_text(encoding="utf-8")
    function_body = runner.split("async function attachXMedia", 1)[1].split(
        "\nasync function waitForXMediaReflection", 1
    )[0]

    assert "waitForFileChooser(tab, 15000)" in function_body
    assert "await attachButton.click({ timeoutMs: 15000, force: true })" in function_body
    assert "await fileChooser.setFiles(mediaPaths)" in function_body
    assert "uploadChromeExtensionInputViaFileChooser(tab, fileInput, mediaPaths)" in function_body
    assert ".setInputFiles(" not in function_body
    assert "x_filechooser_not_captured" in function_body


def test_linkedin_generated_media_photo_route_resolves_post_upload_composer_root() -> None:
    runner = RUNNER_PATH.read_text(encoding="utf-8")
    function_body = runner.split("async function resolveLinkedInComposerRootAfterMediaUpload", 1)[1].split(
        "\nasync function visibleLinkedInPhotoButtons", 1
    )[0]

    assert "linkedInUploadComposerRoots(tab)" in function_body
    assert "initialUploadRootCount" in function_body
    assert "Feed post|Sort by|Recommended for you|Promoted" in function_body
    assert "findLinkedInPostEditor(tab, root)" in function_body
    assert "hasLinkedInMediaReflection(tab, root)" in function_body
    assert "return fallbackRoot" in function_body


def test_linkedin_generated_media_photo_route_advances_media_editor_next() -> None:
    runner = RUNNER_PATH.read_text(encoding="utf-8")
    function_body = runner.split("async function advanceLinkedInMediaEditorIfPresent", 1)[1].split(
        "\nasync function resolveLinkedInComposerRootAfterMediaUpload", 1
    )[0]

    assert "linkedInPostUploadCandidateRoots(tab, fallbackRoot, initialUploadRootCount, expectedCount)" in function_body
    assert 'button:has-text("Next")' in function_body
    assert 'button[aria-label^="Next "]' in function_body
    assert 'button:has-text("次へ")' in function_body
    assert 'button[aria-label^="次へ "]' in function_body
    assert "linkedInButtonLabel(nextButton)" in function_body
    assert "isLinkedInMediaEditorNextLabel(label)" in function_body
    assert "hasLinkedInMediaReflection(tab, root, expectedCount, { allowCountOnly: true })" in function_body
    assert "surface_missing: linkedin_photo_editor_preview_missing_before_next" in function_body
    assert "surface_missing: linkedin_photo_editor_next_disabled" in function_body
    assert "await nextButton.click()" in function_body
    assert "page of document|document|carousel" in runner


def test_linkedin_generated_media_post_upload_roots_are_new_or_upload_root_only() -> None:
    runner = RUNNER_PATH.read_text(encoding="utf-8")
    helper_body = runner.split("async function linkedInPostUploadCandidateRoots", 1)[1].split(
        "\nasync function advanceLinkedInMediaEditorIfPresent", 1
    )[0]

    assert "linkedInUploadComposerRoots(tab)" in helper_body
    assert "initialUploadRootCount" in helper_body
    assert "index >= Math.max(initialUploadRootCount, count - 5)" in helper_body
    assert "isLinkedInMediaEditorRoot(tab, root, expectedCount)" in helper_body
    assert "candidates.push(fallbackRoot)" in helper_body


def test_linkedin_generated_media_editor_root_requires_count_signal() -> None:
    runner = RUNNER_PATH.read_text(encoding="utf-8")
    function_body = runner.split("async function isLinkedInMediaEditorRoot", 1)[1].split(
        "\nasync function visibleLinkedInPhotoButtons", 1
    )[0]

    assert "Feed post|Sort by|Recommended for you|Promoted" in function_body
    assert "hasLinkedInMediaReflection(tab, root, expectedCount, { allowCountOnly: true })" in function_body
    assert "1 of ${expectedCount}|1 / ${expectedCount}|${expectedCount}枚" in function_body
    reflection_body = runner.split("async function hasLinkedInMediaReflection", 1)[1].split(
        "\nasync function closeStaleLinkedInAlerts", 1
    )[0]
    assert "root.locator(selector)" in reflection_body
    assert "document.querySelectorAll" not in reflection_body


def test_linkedin_generated_media_broad_roots_use_compact_composer_only() -> None:
    runner = RUNNER_PATH.read_text(encoding="utf-8")
    function_body = runner.split("async function visibleLinkedInPhotoButtons", 1)[1].split(
        "\nasync function waitForLinkedInMediaReflection", 1
    )[0]

    assert "const broadRootSelectors" in function_body
    assert 'broadRoot.locator("div").filter({ hasText: /Start a post|投稿を開始/i })' in function_body
    assert "isCompactLinkedInShareComposerText(text || \"\")" in function_body
    assert "await addButtonsFromRoot(candidate" in function_body
    assert "await addButtonsFromRoot(broadRoot" not in function_body


def test_linkedin_link_reflection_is_scoped_to_share_composer() -> None:
    runner = RUNNER_PATH.read_text(encoding="utf-8")
    function_body = runner.split("async function waitForLinkedInLinkReflection", 1)[1].split(
        "\nexport function hasLinkedInLinkReflectionSnapshot", 1
    )[0]

    assert "root = null" in function_body
    assert "const scope = root || (await findLinkedInActiveComposerRoot(tab))" in function_body
    assert "const scopeText = await scope.textContent().catch(() => \"\")" in function_body
    assert "linkedInLinkReflectionSnapshot(tab, scopeText, scope)" in function_body
    assert ".evaluate(" not in function_body
    assert "document.querySelectorAll('[contenteditable=\"true\"], .ql-editor')" not in function_body


def test_linkedin_post_button_prefers_share_composer_scope() -> None:
    runner = RUNNER_PATH.read_text(encoding="utf-8")
    function_body = runner.split("async function findLinkedInPostButton", 1)[1].split(
        "\nasync function captureLinkedInCompletion", 1
    )[0]

    assert "rootSelectors" in function_body
    assert "findLinkedInPostButtonInRoot(tab, root, selectors)" in function_body
    assert "const locators = root.locator(selector)" in function_body
    assert "locators.nth(index)" in function_body
    assert "isLinkedInComposerRootForSubmit(root, options)" in function_body
    assert "roots.filter({ has: options.editor })" in function_body
    assert "containsBody(rootText, options.expectedBody)" in function_body
    assert "isLinkedInPostSubmitButton(tab, locator)" in function_body
    assert "if (options.strictShareScope)" in function_body
    assert "'[role=\"dialog\"]'" in function_body
    assert '".share-creation-state"' in function_body
    helper_body = runner.split("async function isLinkedInPostSubmitButton", 1)[1].split(
        "\nasync function captureLinkedInCompletion", 1
    )[0]
    assert 'locator.getAttribute("data-control-name")' in helper_body
    assert 'locator.getAttribute("class")' in helper_body
    assert ".evaluate(" not in helper_body
    assert "/^(Post|投稿|投稿する)$/.test(label)" in helper_body


def test_profile2_publish_runner_does_not_call_locator_evaluate() -> None:
    runner = RUNNER_PATH.read_text(encoding="utf-8")
    forbidden = [
        "editor.evaluate(",
        "scope.evaluate(",
        "root.evaluate(",
        "locator.evaluate(",
        "button.evaluate(",
    ]

    for token in forbidden:
        assert token not in runner
    assert "tab.playwright.evaluate(" in runner


def test_linkedin_recent_activity_timeout_is_nonfatal_completion_probe() -> None:
    runner = RUNNER_PATH.read_text(encoding="utf-8")
    function_body = runner.split("async function captureLinkedInRecentActivityCompletion", 1)[1].split(
        "\nexport function markLinkedInPublished", 1
    )[0]

    assert "navigationTimedOut" in function_body
    assert "isTimeoutError(error)" in function_body
    assert "if (!navigationTimedOut) throw error" in function_body
    assert "return { ...result, navigationTimedOut: true }" in function_body
    assert "isTimeoutError(error)" in function_body


def test_linkedin_recent_activity_timeout_before_publish_keeps_post_submit_gate() -> None:
    runner = RUNNER_PATH.read_text(encoding="utf-8")
    function_body = runner.split("async function captureLinkedInRecentActivityBeforePublish", 1)[1].split(
        "\nfunction assertLinkedInCompletionCaptured", 1
    )[0]

    assert "captureLinkedInRecentActivitySnapshot(tab).catch" in function_body
    assert "isTimeoutError(error)" in function_body
    assert "baselineUnavailable: true" in function_body
    assert 'baselineReason: "prepublish_snapshot_timeout"' in function_body
    assert "completion_capture_failed: LinkedIn recent activity prepublish snapshot timed out" not in function_body
    completion_body = runner.split("function assertLinkedInCompletionCaptured", 1)[1].split(
        "\nfunction isTimeoutError", 1
    )[0]
    assert "if (completion.postUrl) return" in completion_body
    assert "completion.postUrl || completion.successVisible" not in completion_body
    assert "allowCurrentPageCapture: true" in runner
    assert "allowRecentActivityFallback: !postBefore.baselineUnavailable" in runner
    assert "recentActivityFallbackSkipped" in runner
    completion_function = runner.split("async function captureLinkedInCompletion", 1)[1].split(
        "\nasync function captureLinkedInRecentActivityBeforePublish", 1
    )[0]
    assert "if (allowCurrentPageCapture && result.postUrl) return result" in completion_function
    assert "result.postUrl && result.successVisible" not in completion_function


def test_linkedin_recent_activity_before_publish_empty_baseline_is_nonfatal() -> None:
    runner = RUNNER_PATH.read_text(encoding="utf-8")
    function_body = runner.split("async function captureLinkedInRecentActivityBeforePublish", 1)[1].split(
        "\nfunction assertLinkedInCompletionCaptured", 1
    )[0]

    assert "const urns = snapshot.urns || (snapshot.urn ? [snapshot.urn] : [])" in function_body
    assert "if (!urns.length)" in function_body
    assert 'baselineReason: "prepublish_snapshot_empty"' in function_body
    assert "completion_capture_failed: LinkedIn recent activity prepublish snapshot returned no activity URNs" not in function_body


def test_linkedin_recent_activity_before_publish_snapshot_does_not_filter_by_new_body() -> None:
    runner = RUNNER_PATH.read_text(encoding="utf-8")
    function_body = runner.split("async function captureLinkedInRecentActivitySnapshot", 1)[1].split(
        "\nfunction assertLinkedInCompletionCaptured", 1
    )[0]

    assert "expectedBodyStart" not in function_body
    assert "innerText" not in function_body
    assert "document.querySelectorAll(\"[data-urn]\")" in function_body
    assert "/urn:li:(activity|share):[0-9]+/i.test(urn)" in function_body


def test_linkedin_recent_activity_timeout_after_post_sets_url_capture_pending() -> None:
    runner = RUNNER_PATH.read_text(encoding="utf-8")
    function_body = runner.split("function assertLinkedInCompletionCaptured", 1)[1].split(
        "\nfunction isTimeoutError", 1
    )[0]

    assert "if (completion.postUrl) return" in function_body
    assert "completion.postUrl || completion.successVisible" not in function_body
    assert "completion.navigationTimedOut" in function_body
    assert "URL capture pending: LinkedIn recent activity timed out after Post click" in function_body
    assert "capture_failed: LinkedIn completion URL was not visible after submit" in function_body


def test_profile2_publish_runner_x_success_keeps_linkedin_pending_state() -> None:
    row = _run_publish_state_update(
        "markXPublished",
        {
            "id": "x-first",
            "status": "approved",
            "published_at": "",
            "linkedin_post_url": "",
            "linkedin_post_id": "",
        },
        {
            "post_url": "https://x.com/nichika2000823/status/123",
            "completion": "x_post_url_captured",
        },
    )

    assert row["status"] == "partially_published"
    assert row["x_post_url"] == "https://x.com/nichika2000823/status/123"
    assert row["x_post_id"] == "123"
    assert row["published_at"] == ""
    assert "LinkedIn remains pending" in row["next_action"]


def test_profile2_publish_runner_x_success_marks_published_when_linkedin_exists() -> None:
    row = _run_publish_state_update(
        "markXPublished",
        {
            "id": "x-last",
            "status": "partially_published",
            "linkedin_post_url": "https://www.linkedin.com/feed/update/urn:li:share:999/",
        },
        {
            "post_url": "https://x.com/nichika2000823/status/123",
            "completion": "x_post_url_captured",
        },
    )

    assert row["status"] == "published"
    assert row["published_at"]
    assert row["next_action"] == "X posted via Daily AI Playwright CLI registered runner; monitor metrics and replies."


def test_profile2_publish_runner_linkedin_success_keeps_x_pending_state() -> None:
    row = _run_publish_state_update(
        "markLinkedInPublished",
        {
            "id": "linkedin-first",
            "status": "approved",
            "published_at": "",
            "x_post_url": "",
            "x_post_id": "",
        },
        {
            "post_url": "https://www.linkedin.com/feed/update/urn:li:share:999/",
            "completion": "linkedin_post_url_captured",
        },
    )

    assert row["status"] == "partially_published"
    assert row["linkedin_post_url"] == "https://www.linkedin.com/feed/update/urn:li:share:999/"
    assert row["published_at"] == ""
    assert "X remains pending" in row["next_action"]


def test_publish_candidate_builder_resumes_linkedin_after_x_posted() -> None:
	candidates = _run_candidate_builder(
		[
			{
                "id": "x-done-linkedin-pending",
                "status": "partially_published",
                "quality_score": "11",
                "keep_priority": "ship_now",
                "review_status": "hold",
                "x_post_url": "https://x.com/nichika2000823/status/123",
                "linkedin_post_url": "",
                "linkedin_text": "LinkedIn body https://example.com/source",
                "media_plan": "LinkedInリンクカード型 with official source link card",
                "review_notes": "Daily AI Browser Use-native publish candidate",
            }
        ],
        max_actions=2,
    )

	assert candidates == [
		{
			"id": "x-done-linkedin-pending",
			"platform": "linkedin",
			"surface": "LinkedInリンクカード型",
		}
	]


def test_publish_candidate_builder_accepts_playwright_cli_candidate_note_for_partial_resume() -> None:
	candidates = _run_candidate_builder(
		[
			{
				"id": "x-done-linkedin-pending-playwright-cli",
				"status": "partially_published",
				"quality_score": "11",
				"keep_priority": "ship_now",
				"review_status": "ready_morning",
				"x_post_url": "https://x.com/nichika2000823/status/123",
				"linkedin_post_url": "",
				"linkedin_text": "LinkedIn body https://example.com/source",
				"media_plan": "X本文+URL型 | LinkedInリンクカード型",
				"error": "x_post_url_recovered_readonly: existing X URL captured; Do not repost X. LinkedIn remains pending.",
				"review_notes": "Daily AI Playwright CLI publish candidate",
			}
		],
		max_actions=2,
	)

	assert candidates == [
		{
			"id": "x-done-linkedin-pending-playwright-cli",
			"platform": "linkedin",
			"surface": "LinkedInリンクカード型",
		}
	]


def test_profile2_publish_runner_linkedin_success_preserves_x_failure_reason() -> None:
	row = _run_publish_state_update(
		"markLinkedInPublished",
		{
			"id": "linkedin-after-x-fail",
			"status": "approved",
			"published_at": "",
			"x_post_url": "",
			"x_post_id": "",
			"error": "x_publish_failed: disabled_submit: X Post button was not enabled",
		},
		{
			"post_url": "https://www.linkedin.com/feed/update/urn:li:share:999/",
			"completion": "linkedin_post_url_captured",
		},
	)

	assert row["status"] == "partially_published"
	assert row["error"] == "x_publish_failed: disabled_submit: X Post button was not enabled"
	assert "X remains pending" in row["next_action"]


def test_profile2_publish_runner_x_success_preserves_linkedin_failure_reason() -> None:
    row = _run_publish_state_update(
        "markXPublished",
        {
            "id": "x-after-linkedin-fail",
            "status": "approved",
            "published_at": "",
            "linkedin_post_url": "",
            "linkedin_post_id": "",
            "error": "linkedin_publish_failed: link_card_not_reflected",
        },
        {
            "post_url": "https://x.com/nichika2000823/status/123",
            "completion": "x_post_url_captured",
        },
    )

    assert row["status"] == "partially_published"
    assert row["error"] == "linkedin_publish_failed: link_card_not_reflected"
    assert "LinkedIn remains pending" in row["next_action"]


def test_profile2_publish_runner_retries_link_card_failure_as_square_image_surface() -> None:
    runner = RUNNER_PATH.read_text(encoding="utf-8")
    assert "switchLinkedInLinkCardToSquareImageAfterReflectionFailure(row, receipt.error)" in runner
    assert 'receipt.surface = "LinkedIn正方形1枚画像型"' in runner
    assert "await publishLinkedInBySurface(tab, row, receipt.surface)" in runner
    assert "markLinkedInSkipped(row, receipt.error)" in runner


def test_profile2_publish_runner_skip_preserves_other_platform_failure_reason() -> None:
    row = _run_publish_state_update(
        "markLinkedInSkipped",
        {
            "id": "both-fail",
            "status": "approved",
            "error": "x_publish_failed: disabled_submit",
        },
        "link_card_not_reflected",
    )

    assert row["error"] == "x_publish_failed: disabled_submit; linkedin_publish_failed: link_card_not_reflected"
    assert row["next_action"].startswith("LinkedIn pending (surface).")
    assert "automation_failure_category=surface" in row["review_notes"]


def test_profile2_publish_runner_normalizes_openai_image_billing_failure() -> None:
    row = _run_publish_state_update(
        "markLinkedInSkipped",
        {
            "id": "linkedin-image-billing-fail",
            "status": "partially_published",
            "error": "",
            "review_notes": "",
        },
        "Command failed: RuntimeError: Error code: 400 - {'error': {'code': 'billing_hard_limit_reached', 'message': 'Billing hard limit has been reached.'}}",
    )

    assert row["error"] == "linkedin_publish_failed: image_generation_unavailable: billing_hard_limit_reached"
    assert row["next_action"].startswith("LinkedIn pending (image_generation).")
    assert "automation_failure_category=image_generation" in row["review_notes"]
    assert "Traceback" not in row["review_notes"]


def test_profile2_publish_runner_success_clears_own_failure_in_any_order() -> None:
    row = _run_publish_state_update(
        "markLinkedInPublished",
        {
            "id": "clear-linkedin-error",
            "status": "approved",
            "x_post_url": "",
            "x_post_id": "",
            "error": "x_publish_failed: disabled_submit; linkedin_publish_failed: link_card_not_reflected",
        },
        {
            "post_url": "https://www.linkedin.com/feed/update/urn:li:share:999/",
            "completion": "linkedin_post_url_captured",
        },
    )

    assert row["error"] == "x_publish_failed: disabled_submit"
    assert row["status"] == "partially_published"


def test_profile2_publish_runner_classifies_clickability_failures() -> None:
    row = _run_publish_state_update(
        "markXSkipped",
        {
            "id": "x-click-fail",
            "status": "approved",
            "error": "",
            "review_notes": "",
        },
        "disabled_submit: X Post button was not enabled",
    )

    assert row["error"] == "x_publish_failed: disabled_submit: X Post button was not enabled"
    assert row["next_action"].startswith("X pending (clickability).")
    assert "automation_failure_category=clickability" in row["review_notes"]


def test_profile2_publish_runner_classifies_auth_failures() -> None:
    row = _run_publish_state_update(
        "markLinkedInSkipped",
        {
            "id": "linkedin-auth-fail",
            "status": "partially_published",
            "error": "",
            "review_notes": "",
        },
        "auth_blocked: LinkedIn login required in Nicky automation profile.",
    )

    assert row["error"] == "linkedin_publish_failed: auth_blocked: LinkedIn login required in Nicky automation profile."
    assert row["next_action"].startswith("LinkedIn pending (auth).")
    assert "automation_failure_category=auth" in row["review_notes"]


def test_profile2_publish_runner_blocks_generic_do_not_repost_for_linkedin(tmp_path: Path) -> None:
    queue_path = tmp_path / "posting_queue.tsv"
    _write_queue(
        queue_path,
        [
            {
                "id": "blocked-linkedin",
                "status": "partially_published",
                "quality_score": "10",
                "keep_priority": "ship_now",
                "source_url": "https://www.microsoft.com/en-us/microsoft-365/blog/example/",
                "media_plan": "LinkedInリンクカード型",
                "linkedin_text": "PowerPoint usage is up 43%. https://www.microsoft.com/en-us/microsoft-365/blog/example/",
                "review_notes": "Local automation profile publish candidate",
                "next_action": "Do not repost until the existing post URL is verified.",
            }
        ],
    )

    result = _run_publish_runner(queue_path)
    payload = json.loads(result.stdout)

    assert result.returncode == 0
    assert payload["ok"] is True
    assert payload["result"]["published"] == 0
    assert "No X or LinkedIn publish candidates" in payload["result"]["message"]


def test_registered_trusted_dispatch_snapshots_metadata_and_claims_before_first_await() -> None:
    script = f"""
        import assert from "node:assert/strict";
        import {{
          runRegisteredAutomationWithTrustedBridge,
          snapshotTrustedHostRuntimeMetadata,
        }} from {json.dumps(str(BRIDGE_SERVER_PATH))};

        globalThis.nodeRepl = {{
          requestMeta: {{
            "x-codex-turn-metadata": {{
              session_id: "trusted-session",
              thread_id: "trusted-thread",
              turn_id: "trusted-turn",
              thread_source: "host",
            }},
          }},
        }};
        const snapshot = snapshotTrustedHostRuntimeMetadata();
        await Promise.resolve();
        globalThis.nodeRepl.requestMeta["x-codex-turn-metadata"].turn_id = "mutated-after-await";
        assert.equal(Object.isFrozen(snapshot), true);
        assert.deepEqual(snapshot, {{
          session_id: "trusted-session",
          thread_id: "trusted-thread",
          turn_id: "trusted-turn",
          thread_source: "host",
          subagent_kind: "",
          parent_thread_id: "",
        }});

        const source = runRegisteredAutomationWithTrustedBridge.toString();
        const firstAwait = source.indexOf("await ");
        assert.ok(firstAwait > 0);
        assert.ok(source.indexOf("snapshotTrustedHostRuntimeMetadata()") < firstAwait);
        assert.ok(source.indexOf("claimTrustedAutomationDispatchSync") < firstAwait);
        assert.equal(source.includes("codexTurnMetadataFromEnv"), false);
        assert.equal(source.includes("codexTurnMetadataFromPayload"), false);
    """
    subprocess.run(["node", "--input-type=module", "-e", script], check=True)


def test_registered_trusted_dispatch_missing_host_metadata_ignores_env_fallback() -> None:
    script = f"""
        import assert from "node:assert/strict";
        import {{ snapshotTrustedHostRuntimeMetadata }} from {json.dumps(str(BRIDGE_SERVER_PATH))};

        process.env.CODEX_SESSION_ID = "untrusted-env-session";
        process.env.CODEX_THREAD_ID = "untrusted-env-thread";
        process.env.CODEX_TURN_ID = "untrusted-env-turn";
        globalThis.nodeRepl = {{ requestMeta: {{}} }};
        const snapshot = snapshotTrustedHostRuntimeMetadata();
        assert.deepEqual(snapshot, {{
          session_id: "",
          thread_id: "",
          turn_id: "",
          thread_source: "trusted_host",
          subagent_kind: "",
          parent_thread_id: "",
        }});
    """
    subprocess.run(["node", "--input-type=module", "-e", script], check=True)


def test_registered_trusted_dispatch_rejects_worker_metadata_as_root_fallback() -> None:
    script = f"""
        import assert from "node:assert/strict";
        import {{
          runRegisteredAutomationWithTrustedBridge,
          snapshotTrustedHostRuntimeMetadata,
        }} from {json.dumps(str(BRIDGE_SERVER_PATH))};

        globalThis.nodeRepl = {{ requestMeta: {{ "x-codex-turn-metadata": {{
          session_id: "root-session",
          thread_id: "worker-thread",
          turn_id: "worker-turn",
          thread_source: "subagent",
          subagent_kind: "thread_spawn",
          parent_thread_id: "root-thread",
        }} }} }};
        const snapshot = snapshotTrustedHostRuntimeMetadata();
        assert.equal(snapshot.thread_source, "subagent");
        assert.equal(snapshot.subagent_kind, "thread_spawn");
        const source = runRegisteredAutomationWithTrustedBridge.toString();
        assert.equal(source.includes("trusted_browser_wrapper_root_runtime_required"), true);
        assert.equal(source.includes('trustedHostMetadata.thread_source === "subagent"'), true);
    """
    subprocess.run(["node", "--input-type=module", "-e", script], check=True)


def test_registered_trusted_dispatch_child_env_is_exact_and_special_character_safe() -> None:
    script = f"""
        import assert from "node:assert/strict";
        import {{ spawnSync }} from "node:child_process";
        import {{ buildTrustedAutomationChildEnv }} from {json.dumps(str(BRIDGE_SERVER_PATH))};

        const special = "turn-$()-'\\\";\\n日本語";
        const trustedHostMetadata = Object.freeze({{
          session_id: `session-${{special}}`,
          thread_id: `thread-${{special}}`,
          turn_id: special,
          thread_source: "host",
          subagent_kind: "",
          parent_thread_id: "",
        }});
        const request = {{
          automation_id: "sample",
          control_run_id: "control",
          origin_thread_id: "origin-thread",
          origin_session_id: "origin-session",
          origin_turn_id: "origin-turn",
          run_nonce: special,
          registered_prompt_sha256: "prompt",
          launch_message_sha256: "launch",
          registered_cwd: "/tmp/project",
          stage: "execute",
          issued_at: "issued",
          expires_at: "expires",
        }};
        const env = buildTrustedAutomationChildEnv({{
          request,
          resolvedRequestPath: "/tmp/control/request.json",
          trustedHostMetadata,
        }});
        assert.equal(Object.isFrozen(env), true);
        assert.equal(env.CODEX_TURN_ID, special);
        assert.equal(env.SOCIAL_FLOW_CONTROL_EXECUTION_TURN_ID, special);
        assert.equal(env.SOCIAL_FLOW_CONTROL_RUN_NONCE, special);
        const child = spawnSync(process.execPath, ["-e", "process.stdout.write(JSON.stringify({{turn:process.env.CODEX_TURN_ID,nonce:process.env.SOCIAL_FLOW_CONTROL_RUN_NONCE}}))"], {{
          env: {{ ...process.env, ...env }},
          encoding: "utf8",
        }});
        assert.equal(child.status, 0, child.stderr);
        assert.deepEqual(JSON.parse(child.stdout), {{ turn: special, nonce: special }});
    """
    subprocess.run(["node", "--input-type=module", "-e", script], check=True)


def test_registered_trusted_dispatch_claim_is_one_shot_and_failure_artifact_is_canonical(tmp_path: Path) -> None:
    script = f"""
        import assert from "node:assert/strict";
        import fs from "node:fs";
        import path from "node:path";
        import {{
          claimTrustedAutomationDispatchSync,
          writeTrustedDispatchPreChildFailureSync,
        }} from {json.dumps(str(BRIDGE_SERVER_PATH))};

        const runDir = {json.dumps(str(tmp_path / "control-run"))};
        fs.mkdirSync(runDir, {{ recursive: true, mode: 0o700 }});
        fs.chmodSync(runDir, 0o700);
        const requestPath = path.join(runDir, "request.json");
        fs.writeFileSync(requestPath, "{{}}\\n", {{ mode: 0o600 }});
        fs.writeFileSync(path.join(runDir, "terminal-blocker.json"), JSON.stringify({{ exact_blocker: "initial-shell-blocker" }}));
        const trustedHostMetadata = Object.freeze({{
          session_id: "session",
          thread_id: "thread",
          turn_id: "turn",
          thread_source: "host",
          subagent_kind: "",
          parent_thread_id: "",
        }});
        globalThis.process = undefined;
        const attempt = () => claimTrustedAutomationDispatchSync({{
          resolvedRequestPath: requestPath,
          trustedHostMetadata,
        }});
        const [first, second] = await Promise.allSettled([
          Promise.resolve().then(attempt),
          Promise.resolve().then(attempt),
        ]);
        assert.equal([first.status, second.status].filter((status) => status === "fulfilled").length, 1);
        assert.equal([first.status, second.status].filter((status) => status === "rejected").length, 1);
        const dispatchClaim = first.status === "fulfilled" ? first.value : second.value;
        assert.throws(attempt, /scheduler_control_trusted_dispatch_already_claimed/);
        const claimPath = path.join(runDir, "trusted-dispatch-claim.json");
        assert.equal(fs.existsSync(claimPath), true);

        const request = {{ automation_id: "sample", control_run_id: "control-run", stage: "execute" }};
        writeTrustedDispatchPreChildFailureSync({{
          request,
          resolvedRequestPath: requestPath,
          dispatchClaim,
          exactBlocker: "trusted_browser_wrapper_runtime_metadata_missing",
        }});
        const terminal = JSON.parse(fs.readFileSync(path.join(runDir, "terminal-blocker.json"), "utf8"));
        const cleanup = JSON.parse(fs.readFileSync(path.join(runDir, "cleanup-proof.json"), "utf8"));
        assert.equal(terminal.exact_blocker, "trusted_browser_wrapper_runtime_metadata_missing");
        assert.equal(terminal.phase, "trusted_dispatch_pre_child");
        assert.equal(terminal.dispatched, false);
        assert.equal(terminal.external_actions, 0);
        assert.equal(terminal.cleanup.child_started, false);
        assert.equal(terminal.cleanup.bridge_started, false);
        assert.equal(terminal.dispatch_claim_retained, true);
        assert.equal(terminal.dispatch_claim.path, claimPath);
        assert.deepEqual(terminal.cleanup.owned_processes_remaining, []);
        assert.equal(cleanup.external_actions, 0);
        assert.equal(cleanup.dispatch_claim_retained, true);
        assert.equal(fs.existsSync(claimPath), true);
    """
    subprocess.run(["node", "--input-type=module", "-e", script], check=True)


def test_trusted_process_manifest_strict_controller_and_child_bindings(tmp_path: Path) -> None:
    script = f"""
        import assert from "node:assert/strict";
        import fs from "node:fs";
        import path from "node:path";
        import {{
          readOwnedProcessManifestSync,
          terminateOwnedProcessGroups,
        }} from {json.dumps(str(BRIDGE_SERVER_PATH))};

        const schedulerRunDir = {json.dumps(str(tmp_path / "codex-app-manifest-run"))};
        fs.mkdirSync(schedulerRunDir, {{ recursive: true, mode: 0o700 }});
        fs.chmodSync(schedulerRunDir, 0o700);
        const ownerBinding = {{
          process_manifest_path: path.join(schedulerRunDir, "trusted-wrapper-process-manifest.json"),
          scheduler_run_dir: schedulerRunDir,
          scheduler_run_id: "run-1",
          control_run_id: "control-1",
          owner_id: "owner-1",
          bridge_instance_id: "bridge-1",
          bridge_url: "http://127.0.0.1:58737",
        }};
        const basePayload = {{
          schema: "scheduler_control_owned_process_manifest.v1",
          scheduler_run_id: "run-1",
          scheduler_run_dir: schedulerRunDir,
          control_run_id: "control-1",
          owner_id: "owner-1",
          bridge_instance_id: "bridge-1",
          bridge_url: "http://127.0.0.1:58737",
          controller_pid: 999999,
          controller_pgid: 999999,
          child_started: false,
        }};
        const writeManifest = (overrides = {{}}) => {{
          fs.writeFileSync(ownerBinding.process_manifest_path, JSON.stringify({{ ...basePayload, ...overrides }}), {{ mode: 0o600 }});
          fs.chmodSync(ownerBinding.process_manifest_path, 0o600);
        }};

        // A trusted preflight may carry only the controller binding.
        writeManifest();
        const controllerOnly = readOwnedProcessManifestSync(ownerBinding, {{ requireChild: false }});
        assert.equal(controllerOnly.payload.controller_pid, 999999);
        assert.equal(controllerOnly.payload.controller_pgid, 999999);
        assert.throws(
          () => readOwnedProcessManifestSync(ownerBinding, {{ requireChild: true }}),
          /trusted_wrapper_process_manifest_child_binding_missing/,
        );
        const clean = await terminateOwnedProcessGroups({{
          ownerBinding,
          termGraceMs: 10,
          killGraceMs: 10,
          requireChild: false,
        }});
        assert.deepEqual(clean.remaining, []);

        // Controller IDs are never coerced from malformed values.
        writeManifest({{ controller_pid: 0 }});
        assert.throws(
          () => readOwnedProcessManifestSync(ownerBinding, {{ requireChild: false }}),
          /trusted_wrapper_process_manifest_controller_binding_invalid/,
        );
        const malformedController = await terminateOwnedProcessGroups({{
          ownerBinding,
          termGraceMs: 10,
          killGraceMs: 10,
          requireChild: false,
        }});
        assert.ok(malformedController.remaining.some((entry) => entry.includes("controller_binding_invalid")));

        // Once child_started=true, all child IDs must be positive and aliases must agree.
        writeManifest({{
          child_started: true,
          workflow_child_pid: 0,
          workflow_child_pgid: 999998,
          child_pid: 999999,
          child_pgid: 999998,
        }});
        assert.throws(
          () => readOwnedProcessManifestSync(ownerBinding, {{ requireChild: false }}),
          /trusted_wrapper_process_manifest_child_binding_invalid/,
        );
        writeManifest({{
          child_started: true,
          workflow_child_pid: 999998,
          workflow_child_pgid: 999998,
          child_pid: 999997,
          child_pgid: 999998,
        }});
        assert.throws(
          () => readOwnedProcessManifestSync(ownerBinding, {{ requireChild: true }}),
          /trusted_wrapper_process_manifest_child_binding_invalid/,
        );
    """
    subprocess.run(["node", "--input-type=module", "-e", script], check=True)


def test_trusted_wrapper_receipt_publication_is_bound_atomic_and_one_shot(tmp_path: Path) -> None:
    script = f"""
        import assert from "node:assert/strict";
        import fs from "node:fs";
        import path from "node:path";
        import {{ issueTrustedWrapperReceiptSync }} from {json.dumps(str(BRIDGE_SERVER_PATH))};

        const schedulerRunDir = {json.dumps(str(tmp_path / "codex-app-sample-run-1"))};
        fs.mkdirSync(schedulerRunDir, {{ recursive: true, mode: 0o700 }});
        fs.chmodSync(schedulerRunDir, 0o700);
        const request = {{
          request_id: "request-1",
          automation_id: "sample",
          control_run_id: "control-1",
          run_nonce: "nonce-1",
          mode: "preflight",
          stage: "preflight",
          scheduler_run_id: "run-1",
          scheduler_run_dir: schedulerRunDir,
          expires_at: new Date(Date.now() + 60000).toISOString(),
        }};
        const args = {{
          request,
          resolvedRequestPath: "/tmp/control/request.json",
          trustedHostMetadata: {{ session_id: "session", thread_id: "thread", turn_id: "turn" }},
          bridgeInfo: {{ bridge_instance_id: "bridge-1", url: "http://127.0.0.1:58737" }},
          ownerBinding: {{
            owner_id: "owner-1",
            owner_start_path: path.join(schedulerRunDir, "trusted-wrapper-owner-start.json"),
            owner_heartbeat_path: path.join(schedulerRunDir, "trusted-wrapper-owner-heartbeat.json"),
            owner_terminal_path: path.join(schedulerRunDir, "trusted-wrapper-owner-terminal.json"),
            timeout_seconds: 18000,
          }},
          browserBinding: {{
            id: "profile-2",
            name: "Chrome",
            type: "extension",
            metadata: {{ profileOrdering: 2, profileName: "Nicky/Profile 2" }},
          }},
        }};
        globalThis.process = undefined;
        const first = issueTrustedWrapperReceiptSync(args);
        const original = fs.readFileSync(first.path, "utf8");
        const payload = JSON.parse(fs.readFileSync(first.path, "utf8"));
        assert.equal(payload.request_id, "request-1");
        assert.equal(payload.control_run_id, "control-1");
        assert.equal(payload.execution_turn_id, "turn");
        assert.equal(payload.bridge_instance_id, "bridge-1");
        assert.equal(payload.browser_id, "profile-2");
        assert.equal(payload.mode, "preflight");
        assert.equal(payload.external_actions, 0);
        assert.equal(payload.owner_id, "owner-1");
        assert.equal(payload.owner_timeout_seconds, 18000);
        assert.equal(fs.lstatSync(first.path).isSymbolicLink(), false);
        assert.equal(fs.statSync(first.path).mode & 0o777, 0o600);
        assert.throws(() => issueTrustedWrapperReceiptSync(args), /trusted_wrapper_receipt_already_exists/);
        assert.equal(fs.readFileSync(first.path, "utf8"), original);
        assert.equal(fs.readdirSync(schedulerRunDir).filter((name) => name.includes(".tmp")).length, 0);
    """
    subprocess.run(["node", "--input-type=module", "-e", script], check=True)


def test_registered_trusted_dispatch_resets_cached_bridge_and_binds_fresh_receipt_before_child() -> None:
    script = f"""
        import assert from "node:assert/strict";
        import {{
          runChromeExtensionTrustedBridgeCommand,
          runRegisteredAutomationWithTrustedBridge,
        }} from {json.dumps(str(BRIDGE_SERVER_PATH))};
        const source = runRegisteredAutomationWithTrustedBridge.toString();
        const commandSource = runChromeExtensionTrustedBridgeCommand.toString();
        assert.equal(source.includes("stopChromeExtensionTrustedBridge"), true);
        assert.equal(source.includes("__socialFlowChromeExtensionProfile2Verified = false"), true);
        assert.equal(source.includes("setupChromeExtensionProfile2Runtime"), true);
        assert.equal(source.includes("issueTrustedWrapperReceiptSync"), true);
        assert.ok(source.indexOf("issueTrustedWrapperReceiptSync") < source.indexOf("onChildSpawn"));
        assert.equal(source.includes("SOCIAL_FLOW_TRUSTED_WRAPPER_RECEIPT_PATH"), true);
        assert.equal(source.includes("backgroundOwner: true"), true);
        assert.ok(commandSource.indexOf("prepareChildEnv") < commandSource.indexOf("spawn("));
    """
    subprocess.run(["node", "--input-type=module", "-e", script], check=True)


def test_background_trusted_owner_lifecycle_is_time_compressed_and_deterministic(tmp_path: Path) -> None:
    script = f"""
        import assert from "node:assert/strict";
        import fs from "node:fs";
        import path from "node:path";
        import {{
          runChromeExtensionTrustedBridgeCommand,
          startChromeExtensionTrustedBridge,
          startTrustedAutomationOwnerSync,
        }} from {json.dumps(str(BRIDGE_SERVER_PATH))};
        const globals = {{}};
        const schedulerRunDir = {json.dumps(str(tmp_path / "codex-app-sample-run"))};
        fs.mkdirSync(schedulerRunDir, {{ recursive: true, mode: 0o700 }});
        fs.chmodSync(schedulerRunDir, 0o700);
        const bridgeInfo = await startChromeExtensionTrustedBridge({{ host: "127.0.0.1", port: 0, globals }});
        const request = {{
          request_id: "request-1",
          control_run_id: "control-1",
          scheduler_run_id: "run-1",
          scheduler_run_dir: schedulerRunDir,
        }};
        const ownerBinding = startTrustedAutomationOwnerSync({{
          request,
          bridgeInfo,
          timeoutSeconds: 1,
          heartbeatIntervalMs: 10,
          killGraceMs: 10,
        }});
        const started = Date.now();
        const ack = await runChromeExtensionTrustedBridgeCommand({{
          command: [process.execPath, "-e", "setTimeout(() => process.exit(0), 120)"],
          host: "127.0.0.1",
          port: 0,
          globals,
          backgroundOwner: true,
          ownerBinding,
        }});
        assert.equal(ack.status, "owner_started");
        assert.ok(Date.now() - started < 100);
        assert.equal(fs.existsSync(ownerBinding.owner_start_path), true);
        await globals.__socialFlowTrustedAutomationOwners.get(ownerBinding.owner_id);
        const heartbeat = JSON.parse(fs.readFileSync(ownerBinding.owner_heartbeat_path, "utf8"));
        const terminal = JSON.parse(fs.readFileSync(ownerBinding.owner_terminal_path, "utf8"));
        const cleanup = JSON.parse(fs.readFileSync(ownerBinding.owner_cleanup_path, "utf8"));
        assert.ok(heartbeat.sequence > 1);
        assert.equal(terminal.status, "completed");
        assert.deepEqual(cleanup.owned_processes_remaining, []);
        assert.equal(globals.__socialFlowChromeExtensionBridge, null);
    """
    subprocess.run(["node", "--input-type=module", "-e", script], check=True)


def test_trusted_wrapper_atomic_paths_have_no_pid_or_environment_fallback() -> None:
    source = BRIDGE_SERVER_PATH.read_text(encoding="utf-8")
    assert "process.pid" not in source
    assert "runtimePid" not in source
    assert "runtime_pid" not in source
    assert ".tmp-${publicationId}" in source
    assert 'fsSync.openSync(tempPath, "wx", 0o600)' in source
    assert "fsSync.linkSync(tempPath, publicationPath)" in source
