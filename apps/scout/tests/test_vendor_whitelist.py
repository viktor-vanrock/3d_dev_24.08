"""Тесты источника vendor_whitelist на фикстурах HTML — без сети.

Фикстуры смоделированы по реальной разметке www.prusa3d.com (проверено вручную
2026-07-09): листинг отдаёт `<a href="/product/<slug>/">`, карточка товара —
`<script type="application/ld+json" id="product-jsonld">` со schema.org Product.
"""

from __future__ import annotations

import json
import re

from scout.sources.vendor_whitelist import (
    VendorProfile,
    content_hash,
    discover_product_urls,
    parse_product,
)

_PROFILE = VendorProfile(
    vendor_slug="prusa-research",
    vendor_name="Prusa Research",
    listing_url="https://www.prusa3d.com/en/3d-printers/",
    product_link_re=re.compile(r'href="(/product/[a-z0-9-]+/)"'),
)

_LISTING_HTML = """
<div class="grid">
  <a href="/product/original-prusa-mk4s-3d-printer/">MK4S</a>
  <a href="/product/original-prusa-mk4s-3d-printer-kit/">MK4S kit</a>
  <a href="/product/original-prusa-mk4s-3d-printer/">MK4S (repeat link)</a>
  <a href="/cart/">Cart</a>
</div>
"""

_PRODUCT_JSONLD = {
    "@context": "https://schema.org",
    "@type": "Product",
    "name": "Original Prusa MK4S 3D Printer",
    "description": "Fast printer",
    "image": ["https://www.prusa3d.com/img.jpg"],
    "offers": [{"@type": "Offer", "price": "799.200000", "priceCurrency": "EUR"}],
}
_PRODUCT_HTML = (
    '<html><body><script type="application/ld+json" id="product-jsonld">'
    + json.dumps(_PRODUCT_JSONLD)
    + "</script></body></html>"
)

_PRODUCT_HTML_NO_JSONLD = "<html><body><p>No structured data here</p></body></html>"

_PRODUCT_HTML_BROKEN_JSONLD = """
<script type="application/ld+json" id="product-jsonld">{not valid json</script>
"""


def test_discover_product_urls_dedupes_and_resolves_absolute():
    urls = discover_product_urls(_PROFILE, _LISTING_HTML)

    assert urls == [
        "https://www.prusa3d.com/product/original-prusa-mk4s-3d-printer/",
        "https://www.prusa3d.com/product/original-prusa-mk4s-3d-printer-kit/",
    ]


def test_discover_product_urls_ignores_non_product_links():
    urls = discover_product_urls(_PROFILE, _LISTING_HTML)
    assert all("/product/" in u for u in urls)


def test_parse_product_extracts_name_and_offer():
    url = "https://www.prusa3d.com/product/original-prusa-mk4s-3d-printer/"
    candidate = parse_product(_PROFILE, url, _PRODUCT_HTML)

    assert candidate is not None
    assert candidate.raw["model_name"] == "Original Prusa MK4S 3D Printer"
    assert candidate.raw["vendor_slug"] == "prusa-research"
    assert candidate.raw["offers"][0]["price"] == "799.200000"
    assert candidate.external_ref == url
    assert candidate.announced_at is None


def test_parse_product_returns_none_without_jsonld():
    candidate = parse_product(_PROFILE, "https://example.invalid/x/", _PRODUCT_HTML_NO_JSONLD)
    assert candidate is None


def test_parse_product_returns_none_on_broken_jsonld():
    candidate = parse_product(_PROFILE, "https://example.invalid/x/", _PRODUCT_HTML_BROKEN_JSONLD)
    assert candidate is None


def test_content_hash_stable_regardless_of_key_order():
    a = content_hash({"name": "MK4S", "price": "799"})
    b = content_hash({"price": "799", "name": "MK4S"})
    assert a == b


def test_content_hash_changes_when_content_changes():
    a = content_hash({"name": "MK4S", "price": "799"})
    b = content_hash({"name": "MK4S", "price": "749"})
    assert a != b
