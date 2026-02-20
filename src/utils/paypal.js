// src/utils/paypal.js
import axios from "axios";

const PAYPAL_BASE = "https://api-m.sandbox.paypal.com"; // change to Live for production

export const getAccessToken = async () => {
  const auth = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_SECRET}`
  ).toString("base64");

  try {
    const response = await axios.post(
      `${PAYPAL_BASE}/v1/oauth2/token`,
      "grant_type=client_credentials",
      {
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    return response.data.access_token;
  } catch (err) {
    console.error("PayPal Token Error:", err.response?.data || err.message);
    throw err;
  }
};