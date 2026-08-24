"""Allowlisted official-source retrieval; models never receive a network tool."""

from __future__ import annotations

import hashlib
import ipaddress
from dataclasses import dataclass
from datetime import UTC, datetime
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit, urlunsplit

import httpx

from .canonical import canonicalize_url, host_is_allowed, source_fingerprint


class _ReadableHtmlParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._ignored_depth = 0
        self._title_depth = 0
        self.title_parts: list[str] = []
        self.text_parts: list[str] = []
        self.meta: dict[str, str] = {}

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"script", "style", "svg", "noscript"}:
            self._ignored_depth += 1
        if tag == "title":
            self._title_depth += 1
        if tag == "meta":
            values = {key.lower(): value for key, value in attrs if value is not None}
            key = values.get("property") or values.get("name")
            content = values.get("content")
            if key and content:
                self.meta[key.lower()] = content.strip()

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style", "svg", "noscript"} and self._ignored_depth:
            self._ignored_depth -= 1
        if tag == "title" and self._title_depth:
            self._title_depth -= 1

    def handle_data(self, data: str) -> None:
        value = " ".join(data.split())
        if not value:
            return
        if self._title_depth:
            self.title_parts.append(value)
        if not self._ignored_depth:
            self.text_parts.append(value)


@dataclass(frozen=True)
class RetrievedSource:
    source_id: str
    canonical_url: str
    title: str
    publisher: str
    published_at: str | None
    retrieved_at: str
    content_hash: str
    source_fingerprint: str
    text: str
    image_url: str | None = None

    def contract_record(self) -> dict:
        return {
            "source_id": self.source_id,
            "canonical_url": self.canonical_url,
            "title": self.title,
            "publisher": self.publisher,
            "published_at": self.published_at,
            "retrieved_at": self.retrieved_at,
            "content_hash": self.content_hash,
            "source_fingerprint": self.source_fingerprint,
        }

    def model_record(self, max_chars: int) -> dict:
        return {**self.contract_record(), "text": self.text[:max_chars]}

    def image_record(self) -> dict | None:
        if self.image_url is None:
            return None
        return {
            "source_id": self.source_id,
            "image_url": self.image_url,
            "alt": self.title,
        }


def _source_image_url(
    page_url: str,
    raw_url: str | None,
    allowed_hosts: list[str],
) -> str | None:
    """Accept an HTTPS image only when its resolved host is explicitly official."""
    if not raw_url or len(raw_url) > 2_048:
        return None
    value = raw_url.strip()
    if any(character in value for character in {'"', "'", "<", ">", "`"}) or any(
        ord(character) < 32 for character in value
    ):
        return None
    parsed = urlsplit(urljoin(page_url, value))
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        return None
    hostname = parsed.hostname.lower().rstrip(".")
    if hostname == "localhost" or hostname.endswith((".localhost", ".local")):
        return None
    try:
        if not ipaddress.ip_address(hostname).is_global:
            return None
    except ValueError:
        pass
    normalized = urlunsplit((parsed.scheme, parsed.netloc, parsed.path, parsed.query, ""))
    if not host_is_allowed(normalized, allowed_hosts):
        return None
    return normalized


class OfficialSourceFetcher:
    def __init__(self, *, timeout_seconds: float = 25, max_chars: int = 24_000) -> None:
        self.max_chars = max_chars
        self._client = httpx.Client(
            follow_redirects=False,
            timeout=timeout_seconds,
            headers={"User-Agent": "portal-scout-news/2 (+https://3mf.tech)"},
        )

    def close(self) -> None:
        self._client.close()

    def fetch(self, url: str, allowed_hosts: list[str], publisher: str) -> RetrievedSource:
        current = canonicalize_url(url)
        for _ in range(5):
            if not host_is_allowed(current, allowed_hosts):
                raise ValueError(f"source host is not allowlisted: {current}")
            response = self._client.get(current)
            if response.is_redirect:
                location = response.headers.get("location")
                if not location:
                    raise ValueError("redirect has no location")
                # Preserve the server's trailing slash while traversing redirects. The canonical
                # representation is computed only after the final response; stripping the slash
                # here can bounce forever between an origin and its slash redirect.
                current = str(response.url.join(location))
                continue
            response.raise_for_status()
            break
        else:
            raise ValueError("too many source redirects")

        content_type = response.headers.get("content-type", "")
        if "text/html" not in content_type:
            raise ValueError(f"unsupported official source content type: {content_type}")
        if not host_is_allowed(str(response.url), allowed_hosts):
            raise ValueError("final source host is not allowlisted")

        parser = _ReadableHtmlParser()
        parser.feed(response.text)
        text = "\n".join(parser.text_parts)
        if len(text) < 200:
            raise ValueError("official source has insufficient readable text")
        title = (
            parser.meta.get("og:title")
            or parser.meta.get("twitter:title")
            or " ".join(parser.title_parts)
        ).strip()
        published_at = (
            parser.meta.get("article:published_time")
            or parser.meta.get("datepublished")
            or parser.meta.get("date")
        )
        image_url = _source_image_url(
            str(response.url),
            parser.meta.get("og:image:secure_url")
            or parser.meta.get("og:image")
            or parser.meta.get("twitter:image")
            or parser.meta.get("twitter:image:src"),
            allowed_hosts,
        )
        canonical_url = canonicalize_url(str(response.url))
        digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
        fingerprint = source_fingerprint(canonical_url)
        return RetrievedSource(
            source_id=f"src_{fingerprint.removeprefix('sha256:')[:16]}",
            canonical_url=canonical_url,
            title=title or canonical_url,
            publisher=publisher,
            published_at=published_at,
            retrieved_at=datetime.now(UTC).isoformat().replace("+00:00", "Z"),
            content_hash=f"sha256:{digest}",
            source_fingerprint=fingerprint,
            text=text[: self.max_chars],
            image_url=image_url,
        )
