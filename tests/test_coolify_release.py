from __future__ import annotations

import argparse
import ast
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock
import yaml

from infra import coolify_release as release
from infra import smokecheck


APPLICATION_UUID = "b" * 24
DEPLOYMENT_UUID = "d" * 24
ROLLBACK_UUID = "r" * 24
OLD_DIGEST = f"sha256:{'1' * 64}"
NEW_DIGEST = f"sha256:{'2' * 64}"
OLD_REVISION = "3" * 40
NEW_REVISION = "4" * 40


def sample_contract() -> dict[str, object]:
    return {
        "name": "inventory-generator",
        "build_pack": "dockerimage",
        "docker_registry_image_name": "ghcr.io/szczepangrela/inventory-generator",
        "fqdn": "https://inventory-generator.grela.dev:8080",
        "domains": None,
        "redirect": "both",
        "ports_exposes": "8080",
        "ports_mappings": None,
        "health_check_enabled": True,
        "health_check_type": "cmd",
        "health_check_command": "curl --fail --silent --show-error --max-time 4 http://127.0.0.1:8080/api/health",
        "health_check_interval": 5,
        "health_check_timeout": 5,
        "health_check_retries": 10,
        "health_check_start_period": 10,
        "custom_labels": None,
        "custom_network_aliases": None,
        "destination_type": "App\\Models\\StandaloneDocker",
        "destination_id": 2,
        "max_restart_count": 10,
        "limits_memory": "512m",
        "limits_memory_swap": "512m",
        "limits_memory_swappiness": 0,
        "limits_memory_reservation": "128m",
        "limits_cpus": "1",
        "limits_cpu_shares": 1024,
        "custom_docker_run_options": "--cap-drop=ALL --init",
        "settings": {
            "connect_to_docker_network": False,
            "docker_images_to_keep": 2,
            "is_consistent_container_name_enabled": False,
            "is_container_label_readonly_enabled": True,
            "is_force_https_enabled": False,
            "stop_grace_period": None,
        },
    }


class FakeClient:
    def __init__(self, expected: dict[str, object], statuses: list[list[str]]) -> None:
        self.application = expected | {
            "id": 1,
            "uuid": APPLICATION_UUID,
            "status": "running:healthy",
            "docker_registry_image_tag": release.digest_to_tag(OLD_DIGEST),
        }
        self.statuses_to_queue = [list(values) for values in statuses]
        self.deployment_statuses: dict[str, list[str]] = {}
        self.updates: list[str] = []
        self.queued: list[str] = []
        self.cancelled: list[str] = []
        self.application_deployments: list[dict[str, object]] = []
        self.live_revision = OLD_REVISION

    def get_application(self, application_uuid: str) -> dict[str, object]:
        assert application_uuid == APPLICATION_UUID
        return dict(self.application)

    def update_tag(self, application_uuid: str, tag: str) -> None:
        assert application_uuid == APPLICATION_UUID
        self.updates.append(tag)
        self.application["docker_registry_image_tag"] = tag

    def list_application_deployments(
        self,
        application_uuid: str,
    ) -> list[dict[str, object]]:
        assert application_uuid == APPLICATION_UUID
        return list(self.application_deployments)

    def queue_deployment(self, application_uuid: str) -> str:
        assert application_uuid == APPLICATION_UUID
        deployment_uuid = DEPLOYMENT_UUID if not self.queued else ROLLBACK_UUID
        self.queued.append(deployment_uuid)
        self.deployment_statuses[deployment_uuid] = self.statuses_to_queue.pop(0)
        return deployment_uuid

    def get_deployment(self, deployment_uuid: str) -> dict[str, object]:
        statuses = self.deployment_statuses[deployment_uuid]
        status = statuses.pop(0) if len(statuses) > 1 else statuses[0]
        if status == "finished":
            tag = self.application["docker_registry_image_tag"]
            self.live_revision = (
                NEW_REVISION
                if tag == release.digest_to_tag(NEW_DIGEST)
                else OLD_REVISION
            )
        return {"deployment_uuid": deployment_uuid, "status": status}

    def cancel_deployment(self, deployment_uuid: str) -> None:
        self.cancelled.append(deployment_uuid)
        self.deployment_statuses[deployment_uuid] = ["cancelled"]


class TestCoolifyRelease(unittest.TestCase):
    def setUp(self):
        self.contract_path = Path("infra/coolify-production.json")
        self.assertTrue(self.contract_path.exists())

    def test_contract_loaded_matches_sample(self):
        loaded = release.load_contract(self.contract_path)
        sample = sample_contract()
        mismatches = release._compare_contract(loaded, sample)
        self.assertEqual(mismatches, [])

    def test_digest_and_tag_conversion(self):
        digest = f"sha256:{'a' * 64}"
        tag = f"sha256-{'a' * 64}"
        self.assertEqual(release.digest_to_tag(digest), tag)
        self.assertEqual(release.tag_to_digest(tag), digest)

        with self.assertRaises(release.ReleaseError):
            release.digest_to_tag("invalid:123")
        with self.assertRaises(release.ReleaseError):
            release.tag_to_digest("invalid-123")

    def test_contract_drift_detection(self):
        app = sample_contract() | {"uuid": APPLICATION_UUID, "limits_memory": "256m"}
        with self.assertRaises(release.ReleaseError) as ctx:
            release.verify_application(app, sample_contract(), APPLICATION_UUID)
        self.assertIn("limits_memory", str(ctx.exception))

    @patch.dict(os.environ, {"COOLIFY_TOKEN": "test-token"})
    @patch("infra.coolify_release.verify_image_revision")
    @patch("infra.coolify_release.check_public_baseline")
    @patch("infra.coolify_release.check_public_release")
    def test_happy_path_deployment(
        self,
        mock_release_smoke,
        mock_baseline_smoke,
        mock_verify_img,
    ):
        client = FakeClient(sample_contract(), [["in_progress", "finished"]])
        args = argparse.Namespace(
            coolify_url="https://coolify.internal",
            application_uuid=APPLICATION_UUID,
            public_url="https://inventory-generator.grela.dev",
            digest=NEW_DIGEST,
            expected_revision=NEW_REVISION,
            contract=self.contract_path,
            deployment_timeout=5,
            poll_interval=0.001,
            settle_checks=1,
            settle_attempts=3,
            soak_checks=1,
        )

        with patch("infra.coolify_release.CoolifyClient", return_value=client):
            with patch(
                "infra.coolify_release.read_public_revision",
                side_effect=lambda url: client.live_revision,
            ):
                release.deploy_release(args)

        self.assertEqual(client.updates, [release.digest_to_tag(NEW_DIGEST)])
        self.assertEqual(client.queued, [DEPLOYMENT_UUID])
        self.assertEqual(client.cancelled, [])
        mock_baseline_smoke.assert_called_once()
        mock_release_smoke.assert_called_once()

    @patch.dict(os.environ, {"COOLIFY_TOKEN": "test-token"})
    def test_active_deployment_conflict(self):
        client = FakeClient(sample_contract(), [])
        client.application_deployments = [{"status": "in_progress"}]
        args = argparse.Namespace(
            coolify_url="https://coolify.internal",
            application_uuid=APPLICATION_UUID,
            public_url="https://inventory-generator.grela.dev",
            digest=NEW_DIGEST,
            expected_revision=NEW_REVISION,
            contract=self.contract_path,
            deployment_timeout=5,
            poll_interval=0.001,
            settle_checks=1,
            settle_attempts=3,
            soak_checks=1,
        )

        with patch("infra.coolify_release.CoolifyClient", return_value=client):
            with self.assertRaises(release.ReleaseError) as ctx:
                release.deploy_release(args)
            self.assertIn("already running", str(ctx.exception))

    @patch.dict(os.environ, {"COOLIFY_TOKEN": "test-token"})
    @patch("infra.coolify_release.verify_image_revision")
    @patch("infra.coolify_release.check_public_baseline")
    @patch("infra.coolify_release.check_public_release")
    def test_already_configured_and_active_noop(
        self,
        mock_release_smoke,
        mock_baseline_smoke,
        mock_verify_img,
    ):
        client = FakeClient(sample_contract(), [])
        client.application["docker_registry_image_tag"] = release.digest_to_tag(NEW_DIGEST)
        client.live_revision = NEW_REVISION

        args = argparse.Namespace(
            coolify_url="https://coolify.internal",
            application_uuid=APPLICATION_UUID,
            public_url="https://inventory-generator.grela.dev",
            digest=NEW_DIGEST,
            expected_revision=NEW_REVISION,
            contract=self.contract_path,
            deployment_timeout=5,
            poll_interval=0.001,
            settle_checks=1,
            settle_attempts=3,
            soak_checks=1,
        )

        with patch("infra.coolify_release.CoolifyClient", return_value=client):
            with patch(
                "infra.coolify_release.read_public_revision",
                return_value=NEW_REVISION,
            ):
                release.deploy_release(args)

        self.assertEqual(client.updates, [])
        self.assertEqual(client.queued, [])
        mock_release_smoke.assert_called_once()

    @patch.dict(os.environ, {"COOLIFY_TOKEN": "test-token"})
    @patch("infra.coolify_release.verify_image_revision")
    @patch("infra.coolify_release.check_public_baseline")
    @patch("infra.coolify_release.check_public_release")
    def test_rollback_on_deployment_failure(
        self,
        mock_release_smoke,
        mock_baseline_smoke,
        mock_verify_img,
    ):
        client = FakeClient(
            sample_contract(),
            [
                ["in_progress", "failed"],   # Candidate fails
                ["in_progress", "finished"], # Rollback succeeds
            ],
        )

        args = argparse.Namespace(
            coolify_url="https://coolify.internal",
            application_uuid=APPLICATION_UUID,
            public_url="https://inventory-generator.grela.dev",
            digest=NEW_DIGEST,
            expected_revision=NEW_REVISION,
            contract=self.contract_path,
            deployment_timeout=5,
            poll_interval=0.001,
            settle_checks=1,
            settle_attempts=3,
            soak_checks=1,
        )

        with patch("infra.coolify_release.CoolifyClient", return_value=client):
            with patch(
                "infra.coolify_release.read_public_revision",
                side_effect=lambda url: client.live_revision,
            ):
                with self.assertRaises(release.ReleaseError) as ctx:
                    release.deploy_release(args)
                self.assertIn("rollback", str(ctx.exception))

        self.assertEqual(
            client.updates,
            [release.digest_to_tag(NEW_DIGEST), release.digest_to_tag(OLD_DIGEST)],
        )
        self.assertEqual(client.queued, [DEPLOYMENT_UUID, ROLLBACK_UUID])

    @patch.dict(os.environ, {"COOLIFY_TOKEN": "test-token"})
    @patch("infra.coolify_release.verify_image_revision")
    @patch("infra.coolify_release.check_public_baseline")
    def test_rollback_on_consecutive_probe_failures_during_overlap(
        self,
        mock_baseline_smoke,
        mock_verify_img,
    ):
        client = FakeClient(
            sample_contract(),
            [
                ["in_progress", "in_progress", "in_progress", "in_progress"], # Candidate
                ["in_progress", "finished"],                                   # Rollback
            ],
        )

        probe_responses = [
            OLD_REVISION,  # Baseline
            release.ReleaseError("down"), # Failure 1
            release.ReleaseError("down"), # Failure 2
            release.ReleaseError("down"), # Failure 3 -> triggers cancel & rollback
            OLD_REVISION,  # Rollback revision checks
            OLD_REVISION,
            OLD_REVISION,
            OLD_REVISION,
        ]

        def dynamic_probe(url):
            if probe_responses:
                val = probe_responses.pop(0)
                if isinstance(val, Exception):
                    raise val
                return val
            return OLD_REVISION

        args = argparse.Namespace(
            coolify_url="https://coolify.internal",
            application_uuid=APPLICATION_UUID,
            public_url="https://inventory-generator.grela.dev",
            digest=NEW_DIGEST,
            expected_revision=NEW_REVISION,
            contract=self.contract_path,
            deployment_timeout=5,
            poll_interval=0.001,
            settle_checks=1,
            settle_attempts=3,
            soak_checks=1,
        )

        with patch("infra.coolify_release.CoolifyClient", return_value=client):
            with patch("infra.coolify_release.read_public_revision", side_effect=dynamic_probe):
                with self.assertRaises(release.ReleaseError) as ctx:
                    release.deploy_release(args)
                self.assertIn("three consecutive deployment probes", str(ctx.exception))

        self.assertEqual(client.cancelled, [DEPLOYMENT_UUID])
        self.assertEqual(client.queued, [DEPLOYMENT_UUID, ROLLBACK_UUID])


class TestSmokeCheck(unittest.TestCase):
    def test_validate_inputs(self):
        with self.assertRaises(ValueError):
            smokecheck._validate_inputs("ftp://bad", "a" * 40)
        with self.assertRaises(ValueError):
            smokecheck._validate_inputs("http://good.example", "bad-rev")

    @patch("infra.smokecheck._read_json")
    def test_check_health_success(self, mock_read_json):
        rev = "a" * 40
        mock_read_json.return_value = {"status": "ok", "revision": rev}
        smokecheck.check_health("http://localhost:8080", rev)

    @patch("infra.smokecheck._read_json")
    def test_check_health_mismatched_revision(self, mock_read_json):
        mock_read_json.return_value = {"status": "ok", "revision": "b" * 40}
        with self.assertRaises(ValueError) as ctx:
            smokecheck.check_health("http://localhost:8080", "a" * 40)
        self.assertIn("does not match", str(ctx.exception))

    @patch("infra.smokecheck._open")
    def test_check_assets_missing_security_headers(self, mock_open):
        mock_response = MagicMock()
        mock_response.status = 200
        mock_response.read.return_value = b"<!DOCTYPE html><html></html>"
        mock_response.headers = {}
        mock_open.return_value.__enter__.return_value = mock_response

        with self.assertRaises(ValueError) as ctx:
            smokecheck._check_assets("http://localhost:8080", timeout=5, require_security_headers=True)
        self.assertIn("missing", str(ctx.exception))

    @patch("infra.smokecheck._open")
    def test_check_assets_valid_security_headers(self, mock_open):
        mock_response = MagicMock()
        mock_response.status = 200
        mock_response.read.return_value = b"<!DOCTYPE html><html></html>"
        mock_response.headers = {
            "Content-Security-Policy": "default-src 'self'",
            "X-Content-Type-Options": "nosniff",
            "X-Frame-Options": "DENY",
            "Referrer-Policy": "strict-origin-when-cross-origin",
            "Permissions-Policy": "camera=(), microphone=()",
        }
        mock_open.return_value.__enter__.return_value = mock_response

        smokecheck._check_assets("http://localhost:8080", timeout=5, require_security_headers=True)


if __name__ == "__main__":
    unittest.main()


class TestCoolifyReleaseEdgeCases(unittest.TestCase):
    @patch.dict(os.environ, {"COOLIFY_TOKEN": "test-token"})
    @patch("infra.coolify_release.verify_image_revision")
    @patch("infra.coolify_release.check_public_baseline")
    def test_uncertain_deployment_request_stops_mutation(
        self,
        mock_baseline,
        mock_verify_img,
    ):
        class UncertainClient(FakeClient):
            def queue_deployment(self, application_uuid: str) -> str:
                raise release.UncertainDeployment("network dropped during deploy request")

        client = UncertainClient(sample_contract(), [])
        args = argparse.Namespace(
            coolify_url="https://coolify.internal",
            application_uuid=APPLICATION_UUID,
            public_url="https://inventory-generator.grela.dev",
            digest=NEW_DIGEST,
            expected_revision=NEW_REVISION,
            contract=Path("infra/coolify-production.json"),
            deployment_timeout=5,
            poll_interval=0.001,
            settle_checks=1,
            settle_attempts=3,
            soak_checks=1,
        )

        with patch("infra.coolify_release.CoolifyClient", return_value=client):
            with patch("infra.coolify_release.read_public_revision", return_value=OLD_REVISION):
                with self.assertRaises(release.UncertainDeployment) as ctx:
                    release.deploy_release(args)
                self.assertIn("network dropped", str(ctx.exception))

        self.assertEqual(client.updates, [release.digest_to_tag(NEW_DIGEST)])
        self.assertEqual(client.queued, [])

    def test_cancellation_must_reach_terminal_state(self):
        client = FakeClient(sample_contract(), [])
        client.deployment_statuses[DEPLOYMENT_UUID] = ["in_progress", "cancelled"]

        with patch("infra.coolify_release.time.sleep", return_value=None):
            release.cancel_and_confirm(
                client,
                DEPLOYMENT_UUID,
                timeout=1,
                interval=0.001,
            )

        self.assertEqual(client.cancelled, [DEPLOYMENT_UUID])

    def test_cancellation_reconciles_error_with_terminal_state(self):
        class ErrorOnCancelClient(FakeClient):
            def cancel_deployment(self, deployment_uuid: str) -> None:
                self.cancelled.append(deployment_uuid)
                raise release.ReleaseError("HTTP 502 Bad Gateway")

        client = ErrorOnCancelClient(sample_contract(), [])
        client.deployment_statuses[DEPLOYMENT_UUID] = ["cancelled-by-user"]

        with patch("infra.coolify_release.time.sleep", return_value=None):
            release.cancel_and_confirm(
                client,
                DEPLOYMENT_UUID,
                timeout=1,
                interval=0.001,
            )

        self.assertEqual(client.cancelled, [DEPLOYMENT_UUID])

    @patch("infra.smokecheck._open")
    def test_smoke_check_attributes_and_exports(self, mock_open):
        class FakeContext:
            def __init__(self, resp):
                self.resp = resp
            def __enter__(self):
                return self.resp
            def __exit__(self, *args):
                pass

        def fake_open(req, timeout):
            url = req.full_url if hasattr(req, "full_url") else str(req)
            resp = MagicMock()
            if "/api/attributes/default/en" in url:
                resp.status = 200
                resp.read.return_value = json.dumps([{"name": "Item"}]).encode()
            elif "/api/export/csv" in url and getattr(req, "data", None) == b"{}":
                import urllib.error
                err = urllib.error.HTTPError(url, 400, "Bad Request", {}, io.BytesIO(b"Bad"))
                err.close()
                raise err
            elif "/api/export/" in url:
                resp.status = 200
                fmt = url.split("/")[-1]
                ct = {
                    "csv": "text/csv; charset=utf-8",
                    "html": "text/html; charset=utf-8",
                    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                }[fmt]
                resp.headers = {"Content-Type": ct}
                resp.read.return_value = b"sample-file-bytes"
            else:
                resp.status = 200
                resp.read.return_value = b"ok"
            return FakeContext(resp)

        mock_open.side_effect = fake_open
        smokecheck._check_attributes("http://localhost:8080", timeout=5)
        smokecheck._check_exports("http://localhost:8080", timeout=5)

    def test_rollback_stops_on_active_deployment(self):
        client = FakeClient(sample_contract(), [])
        client.application_deployments = [{"status": "in_progress"}]
        contract = sample_contract()
        with self.assertRaises(release.ReleaseError) as ctx:
            release.rollback(
                client=client,
                application_uuid=APPLICATION_UUID,
                previous_tag=release.digest_to_tag(OLD_DIGEST),
                previous_revision=OLD_REVISION,
                failed_revision=NEW_REVISION,
                contract=contract,
                public_url="https://inventory-generator.grela.dev",
                timeout=5,
                interval=0.001,
                health_attempts=3,
            )
        self.assertIn("another Coolify deployment is already running", str(ctx.exception))
        # Ensure no mutation occurred
        self.assertEqual(client.updates, [])
        self.assertEqual(client.queued, [])

    def test_rollback_stops_on_unknown_deployment_status(self):
        client = FakeClient(sample_contract(), [])
        client.application_deployments = [{"status": "unexpected-custom-state"}]
        contract = sample_contract()
        with self.assertRaises(release.UncertainDeployment) as ctx:
            release.rollback(
                client=client,
                application_uuid=APPLICATION_UUID,
                previous_tag=release.digest_to_tag(OLD_DIGEST),
                previous_revision=OLD_REVISION,
                failed_revision=NEW_REVISION,
                contract=contract,
                public_url="https://inventory-generator.grela.dev",
                timeout=5,
                interval=0.001,
                health_attempts=3,
            )
        self.assertIn("unknown deployment status", str(ctx.exception))
        # Ensure no mutation occurred
        self.assertEqual(client.updates, [])
        self.assertEqual(client.queued, [])

    def test_verify_no_running_deployment_offline_states(self):
        client = FakeClient(sample_contract(), [])
        # Terminal statuses pass without error
        for terminal_status in ["finished", "failed", "cancelled", "cancelled-by-user"]:
            client.application_deployments = [{"status": terminal_status}]
            release.verify_no_running_deployment(client, APPLICATION_UUID)

        # Active statuses raise ReleaseError
        for active_status in ["queued", "in_progress"]:
            client.application_deployments = [{"status": active_status}]
            with self.assertRaises(release.ReleaseError):
                release.verify_no_running_deployment(client, APPLICATION_UUID)

        # Unknown / non-terminal statuses raise UncertainDeployment
        for unknown_status in ["pending_approval", "unknown", "initializing"]:
            client.application_deployments = [{"status": unknown_status}]
            with self.assertRaises(release.UncertainDeployment):
                release.verify_no_running_deployment(client, APPLICATION_UUID)


class TestOperatorProceduresAndDeployWorkflow(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        deploy_yml_path = Path(__file__).resolve().parent.parent / ".github" / "workflows" / "deploy.yml"
        runbook_path = Path(__file__).resolve().parent.parent / "docs" / "operator-procedures.md"

        # Extract actual workflow step scripts from .github/workflows/deploy.yml
        deploy_data = yaml.safe_load(deploy_yml_path.read_text(encoding="utf-8"))
        preflight_steps = deploy_data["jobs"]["preflight"]["steps"]
        step_scripts = {s.get("id"): s.get("run") for s in preflight_steps if "id" in s}

        cls.freshness_script = step_scripts["freshness"]
        cls.image_script = step_scripts["image"]

        # Extract actual container selector script from docs/operator-procedures.md
        runbook_text = runbook_path.read_text(encoding="utf-8")
        match = re.search(
            r"(CONTAINER_COUNT=\$\(echo \$CONTAINERS \| wc -w\).*?\nfi)",
            runbook_text,
            re.DOTALL,
        )
        if not match:
            raise RuntimeError("Could not find container selector snippet in docs/operator-procedures.md")
        cls.selector_script = match.group(1)

        # Extract actual manual rollback python snippet from docs/operator-procedures.md (Section 2.2 Option B)
        py_match = re.search(
            r"#### Opcja B.*?"
            r"```bash\s*\npython3 -c '(.*?)'\s*\n```",
            runbook_text,
            re.DOTALL,
        )
        if not py_match:
            raise RuntimeError("Could not find manual python snippet under Option B in docs/operator-procedures.md")
        cls.manual_rollback_script = py_match.group(1).strip()

    def _run_freshness_gate(
        self, event_name: str, expected_revision: str, main_revision: str
    ) -> bool:
        with tempfile.TemporaryDirectory() as tmpdir:
            gh_bin = Path(tmpdir) / "gh"
            gh_bin.write_text(f"#!/bin/sh\necho {main_revision}\n", encoding="utf-8")
            gh_bin.chmod(0o755)
            out_file = Path(tmpdir) / "output"
            out_file.touch()
            env = dict(os.environ)
            old_path = env.get("PATH", "")
            env["PATH"] = f"{tmpdir}:{old_path}"
            env["EVENT_NAME"] = event_name
            env["EXPECTED_REVISION"] = expected_revision
            env["GITHUB_REPOSITORY"] = "SzczepanGrela/inventory-generator"
            env["GITHUB_OUTPUT"] = str(out_file)
            res = subprocess.run(
                ["bash", "-c", self.freshness_script],
                env=env,
                capture_output=True,
                text=True,
                check=True,
            )
            return "deploy=true" in out_file.read_text(encoding="utf-8")

    def _run_image_revision_check(
        self, expected_revision: str, image_label: str
    ) -> bool:
        with tempfile.TemporaryDirectory() as tmpdir:
            docker_bin = Path(tmpdir) / "docker"
            docker_bin.write_text(
                f"""#!/bin/sh
if [ "$1" = "pull" ]; then exit 0; fi
if [ "$1" = "image" ] && [ "$2" = "inspect" ]; then
    echo "{image_label}"
    exit 0
fi
exit 0
""",
                encoding="utf-8",
            )
            docker_bin.chmod(0o755)
            out_file = Path(tmpdir) / "output"
            out_file.touch()
            env = dict(os.environ)
            old_path = env.get("PATH", "")
            env["PATH"] = f"{tmpdir}:{old_path}"
            env["IMAGE_NAME"] = "ghcr.io/szczepangrela/inventory-generator"
            env["DIGEST"] = "sha256:" + "0" * 64
            env["EXPECTED_REVISION"] = expected_revision
            env["GITHUB_OUTPUT"] = str(out_file)
            res = subprocess.run(
                ["bash", "-c", self.image_script],
                env=env,
                capture_output=True,
                text=True,
            )
            return res.returncode == 0

    def _run_container_selector(self, containers: str):
        with tempfile.TemporaryDirectory() as tmpdir:
            docker_bin = Path(tmpdir) / "docker"
            arg_file = Path(tmpdir) / "args.json"
            docker_bin.write_text(
                f"""#!/bin/sh
python3 -c 'import sys, json; json.dump(sys.argv[1:], open("{arg_file}", "w"))' "$@"
exit 0
""",
                encoding="utf-8",
            )
            docker_bin.chmod(0o755)
            env = dict(os.environ)
            old_path = env.get("PATH", "")
            env["PATH"] = f"{tmpdir}:{old_path}"
            env["CONTAINERS"] = containers
            res = subprocess.run(
                ["bash", "-c", self.selector_script],
                env=env,
                capture_output=True,
                text=True,
            )
            docker_args = (
                json.loads(arg_file.read_text(encoding="utf-8"))
                if arg_file.exists()
                else None
            )
            return res.returncode, res.stdout, res.stderr, docker_args

    def test_workflow_dispatch_old_manual_target_reaches_promotion(self):
        # IC05-2: Deliberate manual rollback with old commit should NOT be skipped as stale
        deploy = self._run_freshness_gate(
            event_name="workflow_dispatch",
            expected_revision="9a2dee631f4aff76dc2024d3036287ad93216452",
            main_revision="16ed383d2affb96a7a538ec935a7b3b7dd337257",
        )
        self.assertTrue(deploy, "Manual rollback must reach promotion even if expected_revision differs from main")

    def test_workflow_dispatch_empty_expected_revision_reaches_promotion(self):
        # IC05-2: Manual dispatch with empty expected_revision reaches promotion
        deploy = self._run_freshness_gate(
            event_name="workflow_dispatch",
            expected_revision="",
            main_revision="16ed383d2affb96a7a538ec935a7b3b7dd337257",
        )
        self.assertTrue(deploy)

    def test_push_stale_automatic_target_is_rejected(self):
        # IC05F-2: Automatic push event with old revision MUST be skipped (deploy=false)
        deploy = self._run_freshness_gate(
            event_name="push",
            expected_revision="9a2dee631f4aff76dc2024d3036287ad93216452",
            main_revision="16ed383d2affb96a7a538ec935a7b3b7dd337257",
        )
        self.assertFalse(deploy, "Stale automatic push deployment must be skipped (deploy=false)")

    def test_push_fresh_automatic_target_proceeds(self):
        # IC05F-2: Automatic push matching main revision proceeds (deploy=true)
        deploy = self._run_freshness_gate(
            event_name="push",
            expected_revision="16ed383d2affb96a7a538ec935a7b3b7dd337257",
            main_revision="16ed383d2affb96a7a538ec935a7b3b7dd337257",
        )
        self.assertTrue(deploy)

    def test_workflow_call_stale_automatic_target_is_rejected(self):
        # IC05-2 / IC05F-2: Automatic deployment whose expected revision differs from main MUST be skipped
        deploy = self._run_freshness_gate(
            event_name="workflow_call",
            expected_revision="9a2dee631f4aff76dc2024d3036287ad93216452",
            main_revision="16ed383d2affb96a7a538ec935a7b3b7dd337257",
        )
        self.assertFalse(deploy, "Stale automatic deployment must be skipped (deploy=false)")

    def test_workflow_call_fresh_automatic_target_proceeds(self):
        # Fresh automatic deployment matches main and proceeds
        deploy = self._run_freshness_gate(
            event_name="workflow_call",
            expected_revision="16ed383d2affb96a7a538ec935a7b3b7dd337257",
            main_revision="16ed383d2affb96a7a538ec935a7b3b7dd337257",
        )
        self.assertTrue(deploy)

    def test_preflight_image_revision_label_verification_matches(self):
        # IC05F-2: Image revision label matching expected_revision passes verification
        passed = self._run_image_revision_check(
            expected_revision="9a2dee631f4aff76dc2024d3036287ad93216452",
            image_label="9a2dee631f4aff76dc2024d3036287ad93216452",
        )
        self.assertTrue(passed)

    def test_preflight_image_revision_label_verification_rejects_mismatch(self):
        # IC05F-2: Image revision label mismatch against expected_revision is rejected
        passed = self._run_image_revision_check(
            expected_revision="9a2dee631f4aff76dc2024d3036287ad93216452",
            image_label="16ed383d2affb96a7a538ec935a7b3b7dd337257",
        )
        self.assertFalse(passed, "Preflight must reject mismatched image revision label")

    def test_preflight_image_revision_label_verification_rejects_invalid_label(self):
        # IC05F-2: Image revision label that is not a valid 40-hex SHA is rejected
        passed = self._run_image_revision_check(
            expected_revision="9a2dee631f4aff76dc2024d3036287ad93216452",
            image_label="invalid_non_hex_revision",
        )
        self.assertFalse(passed, "Preflight must reject invalid revision format")

    def test_preflight_image_revision_label_verification_empty_expected_proceeds(self):
        # IC05F-2: When expected_revision is empty, preflight proceeds if label is valid 40-hex
        passed = self._run_image_revision_check(
            expected_revision="",
            image_label="9a2dee631f4aff76dc2024d3036287ad93216452",
        )
        self.assertTrue(passed)

    def test_runbook_exception_ordering(self):
        # IC05-3 & IC07-2: UncertainDeployment inherits from ReleaseError; handling in docs/operator-procedures.md
        # must catch UncertainDeployment BEFORE ReleaseError, otherwise UncertainDeployment is shadowed.
        self.assertTrue(issubclass(release.UncertainDeployment, release.ReleaseError))

        # 1. Parse AST from the actual runbook snippet extracted from docs/operator-procedures.md
        tree = ast.parse(self.manual_rollback_script)
        try_nodes = [node for node in ast.walk(tree) if isinstance(node, ast.Try)]
        self.assertTrue(try_nodes, "Runbook manual rollback snippet must contain a try/except block")

        # Find the try block that guards verify_no_running_deployment
        relevant_try = None
        for t in try_nodes:
            calls = [
                n.func.id for n in ast.walk(t)
                if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)
            ]
            if "verify_no_running_deployment" in calls:
                relevant_try = t
                break

        self.assertIsNotNone(
            relevant_try,
            "Could not find try block protecting verify_no_running_deployment in runbook snippet",
        )

        handler_types = [
            h.type.id for h in relevant_try.handlers
            if isinstance(h.type, ast.Name)
        ]
        self.assertIn("UncertainDeployment", handler_types)
        self.assertIn("ReleaseError", handler_types)

        # Assert that UncertainDeployment precedes ReleaseError in handler order
        uncertain_idx = handler_types.index("UncertainDeployment")
        release_error_idx = handler_types.index("ReleaseError")
        self.assertLess(
            uncertain_idx,
            release_error_idx,
            "In docs/operator-procedures.md, UncertainDeployment handler must precede ReleaseError handler "
            "because UncertainDeployment is a subclass of ReleaseError",
        )

        # 2. Runtime behavioral verification: compile and execute the handler order with fake dependencies
        def create_dispatcher(handlers: list[ast.ExceptHandler]):
            func_def = ast.FunctionDef(
                name="dispatch_exc",
                args=ast.arguments(
                    posonlyargs=[],
                    args=[ast.arg(arg="exc", annotation=None)],
                    kwonlyargs=[],
                    kw_defaults=[],
                    defaults=[],
                ),
                body=[
                    ast.Try(
                        body=[ast.Raise(exc=ast.Name(id="exc", ctx=ast.Load()), cause=None)],
                        handlers=[
                            ast.ExceptHandler(
                                type=h.type,
                                name=h.name,
                                body=[ast.Return(value=ast.Constant(value=h.type.id))],
                            )
                            for h in handlers
                        ],
                        orelse=[],
                        finalbody=[],
                    )
                ],
                decorator_list=[],
            )
            ast.fix_missing_locations(func_def)
            mod = ast.Module(body=[func_def], type_ignores=[])
            env = {"UncertainDeployment": release.UncertainDeployment, "ReleaseError": release.ReleaseError}
            exec(compile(mod, filename="<runbook_ast>", mode="exec"), env)
            return env["dispatch_exc"]

        # Runbook handler order correctly routes UncertainDeployment to UncertainDeployment handler
        runbook_dispatcher = create_dispatcher(relevant_try.handlers)
        self.assertEqual(
            runbook_dispatcher(release.UncertainDeployment("uncertain state")),
            "UncertainDeployment",
        )
        self.assertEqual(
            runbook_dispatcher(release.ReleaseError("regular error")),
            "ReleaseError",
        )

        # 3. Regression proof: demonstrate that reversing the handler order fails the exception routing check
        reversed_dispatcher = create_dispatcher(list(reversed(relevant_try.handlers)))
        # When reversed, UncertainDeployment is mistakenly caught by ReleaseError because of subclassing!
        self.assertNotEqual(
            reversed_dispatcher(release.UncertainDeployment("uncertain state")),
            "UncertainDeployment",
            "Reversed handler order must NOT correctly handle UncertainDeployment",
        )
        self.assertEqual(
            reversed_dispatcher(release.UncertainDeployment("uncertain state")),
            "ReleaseError",
        )

    def test_runbook_container_selector_zero_containers_fails(self):
        # IC05F-2: Zero containers output error and exit code 1
        rc, out, err, args = self._run_container_selector("")
        self.assertNotEqual(rc, 0)
        self.assertIn("BŁĄD: Brak uruchomionych kontenerów", err)

    def test_runbook_container_selector_single_container_succeeds(self):
        # IC05F-2: Single container selects ID and exits 0
        rc, out, err, args = self._run_container_selector("single_cid_123")
        self.assertEqual(rc, 0)
        self.assertIn("Aktywny pojedynczy kontener produkcyjny: single_cid_123", out)

    def test_runbook_container_selector_two_containers_separate_flags(self):
        # IC05-4 / IC05F-2: Multi-container produces separate flags (--filter id=a --filter id=b), not one combined string
        for sep in [" ", "\n"]:
            containers = f"cid_aaa{sep}cid_bbb"
            rc, out, err, args = self._run_container_selector(containers)
            self.assertEqual(rc, 1)
            self.assertIn("Wykryto 2 aktywnych kontenerów", err)
            self.assertEqual(args[:4], ["ps", "--filter", "id=cid_aaa", "--filter"])
            self.assertEqual(args[4], "id=cid_bbb")
            for arg in args:
                self.assertNotIn(" --filter ", arg)


