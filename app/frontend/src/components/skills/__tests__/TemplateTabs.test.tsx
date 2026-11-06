import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useState } from "react";
import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw-server";
import TemplateTabs from "../TemplateTabs";
import type { SkillTemplate } from "../../../types/agents";

beforeAll(() => { if (!document.elementFromPoint) document.elementFromPoint = () => document.body; });

const TABS: SkillTemplate[] = [
  { key: "weekly", title: "Weekly update", body_html: "<p>WEEKLY BODY</p>" },
  { key: "plan", title: "Net-new plan", body_html: "<p>PLAN BODY</p>" },
];

describe("TemplateTabs — viewer", () => {
  it("renders nothing when read-only with no templates", () => {
    const { container } = render(<TemplateTabs templates={[]} readOnly />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows one tab per template and switches the body", () => {
    render(<TemplateTabs templates={TABS} readOnly />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Weekly update", "Net-new plan"]);
    expect(screen.getByText("WEEKLY BODY")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Net-new plan" }));
    expect(screen.getByText("PLAN BODY")).toBeInTheDocument();
    expect(screen.queryByText("WEEKLY BODY")).not.toBeInTheDocument();
  });

  it("reports the selected template and honours a controlled selection", () => {
    const onSelect = vi.fn();
    const { rerender } = render(<TemplateTabs templates={TABS} readOnly selectedKey="plan" onSelect={onSelect} />);
    expect(screen.getByRole("tab", { name: "Net-new plan" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: "Weekly update" }));
    expect(onSelect).toHaveBeenCalledWith("weekly");
    rerender(<TemplateTabs templates={TABS} readOnly selectedKey="weekly" onSelect={onSelect} />);
    expect(screen.getByText("WEEKLY BODY")).toBeInTheDocument();
  });

  it("sanitizes template HTML", () => {
    render(<TemplateTabs readOnly templates={[{ key: "x", title: "X", body_html: '<p>ok</p><img src=x onerror="alert(1)"><script>bad()</script>' }]} />);
    expect(document.querySelector("script")).toBeNull();
    expect(document.querySelector("[onerror]")).toBeNull();
    expect(screen.getByText("ok")).toBeInTheDocument();
  });
});

function Editable({ initial = [] as SkillTemplate[], onChange = vi.fn() }) {
  const [t, setT] = useState(initial);
  return <TemplateTabs templates={t} onChange={(n) => { setT(n); onChange(n); }} />;
}

describe("TemplateTabs — author", () => {
  it("adds and removes blank templates", () => {
    const onChange = vi.fn();
    render(<Editable onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Blank template" }));
    expect(screen.getAllByRole("tab")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Remove tab" }));
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("renames a template", () => {
    render(<Editable initial={TABS} />);
    fireEvent.change(screen.getByLabelText("Template name"), { target: { value: "Friday update" } });
    expect(screen.getByRole("tab", { name: "Friday update" })).toBeInTheDocument();
  });

  it("imports a document into one tab per section, converting markdown to rich text", async () => {
    server.use(http.post("/api/v1/skills/agent-skills/parse-template/", () => HttpResponse.json({
      text: "x", intro: "# Impact 360",
      sections: [
        { key: "every-friday", title: "Every Friday Updates", markdown: "* What is the client focused on?\n  * Next step" },
        { key: "net-new", title: "Net-new Account Plan", markdown: "## Plan\n\nSummarize **developments**." },
      ],
    })));
    const onChange = vi.fn();
    render(<Editable onChange={onChange} />);
    const input = screen.getByTestId("template-file-input");
    fireEvent.change(input, { target: { files: [new File(["# x"], "impact.md", { type: "text/markdown" })] } });
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(2));
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Every Friday Updates", "Net-new Account Plan"]);
    const saved = onChange.mock.calls.at(-1)![0] as SkillTemplate[];
    // The editor normalises list items to <li><p>…</p></li>; assert structure, not exact markup.
    const doc = document.createElement("div");
    doc.innerHTML = saved[0].body_html;
    expect(doc.querySelectorAll("ul")).toHaveLength(2);
    expect(doc.querySelector("ul ul")?.textContent).toBe("Next step");
    expect(doc.querySelector("ul")?.textContent).toContain("What is the client focused on?");
    expect(saved[1].body_html).toContain("<h2>Plan</h2>");
    expect(saved[1].body_html).toContain("<strong>developments</strong>");
    expect(screen.getByText("Document intro (not a template)")).toBeInTheDocument();
  });

  it("falls back to a single template when the document has no sections", async () => {
    server.use(http.post("/api/v1/skills/agent-skills/parse-template/", () => HttpResponse.json({
      text: "Just some text", intro: "", sections: [],
    })));
    render(<Editable />);
    fireEvent.change(screen.getByTestId("template-file-input"), { target: { files: [new File(["x"], "notes.txt")] } });
    await waitFor(() => expect(screen.getByRole("tab", { name: "notes" })).toBeInTheDocument());
  });

  it("shows the server's message when a file can't be read", async () => {
    server.use(http.post("/api/v1/skills/agent-skills/parse-template/", () =>
      HttpResponse.json({ detail: "Couldn't read any text from that file." }, { status: 400 })));
    render(<Editable />);
    fireEvent.change(screen.getByTestId("template-file-input"), { target: { files: [new File(["x"], "a.bin")] } });
    expect(await screen.findByText(/Couldn't read any text/)).toBeInTheDocument();
  });

  it("gives imported tabs unique keys when importing twice", async () => {
    server.use(http.post("/api/v1/skills/agent-skills/parse-template/", () => HttpResponse.json({
      text: "x", intro: "", sections: [{ key: "update", title: "Update", markdown: "Body" }, { key: "other", title: "Other", markdown: "Body" }],
    })));
    const onChange = vi.fn();
    render(<Editable onChange={onChange} />);
    const input = screen.getByTestId("template-file-input");
    fireEvent.change(input, { target: { files: [new File(["x"], "a.md")] } });
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(2));
    fireEvent.change(input, { target: { files: [new File(["x"], "b.md")] } });
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(4));
    const keys = (onChange.mock.calls.at(-1)![0] as SkillTemplate[]).map((t) => t.key);
    expect(new Set(keys).size).toBe(4);
  });
});
