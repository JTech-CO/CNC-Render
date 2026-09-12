import { describe, expect, it, vi } from "vitest";
import { M11ResultBridge } from "../../app/components/m11-result-bridge";

const FIRST_RUN = "7a000000-0000-4000-8000-000000000001";
const NEXT_RUN = "7a000000-0000-4000-8000-000000000002";

describe("M11 isolated result provenance bridge", () => {
  it("has stable immutable scalar snapshots and does not emit repeated run samples", () => {
    const bridge = new M11ResultBridge(); const notify = vi.fn();
    const initial = bridge.getSnapshot(); const unsubscribe = bridge.subscribe(notify);
    expect(initial).toEqual({ runId: null, requiresRerun: false });
    expect(Object.isFrozen(initial)).toBe(true);
    expect(notify).not.toHaveBeenCalled();
    bridge.started(); expect(bridge.getSnapshot()).toBe(initial);
    bridge.publishRun(FIRST_RUN); const active = bridge.getSnapshot();
    expect(active).not.toBe(initial); expect(notify).toHaveBeenCalledTimes(1);
    for (let frame = 0; frame < 1000; frame += 1) bridge.publishRun(FIRST_RUN);
    expect(bridge.getSnapshot()).toBe(active); expect(notify).toHaveBeenCalledTimes(1);
    expect(Object.keys(active)).toEqual(["runId", "requiresRerun"]);
    unsubscribe(); bridge.publishRun(NEXT_RUN); expect(notify).toHaveBeenCalledTimes(1);
  });

  it("invalidates a prior result at start, before a new initialized run arrives", () => {
    const bridge = new M11ResultBridge(); bridge.publishRun(FIRST_RUN);
    const states: unknown[] = []; bridge.subscribe(() => states.push(bridge.getSnapshot()));
    bridge.started(); bridge.started(); bridge.publishRun(NEXT_RUN); bridge.publishRun(NEXT_RUN);
    expect(states).toEqual([{ runId: null, requiresRerun: false }, { runId: NEXT_RUN, requiresRerun: false }]);
  });

  it("preserves restore denial across late old-session summaries until an explicit new start", () => {
    const bridge = new M11ResultBridge(); const notify = vi.fn(); bridge.publishRun(FIRST_RUN); bridge.subscribe(notify);
    bridge.restored(); const restored = bridge.getSnapshot();
    expect(restored).toEqual({ runId: null, requiresRerun: true });
    bridge.restored(); bridge.publishRun(FIRST_RUN); bridge.publishRun(NEXT_RUN);
    expect(bridge.getSnapshot()).toBe(restored); expect(notify).toHaveBeenCalledTimes(1);
    bridge.started(); bridge.publishRun(NEXT_RUN);
    expect(bridge.getSnapshot()).toEqual({ runId: NEXT_RUN, requiresRerun: false });
    expect(notify).toHaveBeenCalledTimes(3);
  });

  it("supports mounting after an unobserved transition and unsubscribing independently", () => {
    const bridge = new M11ResultBridge(); bridge.publishRun(FIRST_RUN); bridge.restored();
    const first = vi.fn(); const second = vi.fn();
    const unsubscribe = bridge.subscribe(first); bridge.subscribe(second);
    expect(bridge.getSnapshot().requiresRerun).toBe(true);
    unsubscribe(); bridge.started();
    expect(first).not.toHaveBeenCalled(); expect(second).toHaveBeenCalledTimes(1);
    expect(() => bridge.publishRun("")).toThrow("must not be empty");
  });
});
