"""Temporary, manually approved drill of the real release client's rollback path.

Normal deployments do not import this module. Retire it after dated acceptance.
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path
from urllib.parse import urlsplit

from infra import coolify_release as release

CONFIRMATION = "restore-after-controlled-smoke-failure"


class InjectedSmokeFailure(release.ReleaseError):
    """Candidate passed actual public smoke; now exercise its rollback handler."""


def validate_inputs(args: argparse.Namespace) -> None:
    if args.confirmation != CONFIRMATION:
        raise release.ReleaseError("explicit acceptance confirmation is required")
    for value in (args.digest, args.previous_digest):
        if not release.DIGEST_PATTERN.fullmatch(value):
            raise release.ReleaseError("acceptance requires two immutable digests")
    for value in (args.expected_revision, args.previous_revision):
        if not release.smokecheck.REVISION_PATTERN.fullmatch(value):
            raise release.ReleaseError("acceptance requires two full revisions")
    if args.digest == args.previous_digest:
        raise release.ReleaseError("acceptance candidate must differ from baseline")
    if args.expected_revision == args.previous_revision:
        raise release.ReleaseError("acceptance revisions must be distinguishable")
    if not release.UUID_PATTERN.fullmatch(args.application_uuid):
        raise release.ReleaseError("invalid application UUID")
    url = urlsplit(args.public_url)
    if (url.scheme != "https" or not url.hostname or url.username or url.password
            or url.query or url.fragment or url.path not in ("", "/")):
        raise release.ReleaseError("public URL must be a credential-free HTTPS origin")


def run_acceptance(args: argparse.Namespace) -> None:
    validate_inputs(args)
    injected = None
    failed_at = None

    def fail_after_actual_smoke() -> None:
        nonlocal injected, failed_at
        # This is a deliberate test failure, not an application fault or falsified
        # health response. The real candidate smoke has already passed.
        injected = InjectedSmokeFailure("controlled post-smoke failure")
        failed_at = time.monotonic()
        raise injected

    try:
        release.deploy_release(
            args,
            expected_previous=(args.previous_digest, args.previous_revision),
            after_smoke=fail_after_actual_smoke,
        )
    except release.UncertainDeployment:
        # Never add another mutation on an ambiguous deployment result.
        raise
    except release.ReleaseError as exc:
        # A failure before the injection, or a failed rollback, is NOT a pass.
        if injected is None or exc.__cause__ is not injected:
            raise
    else:
        raise release.ReleaseError("rollback drill did not reach its injected failure")

    client = release.CoolifyClient(args.coolify_url, release.token_from_environment())
    release.verify_no_running_deployment(client, args.application_uuid)
    release.verify_application(
        client.get_application(args.application_uuid),
        release.load_contract(args.contract),
        args.application_uuid,
        expected_tag=release.digest_to_tag(args.previous_digest),
    )
    release.wait_for_revision(
        args.public_url, args.previous_revision,
        consecutive_checks=3, interval=args.poll_interval, attempts=args.settle_attempts,
    )
    # Both revisions have the current export contract; verify all formats after
    # restoration as well as the backward-compatible smoke used by rollback().
    release.check_public_release(args.public_url, args.previous_revision)
    assert failed_at is not None
    release.append_summary([
        "### Inventory controlled rollback acceptance", "",
        f"- Candidate revision: {args.expected_revision}",
        f"- Candidate digest: {args.digest}",
        "- Real public smoke passed before deliberate test failure.",
        f"- Restored revision: {args.previous_revision}",
        f"- Restored digest: {args.previous_digest}",
        "- Saved digest, healthy application, stable public revision and exports verified.",
        f"- Injection to final restoration verification: {time.monotonic() - failed_at:.1f}s",
    ])


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    for field in ("coolify-url", "application-uuid", "public-url", "digest",
                  "expected-revision", "previous-digest", "previous-revision", "confirmation"):
        parser.add_argument("--" + field, required=True)
    parser.set_defaults(
        contract=Path("infra/coolify-production.json"), deployment_timeout=600,
        poll_interval=2, settle_checks=5, settle_attempts=45, soak_checks=15,
    )
    return parser.parse_args()


def main() -> int:
    try:
        run_acceptance(parse_args())
    except release.ReleaseError as exc:
        print(f"rollback acceptance failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
