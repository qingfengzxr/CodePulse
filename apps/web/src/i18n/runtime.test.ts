import assert from "node:assert/strict";
import test from "node:test";

import { formatMetricLabel, formatSamplingLabel } from "../display";
import { normalizeLocale, setRuntimeLocale, translate } from "./index";
import { normalizeThemeMode, resolveThemeMode } from "../theme";

test("normalizeLocale maps Chinese and English variants", () => {
  assert.equal(normalizeLocale("zh"), "zh-CN");
  assert.equal(normalizeLocale("zh-Hans-CN"), "zh-CN");
  assert.equal(normalizeLocale("en-US"), "en");
  assert.equal(normalizeLocale("fr"), null);
});

test("theme resolution supports system mode", () => {
  assert.equal(normalizeThemeMode("system"), "system");
  assert.equal(normalizeThemeMode("dark"), "dark");
  assert.equal(normalizeThemeMode("invalid"), null);
  assert.equal(resolveThemeMode("system", "dark"), "dark");
  assert.equal(resolveThemeMode("system", "light"), "light");
  assert.equal(resolveThemeMode("dark", "light"), "dark");
});

test("labels and translations follow runtime locale", () => {
  setRuntimeLocale("en");
  assert.equal(translate("shell.theme.system"), "System");
  assert.equal(formatMetricLabel("added"), "Added");
  assert.equal(formatSamplingLabel("weekly"), "Weekly");

  setRuntimeLocale("zh-CN");
  assert.equal(translate("shell.theme.system"), "跟随系统");
  assert.equal(formatMetricLabel("added"), "新增");
  assert.equal(formatSamplingLabel("weekly"), "Weekly");
});
