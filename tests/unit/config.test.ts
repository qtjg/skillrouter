import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configPaths, loadConfig, setConfigValue, unsetConfigValue, writeProjectConfig, DEFAULT_CONFIG } from "../../src/config/config.ts";
import { ConfigError } from "../../src/utils/errors.ts";

test("configPaths honors XDG env vars", () => {
  process.env.XDG_CONFIG_HOME = "/tmp/cfg";
  process.env.XDG_STATE_HOME = "/tmp/state";
  try {
    const paths = configPaths("/repo");
    assert.equal(paths.projectConfig, "/repo/skillrouter.yaml");
    assert.equal(paths.globalConfig, "/tmp/cfg/skillrouter/config.yaml");
    assert.equal(paths.stateDir, "/tmp/state/skillrouter");
  } finally {
    delete process.env.XDG_CONFIG_HOME;
    delete process.env.XDG_STATE_HOME;
  }
});

test("loadConfig returns defaults with no config files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sr-cfg-"));
  process.env.XDG_CONFIG_HOME = join(dir, "cfg");
  process.env.XDG_STATE_HOME = join(dir, "state");
  try {
    const { config, projectConfigPath, globalConfigPath } = await loadConfig(dir);
    assert.deepEqual(config, DEFAULT_CONFIG);
    assert.equal(projectConfigPath, null);
    assert.ok(globalConfigPath.endsWith("config.yaml"));
  } finally {
    delete process.env.XDG_CONFIG_HOME;
    delete process.env.XDG_STATE_HOME;
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadConfig merges project config over global config", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sr-merge-"));
  process.env.XDG_CONFIG_HOME = join(dir, "cfg");
  process.env.XDG_STATE_HOME = join(dir, "state");
  try {
    const project = join(dir, "app");
    await writeProjectConfig(project, { ...DEFAULT_CONFIG, router: { ...DEFAULT_CONFIG.router, threshold: 60, mode: "automatic" } });
    await setConfigValue("router.threshold", 30, dir);
    const { config } = await loadConfig(project);
    assert.equal(config.router.threshold, 60);
    assert.equal(config.router.mode, "automatic");
    assert.equal(config.router.maxActivations, DEFAULT_CONFIG.router.maxActivations);
  } finally {
    delete process.env.XDG_CONFIG_HOME;
    delete process.env.XDG_STATE_HOME;
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadConfig rejects invalid threshold and mode", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sr-badcfg-"));
  process.env.XDG_CONFIG_HOME = join(dir, "cfg");
  try {
    const project = join(dir, "app");
    await writeProjectConfig(project, { ...DEFAULT_CONFIG, router: { ...DEFAULT_CONFIG.router, threshold: 101 } });
    await assert.rejects(
      () => loadConfig(project),
      (err: unknown) => err instanceof ConfigError && err.message.includes("threshold"),
    );
    await writeProjectConfig(project, { ...DEFAULT_CONFIG, router: { ...DEFAULT_CONFIG.router, mode: "nope" as never } });
    await assert.rejects(
      () => loadConfig(project),
      (err: unknown) => err instanceof ConfigError && err.message.includes("mode"),
    );
  } finally {
    delete process.env.XDG_CONFIG_HOME;
    delete process.env.XDG_STATE_HOME;
    await rm(dir, { recursive: true, force: true });
  }
});

test("setConfigValue and unsetConfigValue round-trip", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sr-setcfg-"));
  process.env.XDG_CONFIG_HOME = join(dir, "cfg");
  process.env.XDG_STATE_HOME = join(dir, "state");
  try {
    const path = await setConfigValue("router.threshold", 77, dir);
    const content = await readFile(path, "utf8");
    assert.ok(content.includes("threshold: 77"));
    const { config } = await loadConfig(dir);
    assert.equal(config.router.threshold, 77);
    await unsetConfigValue("router.threshold", dir);
    const reloaded = await loadConfig(dir);
    assert.equal(reloaded.config.router.threshold, DEFAULT_CONFIG.router.threshold);
  } finally {
    delete process.env.XDG_CONFIG_HOME;
    delete process.env.XDG_STATE_HOME;
    await rm(dir, { recursive: true, force: true });
  }
});