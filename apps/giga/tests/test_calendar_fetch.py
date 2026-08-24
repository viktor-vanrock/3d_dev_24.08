"""Тесты fetch/adapter календаря релизов — фикстуры RSS/Atom-XML, без сети."""

from __future__ import annotations

from giga.calendar.fetch import parse_feed, strip_html
from giga.calendar.sources import Source

_SOURCE = Source(
    id="test-vendor",
    vendor_slug="test-vendor",
    vendor_name="Test Vendor",
    feed_url="https://example.invalid/feed",
)

_RSS_FEED = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
<title>Test Vendor Blog</title>
<item>
  <title>Announcing the Test Printer X1</title>
  <link>https://example.invalid/blog/test-printer-x1/</link>
  <pubDate>Fri, 03 Jul 2026 09:46:16 +0000</pubDate>
  <content:encoded><![CDATA[<p>We are now shipping the <b>Test Printer X1</b> starting
  today.</p>]]></content:encoded>
</item>
<item>
  <title>Join us at a trade show</title>
  <link>https://example.invalid/blog/trade-show/</link>
  <pubDate>Mon, 29 Jun 2026 12:00:00 +0000</pubDate>
  <description>Come visit our booth.</description>
</item>
</channel>
</rss>
"""

_ATOM_FEED = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<entry>
  <title>Test Printer X2 preorder is live</title>
  <link href="https://example.invalid/blog/test-printer-x2/"/>
  <published>2026-07-01T10:00:00Z</published>
  <summary>Preorder now open.</summary>
</entry>
</feed>
"""


def test_strip_html_removes_tags_and_unescapes_entities():
    assert strip_html("<p>Hello &amp; <b>world</b></p>") == "Hello & world"


def test_strip_html_collapses_whitespace():
    assert strip_html("a\n\n  <br/>  b") == "a b"


def test_parse_feed_rss_extracts_articles():
    articles = parse_feed(_SOURCE, _RSS_FEED)

    assert len(articles) == 2
    first = articles[0]
    assert first.title == "Announcing the Test Printer X1"
    assert first.url == "https://example.invalid/blog/test-printer-x1/"
    assert first.vendor_slug == "test-vendor"
    assert "Test Printer X1" in first.text
    assert "<b>" not in first.text
    assert first.published_at is not None
    assert first.published_at.year == 2026


def test_parse_feed_prefers_content_encoded_over_description():
    articles = parse_feed(_SOURCE, _RSS_FEED)
    assert "shipping" in articles[0].text.lower()


def test_parse_feed_respects_limit():
    articles = parse_feed(_SOURCE, _RSS_FEED, limit=1)
    assert len(articles) == 1


def test_parse_feed_atom_extracts_articles():
    articles = parse_feed(_SOURCE, _ATOM_FEED)

    assert len(articles) == 1
    assert articles[0].title == "Test Printer X2 preorder is live"
    assert articles[0].url == "https://example.invalid/blog/test-printer-x2/"
    assert articles[0].published_at is not None


def test_parse_feed_skips_items_missing_title_or_link():
    feed = """<?xml version="1.0"?>
    <rss version="2.0"><channel>
    <item><link>https://example.invalid/no-title/</link></item>
    <item><title>No link here</title></item>
    </channel></rss>
    """
    assert parse_feed(_SOURCE, feed) == []
