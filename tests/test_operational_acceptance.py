from __future__ import annotations

import argparse
import copy
import os
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch

import yaml

from infra import acceptance_preflight as preflight
from infra import canary_acceptance as canary
from infra import coolify_release as release
from infra import rollback_acceptance as drill
from test_coolify_release import (
    APPLICATION_UUID, DEPLOYMENT_UUID, ROLLBACK_UUID, FakeClient,
    OLD_DIGEST, NEW_DIGEST, OLD_REVISION, NEW_REVISION, sample_contract,
)


def rollback_args():
    return argparse.Namespace(
        coolify_url="https://coolify.internal", application_uuid=APPLICATION_UUID,
        public_url="https://inventory.example.test", digest=NEW_DIGEST,
        expected_revision=NEW_REVISION, previous_digest=OLD_DIGEST,
        previous_revision=OLD_REVISION, confirmation=drill.CONFIRMATION,
        contract=Path("infra/coolify-production.json"), deployment_timeout=5,
        poll_interval=0.001, settle_checks=1, settle_attempts=3, soak_checks=1,
    )


class TestRollbackAcceptance(unittest.TestCase):
    def setUp(self):
        self.client = FakeClient(sample_contract(), [["finished"], ["finished"]])
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.dict(os.environ, {"COOLIFY_TOKEN": "test-token"}))
        self.stack.enter_context(patch.object(release, "CoolifyClient", return_value=self.client))
        self.stack.enter_context(patch.object(release, "verify_image_revision"))
        self.stack.enter_context(patch.object(release, "check_public_baseline"))
        self.smoke = self.stack.enter_context(patch.object(release, "check_public_release"))
        self.summary = self.stack.enter_context(patch.object(release, "append_summary"))
        self.stack.enter_context(patch.object(
            release, "read_public_revision", side_effect=lambda url: self.client.live_revision))

    def test_real_deploy_handler_restores_baseline_and_smokes_both_versions(self):
        drill.run_acceptance(rollback_args())
        self.assertEqual(self.client.queued, [DEPLOYMENT_UUID, ROLLBACK_UUID])
        self.assertEqual(self.client.updates,
                         [release.digest_to_tag(NEW_DIGEST), release.digest_to_tag(OLD_DIGEST)])
        self.assertEqual([call.args[1] for call in self.smoke.call_args_list],
                         [NEW_REVISION, OLD_REVISION])
        self.summary.assert_called_once()

    def test_changed_baseline_refuses_before_mutation(self):
        for field in ("previous_digest", "previous_revision"):
            args = rollback_args()
            setattr(args, field, "sha256:" + "a" * 64 if field.endswith("digest") else "a" * 40)
            with self.subTest(field=field), self.assertRaisesRegex(release.ReleaseError, "baseline changed"):
                drill.run_acceptance(args)
        self.assertEqual(self.client.updates, [])

    def test_missing_confirmation_and_same_digest_refuse_before_mutation(self):
        for field, value in (("confirmation", ""), ("digest", OLD_DIGEST),
                             ("expected_revision", OLD_REVISION), ("public_url", "http://bad.test")):
            args = rollback_args()
            setattr(args, field, value)
            with self.subTest(field=field), self.assertRaises(release.ReleaseError):
                drill.run_acceptance(args)
        self.assertEqual(self.client.updates, [])

    def test_real_candidate_failure_is_not_reported_as_drill_success(self):
        self.smoke.side_effect = release.ReleaseError("real export failure")
        with self.assertRaisesRegex(release.ReleaseError, "real export failure"):
            drill.run_acceptance(rollback_args())
        self.assertEqual(self.client.live_revision, OLD_REVISION)
        self.summary.assert_not_called()

    def test_failed_rollback_is_not_reported_as_success(self):
        self.client.statuses_to_queue = [["finished"], ["failed"]]
        with self.assertRaisesRegex(release.ReleaseError, "rollback also failed"):
            drill.run_acceptance(rollback_args())
        self.summary.assert_not_called()

    def test_uncertain_candidate_never_queues_rollback(self):
        with patch.object(self.client, "queue_deployment",
                          side_effect=release.UncertainDeployment("unknown POST outcome")):
            with self.assertRaises(release.UncertainDeployment):
                drill.run_acceptance(rollback_args())
        self.assertEqual(self.client.updates, [release.digest_to_tag(NEW_DIGEST)])
        self.summary.assert_not_called()

    def test_failed_final_verification_is_not_reported_as_success(self):
        self.smoke.side_effect = [None, release.ReleaseError("restored export failed")]
        with self.assertRaisesRegex(release.ReleaseError, "restored export failed"):
            drill.run_acceptance(rollback_args())
        self.summary.assert_not_called()

    def test_normal_release_has_no_injection_or_rollback(self):
        release.deploy_release(rollback_args())
        self.assertEqual(self.client.updates, [release.digest_to_tag(NEW_DIGEST)])


class CanaryClient(FakeClient):
    def __init__(self):
        super().__init__(sample_contract(), [["failed"], ["finished"]])
        self.application.update(name=canary.CANARY_NAME, fqdn=None)
        self.application["settings"]["is_preview_deployments_enabled"] = False
        self.storages = {"persistent_storages": [], "file_storages": []}
        self.patches = []

    def _request(self, method, path, body=None):
        if method == "GET":
            assert path == f"/applications/{APPLICATION_UUID}/storages"
            return self.storages
        assert method == "PATCH" and path == f"/applications/{APPLICATION_UUID}"
        self.patches.append(copy.deepcopy(body))
        self.application.update(body)
        return {"uuid": APPLICATION_UUID}


class TestCanaryAcceptance(unittest.TestCase):
    def setUp(self):
        self.args = argparse.Namespace(
            coolify_url="https://coolify.internal", application_uuid=APPLICATION_UUID,
            production_application_uuid="p" * 24, stable_digest=OLD_DIGEST,
            stable_revision=OLD_REVISION, confirmation=canary.CONFIRMATION,
        )
        self.client = CanaryClient()
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.dict(os.environ, {"COOLIFY_TOKEN": "test-token"}))
        self.stack.enter_context(patch.object(release, "CoolifyClient", return_value=self.client))
        self.stack.enter_context(patch.object(release, "verify_image_revision"))
        self.summary = self.stack.enter_context(patch.object(release, "append_summary"))

    def test_rejection_restores_health_command_and_never_patches_production(self):
        canary.run_acceptance(self.args)
        self.assertEqual(self.client.patches, [{"health_check_command": "/bin/false"},
                                              {"health_check_command": canary.HEALTH_COMMAND}])
        self.summary.assert_called_once()

    def test_production_or_nonisolated_canary_refused_without_mutation(self):
        for change in ({"name": "inventory-generator"}, {"fqdn": "https://public.test"},
                       {"ports_mappings": "8080:8080"}, {"health_check_enabled": False},
                       {"pre_deployment_command": "anything"}):
            original = copy.deepcopy(self.client.application)
            self.client.application.update(change)
            with self.subTest(change=change), self.assertRaises(release.ReleaseError):
                canary.run_acceptance(self.args)
            self.client.application = original
        self.args.production_application_uuid = APPLICATION_UUID
        with self.assertRaises(release.ReleaseError):
            canary.run_acceptance(self.args)
        self.assertEqual(self.client.patches, [])

    def test_storage_or_unrecognized_storage_response_refused(self):
        for storage in ([], {"message": "unexpected"},
                        {"persistent_storages": []},
                        {"persistent_storages": [{"id": 1}], "file_storages": []},
                        {"persistent_storages": [], "file_storages": [{"id": 1}]}):
            self.client.storages = storage
            with self.assertRaises(release.ReleaseError):
                canary.run_acceptance(self.args)
        self.assertEqual(self.client.patches, [])

    def test_wrongly_promoted_candidate_restores_but_fails_acceptance(self):
        self.client.statuses_to_queue = [["finished"], ["finished"]]
        with self.assertRaisesRegex(release.ReleaseError, "rejection was not observed"):
            canary.run_acceptance(self.args)
        self.assertEqual(len(self.client.queued), 2)
        self.summary.assert_not_called()

    def test_unknown_candidate_state_stops_mutation(self):
        self.client.statuses_to_queue = [["not-understood"]]
        with self.assertRaises(release.UncertainDeployment):
            canary.run_acceptance(self.args)
        self.assertEqual(self.client.patches, [{"health_check_command": "/bin/false"}])
        self.assertEqual(len(self.client.queued), 1)
        self.summary.assert_not_called()

    def test_timeout_cleanup_does_not_turn_into_a_pass(self):
        with patch.object(canary, "wait_terminal", side_effect=["observation-timeout", "finished"]):
            with self.assertRaisesRegex(release.ReleaseError, "observation-timeout"):
                canary.run_acceptance(self.args)
        self.summary.assert_not_called()


class TestAcceptanceWorkflow(unittest.TestCase):
    def test_scoped_manual_lock_environment_and_pins(self):
        workflow = yaml.safe_load(Path(".github/workflows/acceptance.yml").read_text())
        self.assertEqual(set(workflow[True]), {"workflow_dispatch"})
        self.assertEqual(workflow["concurrency"], {"group": "production", "cancel-in-progress": False})
        self.assertEqual(workflow["jobs"]["exercise"]["environment"], "production")
        self.assertEqual(workflow["jobs"]["preflight"]["if"], "github.ref == 'refs/heads/main'")
        for job in workflow["jobs"].values():
            for step in job["steps"]:
                if "uses" in step:
                    self.assertRegex(step["uses"], r"@[a-f0-9]{40}$")

    def test_preflight_validates_both_images_before_commands(self):
        env = {"MODE": "rollback", "CONFIRMATION": drill.CONFIRMATION,
               "DIGEST": NEW_DIGEST, "REVISION": NEW_REVISION,
               "PREVIOUS_DIGEST": OLD_DIGEST, "PREVIOUS_REVISION": OLD_REVISION}
        self.assertEqual(preflight.image_pairs(env), [(NEW_DIGEST, NEW_REVISION), (OLD_DIGEST, OLD_REVISION)])
        with patch.dict(os.environ, env), patch.object(preflight.subprocess, "run") as run, \
                patch.object(release, "verify_image_revision") as verify:
            preflight.main()
        self.assertEqual(run.call_count, 2)
        self.assertTrue(all("--repo" in call.args[0] for call in run.call_args_list))
        self.assertEqual(verify.call_count, 2)
        for field, value in (("DIGEST", "latest"), ("PREVIOUS_REVISION", "short"),
                             ("CONFIRMATION", ""), ("PREVIOUS_DIGEST", NEW_DIGEST)):
            with self.subTest(field=field), self.assertRaises(release.ReleaseError):
                preflight.image_pairs(env | {field: value})

    def test_canary_preflight_refuses_production_and_mixed_inputs(self):
        env = {"MODE": "canary", "CONFIRMATION": canary.CONFIRMATION,
               "DIGEST": OLD_DIGEST, "REVISION": OLD_REVISION,
               "CANARY_UUID": APPLICATION_UUID, "PRODUCTION_UUID": "p" * 24}
        self.assertEqual(preflight.image_pairs(env), [(OLD_DIGEST, OLD_REVISION)])
        for update in ({"CANARY_UUID": "p" * 24}, {"PREVIOUS_DIGEST": OLD_DIGEST}, {"MODE": "bad"}):
            with self.assertRaises(release.ReleaseError):
                preflight.image_pairs(env | update)


if __name__ == "__main__":
    unittest.main()
