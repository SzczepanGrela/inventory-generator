"""Health-gate exercise on an explicitly prepared, disposable application only."""
from __future__ import annotations

import argparse
import sys
import time

from infra import coolify_release as release

CANARY_NAME = "inventory-deployment-canary"
CONFIRMATION = "isolated-canary-health-gate"
HEALTH_COMMAND = "curl --fail --silent --show-error --max-time 4 http://127.0.0.1:8080/api/health"


def verify_canary(client, args, *, command=HEALTH_COMMAND, require_healthy=True):
    if (args.application_uuid == args.production_application_uuid
            or not release.UUID_PATTERN.fullmatch(args.application_uuid)
            or not release.UUID_PATTERN.fullmatch(args.production_application_uuid)):
        raise release.ReleaseError("a distinct valid canary UUID is required")
    if args.confirmation != CONFIRMATION:
        raise release.ReleaseError("explicit canary confirmation is required")
    app = client.get_application(args.application_uuid)
    contract = {
        "name": CANARY_NAME, "build_pack": "dockerimage", "fqdn": None, "domains": None,
        "ports_exposes": "8080", "ports_mappings": None,
        "docker_registry_image_name": "ghcr.io/szczepangrela/inventory-generator",
        "health_check_enabled": True, "health_check_type": "cmd",
        "health_check_command": command,
        "health_check_interval": 5, "health_check_timeout": 5,
        "health_check_retries": 10, "health_check_start_period": 10,
        "limits_memory": "512m", "limits_memory_swap": "512m",
        "limits_cpus": "1", "custom_docker_run_options": "--cap-drop=ALL --init",
        "custom_labels": None, "custom_network_aliases": None,
        "settings": {"connect_to_docker_network": False,
                     "is_consistent_container_name_enabled": False,
                     "is_preview_deployments_enabled": False},
    }
    release.verify_application(
        app, contract, args.application_uuid,
        expected_tag=release.digest_to_tag(args.stable_digest),
        require_healthy=require_healthy,
    )
    for key in ("pre_deployment_command", "post_deployment_command"):
        if app.get(key):
            raise release.ReleaseError("canary must not have deployment commands")
    # Do not assume that an app with no declared volume in our contract has none.
    storages = client._request("GET", f"/applications/{args.application_uuid}/storages")
    if storages != []:
        raise release.ReleaseError("canary storage is present or unreadable")


def set_health(client, args, command):
    # _request never retries mutations. Any ambiguous response stops the drill.
    client._request("PATCH", f"/applications/{args.application_uuid}",
                    {"health_check_command": command})
    verify_canary(client, args, command=command, require_healthy=False)


def wait_terminal(client, deployment_uuid, timeout):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        status = client.get_deployment(deployment_uuid).get("status")
        if status in {"finished"} | release.FAILED_DEPLOYMENT_STATUSES:
            return status
        if status not in release.ACTIVE_DEPLOYMENT_STATUSES:
            raise release.UncertainDeployment("unknown canary deployment status")
        time.sleep(2)
    release.cancel_and_confirm(client, deployment_uuid, timeout=60, interval=2)
    # Timeout/cancellation is cleanup, not evidence of a health-gate rejection.
    return "observation-timeout"


def run_acceptance(args):
    client = release.CoolifyClient(args.coolify_url, release.token_from_environment())
    verify_canary(client, args)
    release.verify_no_running_deployment(client, args.application_uuid)
    release.verify_image_revision(
        f"ghcr.io/szczepangrela/inventory-generator@{args.stable_digest}",
        args.stable_revision,
    )
    # Do not alter the old container or image. Only the newly generated candidate
    # receives this failing managed health command. Production is never patched.
    set_health(client, args, "/bin/false")
    candidate_uuid = client.queue_deployment(args.application_uuid)
    print(f"Canary candidate deployment: {candidate_uuid}", flush=True)
    status = wait_terminal(client, candidate_uuid, timeout=180)
    release.verify_no_running_deployment(client, args.application_uuid)
    set_health(client, args, HEALTH_COMMAND)
    restoration_uuid = client.queue_deployment(args.application_uuid)
    print(f"Canary restoration deployment: {restoration_uuid}", flush=True)
    restored = wait_terminal(client, restoration_uuid, timeout=600)
    if restored != "finished":
        raise release.ReleaseError("canary restoration did not finish successfully")
    # Allow the API's health summary to catch up without mutating anything else.
    for attempt in range(30):
        try:
            verify_canary(client, args)
            break
        except release.ReleaseError:
            if attempt == 29:
                raise
            time.sleep(2)
    if status != "failed":
        raise release.ReleaseError(
            f"canary restored, but expected health rejection was not observed: {status}"
        )
    release.append_summary([
        "### Inventory isolated health-gate acceptance", "",
        f"- Canary candidate deployment: {candidate_uuid}; terminal status: failed",
        f"- Restoration deployment: {restoration_uuid}; healthy configuration verified",
        "- Production UUID excluded; no domains, host port mappings or app storage.",
        "- Operator Docker events/readback must separately prove old-container retention.",
        "- Canary is retained for selective inspection and scoped cleanup.",
    ])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for field in ("coolify-url", "application-uuid", "production-application-uuid",
                  "stable-digest", "stable-revision", "confirmation"):
        parser.add_argument("--" + field, required=True)
    args = parser.parse_args()
    try:
        if not release.smokecheck.REVISION_PATTERN.fullmatch(args.stable_revision):
            raise release.ReleaseError("invalid stable image revision")
        run_acceptance(args)
    except release.ReleaseError as exc:
        print(f"canary acceptance failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
