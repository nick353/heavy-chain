from __future__ import annotations

from collections.abc import Iterable
import requests


class XPublisher:
    endpoint = "https://api.x.com/2/tweets"
    users_endpoint = "https://api.x.com/2/users"

    def __init__(self, access_token: str) -> None:
        self._access_token = access_token

    def publish(self, text: str) -> dict[str, str]:
        if not self._access_token:
            raise ValueError("X_API_ACCESS_TOKEN is required for publishing.")
        response = requests.post(
            self.endpoint,
            headers={
                "Authorization": f"Bearer {self._access_token}",
                "Content-Type": "application/json",
            },
            json={"text": text},
            timeout=30,
        )
        response.raise_for_status()
        data = response.json()["data"]
        post_id = data["id"]
        return {
            "id": post_id,
            "url": f"https://x.com/i/web/status/{post_id}",
        }

    def like(self, tweet_id: str) -> dict[str, str]:
        if not self._access_token:
            raise ValueError("X_API_ACCESS_TOKEN is required for X engagement.")
        user_id = self._fetch_authenticated_user_id()
        response = requests.post(
            f"{self.users_endpoint}/{user_id}/likes",
            headers={
                "Authorization": f"Bearer {self._access_token}",
                "Content-Type": "application/json",
            },
            json={"tweet_id": tweet_id},
            timeout=30,
        )
        response.raise_for_status()
        return {"id": tweet_id, "url": f"https://x.com/i/web/status/{tweet_id}"}

    def reply(self, tweet_id: str, text: str) -> dict[str, str]:
        if not self._access_token:
            raise ValueError("X_API_ACCESS_TOKEN is required for X engagement.")
        response = requests.post(
            self.endpoint,
            headers={
                "Authorization": f"Bearer {self._access_token}",
                "Content-Type": "application/json",
            },
            json={"text": text, "reply": {"in_reply_to_tweet_id": tweet_id}},
            timeout=30,
        )
        response.raise_for_status()
        data = response.json()["data"]
        post_id = data["id"]
        return {
            "id": post_id,
            "url": f"https://x.com/i/web/status/{post_id}",
        }

    def quote(self, tweet_id: str, text: str) -> dict[str, str]:
        if not self._access_token:
            raise ValueError("X_API_ACCESS_TOKEN is required for X engagement.")
        response = requests.post(
            self.endpoint,
            headers={
                "Authorization": f"Bearer {self._access_token}",
                "Content-Type": "application/json",
            },
            json={"text": text, "quote_tweet_id": tweet_id},
            timeout=30,
        )
        response.raise_for_status()
        data = response.json()["data"]
        post_id = data["id"]
        return {
            "id": post_id,
            "url": f"https://x.com/i/web/status/{post_id}",
        }

    def _fetch_authenticated_user_id(self) -> str:
        response = requests.get(
            f"{self.users_endpoint}/me",
            headers={"Authorization": f"Bearer {self._access_token}"},
            timeout=30,
        )
        response.raise_for_status()
        user_id = response.json().get("data", {}).get("id", "")
        if not user_id:
            raise ValueError("X authenticated user id was not returned.")
        return user_id

    def fetch_metrics(self, post_id: str) -> dict[str, str]:
        if not self._access_token:
            raise ValueError("X_API_ACCESS_TOKEN is required for metrics sync.")
        response = requests.get(
            f"{self.endpoint}/{post_id}",
            headers={"Authorization": f"Bearer {self._access_token}"},
            params={"tweet.fields": "public_metrics,non_public_metrics,organic_metrics"},
            timeout=30,
        )
        response.raise_for_status()
        data = response.json().get("data", {})
        public_metrics = data.get("public_metrics", {})
        non_public_metrics = data.get("non_public_metrics", {})
        organic_metrics = data.get("organic_metrics", {})
        impression_count = (
            non_public_metrics.get("impression_count")
            or organic_metrics.get("impression_count")
            or ""
        )
        return {
            "x_like_count": str(public_metrics.get("like_count", "")),
            "x_reply_count": str(public_metrics.get("reply_count", "")),
            "x_repost_count": str(public_metrics.get("retweet_count", "")),
            "x_quote_count": str(public_metrics.get("quote_count", "")),
            "x_impression_count": str(impression_count),
        }


class LinkedInPublisher:
    endpoint = "https://api.linkedin.com/rest/posts"

    def __init__(self, access_token: str, author_urn: str, api_version: str) -> None:
        self._access_token = access_token
        self._author_urn = author_urn
        self._api_version = api_version

    def publish(self, commentary: str) -> dict[str, str]:
        if not self._access_token:
            raise ValueError("LINKEDIN_ACCESS_TOKEN is required for publishing.")
        if not self._author_urn:
            raise ValueError("LINKEDIN_AUTHOR_URN is required for publishing.")

        response = requests.post(
            self.endpoint,
            headers={
                "Authorization": f"Bearer {self._access_token}",
                "Content-Type": "application/json",
                "Linkedin-Version": self._api_version,
                "X-Restli-Protocol-Version": "2.0.0",
            },
            json={
                "author": self._author_urn,
                "commentary": commentary,
                "visibility": "PUBLIC",
                "distribution": {
                    "feedDistribution": "MAIN_FEED",
                    "targetEntities": [],
                    "thirdPartyDistributionChannels": [],
                },
                "lifecycleState": "PUBLISHED",
                "isReshareDisabledByAuthor": False,
            },
            timeout=30,
        )
        response.raise_for_status()
        post_urn = response.headers.get("x-restli-id", "")
        encoded = requests.utils.quote(post_urn, safe="")
        return {
            "id": post_urn,
            "url": f"https://www.linkedin.com/feed/update/{encoded}/",
        }

    def comment(self, target_urn: str, text: str) -> dict[str, str]:
        if not self._access_token:
            raise ValueError("LINKEDIN_ACCESS_TOKEN is required for LinkedIn engagement.")
        if not self._author_urn:
            raise ValueError("LINKEDIN_AUTHOR_URN is required for LinkedIn engagement.")

        encoded_target = requests.utils.quote(target_urn, safe="")
        response = requests.post(
            f"https://api.linkedin.com/rest/socialActions/{encoded_target}/comments",
            headers={
                "Authorization": f"Bearer {self._access_token}",
                "Content-Type": "application/json",
                "Linkedin-Version": self._api_version,
                "X-Restli-Protocol-Version": "2.0.0",
            },
            json={
                "actor": self._author_urn,
                "message": {"text": text},
            },
            timeout=30,
        )
        response.raise_for_status()
        comment_urn = response.headers.get("x-restli-id", "")
        return {"id": comment_urn, "url": f"https://www.linkedin.com/feed/update/{encoded_target}/"}

    def like(self, target_urn: str) -> dict[str, str]:
        if not self._access_token:
            raise ValueError("LINKEDIN_ACCESS_TOKEN is required for LinkedIn engagement.")
        if not self._author_urn:
            raise ValueError("LINKEDIN_AUTHOR_URN is required for LinkedIn engagement.")

        encoded_target = requests.utils.quote(target_urn, safe="")
        encoded_actor = requests.utils.quote(self._author_urn, safe="")
        response = requests.put(
            f"https://api.linkedin.com/rest/socialActions/{encoded_target}/likes/{encoded_actor}",
            headers={
                "Authorization": f"Bearer {self._access_token}",
                "Linkedin-Version": self._api_version,
                "X-Restli-Protocol-Version": "2.0.0",
            },
            timeout=30,
        )
        response.raise_for_status()
        return {"id": target_urn, "url": f"https://www.linkedin.com/feed/update/{encoded_target}/"}

    def fetch_metrics(self, post_urn: str) -> dict[str, str]:
        if not self._access_token:
            raise ValueError("LINKEDIN_ACCESS_TOKEN is required for metrics sync.")

        return {
            "linkedin_impression_count": self._fetch_metric(post_urn, "IMPRESSION"),
            "linkedin_reaction_count": self._fetch_metric(post_urn, "REACTION"),
            "linkedin_comment_count": self._fetch_metric(post_urn, "COMMENT"),
            "linkedin_reshare_count": self._fetch_metric(post_urn, "RESHARE"),
        }

    def _fetch_metric(self, post_urn: str, query_type: str) -> str:
        response = requests.get(
            "https://api.linkedin.com/rest/memberCreatorPostAnalytics",
            headers={
                "Authorization": f"Bearer {self._access_token}",
                "Linkedin-Version": self._api_version,
                "X-Restli-Protocol-Version": "2.0.0",
            },
            params={
                "q": "entity",
                "entity": post_urn,
                "queryType": query_type,
                "aggregation": "TOTAL",
            },
            timeout=30,
        )
        response.raise_for_status()
        return _extract_first_integer(response.json())


def _extract_first_integer(payload: object) -> str:
    for value in _walk_values(payload):
        if isinstance(value, bool):
            continue
        if isinstance(value, int):
            return str(value)
    return ""


def _walk_values(payload: object) -> Iterable[object]:
    if isinstance(payload, dict):
        for value in payload.values():
            yield value
            yield from _walk_values(value)
    elif isinstance(payload, list):
        for value in payload:
            yield value
            yield from _walk_values(value)
