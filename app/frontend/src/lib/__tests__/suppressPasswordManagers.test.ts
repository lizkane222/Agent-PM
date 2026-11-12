import { describe, it, expect, afterEach } from "vitest";
import { installPasswordManagerSuppression } from "../suppressPasswordManagers";

let dispose: (() => void) | null = null;
afterEach(() => { dispose?.(); dispose = null; document.body.innerHTML = ""; });

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("suppressPasswordManagers", () => {
  it("marks existing and later-added inputs, textareas and selects", async () => {
    document.body.innerHTML = `<input id="a" />`;
    dispose = installPasswordManagerSuppression();
    const a = document.getElementById("a")!;
    expect(a).toHaveAttribute("data-1p-ignore");
    expect(a).toHaveAttribute("data-lpignore", "true");
    expect(a).toHaveAttribute("data-bwignore");
    expect(a).toHaveAttribute("autocomplete", "off");
    document.body.insertAdjacentHTML("beforeend", `<div><textarea id="t"></textarea><select id="s"></select></div>`);
    await tick();
    expect(document.getElementById("t")).toHaveAttribute("data-1p-ignore");
    expect(document.getElementById("s")).toHaveAttribute("autocomplete", "off");
  });

  it("leaves password fields, hidden fields and sign-in forms alone", async () => {
    document.body.innerHTML = `<form><input id="u" type="text"/><input id="p" type="password"/></form><input id="h" type="hidden"/>`;
    dispose = installPasswordManagerSuppression();
    for (const id of ["u", "p", "h"]) {
      expect(document.getElementById(id)).not.toHaveAttribute("data-1p-ignore");
      expect(document.getElementById(id)).not.toHaveAttribute("autocomplete");
    }
  });

  it("honours data-allow-autofill on the element or an ancestor, and an existing autocomplete", () => {
    document.body.innerHTML = `<input id="o" data-allow-autofill /><div data-allow-autofill><input id="c"/></div><input id="e" autocomplete="email"/>`;
    dispose = installPasswordManagerSuppression();
    expect(document.getElementById("o")).not.toHaveAttribute("data-1p-ignore");
    expect(document.getElementById("c")).not.toHaveAttribute("data-1p-ignore");
    expect(document.getElementById("e")).toHaveAttribute("autocomplete", "email");
    expect(document.getElementById("e")).toHaveAttribute("data-1p-ignore");
  });

  it("never touches contenteditable editors", async () => {
    document.body.innerHTML = `<div id="ed" contenteditable="true"></div>`;
    dispose = installPasswordManagerSuppression();
    expect(document.getElementById("ed")).not.toHaveAttribute("data-1p-ignore");
  });
});
