"""Validate manual exercise inputs before any private API access."""
from __future__ import annotations

import os
import subprocess

from infra import canary_acceptance, coolify_release as release, rollback_acceptance

REPOSITORY = "SzczepanGrela/inventory-generator"
IMAGE = "ghcr.io/szczepangrela/inventory-generator"


def image_pairs(env):
    mode = env.get("MODE")
    pairs = [(env.get("DIGEST", ""), env.get("REVISION", ""))]
    if mode == "rollback":
        if env.get("CONFIRMATION") != rollback_acceptance.CONFIRMATION:
            raise release.ReleaseError("invalid rollback confirmation")
        pairs.append((env.get("PREVIOUS_DIGEST", ""), env.get("PREVIOUS_REVISION", "")))
        if pairs[0][0] == pairs[1][0] or pairs[0][1] == pairs[1][1]:
            raise release.ReleaseError("rollback requires distinguishable images")
        if env.get("CANARY_UUID"):
            raise release.ReleaseError("rollback must not supply a canary UUID")
    elif mode == "canary":
        if env.get("CONFIRMATION") != canary_acceptance.CONFIRMATION:
            raise release.ReleaseError("invalid canary confirmation")
        uuid = env.get("CANARY_UUID", "")
        if not release.UUID_PATTERN.fullmatch(uuid) or uuid == env.get("PRODUCTION_UUID"):
            raise release.ReleaseError("canary UUID is invalid or targets production")
        if env.get("PREVIOUS_DIGEST") or env.get("PREVIOUS_REVISION"):
            raise release.ReleaseError("canary mode does not use rollback image inputs")
    else:
        raise release.ReleaseError("unsupported acceptance mode")
    for digest, revision in pairs:
        if (not release.DIGEST_PATTERN.fullmatch(digest)
                or not release.smokecheck.REVISION_PATTERN.fullmatch(revision)):
            raise release.ReleaseError("invalid immutable digest or full revision")
    return pairs


def main():
    for digest, revision in image_pairs(os.environ):
        image = f"{IMAGE}@{digest}"
        subprocess.run(
            ["gh", "attestation", "verify", f"oci://{image}", "--repo", REPOSITORY],
            check=True,
        )
        release.verify_image_revision(image, revision)


if __name__ == "__main__":
    main()
