// src/controllers/payment.controller.js
import axios from "axios";
import { getAccessToken } from "../utils/paypal.js";
import { PrismaClient } from "@prisma/client";

const prisma      = new PrismaClient();
const PAYPAL_BASE = "https://api-m.sandbox.paypal.com";
const SERVER_BASE = process.env.SERVER_BASE_URL; // e.g. "http://192.168.1.105:5000"

// ─── Create Order ─────────────────────────────────────────────────────────────
// Protected — req.user comes from authenticateToken middleware
export const createOrder = async (req, res) => {
  try {
    const { amount, appId } = req.body;
    const userId = req.user.id;

    if (!amount || isNaN(parseFloat(amount))) {
      return res.status(400).json({ error: "Invalid amount" });
    }
    if (!appId) {
      return res.status(400).json({ error: "Missing appId" });
    }

    // Block double-purchase
    const existing = await prisma.purchase.findUnique({
      where: { userId_appId: { userId, appId: parseInt(appId) } },
    });
    if (existing) {
      return res.status(400).json({ error: "App already purchased" });
    }

    const token = await getAccessToken();

    const response = await axios.post(
      `${PAYPAL_BASE}/v2/checkout/orders`,
      {
        intent: "CAPTURE",
        purchase_units: [
          {
            amount: { currency_code: "USD", value: parseFloat(amount).toFixed(2) },
            // Encode userId + appId so we can recover them in the success route
            // (PayPal redirect is a plain browser GET — no auth header available there)
            custom_id: `${userId}:${appId}`,
          },
        ],
        application_context: {
          return_url: `${SERVER_BASE}/api/payments/success`,
          cancel_url:  `${SERVER_BASE}/api/payments/cancel`,
          user_action: "PAY_NOW",
          brand_name:  "AppStore",
          shipping_preference: "NO_SHIPPING",
        },
      },
      { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
    );

    const order       = response.data;
    const approvalUrl = order.links?.find((l) => l.rel === "approve")?.href;

    res.json({ orderId: order.id, approvalUrl, status: order.status });
  } catch (err) {
    console.error("Create Order Error:", err.response?.data || err.message);
    res.status(500).json({ error: "Failed to create order" });
  }
};

// ─── Capture Order ────────────────────────────────────────────────────────────
// Protected — called by the mobile app after user closes the PayPal browser
export const captureOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = req.user.id;

    if (!orderId) return res.status(400).json({ error: "Missing orderId" });

    const token = await getAccessToken();

    // Poll until order is APPROVED (max 10 seconds, check every 2s)
    let orderStatus = null;
    for (let i = 0; i < 5; i++) {
      const orderCheck = await axios.get(
        `${PAYPAL_BASE}/v2/checkout/orders/${orderId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      //console.log("Full order:", JSON.stringify(orderCheck.data, null, 2));
      orderStatus = orderCheck.data.status;
      //console.log(`Order status check ${i + 1}: ${orderStatus}`);

      if (orderStatus === "APPROVED") break;
      if (orderStatus === "COMPLETED") {
        // Already captured (e.g. by success page) — just save purchase and return
        const customId = orderCheck.data.purchase_units?.[0]?.custom_id ?? "";
        const appId = parseInt(customId.split(":")[1]);
        if (appId) {
          await prisma.purchase.upsert({
            where:  { userId_appId: { userId, appId } },
            update: {},
            create: { userId, appId },
          });
        }
        return res.json({ success: true, status: "COMPLETED", appId });
      }

      // Wait 2 seconds before next check
      await new Promise((r) => setTimeout(r, 2000));
    }

    if (orderStatus !== "APPROVED") {
      return res.json({ success: false, status: orderStatus ?? "ORDER_NOT_APPROVED" });
    }

    // Now capture
    const response = await axios.post(
      `${PAYPAL_BASE}/v2/checkout/orders/${orderId}/capture`,
      {},
      { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
    );

    const capture = response.data;
    //console.log("Capture response:", capture.status);

    if (capture.status !== "COMPLETED") {
      return res.json({ success: false, status: capture.status });
    }

    // Parse appId from custom_id ("userId:appId") or fallback to request body
    const customId = capture.purchase_units?.[0]?.custom_id ?? "";
    //console.log("custom_id received:", customId);
    let appId = parseInt(customId.split(":")[1]);

    // Fallback: client sends appId in body
    if (!appId && req.body?.appId) {
      appId = parseInt(req.body.appId);
      //console.log("Using appId from request body:", appId);
    }

    if (!appId) {
      console.error("Could not parse appId from custom_id:", customId);
      return res.status(500).json({ error: "Could not determine purchased app" });
    }

    // Save purchase
    await prisma.purchase.upsert({
      where:  { userId_appId: { userId, appId } },
      update: {},
      create: { userId, appId },
    });

    res.json({ success: true, status: capture.status, appId });
  } catch (err) {
    const issue = err.response?.data?.details?.[0]?.issue;
    if (issue === "ORDER_NOT_APPROVED") {
      return res.json({ success: false, status: "ORDER_NOT_APPROVED" });
    }
    console.error("Capture Order Error:", err.response?.data || err.message);
    res.status(500).json({ error: "Failed to capture order" });
  }
};

// ─── Check Purchase ───────────────────────────────────────────────────────────
// Protected — called by AppDetailsScreen on load to show correct button state
export const checkPurchase = async (req, res) => {
  try {
    const userId = req.user.id;
    const appId  = parseInt(req.params.appId);

    const purchase = await prisma.purchase.findUnique({
      where: { userId_appId: { userId, appId } },
    });

    res.json({ purchased: !!purchase });
  } catch (err) {
    console.error("Check Purchase Error:", err.message);
    res.status(500).json({ error: "Failed to check purchase" });
  }
};

// ─── Success page ─────────────────────────────────────────────────────────────
// Public — PayPal redirects here after payment. We also capture + save here
// as a safety net in case the user closes the browser before the app calls /capture.
export const paymentSuccess = async (req, res) => {
  // Capture is handled by the mobile app calling POST /capture/:orderId
  // This page is only shown to the user as confirmation — no capture here
  res.send(successHtml());
};

// ─── Cancel page ──────────────────────────────────────────────────────────────
// Public — PayPal redirects here if user cancels
export const paymentCancel = (req, res) => {
  res.send(cancelHtml());
};

// ─── HTML helpers ─────────────────────────────────────────────────────────────
const baseStyle = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    min-height: 100vh;
    display: flex; align-items: center; justify-content: center; padding: 20px;
  }
  .card {
    background: white; border-radius: 24px; padding: 48px 36px;
    text-align: center; box-shadow: 0 8px 40px rgba(0,0,0,0.1);
    max-width: 360px; width: 100%;
  }
  .icon {
    width: 80px; height: 80px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    margin: 0 auto 24px; font-size: 40px;
  }
  h1 { font-size: 24px; margin-bottom: 12px; font-weight: 800; }
  p  { font-size: 15px; color: #666; line-height: 1.6; }
  .hint {
    margin-top: 28px; padding: 14px 20px; background: #f9f9f9;
    border-radius: 12px; font-size: 13px; color: #999;
  }
`;

const successHtml = () => `
  <!DOCTYPE html><html lang="en">
  <head>
    <meta charset="UTF-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    <title>Payment Successful</title>
    <style>
      ${baseStyle}
      body { background: #f4f8f6; }
      .icon { background: #e8f5e9; }
      h1 { color: #01875f; }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="icon">✅</div>
      <h1>Payment Successful!</h1>
      <p>Your payment has been confirmed.<br/>You can now close this tab and return to the app to download.</p>
      <div class="hint">🔒 This tab can be safely closed.</div>
    </div>
  </body></html>
`;

const cancelHtml = () => `
  <!DOCTYPE html><html lang="en">
  <head>
    <meta charset="UTF-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    <title>Payment Cancelled</title>
    <style>
      ${baseStyle}
      body { background: #fff4f4; }
      .icon { background: #fdecea; }
      h1 { color: #ea4335; }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="icon">❌</div>
      <h1>Payment Cancelled</h1>
      <p>You cancelled the payment.<br/>Close this tab and try again from the app.</p>
      <div class="hint">No charge was made to your account.</div>
    </div>
  </body></html>
`;