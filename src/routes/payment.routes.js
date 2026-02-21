// src/routes/payment.routes.js
import { Router } from "express";
import {
  createOrder,
  captureOrder,
  checkPurchase,
  paymentSuccess,
  paymentCancel,
} from "../controllers/payment.controller.js";
import authenticateToken from "../middleware/authMiddleware.js";

const router = Router();

// ── Protected (JWT required) ──────────────────────────────────────────────────
router.post("/create-order",         authenticateToken, createOrder);
router.post("/capture/:orderId",     authenticateToken, captureOrder);
router.get("/check/:appId",          authenticateToken, checkPurchase);

// ── Public (PayPal browser redirect — no auth header possible) ────────────────
router.get("/success", paymentSuccess);
router.get("/cancel",  paymentCancel);

export default router;