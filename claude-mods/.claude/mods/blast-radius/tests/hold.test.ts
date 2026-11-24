import { describe, expect, mock, test } from "claude-code/testing";

const OK = { exitCode: 0, stdout: "", stderr: "" };
const LOG_FAILED_TOAST = "Blast Radius: couldn't write the decision log";

type Setup = { button: "proceed" | "cancel"; isWriteFailing: boolean };

/** Holds `git reset --hard`, presses a button, and returns the hook result, the logged lines and the toasts. */
async function hold($: any, on: any, { button, isWriteFailing }: Setup) {
  const records: string[] = [];
  const toasts: string[] = [];
  let isPressed = false;
  mock.clock(on);
  on("session.cwd", () => ({ value: "/repo" }));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("ui.close", () => ({ value: undefined }));
  on("ui.invalidate", () => ({ value: undefined }));
  on("ui.toast", (_: unknown, e: unknown) => (toasts.push(String((e as { text?: string }).text ?? e)), { value: undefined }));
  on("process.run", async (_: unknown, e: { argv: string[]; init?: { stdin?: string } }) => {
    if (e.argv.join(" ").includes("blast-radius.log")) {
      records.push(e.init?.stdin ?? "");
      if (isWriteFailing) {
        throw new Error("disk full");
      }
    }
    if (e.argv[0] === "sleep" && !isPressed) {
      isPressed = true;
      const pane = await $.ui.mount({ plugin: "blast-radius", surface: "terminal", component: "Pane", requestId: "blast-radius", props: {} });
      await pane.press({ key: button });
      await pane.unmount();
    }
    return { value: OK };
  });
  on("tool.call", () => ({ result: "ran" }));
  const result = await $.tool.call({ tool: "Bash", command: "git reset --hard" });
  return { result, records: records.map((r) => JSON.parse(r)), toasts };
}

describe("decision log", () => {
  test("logs Proceed, and a failed write does not change the decision", async ($, on) => {
    const { result, records, toasts } = await hold($, on, { button: "proceed", isWriteFailing: true });

    expect(result).toEqual({ result: "ran" });
    expect(records.map((r) => [r.decision, r.kind, r.cwd])).toEqual([["proceed", "git-reset", "/repo"]]);
    expect(toasts).toContain(LOG_FAILED_TOAST);
  });

  test("logs Cancel once and shows no toast when the write works", async ($, on) => {
    const { result, records, toasts } = await hold($, on, { button: "cancel", isWriteFailing: false });

    expect(result.deny).toContain("the user pressed Cancel");
    expect(records.map((r) => r.decision)).toEqual(["cancel"]);
    expect(toasts).not.toContain(LOG_FAILED_TOAST);
  });
});
