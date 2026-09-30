from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Mapping

REVISION_PATTERN = re.compile(r"^[0-9a-f]{40}$")
DEFAULT_BASE_URL = "http://127.0.0.1:8080"
DEFAULT_TIMEOUT_SECONDS = 10

REQUIRED_SECURITY_HEADERS = {
    "content-security-policy": None,  # Present, non-empty
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy": None,
}


def _url(base_url: str, path: str) -> str:
    return f"{base_url.rstrip('/')}{path}"


def _open(request: urllib.request.Request | str, timeout: int):
    return urllib.request.urlopen(request, timeout=timeout)


def _read_json(
    request: urllib.request.Request | str,
    timeout: int,
) -> Mapping[str, object]:
    with _open(request, timeout) as response:
        if response.status != 200:
            raise ValueError(f"request returned HTTP {response.status}")
        payload = json.load(response)
    if not isinstance(payload, Mapping):
        raise ValueError("response is not a JSON object")
    return payload


def _validate_inputs(base_url: str, expected_revision: str) -> None:
    parsed = urllib.parse.urlsplit(base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("base URL must be an absolute HTTP or HTTPS URL")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError(
            "base URL must not contain credentials, a query, or a fragment"
        )
    if not REVISION_PATTERN.fullmatch(expected_revision):
        raise ValueError("expected revision must be a full lowercase commit SHA")


def check_health(
    base_url: str,
    expected_revision: str,
    *,
    timeout: int = DEFAULT_TIMEOUT_SECONDS,
) -> None:
    health_request = urllib.request.Request(
        _url(base_url, "/api/health"),
        headers={
            "Cache-Control": "no-cache",
            "User-Agent": "inventory-release-smokecheck",
        },
    )
    health = _read_json(health_request, timeout)
    if health.get("status") != "ok":
        raise ValueError("health status is not ok")
    if health.get("revision") != expected_revision:
        raise ValueError(
            f"health revision '{health.get('revision')}' does not match expected '{expected_revision}'"
        )


def _check_assets(
    base_url: str,
    *,
    timeout: int,
    require_security_headers: bool = False,
) -> None:
    request = urllib.request.Request(
        _url(base_url, "/"),
        headers={"User-Agent": "inventory-release-smokecheck"},
    )
    with _open(request, timeout) as response:
        if response.status != 200:
            raise ValueError(f"root returned HTTP {response.status}")
        body = response.read(1024)
        if not body:
            raise ValueError("root returned empty response")
        if require_security_headers:
            headers_lower = {k.lower(): v for k, v in response.headers.items()}
            for header_name, expected_value in REQUIRED_SECURITY_HEADERS.items():
                if header_name not in headers_lower:
                    raise ValueError(f"root response missing {header_name} header")
                if expected_value is not None and headers_lower[header_name] != expected_value:
                    raise ValueError(
                        f"root header {header_name} value '{headers_lower[header_name]}' != expected '{expected_value}'"
                    )


def _check_attributes(base_url: str, *, timeout: int) -> None:
    request = urllib.request.Request(
        _url(base_url, "/api/attributes/default/en"),
        headers={
            "Cache-Control": "no-cache",
            "User-Agent": "inventory-release-smokecheck",
        },
    )
    with _open(request, timeout) as response:
        if response.status != 200:
            raise ValueError(f"attributes endpoint returned HTTP {response.status}")
        payload = json.load(response)
        if not isinstance(payload, list) or len(payload) == 0:
            raise ValueError("attributes endpoint returned invalid or empty list")


def _check_exports(base_url: str, *, timeout: int) -> None:
    payload = {
        "attributes": [
            {
                "name": "Item",
                "type": "String",
                "canBeEmpty": False,
                "columnWidth": 1500,
            }
        ],
        "products": [
            {
                "id": 1,
                "attributes": {"Item": "ReleaseSmoke"},
            }
        ],
    }
    body_bytes = json.dumps(payload).encode("utf-8")

    expected_content_types = {
        "csv": "text/csv",
        "html": "text/html",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }

    for fmt, expected_type in expected_content_types.items():
        request = urllib.request.Request(
            _url(base_url, f"/api/export/{fmt}"),
            data=body_bytes,
            headers={
                "Content-Type": "application/json",
                "User-Agent": "inventory-release-smokecheck",
            },
            method="POST",
        )
        with _open(request, timeout) as response:
            if response.status != 200:
                raise ValueError(f"export {fmt} returned HTTP {response.status}")
            ct = response.headers.get("Content-Type", "")
            if expected_type not in ct:
                raise ValueError(
                    f"export {fmt} content-type '{ct}' does not match expected '{expected_type}'"
                )
            file_bytes = response.read(128)
            if not file_bytes:
                raise ValueError(f"export {fmt} returned empty file body")

    # Verify invalid payload rejection (400 Bad Request)
    invalid_request = urllib.request.Request(
        _url(base_url, "/api/export/csv"),
        data=b"{}",
        headers={
            "Content-Type": "application/json",
            "User-Agent": "inventory-release-smokecheck",
        },
        method="POST",
    )
    try:
        with _open(invalid_request, timeout) as resp:
            raise ValueError(f"empty export payload unexpectedly returned HTTP {resp.status}")
    except urllib.error.HTTPError as exc:
        if exc.code != 400:
            raise ValueError(
                f"empty export payload returned HTTP {exc.code}, expected 400"
            ) from exc


def check_baseline_release(
    base_url: str,
    expected_revision: str,
    *,
    timeout: int = DEFAULT_TIMEOUT_SECONDS,
) -> None:
    """Check the stable contract shared by current and earlier releases."""
    _validate_inputs(base_url, expected_revision)
    check_health(base_url, expected_revision, timeout=timeout)
    _check_assets(base_url, timeout=timeout, require_security_headers=False)


def check_release(
    base_url: str,
    expected_revision: str,
    *,
    timeout: int = DEFAULT_TIMEOUT_SECONDS,
) -> None:
    """Check the complete contract implemented by this source revision."""
    _validate_inputs(base_url, expected_revision)
    check_health(base_url, expected_revision, timeout=timeout)
    _check_assets(base_url, timeout=timeout, require_security_headers=True)
    _check_attributes(base_url, timeout=timeout)
    _check_exports(base_url, timeout=timeout)


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate a deployed release.")
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument(
        "--expected-revision",
        default=os.getenv("RELEASE_REVISION", ""),
    )
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT_SECONDS)
    args = parser.parse_args()
    try:
        check_release(args.base_url, args.expected_revision, timeout=args.timeout)
    except (OSError, ValueError) as exc:
        print(f"smoke test failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
