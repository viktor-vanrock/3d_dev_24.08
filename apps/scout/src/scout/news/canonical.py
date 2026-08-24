"""Canonical source URLs and stable fingerprints owned by the host."""

from __future__ import annotations

import hashlib
import posixpath
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit

_TRACKING_KEYS = {
    "fbclid",
    "gclid",
    "mc_cid",
    "mc_eid",
    "ref",
    "source",
}


def canonicalize_url(raw_url: str) -> str:
    """Return a stable HTTPS/HTTP URL without fragments or tracking parameters."""
    parsed = urlsplit(raw_url.strip())
    scheme = parsed.scheme.lower()
    if scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("source URL must be absolute HTTP(S)")

    host = parsed.hostname.lower().encode("idna").decode("ascii")
    port = parsed.port
    if port and not ((scheme == "https" and port == 443) or (scheme == "http" and port == 80)):
        host = f"{host}:{port}"

    decoded_path = parsed.path or "/"
    normalized_path = posixpath.normpath(decoded_path)
    if decoded_path.endswith("/") and normalized_path != "/":
        normalized_path += "/"
    if normalized_path != "/":
        normalized_path = normalized_path.rstrip("/")
    normalized_path = quote(normalized_path, safe="/%:@!$&'()*+,;=-._~")

    query = []
    for key, value in parse_qsl(parsed.query, keep_blank_values=True):
        lowered = key.lower()
        if lowered.startswith("utm_") or lowered in _TRACKING_KEYS:
            continue
        query.append((key, value))
    query.sort()
    return urlunsplit((scheme, host, normalized_path, urlencode(query, doseq=True), ""))


def sha256_prefixed(value: str) -> str:
    return f"sha256:{hashlib.sha256(value.encode('utf-8')).hexdigest()}"


def source_fingerprint(url: str) -> str:
    return sha256_prefixed(canonicalize_url(url))


def host_is_allowed(url: str, allowed_hosts: list[str]) -> bool:
    host = (urlsplit(url).hostname or "").lower()
    return any(
        host == allowed.lower() or host.endswith(f".{allowed.lower()}") for allowed in allowed_hosts
    )
