import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SlackChannelsField from "../SlackChannelsField";
import { SLACK_WORKSPACE_PRESETS, SlackWorkspaceIcon, safeWebUrl, channelIdFromUrl } from "../slackWorkspaces";
import type { SlackChannel } from "../../../types/accounts";

const ch = (o: Partial<SlackChannel> = {}): SlackChannel => ({
  workspace: "Twilio-Enterprise", channel: "acme", url: "https://twilio.enterprise.slack.com/archives/C0123ABC", type: "customer_facing", ...o,
});

describe("Slack workspace icons", () => {
  it("shows the workspace icon with the name only as a tooltip", () => {
    render(<SlackChannelsField channels={[ch()]} onChange={vi.fn()} />);
    const icon = screen.getByTestId("slack-workspace-icon");
    expect(icon).toHaveAttribute("title", "Twilio-Enterprise");
    expect(icon).toHaveAttribute("aria-label", "Slack workspace: Twilio-Enterprise");
    expect(icon.querySelector("svg")).not.toBeNull();
    expect(screen.queryByText("Twilio-Enterprise")).not.toBeInTheDocument();
  });

  it("renders every preset icon", () => {
    for (const p of SLACK_WORKSPACE_PRESETS) {
      const { unmount } = render(<SlackWorkspaceIcon workspace={p.name} />);
      expect(screen.getByTestId("slack-workspace-icon").querySelector("svg")).not.toBeNull();
      unmount();
    }
  });

  it("links the channel name to Slack in a new tab", () => {
    render(<SlackChannelsField channels={[ch()]} onChange={vi.fn()} />);
    const link = screen.getByRole("link", { name: "#acme" });
    expect(link).toHaveAttribute("href", "https://twilio.enterprise.slack.com/archives/C0123ABC");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("shows the C# / A# badge before the icon and no bullet", () => {
    const { container } = render(<SlackChannelsField channels={[ch({ type: "account_team" })]} onChange={vi.fn()} />);
    const badge = screen.getByText("A#");
    const icon = screen.getByTestId("slack-workspace-icon");
    expect(badge.compareDocumentPosition(icon) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector("ul")?.className).toContain("list-none");
  });

  it("uses the saved custom icon, and falls back to a letter tile when it fails", () => {
    render(<SlackWorkspaceIcon workspace="Acme Slack" iconUrl="https://acme.com/i.png" />);
    const img = screen.getByTestId("slack-workspace-icon").querySelector("img") as HTMLImageElement;
    expect(img.src).toBe("https://acme.com/i.png");
    fireEvent.error(img);
    expect(screen.getByTestId("slack-workspace-fallback")).toHaveTextContent("A");
  });

  it("derives a favicon from the link host for a legacy workspace with no icon", () => {
    render(<SlackWorkspaceIcon workspace="Legacy" linkUrl="https://legacy.slack.com/archives/C1" />);
    expect((screen.getByTestId("slack-workspace-icon").querySelector("img") as HTMLImageElement).src).toBe("https://legacy.slack.com/favicon.ico");
  });

  it("never renders a javascript: link or icon", () => {
    expect(safeWebUrl("javascript:alert(1)")).toBeNull();
    render(<SlackChannelsField channels={[ch({ url: "javascript:alert(1)" })]} onChange={vi.fn()} />);
    expect(screen.queryByRole("link", { name: "#acme" })).toBeNull();
    render(<SlackWorkspaceIcon workspace="X" iconUrl="javascript:alert(1)" />);
    expect(screen.getAllByTestId("slack-workspace-fallback").length).toBeGreaterThan(0);
  });

  it("extracts a channel id from an archives link", () => {
    expect(channelIdFromUrl("https://x.slack.com/archives/C0123ABC")).toBe("C0123ABC");
    expect(channelIdFromUrl("https://x.slack.com/")).toBeNull();
  });
});

describe("Slack workspace dropdown", () => {
  it("offers the presets and Other", () => {
    render(<SlackChannelsField channels={[]} onChange={vi.fn()} />);
    fireEvent.click(screen.getByText("+ Add channel"));
    const opts = Array.from(screen.getByLabelText("Slack workspace").querySelectorAll("option")).map((o) => o.textContent);
    expect(opts).toEqual(expect.arrayContaining(["Twilio-Enterprise", "Twilio Contact Center", "Segment Customers", "Other / custom…"]));
  });

  it("saves a preset by name and checks the link host", async () => {
    const onChange = vi.fn().mockResolvedValue(undefined);
    render(<SlackChannelsField channels={[]} onChange={onChange} />);
    fireEvent.click(screen.getByText("+ Add channel"));
    fireEvent.change(screen.getByLabelText("Slack workspace"), { target: { value: "Segment Customers" } });
    fireEvent.change(screen.getByLabelText("Slack channel"), { target: { value: "help" } });
    fireEvent.change(screen.getByLabelText("Slack channel URL"), { target: { value: "https://evil.example.com/archives/C1" } });
    fireEvent.click(screen.getByText("Save"));
    expect(screen.getByRole("alert")).toHaveTextContent("segmentcustomers.slack.com");
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Slack channel URL"), { target: { value: "https://segmentcustomers.slack.com/archives/C1" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith([{ workspace: "Segment Customers", channel: "help", url: "https://segmentcustomers.slack.com/archives/C1", type: "customer_facing" }]));
  });

  it("saves a custom workspace with an icon url, and rejects a non-http icon", async () => {
    const onChange = vi.fn().mockResolvedValue(undefined);
    render(<SlackChannelsField channels={[]} onChange={onChange} />);
    fireEvent.click(screen.getByText("+ Add channel"));
    fireEvent.change(screen.getByLabelText("Slack workspace"), { target: { value: "__custom__" } });
    fireEvent.change(screen.getByLabelText("Custom workspace name"), { target: { value: "Acme" } });
    fireEvent.change(screen.getByLabelText("Slack channel"), { target: { value: "help" } });
    fireEvent.change(screen.getByLabelText("Slack channel URL"), { target: { value: "https://acme.slack.com/c" } });
    fireEvent.change(screen.getByLabelText("Workspace icon URL"), { target: { value: "javascript:alert(1)" } });
    fireEvent.click(screen.getByText("Save"));
    expect(screen.getByRole("alert")).toHaveTextContent(/icon/i);
    fireEvent.change(screen.getByLabelText("Workspace icon URL"), { target: { value: "https://acme.com/i.png" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ workspace: "Acme", workspace_icon: "https://acme.com/i.png" })]));
  });

  it("edits a legacy custom entry as Other with its name filled in", () => {
    render(<SlackChannelsField channels={[ch({ workspace: "Old Co" })]} onChange={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("Edit #acme"));
    expect(screen.getByLabelText("Custom workspace name")).toHaveValue("Old Co");
  });
});
