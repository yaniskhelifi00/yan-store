// src/server.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import cors from "cors";
import dotenv from "dotenv";
import appRoutes from "./routes/appRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import testRoutes from "./routes/testRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import paymentRoutes from "./routes/payment.routes.js";

dotenv.config();

// Needed for __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

app.use(cors({ origin: "*" }));
// Routes
app.use("/app", appRoutes);
app.use("/auth", authRoutes);
app.use("/test", testRoutes);
app.use("/user", userRoutes);
app.use("/apps", express.static(path.join(__dirname, "../public/apps")));
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));
app.use("/api/payments", paymentRoutes);

app.get("/test", (req, res) => { //for test
  res.send("Server is running");
});
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
