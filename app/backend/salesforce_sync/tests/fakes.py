"""
A fake Salesforce client, so no test in this package reaches the network.

Patched in at `salesforce_sync.client.get_client`, mirroring how
`agents/tests/test_agent.py` injects a fake Anthropic client rather than mocking the
layer under test.

`FakeSalesforce` records every call, so a test can assert on the SOQL that was built
and on the exact composite body that would have been POSTed — which is the only way to
verify the Cloud Coach field names and the hours-not-minutes conversion.
"""

from __future__ import annotations

# The 10 role lookups plus every field `cloudcoach_schema.SCHEMA_DEFAULTS` names, as a
# stand-in for a fully-conforming org. Tests that want a field to be missing pass a
# narrower set.
FULL_PROJECT_FIELDS = [
    "Id", "Name", "OwnerId",
    "ccpe_ocp__Account__c",
    "project_cloud__Start__c", "project_cloud__End__c",
    "project_cloud__Status__c", "project_cloud__Description__c",
    "Deliverability__c", "Engagement_Manager__c", "Launch_Engineer__c",
    "Project_Manager__c", "Technical_Launch_Manager__c",
    "Solution_Architect_Primary__c", "Solution_Architect_Secondary__c",
    "Technical_Program_Manager__c", "Email_Program_Manager__c",
    "Delivery_Manager__c",
]

FULL_TIMELOG_FIELDS = [
    "Id", "Project__c", "project_cloud__Date__c", "Total_Hours__c",
    "project_cloud__Description__c", "Resource__c",
]


class _FakeResponse:
    def __init__(self, payload: dict | None) -> None:
        self._payload = payload
        self.ok = payload is not None
        self.status_code = 200 if payload is not None else 404

    def json(self) -> dict:
        return self._payload or {}


class _FakeSession:
    """
    Stands in for `sf.session` — the only way to reach `/services/oauth2/userinfo`,
    which sits outside `sf.base_url`'s versioned data-API path.
    """

    def __init__(self, sf: "FakeSalesforce") -> None:
        self._sf = sf

    def get(self, url, **kwargs):
        self._sf.userinfo_urls.append(url)
        return _FakeResponse(self._sf.userinfo)


class FakeSalesforce:
    """
    Minimal stand-in for `simple_salesforce.Salesforce`.

    `describes` maps sobject name -> list of field dicts (or plain names).
    `query_results` maps a substring of the SOQL -> the result dict to return; the
    first matching substring wins, so a test only has to name the distinguishing part
    of the query it cares about.
    """

    def __init__(
        self,
        *,
        describes: dict | None = None,
        query_results: dict | None = None,
        composite_response: dict | None = None,
        base_url: str = "https://example.my.salesforce.com/services/data/v59.0/",
        chatter_enabled: bool = True,
        userinfo: dict | None = None,
    ) -> None:
        self.base_url = base_url
        # An org with Chatter switched off 404s `chatter/users/me`. Corporate sandboxes
        # commonly do, which is why identity resolution has a second path at all.
        self.chatter_enabled = chatter_enabled
        self.userinfo = userinfo
        self.userinfo_urls: list[str] = []
        self.headers: dict[str, str] = {"Authorization": "Bearer fake"}
        self.session = _FakeSession(self)
        self.describes = describes if describes is not None else {}
        self.query_results = query_results or {}
        self.composite_response = composite_response
        self.queries: list[str] = []
        self.restful_calls: list[tuple[str, str, dict | None]] = []

    # ── simple_salesforce surface ────────────────────────────────────────────

    def query(self, soql):
        self.queries.append(soql)
        for needle, result in self.query_results.items():
            if needle in soql:
                return result
        return {"records": [], "totalSize": 0}

    def query_all(self, soql):
        return self.query(soql)

    def restful(self, path, method="GET", json=None, **kwargs):
        self.restful_calls.append((path, method, json))

        if path.endswith("/describe"):
            sobject = path.split("sobjects/")[1].rsplit("/describe", 1)[0]
            if sobject not in self.describes:
                raise RuntimeError(f"No such object: {sobject}")
            return {"fields": _as_field_dicts(self.describes[sobject])}

        if path == "composite":
            if self.composite_response is not None:
                return self.composite_response
            requests = (json or {}).get("compositeRequest", [])
            return {"compositeResponse": [
                {
                    "referenceId": r["referenceId"],
                    "httpStatusCode": 201,
                    "body": {"id": f"a0B{idx:015d}", "success": True},
                }
                for idx, r in enumerate(requests)
            ]}

        if path == "limits":
            return {}
        if path == "chatter/users/me":
            if not self.chatter_enabled:
                raise RuntimeError("Resource not found: chatter/users/me")
            return {"id": "005000000000001AAA", "email": "sf@example.com"}
        return {}

    # ── assertions helpers ───────────────────────────────────────────────────

    @property
    def composite_bodies(self) -> list[dict]:
        """The record bodies from the last composite POST."""
        for path, method, payload in reversed(self.restful_calls):
            if path == "composite" and method == "POST":
                return [r["body"] for r in (payload or {}).get("compositeRequest", [])]
        return []

    @property
    def composite_call_count(self) -> int:
        return sum(1 for p, m, _ in self.restful_calls if p == "composite" and m == "POST")

    def restful_calls_of_kind(self, *methods: str) -> list[tuple[str, str, dict | None]]:
        """
        Every recorded call whose method is one of `methods`.

        The usual assertion is `restful_calls_of_kind("POST", "PATCH") == []` — i.e. this
        code path wrote nothing — which cannot be expressed by counting composites alone.
        """
        wanted = {m.upper() for m in methods}
        return [c for c in self.restful_calls if c[1].upper() in wanted]


def _as_field_dicts(fields) -> list[dict]:
    out = []
    for f in fields:
        if isinstance(f, dict):
            out.append(f)
        else:
            out.append({"name": f, "referenceTo": []})
    return out


def full_org(**overrides) -> FakeSalesforce:
    """A FakeSalesforce whose org matches `cloudcoach_schema.SCHEMA_DEFAULTS`."""
    describes = {
        "project_cloud__Project__c": FULL_PROJECT_FIELDS,
        "project_cloud__Expense__c": [
            {"name": n, "referenceTo": ["Resource__c"] if n == "Resource__c" else []}
            for n in FULL_TIMELOG_FIELDS
        ],
        "Resource__c": ["Id", "Name", "project_cloud__User__c"],
    }
    describes.update(overrides.pop("describes", {}))
    return FakeSalesforce(describes=describes, **overrides)
