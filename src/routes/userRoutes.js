// routes/userRoutes.js
import express from "express";
import { updateUser , getUser } from "../controllers/userControllers.js"
import authenticateToken from "../middleware/authMiddleware.js";

const router = express.Router();

// PUT /api/users/me
router.get("/me", authenticateToken, getUser);

// PUT /api/users/me
router.put("/me", authenticateToken, updateUser);

export default router;
