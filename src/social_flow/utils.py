from __future__ import annotations

from datetime import datetime, timezone
from hashlib import sha1
from urllib.parse import unquote
import re


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def make_item_id(source_url: str) -> str:
    return sha1(source_url.encode("utf-8")).hexdigest()[:12]


def extract_x_post_id(post_url: str) -> str:
    match = re.search(r"/status/(\d+)", post_url or "")
    return match.group(1) if match else ""


def extract_linkedin_post_id(post_url: str) -> str:
    match = re.search(r"/feed/update/([^/?#]+)", post_url or "")
    if not match:
        return ""
    return unquote(match.group(1))
