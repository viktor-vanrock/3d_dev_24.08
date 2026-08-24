from __future__ import annotations

import httpx

from scout.news.fetch import OfficialSourceFetcher


def test_fetch_preserves_redirect_slash_but_canonicalizes_final_url():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/news":
            return httpx.Response(301, headers={"location": "/news/"})
        return httpx.Response(
            200,
            headers={"content-type": "text/html"},
            text=(
                "<html><head><title>Official update</title>"
                '<meta property="og:image" content="/assets/hero.jpg#preview">'
                "</head><body>"
                + "Official source content. " * 20
                + "</body></html>"
            ),
        )

    fetcher = OfficialSourceFetcher()
    fetcher._client.close()
    fetcher._client = httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=False)

    source = fetcher.fetch("https://official.example/news", ["official.example"], "Official")

    assert source.canonical_url == "https://official.example/news"
    assert source.image_url == "https://official.example/assets/hero.jpg"


def test_fetch_drops_non_https_source_image_metadata():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"content-type": "text/html"},
            text=(
                '<html><head><meta property="og:image" content="http://cdn.example/hero.jpg">'
                "</head><body>"
                + "Official source content. " * 20
                + "</body></html>"
            ),
        )

    fetcher = OfficialSourceFetcher()
    fetcher._client.close()
    fetcher._client = httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=False)

    source = fetcher.fetch("https://official.example/news", ["official.example"], "Official")

    assert source.image_url is None


def test_fetch_drops_https_source_image_from_non_allowlisted_host():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"content-type": "text/html"},
            text=(
                '<html><head><meta name="twitter:image" '
                'content="https://cdn.example/hero.jpg">'
                "</head><body>"
                + "Official source content. " * 20
                + "</body></html>"
            ),
        )

    fetcher = OfficialSourceFetcher()
    fetcher._client.close()
    fetcher._client = httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=False)

    source = fetcher.fetch("https://official.example/news", ["official.example"], "Official")

    assert source.image_url is None
