import type { DesktopPlatform } from "../types";

const TOKEN_MAPS: Record<DesktopPlatform, Record<string, string>> = {
  mac: {
    alt: "Option",
    command: "Cmd",
    commandorcontrol: "Cmd",
    control: "Ctrl",
    ctrl: "Ctrl",
    meta: "Cmd",
    option: "Option",
    shift: "Shift",
    super: "Cmd",
  },
  windows: {
    alt: "Alt",
    command: "Win",
    commandorcontrol: "Ctrl",
    control: "Ctrl",
    ctrl: "Ctrl",
    meta: "Win",
    option: "Alt",
    shift: "Shift",
    super: "Win",
  },
  linux: {
    alt: "Alt",
    command: "Super",
    commandorcontrol: "Ctrl",
    control: "Ctrl",
    ctrl: "Ctrl",
    meta: "Super",
    option: "Alt",
    shift: "Shift",
    super: "Super",
  },
};

export const formatAcceleratorForDisplay = (
  accelerator: string | null | undefined,
  platform: DesktopPlatform,
) =>
  (accelerator || "")
    .split("+")
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => TOKEN_MAPS[platform][token.toLowerCase()] || token)
    .join("+");
