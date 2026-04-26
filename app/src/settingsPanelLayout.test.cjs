const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const stylesPath = path.join(__dirname, "styles.css");
const styles = fs.readFileSync(stylesPath, "utf8");

const getRuleBlock = (selector) => {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = styles.match(new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `Expected to find CSS rule for ${selector}`);
  return match[1];
};

test("settings overlay allows scrolling when the panel exceeds the viewport", () => {
  const overlayRule = getRuleBlock(".settings-overlay");

  assert.match(overlayRule, /overflow-y:\s*auto;/);
});

test("settings panel constrains its height and scrolls its own content", () => {
  const panelRule = getRuleBlock(".settings-panel");

  assert.match(panelRule, /max-height:\s*calc\(100vh\s*-\s*48px\);/);
  assert.match(panelRule, /overflow-y:\s*auto;/);
});
