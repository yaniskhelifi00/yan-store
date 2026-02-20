import fs from "fs";
import path from "path";

export const createAppFolders = (appId) => {
  const appPath = path.join(process.cwd(), "public", "apps", String(appId));
  const screenshotsPath = path.join(appPath, "screenshots");

  if (!fs.existsSync(appPath)) fs.mkdirSync(appPath, { recursive: true });
  if (!fs.existsSync(screenshotsPath)) fs.mkdirSync(screenshotsPath);

  return { appPath, screenshotsPath };
};