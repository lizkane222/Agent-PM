import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useRef, useState } from "react";
import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw-server";
import { mockAgentSkill } from "../../../test/handlers/skills";
import SlashSkillMenu from "../SlashSkillMenu";
import { useSlashSkills, filterSlashSkills } from "../../../hooks/useSlashSkills";

const page = (results: unknown[]) => HttpResponse.json({ count: results.length, next: null, previous: null, results });
let hits = 0;
function serve() {
  hits = 0;
  server.use(http.get("/api/v1/skills/agent-skills/", () => {
    hits++;
    return page([
      mockAgentSkill({ id: 1, name: "weekly-update", description: "Weekly status" }),
      mockAgentSkill({ id: 2, name: "draft-one", description: "Not runnable", status: "draft" }),
      mockAgentSkill({ id: 3, name: "account-brief", description: "Brief an account" }),
    ]);
  }));
}

function Harness({ onEnter }: { onEnter: () => void }) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const slash = useSlashSkills({ value, onChange: setValue, inputRef: ref });
  return (
    <div style={{ position: "relative" }}>
      <SlashSkillMenu menu={slash} />
      <textarea
        ref={ref} value={value} onChange={slash.handleChange} onSelect={slash.handleSelect}
        onKeyDown={(e) => { if (slash.handleKeyDown(e)) return; if (e.key === "Enter") onEnter(); }}
      />
    </div>
  );
}
const box = () => screen.getByRole("textbox") as HTMLTextAreaElement;
const type = (v: string) => fireEvent.change(box(), { target: { value: v, selectionStart: v.length } });

describe("filterSlashSkills", () => {
  const all = [
    { key: "a", name: "weekly-update", description: "x", kind: "agent" as const },
    { key: "b", name: "biweekly", description: "x", kind: "agent" as const },
  ];
  it("lists prefix matches before substring matches", () => {
    expect(filterSlashSkills(all, "wee").map((s) => s.name)).toEqual(["weekly-update", "biweekly"]);
  });
});

describe("SlashSkillMenu", () => {
  it("fetches nothing until a slash is typed, then lists approved skills and Twilio skills", async () => {
    serve();
    render(<Harness onEnter={vi.fn()} />);
    type("hello");
    expect(hits).toBe(0);
    type("/");
    expect(await screen.findByText("/weekly-update")).toBeInTheDocument();
    expect(screen.getByText("/account-brief")).toBeInTheDocument();
    expect(screen.queryByText("/draft-one")).not.toBeInTheDocument();
    expect(screen.getByText("/twilio-account-setup")).toBeInTheDocument();
  });

  it("filters as you type and inserts the skill name on click", async () => {
    serve();
    render(<Harness onEnter={vi.fn()} />);
    type("/wee");
    expect(await screen.findByText("/weekly-update")).toBeInTheDocument();
    expect(screen.queryByText("/account-brief")).not.toBeInTheDocument();
    fireEvent.mouseDown(screen.getByText("/weekly-update"));
    expect(box().value).toBe("/weekly-update ");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("opens after whitespace mid-message but not inside a word", async () => {
    serve();
    render(<Harness onEnter={vi.fn()} />);
    type("a/b");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    type("use /acc");
    expect(await screen.findByText("/account-brief")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByText("/account-brief"));
    expect(box().value).toBe("use /account-brief ");
  });

  it("arrow keys move, Enter selects without sending, Esc dismisses", async () => {
    serve();
    const onEnter = vi.fn();
    render(<Harness onEnter={onEnter} />);
    type("/");
    await screen.findByText("/weekly-update");
    fireEvent.keyDown(box(), { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(onEnter).not.toHaveBeenCalled();
    expect(box().value).toBe("/account-brief ");
    type("/zzzz");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    type("/wee");
    await screen.findByRole("listbox");
    fireEvent.keyDown(box(), { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  it("Tab selects the highlighted skill", async () => {
    serve();
    render(<Harness onEnter={vi.fn()} />);
    type("/wee");
    await screen.findByRole("listbox");
    fireEvent.keyDown(box(), { key: "Tab" });
    await waitFor(() => expect(box().value).toBe("/weekly-update "));
  });
});
