const test = require("node:test");
const assert = require("node:assert/strict");

const { formatAcceleratorForDisplay } = require("./shortcutDisplay.cjs");

test("formats CommandOrControl shortcuts for mac display", () => {
  assert.equal(
    formatAcceleratorForDisplay("CommandOrControl+Shift+V", "darwin"),
    "Cmd+Shift+V",
  );
});

test("formats CommandOrControl shortcuts for windows display", () => {
  assert.equal(
    formatAcceleratorForDisplay("CommandOrControl+Shift+V", "win32"),
    "Ctrl+Shift+V",
  );
});

test("maps Alt to Option on mac display labels", () => {
  assert.equal(
    formatAcceleratorForDisplay("Alt+Space", "darwin"),
    "Option+Space",
  );
});

test("keeps unknown keys intact while formatting known modifiers", () => {
  assert.equal(
    formatAcceleratorForDisplay("Meta+Shift+P", "win32"),
    "Win+Shift+P",
  );
});
