const express = require("express");
const cors = require("cors");
require("dotenv").config();
const connectDB = require("./config/db");

const artistRoutes = require("./routes/artistRoutes");
const artworkRoutes = require("./routes/artworkRoutes");
const reviewRoutes = require("./routes/reviewRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const userRoutes = require("./routes/userRoutes");
const adminRoutes = require("./routes/adminRoutes");

const app = express();
const port = process.env.PORT || 5000;

const allowedOrigins = [
  "http://localhost:3000",
  "https://arthub-three.vercel.app",
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

// CRITICAL: Stripe webhook requires raw body payload before express.json() parser
app.use("/api/payment/webhook", express.raw({ type: "application/json" }));

// Standard JSON parser for all other API endpoints
app.use(express.json());

async function startServer() {
  try {
    const db = await connectDB();

    // Test the database connection
    app.get("/", (req, res) => {
      res.send("ArtHub Server running with Database Connected.");
    });

    // Share database instance across route handlers using app.set
    app.set("db", db);
    console.log("MongoDB Connection Successful!");

    // Main API Route Handlers
    app.use("/api/artists", artistRoutes);
    app.use("/api/artworks", artworkRoutes);
    app.use("/api/reviews", reviewRoutes);
    app.use("/api/payment", paymentRoutes);
    app.use("/api/users", userRoutes);
    app.use("/api/admin", adminRoutes);

    // Global Centralized Error Handling Middleware
    app.use((err, req, res, next) => {
      console.error("Global Error Caught:", err);
      res.status(500).json({
        message: "Internal Server Error",
        error: err.message,
      });
    });

    app.listen(port, () => {
      console.log(`Server running on port ${port}`);
      console.log(`API Link: http://localhost:${port}`);
    });

  } catch (error) {
    console.error("MongoDB connection or Server startup failed:", error);
    process.exit(1);
  }
}

startServer();