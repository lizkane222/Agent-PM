import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import MaskedArrValue from "../MaskedArrValue";
import SlackChannelsField from "../SlackChannelsField";
import CollapsibleAccountSection from "../CollapsibleAccountSection";
import type { SlackChannel } from "../../../types/accounts";

const ch = (o: Partial<SlackChannel> = {}): SlackChannel => ({
  workspace: "Acme Corp", channel: "acme-support", url: "https://acme.slack.com/archives/C1", type: "customer_facing", ...o,
});

describe("MaskedArrValue", () => {
  it("is masked by default and reveals/hides with an accessible toggle", () => {
    render(<MaskedArrValue value="100000" />);
    expect(screen.getByTestId("arr-value")).toHaveTextContent("$••••••");
    expect(screen.queryByText(/100,000/)).not.toBeInTheDocument();
    const btn = screen.getByRole("button", { name: "Show ARR" });
    expect(btn).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(btn);
    expect(screen.getByTestId("arr-value")).toHaveTextContent("$100,000");
    expect(screen.getByRole("button", { name: "Hide ARR" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Hide ARR" }));
    expect(screen.getByTestId("arr-value")).toHaveTextContent("$••••••");
  });
  it("is hidden again on a fresh mount and never persisted", () => {
    const { unmount } = render(<MaskedArrValue value="5" />);
    fireEvent.click(screen.getByRole("button", { name: "Show ARR" }));
    unmount();
    expect(JSON.stringify({ ...localStorage })).not.toMatch(/arr/i);
    render(<MaskedArrValue value="5" />);
    expect(screen.getByTestId("arr-value")).toHaveTextContent("$••••••");
  });
  it("shows a dash with no toggle when there is no ARR", () => {
    render(<MaskedArrValue value="" />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("SlackChannelsField", () => {
  it("shows workspace · #channel with a C# / A# badge and a tooltip link", () => {
    render(<SlackChannelsField channels={[ch(), ch({ workspace: "Twilio", channel: "acme-internal", type: "account_team", url: "https://twilio.slack.com/x" })]} onChange={vi.fn()} />);
    const labels = screen.getAllByTestId("slack-channel-label").map((e) => e.textContent);
    expect(labels).toEqual(["Acme Corp · #acme-support", "Twilio · #acme-internal"]);
    expect(screen.getByText("C#")).toBeInTheDocument();
    expect(screen.getByText("A#")).toBeInTheDocument();
    const tips = screen.getAllByRole("tooltip");
    expect(within(tips[0]).getByText("Customer Facing")).toBeInTheDocument();
    expect(within(tips[1]).getByText("Account Team")).toBeInTheDocument();
    const link = within(tips[0]).getByRole("link");
    expect(link).toHaveAttribute("href", "https://acme.slack.com/archives/C1");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("adds an entry through the inline form", async () => {
    const onChange = vi.fn().mockResolvedValue(undefined);
    render(<SlackChannelsField channels={[]} onChange={onChange} />);
    fireEvent.click(screen.getByText("+ Add channel"));
    fireEvent.change(screen.getByLabelText("Slack workspace"), { target: { value: "Acme" } });
    fireEvent.change(screen.getByLabelText("Slack channel"), { target: { value: "#help" } });
    fireEvent.change(screen.getByLabelText("Slack channel URL"), { target: { value: "https://acme.slack.com/c" } });
    fireEvent.change(screen.getByLabelText("Slack channel type"), { target: { value: "account_team" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith([{ workspace: "Acme", channel: "help", url: "https://acme.slack.com/c", type: "account_team" }]));
  });

  it("rejects non-http URLs and missing names without calling onChange", () => {
    const onChange = vi.fn();
    render(<SlackChannelsField channels={[]} onChange={onChange} />);
    fireEvent.click(screen.getByText("+ Add channel"));
    fireEvent.click(screen.getByText("Save"));
    expect(screen.getByRole("alert")).toHaveTextContent(/required/i);
    fireEvent.change(screen.getByLabelText("Slack workspace"), { target: { value: "A" } });
    fireEvent.change(screen.getByLabelText("Slack channel"), { target: { value: "b" } });
    fireEvent.change(screen.getByLabelText("Slack channel URL"), { target: { value: "javascript:alert(1)" } });
    fireEvent.click(screen.getByText("Save"));
    expect(screen.getByRole("alert")).toHaveTextContent(/http/i);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("edits and removes entries", async () => {
    const onChange = vi.fn().mockResolvedValue(undefined);
    render(<SlackChannelsField channels={[ch(), ch({ channel: "two" })]} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("Remove #acme-support"));
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ channel: "two" })]);
    fireEvent.click(screen.getByLabelText("Edit #two"));
    fireEvent.change(screen.getByLabelText("Slack channel"), { target: { value: "renamed" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith([expect.objectContaining({ channel: "acme-support" }), expect.objectContaining({ channel: "renamed" })]));
  });

  it("keeps the form open with an error when saving fails", async () => {
    render(<SlackChannelsField channels={[]} onChange={vi.fn().mockRejectedValue(new Error("x"))} />);
    fireEvent.click(screen.getByText("+ Add channel"));
    fireEvent.change(screen.getByLabelText("Slack workspace"), { target: { value: "A" } });
    fireEvent.change(screen.getByLabelText("Slack channel"), { target: { value: "b" } });
    fireEvent.change(screen.getByLabelText("Slack channel URL"), { target: { value: "https://a.com" } });
    fireEvent.click(screen.getByText("Save"));
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not save/i);
  });
});

describe("CollapsibleAccountSection", () => {
  it("folds to a titled bar, keeps children mounted, and expands again", () => {
    localStorage.clear();
    render(<CollapsibleAccountSection id="x-test" title="Thing"><input aria-label="draft" defaultValue="keep" /></CollapsibleAccountSection>);
    const collapse = screen.getByRole("button", { name: "Collapse Thing" });
    expect(collapse).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(collapse);
    expect(screen.getByRole("button", { name: "Expand Thing" })).toHaveAttribute("aria-expanded", "false");
    const input = screen.getByLabelText("draft", { selector: "input" });
    expect(input).not.toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Expand Thing" }));
    expect(screen.getByLabelText("draft")).toHaveValue("keep");
    expect(screen.getByLabelText("draft")).toBeVisible();
  });
});
