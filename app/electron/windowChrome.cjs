const getDesktopPlatform = (platform = process.platform) => {
  if (platform === "darwin") {
    return "mac";
  }

  if (platform === "win32") {
    return "windows";
  }

  return "linux";
};

const getWindowChromeConfig = (platform = process.platform) => {
  const desktopPlatform = getDesktopPlatform(platform);

  if (desktopPlatform === "mac") {
    return {
      desktopPlatform,
      browserWindow: {
        frame: true,
        titleBarStyle: "default",
      },
      showCustomWindowControls: false,
      shouldRemoveMenu: false,
    };
  }

  return {
    desktopPlatform,
    browserWindow: {
      frame: false,
      titleBarStyle: "hidden",
    },
    showCustomWindowControls: true,
    shouldRemoveMenu: true,
  };
};

module.exports = {
  getDesktopPlatform,
  getWindowChromeConfig,
};
