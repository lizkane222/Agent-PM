"""
Cloud Coach object / field API names for the connected Salesforce org.

Ported from the `timesheeter` Apps Script add-on (`src/Schema.js`), whose defaults
were discovered by running `describe` against the real Twilio org — see
`src/Debug.js::debugDescribePSAObjects` / `debugFindMyProjects` in that project.
They differ substantially from the `cc4sf__*` names the rest of `salesforce_sync`
assumed, which is why project sync returned nothing.

Two things worth knowing before editing:

* The names are **mixed-namespace on purpose.** Cloud Coach's own fields carry the
  `project_cloud__` / `ccpe_ocp__` prefixes; fields Twilio added to those objects
  (`Total_Hours__c`, `Resource__c`, `Project__c`, the ten role lookups) carry none.
  Do not "helpfully" prefix them.
* Nothing here is verified by a test against a live org, and it cannot be. Every
  consumer therefore describe-gates first (`cloudcoach.available_fields`) so a wrong
  name degrades to a reported skip instead of a SOQL 400.

Override any subset via the `CLOUDCOACH_SCHEMA` environment variable, holding a JSON
object shaped like `SCHEMA_DEFAULTS`. Only the keys you supply are replaced; the rest
fall through. Read from the environment rather than a Django setting so no
`core/settings.py` edit is needed:

    CLOUDCOACH_SCHEMA='{"timeLog": {"hoursField": "Hours__c"}}'
"""

from __future__ import annotations

import json
import logging
import os
from copy import deepcopy
from typing import Any

logger = logging.getLogger(__name__)

SCHEMA_ENV_VAR = "CLOUDCOACH_SCHEMA"

SCHEMA_DEFAULTS: dict[str, Any] = {
    "project": {
        "object": "project_cloud__Project__c",
        "nameField": "Name",
        "accountField": "ccpe_ocp__Account__c",
        "startField": "project_cloud__Start__c",
        "endField": "project_cloud__End__c",
        # Not probed by timesheeter — `Debug.js::debugFindAdminProjects` selected
        # `project_cloud__Status__c`, so status is likely right; description is a
        # guess. Both are describe-gated by `sync.sync_projects`, so a wrong name
        # costs one column rather than the whole query.
        "statusField": "project_cloud__Status__c",
        "descriptionField": "project_cloud__Description__c",
        # A user is "on" a project by holding one of these lookups — Cloud Coach's
        # Resource Assignment object is not how this org links people to projects
        # (`Debug.js::debugMyAssignments` found zero rows against it).
        "userRoleFields": [
            "Deliverability__c",
            "Engagement_Manager__c",
            "Launch_Engineer__c",
            "Project_Manager__c",
            "Technical_Launch_Manager__c",
            "Solution_Architect_Primary__c",
            "Solution_Architect_Secondary__c",
            "Technical_Program_Manager__c",
            "Email_Program_Manager__c",
            "Delivery_Manager__c",
        ],
    },
    "timeLog": {
        "object": "project_cloud__Expense__c",
        "projectField": "Project__c",
        "dateField": "project_cloud__Date__c",
        # Hours, as a decimal — NOT minutes. `write_back.log_time` writes minutes to
        # a `cc4sf__Duration_Minutes__c` that does not exist in this org.
        "hoursField": "Total_Hours__c",
        "descriptionField": "project_cloud__Description__c",
        # Optional. May be a lookup to the Resource__c custom object rather than to
        # User — see `cloudcoach.resolve_resource_id`. Omitted when unresolvable.
        "userField": "Resource__c",
    },
    "resource": {
        "object": "Resource__c",
        "userField": "project_cloud__User__c",
    },
    # Cloud Coach's purpose-built "this person is on this project" object. Preferred by
    # `project_members.push_member_to_project` because creating a record here disturbs
    # nothing, whereas the role lookups above are named roles on a shared record.
    # `Debug.js::debugMyAssignments` probed these exact field names and found zero rows for
    # the current user — so the object may exist but be unused in this org, or these names
    # may be wrong. Describe-gated either way: absent means we fall through to a role slot.
    "resourceAssignment": {
        "object": "project_cloud__Resource_Assignment__c",
        "projectField": "project_cloud__Project_ID__c",
        "userField": "project_cloud__User__c",
        "startField": "project_cloud__Start__c",
        "endField": "project_cloud__End__c",
    },
}


def _deep_merge(base: dict, override: dict) -> dict:
    """Recursively merge `override` into a copy of `base`. Lists replace, not append."""
    out = deepcopy(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _deep_merge(out[key], value)
        else:
            out[key] = deepcopy(value)
    return out


def get_schema() -> dict[str, Any]:
    """The effective schema: defaults deep-merged with the CLOUDCOACH_SCHEMA override."""
    raw = os.getenv(SCHEMA_ENV_VAR, "").strip()
    if not raw:
        return deepcopy(SCHEMA_DEFAULTS)
    try:
        override = json.loads(raw)
    except ValueError as exc:
        logger.warning("Invalid %s JSON, using defaults: %s", SCHEMA_ENV_VAR, exc)
        return deepcopy(SCHEMA_DEFAULTS)
    if not isinstance(override, dict):
        logger.warning("%s must be a JSON object, using defaults.", SCHEMA_ENV_VAR)
        return deepcopy(SCHEMA_DEFAULTS)
    return _deep_merge(SCHEMA_DEFAULTS, override)


def account_relationship(account_field: str) -> str:
    """`ccpe_ocp__Account__c` -> `ccpe_ocp__Account__r`, for SOQL parent traversal."""
    if account_field.endswith("__c"):
        return account_field[: -len("__c")] + "__r"
    return account_field
