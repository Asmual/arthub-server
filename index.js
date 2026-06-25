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

app.use("/api/payments/webhook", express.raw({ type: "application/json" }));
app.use(express.json());

async function startServer() {
  try {
    const db = await connectDB();

    // Test the database connection
    app.get("/", (req, res) => {
      res.send("ArtHub Server running with Database Connected.");
    });
    // Database instance is now available for route handlers via app.locals
    app.set("db", db);
    console.log("MongoDB Connection Successful!");

    // Route handlers for different API endpoints
    app.use("/api/artists", artistRoutes);
    app.use("/api/artworks", artworkRoutes);
    app.use("/api/reviews", reviewRoutes);
    app.use("/api/payments", paymentRoutes);
    app.use("/api/users", userRoutes);
    app.use("/api/admin", adminRoutes);

    // Global error handling middleware
    app.use((err, req, res, next) => {
      console.error("Global Error Caught:", err);
      res.status(500).json({
        message: "Internal Server Error",
        error: err.message,
      });
    });

    app.listen(port, () => {
      console.log(` Server running on port ${port}`);
      console.log(` API Link: http://localhost:${port}`);
    });

  } catch (error) {

    console.error("MongoDB connection or Server startup failed:", error);
    process.exit(1);
  }
}

startServer();