const express = require("express");
const cors = require("cors");
require("dotenv").config();
const connectDB = require("./config/db");

// Import routes at the top layer for optimized memory allocation
const artistRoutes = require("./routes/artistRoutes");
const artworkRoutes = require("./routes/artworkRoutes");
const reviewRoutes = require("./routes/reviewRoutes");
const paymentRoutes = require("./routes/paymentRoutes");

const app = express();
const port = process.env.PORT || 5000;

// Production-ready CORS configuration supporting local and deployed environments
const allowedOrigins = [
  "http://localhost:3000",
  "https://arthub-three.vercel.app",
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.indexOf(origin) === -1) {
        const msg = "The CORS policy for this site does not allow access from the specified Origin.";
        return callback(new Error(msg), false);
      }
      return callback(null, true);
    },
    credentials: true,
  }),
);

app.use(express.json());

// Global connection state handler
async function startServer() {
  try {
    const db = await connectDB();
    console.log("MongoDB Connected Successfully!");

    // Set stable db link accessible across express controllers
    app.set("db", db);

    // Root Health Check Route
    app.get("/", (req, res) => {
      res.send("ArtHub Server is running perfectly...");
    });

    // Dedicated API Route Mounts
    app.use("/api/artists", artistRoutes);
    app.use("/api/artworks", artworkRoutes);
    app.use("/api/reviews", reviewRoutes);
    app.use("/api/payments", paymentRoutes);

    // Initialize server listener
    app.listen(port, () => {
      console.log(`Server is running securely on port: ${port}`);
    });
  } catch (error) {
    console.error("Failed to start server properly:", error);
    process.exit(1);
  }
}

startServer();