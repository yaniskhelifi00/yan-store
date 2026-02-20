// src/controllers/payment.controller.js
import axios from "axios";
import { getAccessToken } from "../utils/paypal.js";

const PAYPAL_BASE = "https://api-m.sandbox.paypal.com";

export const createOrder = async (req, res) => {
  try {
    const { amount } = req.body;
    const token = await getAccessToken();

    const response = await axios.post(
      `${PAYPAL_BASE}/v2/checkout/orders`,
      {
        intent: "CAPTURE",
        purchase_units: [
          {
            amount: {
              currency_code: "USD",
              value: amount,
            },
          },
        ],
        application_context: {
          return_url: "http://localhost:5000/payment/success",
          cancel_url: "http://localhost:5000/payment/cancel"
        },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    res.json(response.data);
  } catch (err) {
    console.error("Create Order Error:", err.response?.data || err.message);
    res.status(500).json({ error: "Failed to create order" });
  }
};



export const captureOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const token = await getAccessToken();

    const response = await axios.post(
      `${PAYPAL_BASE}/v2/checkout/orders/${orderId}/capture`,
      {},
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    res.json(response.data);
  } catch (err) {
    console.error("Capture Order Error:", err.response?.data || err.message);
    res.status(500).json({ error: "Failed to capture order" });
  }
};