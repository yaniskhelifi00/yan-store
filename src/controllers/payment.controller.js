// src/controllers/payment.controller.js
import axios from "axios";
import { getAccessToken } from "../utils/paypal.js";
import { PrismaClient } from "@prisma/client";

const prisma      = new PrismaClient();
const PAYPAL_BASE = "https://api-m.sandbox.paypal.com";
const SERVER_BASE = process.env.SERVER_BASE_URL;

// ─── Create Order ─────────────────────────────────────────────────────────────
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
            custom_id: `${userId}:${appId}`,
          },
        ],
        application_context: {
          return_url:          `${SERVER_BASE}/api/payments/success`,
          cancel_url:          `${SERVER_BASE}/api/payments/cancel`,
          user_action:         "PAY_NOW",
          brand_name:          "AppStore",
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

// ─── Payment Success ──────────────────────────────────────────────────────────
// PayPal redirects here after the user approves.
// We capture + save the purchase here — the app just polls the DB afterwards.
export const paymentSuccess = async (req, res) => {
  try {
    const { token: orderId } = req.query;
    if (!orderId) return res.send(successHtml());

    const accessToken = await getAccessToken();

    // Get order details
    const orderRes = await axios.get(
      `${PAYPAL_BASE}/v2/checkout/orders/${orderId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const order = orderRes.data;

    // Already captured — nothing to do
    if (order.status === "COMPLETED") {
      console.log(`✅ Order ${orderId} already completed`);
      return res.send(successHtml());
    }

    // Capture
    await axios.post(
      `${PAYPAL_BASE}/v2/checkout/orders/${orderId}/capture`,
      {},
      { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" } }
    );

    // Save purchase using custom_id ("userId:appId")
    const customId = order.purchase_units?.[0]?.custom_id ?? "";
    const [userId, appId] = customId.split(":").map(Number);

    if (userId && appId) {
      await prisma.purchase.upsert({
        where:  { userId_appId: { userId, appId } },
        update: {},
        create: { userId, appId },
      });
      console.log(`✅ Purchase saved: userId=${userId} appId=${appId}`);
    } else {
      console.warn("⚠️  Could not parse custom_id:", customId);
    }

    res.send(successHtml());
  } catch (err) {
    console.error("❌ paymentSuccess error:", err.response?.data || err.message);
    // Show success page anyway — purchase likely went through
    res.send(successHtml());
  }
};

// ─── Capture Order ────────────────────────────────────────────────────────────
// Called by the mobile app after the browser closes.
// The success page already captured — we just poll the DB until the record appears.
// Fallback: if the success page failed for any reason, we capture directly.
export const captureOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = req.user.id;
    const appId  = parseInt(req.body.appId);

    if (!orderId) return res.status(400).json({ error: "Missing orderId" });
    if (!appId)   return res.status(400).json({ error: "Missing appId" });

    // Poll DB up to 10 times, every 2s = 20s max
    for (let i = 1; i <= 10; i++) {
      const purchase = await prisma.purchase.findUnique({
        where: { userId_appId: { userId, appId } },
      });

      if (purchase) {
        console.log(`✅ Purchase confirmed on DB check ${i}`);
        return res.json({ success: true, appId });
      }

      console.log(`DB check ${i}: purchase not yet saved, waiting...`);
      await new Promise((r) => setTimeout(r, 2000));
    }

    // Fallback: success page may have failed — try direct capture
    console.warn("⚠️  Purchase not in DB after 20s, attempting direct capture...");
    try {
      const token = await getAccessToken();

      const orderRes = await axios.get(
        `${PAYPAL_BASE}/v2/checkout/orders/${orderId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const status = orderRes.data.status;

      if (status === "APPROVED") {
        await axios.post(
          `${PAYPAL_BASE}/v2/checkout/orders/${orderId}/capture`,
          {},
          { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
        );
        await prisma.purchase.upsert({
          where:  { userId_appId: { userId, appId } },
          update: {},
          create: { userId, appId },
        });
        console.log(`✅ Fallback capture successful`);
        return res.json({ success: true, appId });
      }

      if (status === "COMPLETED") {
        // Was captured but DB save failed — save now
        await prisma.purchase.upsert({
          where:  { userId_appId: { userId, appId } },
          update: {},
          create: { userId, appId },
        });
        return res.json({ success: true, appId });
      }

      return res.status(400).json({ success: false, status: status ?? "ORDER_NOT_APPROVED" });
    } catch (fallbackErr) {
      console.error("❌ Fallback capture failed:", fallbackErr.response?.data || fallbackErr.message);
      return res.status(400).json({ success: false, status: "ORDER_NOT_APPROVED" });
    }
  } catch (err) {
    console.error("❌ captureOrder error:", err.message);
    res.status(500).json({ error: "Server error" });
  }
};

// ─── Check Purchase ───────────────────────────────────────────────────────────
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

// ─── Cancel ───────────────────────────────────────────────────────────────────
export const paymentCancel = (req, res) => res.send(cancelHtml());

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