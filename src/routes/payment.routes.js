// src/routes/payment.routes.js
import express from "express";
import { createOrder, captureOrder } from "../controllers/payment.controller.js";

const router = express.Router();

router.post("/create-order", createOrder);
router.post("/capture/:orderId", captureOrder);

export default router;