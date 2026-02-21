// src/controllers/app.controller.js
import { PrismaClient } from "@prisma/client";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import fsp from "fs/promises";
import multer from "multer";
import sharp from "sharp"; // npm install sharp

const prisma = new PrismaClient();

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ─── Paths ────────────────────────────────────────────────────────────────────
const appsDir = path.join(__dirname, "../../public/apps");
if (!fs.existsSync(appsDir)) fs.mkdirSync(appsDir, { recursive: true });

// ─── Multer — temp storage ────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const tempDir = path.join(process.cwd(), "uploads", "temp");
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    cb(null, tempDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB max per file
  fileFilter: (req, file, cb) => {
    const allowed = {
      icon:        /^image\/(jpeg|jpg|png|webp)$/,
      screenshots: /^image\/(jpeg|jpg|png|webp)$/,
      apk:         /^application\/(vnd\.android\.package-archive|octet-stream)$/,
    };
    const pattern = allowed[file.fieldname];
    if (!pattern || pattern.test(file.mimetype)) return cb(null, true);
    cb(new Error(`Invalid file type for field: ${file.fieldname}`));
  },
});

// ─── Helper: compress & save image ───────────────────────────────────────────
// Converts any uploaded image to a compressed WebP, saves it, removes temp file.
const compressAndSaveImage = async (srcPath, destDir, baseName) => {
  const outName = `${baseName}.webp`;
  const outPath = path.join(destDir, outName);
  await sharp(srcPath)
    .resize({ width: 1080, withoutEnlargement: true }) // max 1080px wide, never upscale
    .webp({ quality: 80 })
    .toFile(outPath);
  await fsp.unlink(srcPath); // remove temp file
  return outName;
};

// ─── Helper: safe file delete ─────────────────────────────────────────────────
const safeUnlink = async (filePath) => {
  try {
    if (filePath && fs.existsSync(filePath)) await fsp.unlink(filePath);
  } catch (err) {
    console.warn("⚠️  Could not delete file:", filePath, err.message);
  }
};

// ─── Helper: ensure dirs exist ────────────────────────────────────────────────
const ensureDir = (dirPath) => {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
};

// ─── Upload App ───────────────────────────────────────────────────────────────
export const uploadApp = [
  upload.fields([
    { name: "icon",        maxCount: 1  },
    { name: "apk",         maxCount: 1  },
    { name: "screenshots", maxCount: 10 },
  ]),

  async (req, res) => {
    let newApp = null; // track so we can clean up on failure
    try {
      const { title, description, category, version, isFree, price } = req.body;

      if (!title?.trim()) {
        return res.status(400).json({ success: false, error: "App title is required" });
      }
      if (!req.files?.apk?.[0]) {
        return res.status(400).json({ success: false, error: "APK file is required" });
      }

      // 1. Create DB record first to get the ID
      newApp = await prisma.app.create({
        data: {
          title:       title.trim(),
          description: description?.trim() || null,
          category:    category?.trim()    || null,
          version:     version?.trim()     || "1.0.0",
          apkUrl:      "__pending__",
          isFree:      isFree === "true",
          price:       parseFloat(price)   || 0,
          developerId: req.user.id,
        },
      });

      // 2. Create folder structure
      const appDir         = path.join(appsDir, String(newApp.id));
      const screenshotsDir = path.join(appDir, "screenshots");
      ensureDir(appDir);
      ensureDir(screenshotsDir);

      // 3. Move APK (no compression — binary file)
      const apkFile = req.files.apk[0];
      const apkDest = path.join(appDir, apkFile.originalname);
      await fsp.rename(apkFile.path, apkDest);
      const apkUrl = `/apps/${newApp.id}/${apkFile.originalname}`;

      // 4. Compress & save icon
      let iconUrl = null;
      if (req.files?.icon?.[0]) {
        const iconFile = req.files.icon[0];
        const outName  = await compressAndSaveImage(iconFile.path, appDir, "icon");
        iconUrl = `/apps/${newApp.id}/${outName}`;
      }

      // 5. Compress & save screenshots
      const screenshotUrls = [];
      if (req.files?.screenshots?.length) {
        for (let i = 0; i < req.files.screenshots.length; i++) {
          const s       = req.files.screenshots[i];
          const outName = await compressAndSaveImage(s.path, screenshotsDir, `screenshot_${i + 1}`);
          screenshotUrls.push(`/apps/${newApp.id}/screenshots/${outName}`);
        }
      }

      // 6. Update DB with final paths
      const finalApp = await prisma.app.update({
        where: { id: newApp.id },
        data:  { apkUrl, iconUrl, screenshots: screenshotUrls },
      });

      res.status(201).json({ success: true, app: finalApp });
    } catch (err) {
      console.error("❌ Upload app error:", err);
      // Clean up DB record if creation failed mid-way
      if (newApp?.id) {
        await prisma.app.delete({ where: { id: newApp.id } }).catch(() => {});
      }
      // Clean up any temp files left over
      const allFiles = Object.values(req.files || {}).flat();
      for (const f of allFiles) await safeUnlink(f.path);

      res.status(500).json({ success: false, error: "Upload failed" });
    }
  },
];

// ─── Update App ───────────────────────────────────────────────────────────────
export const updateApp = [
  upload.fields([
    { name: "icon",        maxCount: 1  },
    { name: "apk",         maxCount: 1  },
    { name: "screenshots", maxCount: 10 },
  ]),

  async (req, res) => {
    try {
      const appId = parseInt(req.params.id);
      const { title, description, category, version, isFree, price } = req.body;

      // 1. Find app + verify ownership
      const app = await prisma.app.findUnique({ where: { id: appId } });
      if (!app) return res.status(404).json({ success: false, error: "App not found" });
      if (app.developerId !== req.user.id) {
        return res.status(403).json({ success: false, error: "Not authorized to edit this app" });
      }

      const appDir         = path.join(appsDir, String(app.id));
      const screenshotsDir = path.join(appDir, "screenshots");
      ensureDir(appDir);
      ensureDir(screenshotsDir);

      // 2. APK — replace if new one uploaded
      let apkUrl = app.apkUrl;
      if (req.files?.apk?.[0]) {
        // Delete old APK
        if (app.apkUrl && app.apkUrl !== "__pending__") {
          await safeUnlink(path.join(process.cwd(), "public", app.apkUrl));
        }
        const apkFile = req.files.apk[0];
        const apkDest = path.join(appDir, apkFile.originalname);
        await fsp.rename(apkFile.path, apkDest);
        apkUrl = `/apps/${app.id}/${apkFile.originalname}`;
      }

      // 3. Icon — compress & replace if new one uploaded
      let iconUrl = app.iconUrl;
      if (req.files?.icon?.[0]) {
        // Delete old icon
        if (app.iconUrl) {
          await safeUnlink(path.join(process.cwd(), "public", app.iconUrl));
        }
        const iconFile = req.files.icon[0];
        const outName  = await compressAndSaveImage(iconFile.path, appDir, "icon");
        iconUrl = `/apps/${app.id}/${outName}`;
      }

      // 4. Screenshots
      let screenshotUrls = app.screenshots || [];

      // Handle individually deleted screenshots
      let deletedScreenshots = [];
      if (req.body.deletedScreenshots) {
        try {
          deletedScreenshots = JSON.parse(req.body.deletedScreenshots);
        } catch {
          console.warn("⚠️  Invalid deletedScreenshots JSON");
        }
      }
      if (deletedScreenshots.length > 0) {
        for (const url of deletedScreenshots) {
          await safeUnlink(path.join(process.cwd(), "public", url));
        }
        screenshotUrls = screenshotUrls.filter((s) => !deletedScreenshots.includes(s));
      }

      // Replace all screenshots if new ones uploaded
      if (req.files?.screenshots?.length) {
        // Delete remaining old screenshots
        for (const url of screenshotUrls) {
          await safeUnlink(path.join(process.cwd(), "public", url));
        }
        screenshotUrls = [];
        for (let i = 0; i < req.files.screenshots.length; i++) {
          const s       = req.files.screenshots[i];
          const outName = await compressAndSaveImage(s.path, screenshotsDir, `screenshot_${Date.now()}_${i + 1}`);
          screenshotUrls.push(`/apps/${app.id}/screenshots/${outName}`);
        }
      }

      // 5. Update DB
      const updatedApp = await prisma.app.update({
        where: { id: app.id },
        data: {
          title:       title?.trim()       || app.title,
          description: description?.trim() ?? app.description,
          category:    category?.trim()    ?? app.category,
          version:     version?.trim()     || app.version,
          isFree:      isFree !== undefined ? isFree === "true" : app.isFree,
          price:       price  !== undefined ? parseFloat(price) : app.price,
          apkUrl,
          iconUrl,
          screenshots: screenshotUrls,
        },
      });

      res.json({ success: true, app: updatedApp });
    } catch (err) {
      console.error("❌ Update app error:", err);
      const allFiles = Object.values(req.files || {}).flat();
      for (const f of allFiles) await safeUnlink(f.path);
      res.status(500).json({ success: false, error: "Update failed" });
    }
  },
];

// ─── Get All Apps ─────────────────────────────────────────────────────────────
export const getAllApps = async (req, res) => {
  try {
    const apps = await prisma.app.findMany({
      select: {
        id:      true,
        iconUrl: true,
        title:   true,
        version: true,
        isFree:  true,
        price:   true,
        category: true,
        _count: {
          select: { downloads: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json(apps);
  } catch (err) {
    console.error("❌ getAllApps error:", err);
    res.status(500).json({ error: "Server error" });
  }
};

// ─── Get App By ID ────────────────────────────────────────────────────────────
export const getAppById = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid app ID" });

    const app = await prisma.app.findUnique({
      where: { id },
      include: {
        developer: { select: { name: true } },
        _count:    { select: { downloads: true } },
      },
    });

    if (!app) return res.status(404).json({ success: false, error: "App not found" });

    // Remove sensitive field
    const { developerId, ...safeApp } = app;

    // Calculate APK size
    let appSize = null;
    if (app.apkUrl && app.apkUrl !== "__pending__") {
      const apkPath = path.join(process.cwd(), "public", app.apkUrl);
      if (fs.existsSync(apkPath)) {
        appSize = fs.statSync(apkPath).size; // bytes
      }
    }

    res.json({ success: true, app: { ...safeApp, size: appSize } });
  } catch (err) {
    console.error("❌ getAppById error:", err);
    res.status(500).json({ error: "Server error" });
  }
};

// ─── Delete App ───────────────────────────────────────────────────────────────
export const deleteApp = async (req, res) => {
  try {
    const appId = parseInt(req.params.id);
    if (isNaN(appId)) return res.status(400).json({ error: "Invalid app ID" });

    const app = await prisma.app.findUnique({ where: { id: appId } });
    if (!app) return res.status(404).json({ error: "App not found" });

    // Verify ownership from JWT only — never trust params
    if (app.developerId !== req.user.id) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    // Delete app folder from disk
    const appFolder = path.join(appsDir, app.id.toString());
    try {
      await fsp.rm(appFolder, { recursive: true, force: true });
      console.log(`🗑️  Deleted folder: ${appFolder}`);
    } catch (err) {
      console.error("⚠️  Error deleting app folder:", err.message);
      // Don't block DB deletion if folder removal fails
    }

    // Delete all related records atomically, then the app
    await prisma.$transaction([
      prisma.purchase.deleteMany({ where: { appId } }),
      prisma.download.deleteMany({ where: { appId } }),
      prisma.app.delete({ where: { id: appId } }),
    ]);

    res.json({ success: true, message: "App deleted successfully" });
  } catch (err) {
    console.error("❌ Delete app error:", err);
    res.status(500).json({ error: "Server error" });
  }
};

// ─── Download App ─────────────────────────────────────────────────────────────
export const appDownload = (req, res) => {
  try {
    const { fileName } = req.params;
    // Prevent path traversal attacks
    const safeName = path.basename(fileName);
    const filePath = path.join(appsDir, safeName);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "File not found" });
    }

    res.download(filePath, safeName, (err) => {
      if (err) {
        console.error("❌ Download error:", err);
        if (!res.headersSent) res.status(500).send("Error downloading file.");
      }
    });
  } catch (err) {
    console.error("❌ appDownload error:", err);
    res.status(500).send("Server Error");
  }
};

// ─── Developer Stats ──────────────────────────────────────────────────────────
export const getDeveloperStats = async (req, res) => {
  try {
    if (req.user.role !== "developer") {
      return res.status(403).json({ error: "Access denied. Not a developer." });
    }

    const apps = await prisma.app.findMany({
      where: { developerId: req.user.id },
      select: {
        isFree: true,
        price:  true,
        _count: { select: { downloads: true, purchases: true } },
      },
    });

    const totalApps      = apps.length;
    const totalDownloads = apps.reduce((sum, a) => sum + a._count.downloads, 0);
    const totalEarnings  = apps.reduce((sum, a) => {
      if (!a.isFree && a.price > 0) {
        return sum + a.price * a._count.purchases;
      }
      return sum;
    }, 0);

    res.json({ totalApps, totalDownloads, totalEarnings });
  } catch (err) {
    console.error("❌ Stats error:", err);
    res.status(500).json({ error: "Server error" });
  }
};

// ─── My Apps ──────────────────────────────────────────────────────────────────
export const getMyApps = async (req, res) => {
  try {
    const apps = await prisma.app.findMany({
      where: { developerId: req.user.id },
      include: {
        _count: { select: { downloads: true, purchases: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({ success: true, apps });
  } catch (err) {
    console.error("❌ getMyApps error:", err);
    res.status(500).json({ error: "Server error" });
  }
};