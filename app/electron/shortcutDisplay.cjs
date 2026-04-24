const { getDesktopPlatform } = require("./windowChrome.cjs");

const MAC_TOKEN_MAP = {
  alt: "Option",
  command: "Cmd",
  commandorcontrol: "Cmd",
  control: "Ctrl",
  ctrl: "Ctrl",
  meta: "Cmd",
  option: "Option",
  shift: "Shift",
  super: "Cmd",
};

const WINDOWS_TOKEN_MAP = {
  alt: "Alt",
  command: "Win",
  commandorcontrol: "Ctrl",
  control: "Ctrl",
  ctrl: "Ctrl",
  meta: "Win",
  option: "Alt",
  shift: "Shift",
  super: "Win",
};

const LINUX_TOKEN_MAP = {
  alt: "Alt",
  command: "Super",
  commandorcontrol: "Ctrl",
  control: "Ctrl",
  ctrl: "Ctrl",
  meta: "Super",
  option: "Alt",
  shift: "Shift",
  super: "Super",
};

const getTokenMap = (platform = process.platform) => {
  const desktopPlatform = getDesktopPlatform(platform);

  if (desktopPlatform === "mac") {
    return MAC_TOKEN_MAP;
  }

  if (desktopPlatform === "windows") {
    return WINDOWS_TOKEN_MAP;
  }

  return LINUX_TOKEN_MAP;
};

const formatAcceleratorForDisplay = (accelerator, platform = process.platform) => {
  if (typeof accelerator !== "string" || !accelerator.trim()) {
    return "";
  }

  const tokenMap = getTokenMap(platform);

  return accelerator
    .split("+")
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => tokenMap[token.toLowerCase()] || token)
    .join("+");
};

module.exports = {
  formatAcceleratorForDisplay,
};
