// src/routes/stat.routes.js
import express from "express";
import { getDeveloperStats, getRecentActivity, getWeeklyDownloads } from "../controllers/stats.controller.js";
import authenticateToken from "../middleware/authMiddleware.js";

const router = express.Router();


router.get("/stats",    authenticateToken, getDeveloperStats);
router.get("/activity", authenticateToken, getRecentActivity);
router.get("/weekly",   authenticateToken, getWeeklyDownloads);

export default router;