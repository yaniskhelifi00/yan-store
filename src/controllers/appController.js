import { PrismaClient } from "@prisma/client";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import fsp from "fs/promises"; 
import multer from "multer";

const prisma = new PrismaClient();

// Needed for __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 📂 Base folder for apps
const appsDir = path.join(__dirname, "../../public/apps");

// Make sure base dir exists
if (!fs.existsSync(appsDir)) {
  fs.mkdirSync(appsDir, { recursive: true });
}

// ---- Multer setup ----
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Always use a safe temp folder for first upload
    const tempDir = path.join(process.cwd(), "uploads", "temp");
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    cb(null, tempDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  },
});

const upload = multer({ storage });

export const uploadApp = [
  upload.fields([
    { name: "icon", maxCount: 1 },
    { name: "apk", maxCount: 1 },
    { name: "screenshots", maxCount: 10 },
  ]),
  
  async (req, res) => {
    try {
      const { title, description, category, version, isFree, price } = req.body;
      console.log("BODY:", req.body);
      console.log("FILES:", req.files);

      if (!title) {
        return res.status(400).json({ success: false, error: "App title is required" });
      }

      // ✅ Step 1: Create DB record first (temporary, without file paths)
      const newApp = await prisma.app.create({
        data: {
          title,
          description,
          category,
          version,
          apkUrl: "will update later",
          isFree: isFree === "true",
          price: parseFloat(price) || 0,
          developerId: req.user.id,
        },
      });

      // ✅ Step 2: Prepare folders using app.id
      const appDir = path.join(appsDir, String(newApp.id));
      const screenshotsDir = path.join(appDir, "screenshots");

      if (!fs.existsSync(appDir)) fs.mkdirSync(appDir, { recursive: true });
      if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });

      // ✅ Step 3: Save files
      let apkUrl = null;
      if (req.files?.apk?.[0]) {
        const apkFile = req.files.apk[0];
        const apkPath = path.join(appDir, apkFile.originalname);
        fs.renameSync(apkFile.path, apkPath);
        apkUrl = `/apps/${newApp.id}/${apkFile.originalname}`;
      }

      let iconUrl = null;
      if (req.files?.icon?.[0]) {
        const iconFile = req.files.icon[0];
        const iconPath = path.join(appDir, iconFile.originalname);
        fs.renameSync(iconFile.path, iconPath);
        iconUrl = `/apps/${newApp.id}/${iconFile.originalname}`;
      }

      const screenshotUrls = [];
      if (req.files?.screenshots) {
        req.files.screenshots.forEach((s) => {
          const targetPath = path.join(screenshotsDir, s.originalname);
          fs.renameSync(s.path, targetPath);
          screenshotUrls.push(`/apps/${newApp.id}/screenshots/${s.originalname}`);
        });
      }

      // ✅ Step 4: Update DB record with file paths
      const finalApp = await prisma.app.update({
        where: { id: newApp.id },
        data: {
          apkUrl,
          iconUrl,
          screenshots: screenshotUrls,
        },
      });

      res.json({ success: true, app: finalApp });
    } catch (err) {
      console.error("❌ Upload app error:", err);
      res.status(500).json({ success: false, error: "Upload failed" });
    }
  },
];


export const updateApp = [
  upload.fields([
    { name: "icon", maxCount: 1 },
    { name: "apk", maxCount: 1 },
    { name: "screenshots", maxCount: 10 },
  ]),

  async (req, res) => {
    try {
      console.log("FIELDS BODY:", req.body);
      console.log("FIELDS FILES:", req.files);
      const { id } = req.params;
      const { title, description, category, version, isFree, price } = req.body;
      
      // ✅ Handle deleted screenshots
      let deletedScreens = [];
      if (req.body.deletedScreenshots) {
        try {
          deletedScreens = JSON.parse(req.body.deletedScreenshots);
          console.log(deletedScreens);
        } catch (e) {
          console.warn("⚠️ Invalid deletedScreenshots JSON:", req.body.deletedScreenshots);
        }
      }


      // ✅ Find app
      const app = await prisma.app.findUnique({ where: { id: parseInt(id) } });
      if (!app) {
        return res.status(404).json({ success: false, error: "App not found" });
      }

      // 🚨 Ownership check
      if (app.developerId !== req.user.id) {
        return res
          .status(403)
          .json({ success: false, error: "Not authorized to edit this app" });
      }

      // ✅ Folder structure (based on ID, not title)
      const appDir = path.join(appsDir, String(app.id));
      const screenshotsDir = path.join(appDir, "screenshots");

      if (!fs.existsSync(appDir)) fs.mkdirSync(appDir, { recursive: true });
      if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });

      // ✅ Replace APK if new one uploaded
      let apkUrl = app.apkUrl;
      if (req.files?.apk?.[0]) {
        if (apkUrl) {
          const oldApkPath = path.join(appDir, path.basename(apkUrl));
          try {
            if (oldApkPath && fs.existsSync(oldApkPath)) {
              fs.unlinkSync(oldApkPath);
            }
          } catch (err) {
            console.warn("⚠️ Failed to delete old APK:", err.message);
          }

        }
        const apkFile = req.files.apk[0];
        const newApkPath = path.join(appDir, apkFile.originalname);
        fs.renameSync(apkFile.path, newApkPath);
        apkUrl = `/apps/${app.id}/${apkFile.originalname}`;
      }

      // ✅ Replace Icon if new one uploaded
      let iconUrl = app.iconUrl;
      if (req.files?.icon?.[0]) {
        if (iconUrl) {
          const oldIconPath = path.join(appDir, path.basename(iconUrl));
          if (fs.existsSync(oldIconPath)) fs.unlinkSync(oldIconPath);
        }
        const iconFile = req.files.icon[0];
        const newIconPath = path.join(appDir, iconFile.originalname);
        fs.renameSync(iconFile.path, newIconPath);
        iconUrl = `/apps/${app.id}/${iconFile.originalname}`;
      }

      // ✅ Replace Screenshots
      let screenshotUrls = app.screenshots || [];

      if (req.files?.screenshots?.length) {
        // remove old screenshots
        screenshotUrls.forEach((s) => {
          const oldScreenshotPath = path.join(screenshotsDir, path.basename(s));
          if (fs.existsSync(oldScreenshotPath)) fs.unlinkSync(oldScreenshotPath);
        });

        // save new ones
        screenshotUrls = [];
        req.files.screenshots.forEach((s) => {
          const targetPath = path.join(screenshotsDir, s.originalname);
          fs.renameSync(s.path, targetPath);
          screenshotUrls.push(`/apps/${app.id}/screenshots/${s.originalname}`);
        });
      } else if (req.body.screenshots === "[]") {
        // 🚨 If `screenshots` is explicitly sent empty -> delete old ones
        screenshotUrls.forEach((s) => {
          const oldScreenshotPath = path.join(screenshotsDir, path.basename(s));
          if (fs.existsSync(oldScreenshotPath)) fs.unlinkSync(oldScreenshotPath);
        });
        screenshotUrls = [];
      }


      // ✅ Update DB record
      const updatedApp = await prisma.app.update({
        where: { id: app.id },
        data: {
          title: title || app.title,
          description: description || app.description,
          category: category || app.category,
          version: version || app.version,
          isFree: isFree !== undefined ? isFree === "true" : app.isFree,
          price: price !== undefined ? parseFloat(price) : app.price,
          apkUrl,
          iconUrl,
          screenshots: screenshotUrls,
        },
      });

      res.json({ success: true, app: updatedApp });
    } catch (err) {
      console.error("❌ Update app error:", err);
      res.status(500).json({ success: false, error: "Update failed" });
    }
  },
];



export const getAllApps = async (req, res) => {
  try {
    const apps = await prisma.app.findMany({
      select: {
        id : true,
        iconUrl: true,
        title: true,
        version: true,
        isFree: true,
        price: true,
        downloads: true, // include all download rows
      },
      orderBy: { createdAt: "desc" },
    });

    res.json(apps);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
};





export const getAppById = async (req, res) => {
  try {
    const id = parseInt(req.params.id);

    const app = await prisma.app.findUnique({
      where: { id },
      include: { 
        developer: {
          select: {
            name: true
          }
        },
        _count: {
          select: {
            downloads: true // This returns the integer count of downloads
          }
        }
      },
    });

    if (!app) {
      return res.status(404).json({ success: false, error: "App not found" });
    } else {
      delete app.developerId;
    }

    // ✅ Calculate APK size
    let appSize = null;
    if (app.apkUrl) {
      // Convert URL (/apps/123/file.apk) → absolute path
      const apkPath = path.join(process.cwd(), "public", app.apkUrl);
      if (fs.existsSync(apkPath)) {
        const stats = fs.statSync(apkPath);
        appSize = stats.size; // in bytes
      }
    }

    res.json({ success: true, app: { ...app, size: appSize } });
  } catch (error) {
    console.error("❌ getAppById error:", error);
    res.status(500).json({ error: "Server error" });
  }
};


//delete app
export const deleteApp = async (req, res) => {
  try {
    const appId = parseInt(req.params.id);

    // 1️⃣ Find the app in DB
    const app = await prisma.app.findUnique({ where: { id: appId } });
    if (!app) return res.status(404).json({ error: "App not found" });

    // 2️⃣ Check if the logged-in user owns this app
    if (app.developerId !== req.user.id) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    // 3️⃣ Delete the app folder including all files
    const appFolder = path.join(__dirname, "../../public/apps", app.id.toString());
    try {
      await fsp.rm(appFolder, { recursive: true, force: true });
      console.log(`Deleted folder: ${appFolder}`);
    } catch (err) {
      console.error("Error deleting folder:", err);
    }

    // 4️⃣ Delete the app from DB (downloads are automatically deleted due to cascade)
    await prisma.app.delete({ where: { id: appId } });

    res.json({ message: "App deleted successfully" });
  } catch (err) {
    console.error("Delete app error:", err);
    res.status(500).json({ error: "Server error" });
  }
};



export const appDownload = (req, res) => {
  try {
    const { fileName } = req.params;
    const filePath = path.join(__dirname, "../../public/apps", fileName);

    res.download(filePath, fileName, (err) => {
      if (err) {
        console.error(err);
        res.status(500).send("Error downloading the file.");
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Server Error");
  }
};



export const getDeveloperStats = async (req, res) => {
  try {
    const developerId = req.user.id;

    const isDeveloper = req.user.role === 'developer';
    if (!isDeveloper) {
      return res.status(403).json({ error: "Access denied. Not a developer." });
    }

    // Fetch all apps for this developer
    const apps = await prisma.app.findMany({
      where: { developerId: parseInt(developerId) },
      include: {
        downloads: true, // assuming you have a Download model
      },
    });

    if (!apps || apps.length === 0) {
      return res.json({
        totalApps: 0,
        totalDownloads: 0,
        totalEarnings: 0,
      });
    }

    // Calculate stats
    const totalApps = apps.length;

    const totalDownloads = apps.reduce(
      (sum, app) => sum + (app.downloads?.length || 0),
      0
    );

    const totalEarnings = apps.reduce((sum, app) => {
      if (!app.isFree && app.price) {
        return sum + app.price * (app.downloads?.length || 0);
      }
      return sum;
    }, 0);

    res.json({
      totalApps,
      totalDownloads,
      totalEarnings,
    });
  } catch (err) {
    console.error("Stats error:", err);
    res.status(500).json({ error: "Server error" });
  }
};

//My Apps Controller
export const getMyApps = async (req, res) => {
  try {
    // ✅ user is injected by authenticateToken middleware
    const userId = req.user.id;
    console.log("user ID from token:", userId);

    const apps = await prisma.app.findMany({
      where: { developerId: userId }, // developerId must match the logged-in user
      include: {
        downloads: true, // include related downloads
      },
    });

    res.json(apps);
  } catch (error) {
    console.error("getMyApps error:", error);
    res.status(500).json({ error: "Server error" });
  }
};