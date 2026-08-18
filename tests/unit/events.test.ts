import { test } from "node:test";
import assert from "node:assert/strict";
import { EventBus, type SkillRouterEvent } from "../../src/core/events.ts";

type TaskStarted = Extract<SkillRouterEvent, { event: "task.started" }>;
type RouterDecided = Extract<SkillRouterEvent, { event: "router.decided" }>;
type Installed = Extract<SkillRouterEvent, { event: "capability.installed" }>;

test("EventBus delivers matching events and gather history", () => {
  const bus = new EventBus();
  const seen: string[] = [];
  bus.on("task.started", (e: TaskStarted) => seen.push(e.task));
  bus.emit({ event: "task.started", task: "write tests", project: null });
  bus.emit({ event: "file.changed", path: "a.ts" });
  assert.deepEqual(seen, ["write tests"]);
  assert.equal(bus.getHistory().length, 2);
});

test("EventBus unsubscribe stops delivery", () => {
  const bus = new EventBus();
  const seen: string[] = [];
  const off = bus.on("router.decided", (e: RouterDecided) => seen.push(e.task));
  bus.emit({ event: "router.decided", decisionId: "d1", task: "t1", activations: [], deactivations: [] });
  off();
  bus.emit({ event: "router.decided", decisionId: "d2", task: "t2", activations: [], deactivations: [] });
  assert.deepEqual(seen, ["t1"]);
});

test("EventBus swallows handler errors", () => {
  const bus = new EventBus();
  bus.on("capability.installed", () => {
    throw new Error("boom");
  });
  assert.doesNotThrow(() => bus.emit({ event: "capability.installed", id: "x", version: "1.0.0" }));
});

test("EventBus clear resets history but not handlers", () => {
  const bus = new EventBus();
  const seen: string[] = [];
  bus.on("capability.installed", (e: Installed) => seen.push(e.id));
  bus.emit({ event: "capability.installed", id: "a", version: "1.0.0" });
  bus.clear();
  assert.equal(bus.getHistory().length, 0);
  bus.emit({ event: "capability.installed", id: "b", version: "1.0.0" });
  assert.deepEqual(seen, ["a", "b"]);
});