import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, classifyResult, calibrate, buildConfidence, measureCalibration, normalizeThresholds } from "../../src/classification/classifier.ts";
import { buildClarification } from "../../src/clarification/clarifier.ts";

test("classify maps scores to NO_MATCH/WEAK_MATCH/GOOD_MATCH/EXACT_MATCH with defaults", () => {
  assert.equal(classify(10), "NO_MATCH");
  assert.equal(classify(24), "NO_MATCH");
  assert.equal(classify(25), "WEAK_MATCH");
  assert.equal(classify(49), "WEAK_MATCH");
  assert.equal(classify(50), "GOOD_MATCH");
  assert.equal(classify(74), "GOOD_MATCH");
  assert.equal(classify(75), "EXACT_MATCH");
  assert.equal(classify(95), "EXACT_MATCH");
});

test("custom thresholds are normalized and ordered", () => {
  const t = normalizeThresholds({ noMatch: 10, weak: 20, good: 60, exact: 40 });
  // sorted: 10,20,40,60
  assert.deepEqual(t, { noMatch: 10, weak: 20, good: 40, exact: 60 });
  assert.equal(classify(15, t), "WEAK_MATCH");
  assert.equal(classify(50, t), "EXACT_MATCH");
  assert.equal(classify(35, t), "GOOD_MATCH");
  assert.equal(classify(5, t), "NO_MATCH");
});

test("out-of-range scores are clamped to [0,100]", () => {
  assert.equal(classify(-5), "NO_MATCH");
  assert.equal(classify(150), "EXACT_MATCH");
});

test("calibrate without enough evidence returns the naive score probability", () => {
  assert.equal(calibrate(80, []), 0.8);
  assert.equal(calibrate(80, [{ successRate: 0.5, usage: 5 }]), 0.8, "usage < MIN_OBSERVATIONS is ignored");
});

test("calibrate blends observed reliability when samples are sufficient", () => {
  const samples = [{ successRate: 0.5, usage: 50 }];
  const value = calibrate(80, samples);
  assert.equal(value, Math.round((0.4 * 0.8 + 0.6 * 0.5) * 1000) / 1000);
  assert.ok(value < 0.8 && value > 0.5);
});

test("buildConfidence labels by value with calibration version", () => {
  assert.deepEqual(buildConfidence(90, []), { value: 0.9, label: "high", calibrationVersion: "1.0.0" });
  assert.deepEqual(buildConfidence(50, []).label, "medium");
  assert.deepEqual(buildConfidence(20, []).label, "low");
});

test("classifyResult composes class + confidence + reasons", () => {
  const result = classifyResult(82, [{ successRate: 0.9, usage: 20 }]);
  assert.equal(result.class, "EXACT_MATCH");
  assert.ok(result.confidence.value > 0.8);
  assert.ok(result.reasons.some((r) => r.includes("calibrated")));
  const weak = classifyResult(30, []);
  assert.equal(weak.class, "WEAK_MATCH");
  assert.ok(weak.reasons.some((r) => r.includes("clarification")));
  const none = classifyResult(10, []);
  assert.equal(none.class, "NO_MATCH");
  assert.ok(none.reasons.some((r) => r.includes("no activation")));
});

test("measureCalibration reports ECE and Brier", () => {
  // Scores 90/10 predict 0.9/0.1 while outcomes are 1.0/0.0:
  // ECE = 0.5*|1-0.9| + 0.5*|0-0.1| = 0.1; Brier = 0.01.
  const perfectBayes = measureCalibration([
    { score: 90, success: true },
    { score: 90, success: true },
    { score: 10, success: false },
    { score: 10, success: false },
  ]);
  assert.equal(perfectBayes.ece, 0.1);
  assert.equal(perfectBayes.brier, 0.01);
  assert.equal(perfectBayes.n, 4);

  const ideal = measureCalibration([
    { score: 100, success: true },
    { score: 100, success: true },
    { score: 0, success: false },
    { score: 0, success: false },
  ]);
  assert.equal(ideal.ece, 0);
  assert.equal(ideal.brier, 0);

  const noisy = measureCalibration([
    { score: 90, success: false },
    { score: 10, success: true },
  ]);
  assert.ok(noisy.ece > 0.5);
  assert.ok(noisy.brier > 0.5);
});

test("buildClarification returns null when a candidate is clearly ahead", () => {
  const c = buildClarification([
    { id: "a", label: "A", score: 90 },
    { id: "b", label: "B", score: 80 },
  ]);
  assert.equal(c, null);
  assert.equal(buildClarification([{ id: "a", label: "A", score: 90 }]), null);
  assert.equal(buildClarification([]), null);
});

test("buildClarification produces a minimal question for close candidates", () => {
  const c = buildClarification([
    { id: "docker", label: "Docker Deploy", score: 82.4 },
    { id: "docker-lite", label: "Docker Deploy Lite", score: 81.9 },
    { id: "kube", label: "Kube Deploy", score: 70 },
  ]);
  assert.ok(c, "close top two must trigger a clarification");
  assert.ok(c!.question.includes("Docker Deploy"));
  assert.deepEqual(c!.resolves, ["docker", "docker-lite"]);
  assert.equal(c!.options.length, 2, "kube is beyond the margin");
  assert.ok(c!.options.every((o) => !o.label.includes("secret") && !o.id.includes(":")));
});

test("maxOptions bounds the clarification surface", () => {
  const c = buildClarification(
    [
      { id: "a", label: "A", score: 80 },
      { id: "b", label: "B", score: 79 },
      { id: "c", label: "C", score: 78 },
      { id: "d", label: "D", score: 77 },
    ],
    { maxOptions: 2 },
  );
  assert.equal(c!.options.length, 2);
});