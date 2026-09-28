import { describe, expect, it } from "vitest";
import {
  humanizeRole,
  isPushOk,
  summarizePush,
  summarizePushes,
  summarizeSyncReport,
} from "../cloudCoachPush";
import {
  mockCloudCoachPush,
  mockCloudCoachSyncReport,
} from "../../test/handlers/salesforce";

// The status strings mirror the constants in salesforce_sync/project_members.py. If the
// two drift, an outcome renders as the unknown-status fallback rather than throwing —
// these tests are what keep the wording honest.

describe("isPushOk", () => {
  it("treats pushed and already-a-member as fine", () => {
    expect(isPushOk(mockCloudCoachPush({ status: "pushed" }))).toBe(true);
    expect(isPushOk(mockCloudCoachPush({ status: "already_member" }))).toBe(true);
  });

  it("treats every other outcome as needing attention", () => {
    for (const status of ["no_free_slot", "no_sf_user", "no_mechanism", "error"]) {
      expect(isPushOk(mockCloudCoachPush({ status }))).toBe(false);
    }
  });

  it("is false for null", () => {
    expect(isPushOk(null)).toBe(false);
    expect(isPushOk(undefined)).toBe(false);
  });
});

describe("humanizeRole", () => {
  it("turns a Salesforce field name into something speakable", () => {
    expect(humanizeRole("Solution_Architect_Primary__c")).toBe("Solution Architect Primary");
    expect(humanizeRole("Project_Manager__c")).toBe("Project Manager");
  });
});

describe("summarizePush", () => {
  it("prefers the server's own message", () => {
    // The server has the project and person names to hand, so its wording is better.
    const result = mockCloudCoachPush({ message: "Jane added to Acme in Cloud Coach." });
    expect(summarizePush(result)).toBe("Jane added to Acme in Cloud Coach.");
  });

  it("falls back to a written sentence per status", () => {
    const base = { member_name: "Jane", project_name: "Acme", message: "" };
    expect(summarizePush({ ...base, status: "pushed" })).toContain("added to Acme");
    expect(summarizePush({ ...base, status: "already_member" })).toContain("already on Acme");
    expect(summarizePush({ ...base, status: "no_free_slot" })).toContain("Every project role");
    expect(summarizePush({ ...base, status: "no_sf_user" })).toContain("No Salesforce user");
    expect(summarizePush({ ...base, status: "no_mechanism" })).toContain("no way to add");
    expect(summarizePush({ ...base, status: "error" })).toContain("Could not add");
  });

  it("reads sensibly with no names at all", () => {
    const spoken = summarizePush({ status: "pushed", message: "" });
    expect(spoken).toBe("That person added to the project in Cloud Coach.");
  });

  it("does not throw on an unrecognised status", () => {
    const spoken = summarizePush({ status: "something_new", message: "" });
    expect(spoken).toContain("Could not add");
  });
});

describe("summarizePushes", () => {
  it("is empty for no results, so the toast stays hidden", () => {
    expect(summarizePushes([])).toBe("");
  });

  it("uses the single-result wording for one", () => {
    const one = mockCloudCoachPush({ message: "Jane added." });
    expect(summarizePushes([one])).toBe("Jane added.");
  });

  it("counts successes and failures for a batch", () => {
    const results = [
      mockCloudCoachPush({ status: "pushed" }),
      mockCloudCoachPush({ status: "already_member" }),
      mockCloudCoachPush({ status: "no_free_slot" }),
    ];
    expect(summarizePushes(results)).toBe("2 added to Cloud Coach, 1 could not be added.");
  });

  it("omits the failure clause when everything worked", () => {
    const results = [mockCloudCoachPush(), mockCloudCoachPush()];
    expect(summarizePushes(results)).toBe("2 added to Cloud Coach.");
  });
});

describe("summarizeSyncReport", () => {
  it("distinguishes a preview from a completed push", () => {
    const dry = mockCloudCoachSyncReport({ dry_run: true });
    const real = mockCloudCoachSyncReport({ dry_run: false });
    expect(summarizeSyncReport(dry)).toContain("Would sync");
    expect(summarizeSyncReport(real)).toContain("Synced");
  });

  it("labels each status count", () => {
    const report = mockCloudCoachSyncReport({
      dry_run: true,
      results: [
        mockCloudCoachPush({ status: "pushed" }),
        mockCloudCoachPush({ status: "already_member" }),
      ],
    });
    const spoken = summarizeSyncReport(report);
    expect(spoken).toContain("1 added");
    expect(spoken).toContain("1 already on it");
  });

  it("reports an empty project rather than an empty string", () => {
    const report = mockCloudCoachSyncReport({ results: [], counts: {} });
    expect(summarizeSyncReport(report)).toBe("No project members to sync.");
  });

  it("prefers a server-supplied message", () => {
    const report = mockCloudCoachSyncReport({
      message: "This project has no Salesforce project id, so nothing can be synced.",
    });
    expect(summarizeSyncReport(report)).toContain("no Salesforce project id");
  });
});
