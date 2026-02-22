// src/controllers/stats.controller.js
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const getDeveloperStats = async (req, res) => {
  try {
    const developerId = req.user.id;

    const apps = await prisma.app.findMany({
      where: { developerId },
      select: { id: true },
    });

    const appIds = apps.map((a) => a.id);
    console.log("developerId:", developerId);
    console.log("appIds:", appIds);

    if (appIds.length === 0) {
      return res.json({ totalApps: 0, totalDownloads: 0, totalRevenue: 0, totalUsers: 0 });
    }

    const totalApps = appIds.length;

    const totalDownloads = await prisma.download.count({
      where: { appId: { in: appIds } },
    });
    console.log("totalDownloads:", totalDownloads);

    const uniqueUsers = await prisma.download.findMany({
      where:    { appId: { in: appIds } },
      select:   { userId: true },
      distinct: ["userId"],
    });
    console.log("uniqueUsers:", uniqueUsers);

    const totalUsers = uniqueUsers.length;

    const developer = await prisma.user.findUnique({
      where:  { id: developerId },
      select: { solde: true },
    });

    const totalRevenue = developer?.solde ?? 0;

    res.json({
      totalApps,
      totalDownloads,
      totalRevenue: totalRevenue.toFixed(2),
      totalUsers,
    });
  } catch (err) {
    console.error("getDeveloperStats error:", err.message);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
};

// GET /dev/activity  — last 10 downloads + purchases across developer's apps
export const getRecentActivity = async (req, res) => {
  try {
    const developerId = req.user.id;

    const apps = await prisma.app.findMany({
      where:  { developerId },
      select: { id: true },
    });
    const appIds = apps.map((a) => a.id);

    if (appIds.length === 0) return res.json({ activity: [] });

    // Fetch recent downloads
    const downloads = await prisma.download.findMany({
      where:   { appId: { in: appIds } },
      orderBy: { downloadedAt: "desc" },
      take:    10,
      select:  {
        downloadedAt: true,
        app: { select: { title: true } },
      },
    });

    // Fetch recent purchases
    const purchases = await prisma.purchase.findMany({
      where:   { appId: { in: appIds } },
      orderBy: { purchasedAt: "desc" },
      take:    10,
      select:  {
        purchasedAt: true,
        app: { select: { title: true, price: true } },
      },
    });

    // Merge + sort by date
    const activity = [
      ...downloads.map((d) => ({
        type:      "download",
        appTitle:  d.app.title,
        action:    "New download",
        createdAt: d.downloadedAt,
      })),
      ...purchases.map((p) => ({
        type:      "purchase",
        appTitle:  p.app.title,
        action:    `Purchased — $${p.app.price.toFixed(2)}`,
        createdAt: p.purchasedAt,
      })),
    ]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 10);

    res.json({ activity });
  } catch (err) {
    console.error("getRecentActivity error:", err.message);
    res.status(500).json({ error: "Failed to fetch activity" });
  }
};

// GET /dev/weekly  — downloads per day for the last 7 days
export const getWeeklyDownloads = async (req, res) => {
  try {
    const developerId = req.user.id;

    const apps = await prisma.app.findMany({
      where:  { developerId },
      select: { id: true },
    });
    const appIds = apps.map((a) => a.id);

    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      d.setHours(0, 0, 0, 0);
      return d;
    });

    const counts = await Promise.all(
      days.map((day) => {
        const next = new Date(day);
        next.setDate(next.getDate() + 1);
        return prisma.download.count({
          where: {
            appId:        { in: appIds },
            downloadedAt: { gte: day, lt: next },
          },
        });
      })
    );

    res.json({ days: counts });
  } catch (err) {
    console.error("getWeeklyDownloads error:", err.message);
    res.status(500).json({ error: "Failed to fetch weekly data" });
  }
};