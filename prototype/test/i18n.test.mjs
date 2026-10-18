import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from 'node:fs';
import { Language, McpText, I18n } from "../dist/i18n.js";
import { Locale, Text } from "../extension/i18n.js";
import { NativeStatus } from "../extension/protocol.js";

const toolNames = [
  "requestSession", "approvalStatus", "listTabs", "createTab", "closeTab", "release",
  "observe", "fill", "click", "navigate", "capabilities", "availableTabs",
];

test("language selection honors explicit values and falls back to system locale", () => {
  assert.equal(I18n.select("zh-CN", "en-US"), Language.ZH_CN);
  assert.equal(I18n.select("en", "zh-CN"), Language.EN);
  assert.equal(I18n.select("fr", "zh-CN"), Language.EN);
  assert.equal(I18n.select(undefined, "zh-TW"), Language.ZH_CN);
  assert.equal(I18n.select(undefined, "en-US"), Language.EN);
});

test("all MCP tools have localized descriptions", () => {
  for (const language of [Language.EN, Language.ZH_CN]) {
    assert.deepEqual(Object.keys(McpText.TOOLS[language]).sort(), [...toolNames].sort());
    for (const description of Object.values(McpText.TOOLS[language])) {
      assert.ok(description.trim().length > 0);
    }
  }
});

test("popup catalogs cover all text keys and browser locale fallbacks", () => {
  const manifest = JSON.parse(readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
  assert.match(manifest.content_security_policy.extension_pages, /connect-src 'self'(?:;|$)/);
  const keys = [...Object.values(Text), ...Object.values(NativeStatus.Hints)];
  assert.deepEqual(Object.keys(Locale.Catalogs.en).sort(), Object.keys(Locale.Catalogs['zh-CN']).sort());
  for (const language of ['en', 'zh-CN']) {
    const locale = new Locale({}, language);
    for (const key of keys) assert.ok(locale.get(key) && locale.get(key) !== key);
  }
  assert.equal(Locale.normalize('zh_TW'), 'zh-CN');
  assert.equal(Locale.normalize('de-DE'), 'en');
});

test("popup still works when local preference storage is unavailable", async () => {
  const locale = new Locale({}, 'zh-CN');
  await locale.load();
  assert.equal(locale.language, 'zh-CN');
  await locale.set('en');
  assert.equal(locale.language, 'en');
  await locale.set('invalid');
  assert.equal(locale.choice, 'en');
});
