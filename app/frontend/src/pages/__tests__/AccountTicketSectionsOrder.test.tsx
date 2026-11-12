import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import CollapsibleAccountSection from "../../components/account/CollapsibleAccountSection";
import { ACCOUNT_SECTION_IDS, reloadAccountSectionCollapse } from "../../hooks/useAccountSectionCollapse";

// The page renders these sections in this exact order (see AccountDetailPage.tsx); the
// page itself is too large to mount here, so the contract is pinned on the ids + source.
import source from "../AccountDetailPage.tsx?raw";

beforeEach(() => { localStorage.clear(); reloadAccountSectionCollapse(); });

describe("ticket sections on Account Detail", () => {
  it("are declared above the Email Chain Summary section, in order", () => {
    const at = (needle: string) => source.indexOf(`id={SECTION_IDS.${needle}}`);
    const [a, b, c, d] = [at("jiraTickets"), at("zendeskTickets"), at("productGaps"), at("email")];
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
    expect(c).toBeLessThan(d);
  });

  it("keep the existing ids and add three new ones", () => {
    expect(ACCOUNT_SECTION_IDS.email).toBe("email");
    expect(ACCOUNT_SECTION_IDS.meetingNotes).toBe("meeting-notes");
    expect([ACCOUNT_SECTION_IDS.jiraTickets, ACCOUNT_SECTION_IDS.zendeskTickets, ACCOUNT_SECTION_IDS.productGaps])
      .toEqual(["jira-tickets", "zendesk-tickets", "product-gaps"]);
  });

  it("collapse independently", () => {
    render(
      <div>
        <CollapsibleAccountSection id={ACCOUNT_SECTION_IDS.jiraTickets} title="JIRAs / Engineering Tickets"><p>j</p></CollapsibleAccountSection>
        <CollapsibleAccountSection id={ACCOUNT_SECTION_IDS.zendeskTickets} title="Zendesk / Support Tickets"><p>z</p></CollapsibleAccountSection>
        <CollapsibleAccountSection id={ACCOUNT_SECTION_IDS.productGaps} title="Product Gaps"><p>g</p></CollapsibleAccountSection>
      </div>,
    );
    fireEvent.click(screen.getByLabelText("Collapse Zendesk / Support Tickets"));
    const state = (id: string) => document.querySelector(`[data-section="${id}"]`)?.getAttribute("data-collapsed");
    expect(state("zendesk-tickets")).toBe("true");
    expect(state("jira-tickets")).toBe("false");
    expect(state("product-gaps")).toBe("false");
  });
});
