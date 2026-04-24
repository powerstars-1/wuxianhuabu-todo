const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getDesktopPlatform,
  getWindowChromeConfig,
} = require("./windowChrome.cjs");

test("maps darwin to mac and uses native window chrome", () => {
  assert.equal(getDesktopPlatform("darwin"), "mac");
  assert.deepEqual(getWindowChromeConfig("darwin"), {
    desktopPlatform: "mac",
    browserWindow: {
      frame: true,
      titleBarStyle: "default",
    },
    showCustomWindowControls: false,
    shouldRemoveMenu: false,
  });
});

test("maps win32 to windows and keeps custom frameless controls", () => {
  assert.equal(getDesktopPlatform("win32"), "windows");
  assert.deepEqual(getWindowChromeConfig("win32"), {
    desktopPlatform: "windows",
    browserWindow: {
      frame: false,
      titleBarStyle: "hidden",
    },
    showCustomWindowControls: true,
    shouldRemoveMenu: true,
  });
});

test("falls back to linux-style chrome for other desktop platforms", () => {
  assert.equal(getDesktopPlatform("freebsd"), "linux");
  assert.deepEqual(getWindowChromeConfig("freebsd"), {
    desktopPlatform: "linux",
    browserWindow: {
      frame: false,
      titleBarStyle: "hidden",
    },
    showCustomWindowControls: true,
    shouldRemoveMenu: true,
  });
});
