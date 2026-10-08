import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import dotenv from "dotenv";
import connectDB from "./config/db";

// Core router configurations pipeline mapping
import artistRoutes from "./routes/artistRoutes";
import artworkRoutes from "./routes/artworkRoutes";
import reviewRoutes from "./routes/reviewRoutes";
import paymentRoutes from "./routes/paymentRoutes";
import userRoutes from "./routes/userRoutes";
import adminRoutes from "./routes/adminRoutes";
import subscriptionRoutes from "./routes/subscriptionRoutes";
import aiRoutes from "./routes/aiRoutes";

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

const allowedOrigins: string[] = [
  "http://localhost:3000",
  "https://arthub-three.vercel.app",
];

// Configure Cross-Origin Resource Sharing protocols
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      callback(new Error("Not allowed by CORS cross-origin configuration framework"));
    },
    credentials: true,
  })
);

app.use("/api/payment/webhook", express.raw({ type: "application/json" }));

// Standard JSON parser for all other incoming API operations
app.use(express.json());

async function startServer(): Promise<void> {
  try {
    // Await primary database thread mapping instantiation layer
    const db = await connectDB();

    // Default target probe validation landing page
    app.get("/", (_req: Request, res: Response) => {
      res.send("ArtHub Server running with Database Connected via Hybrid Security Blueprint.");
    });

    // Share database instance across route handlers using native Express allocation engine
    app.set("db", db);
    console.log("MongoDB Connection Successful!");

    // Central Application API Route Registrations
    app.use("/api/artists", artistRoutes);
    app.use("/api/artworks", artworkRoutes);
    app.use("/api/reviews", reviewRoutes);
    app.use("/api/payment", paymentRoutes);
    app.use("/api/users", userRoutes);
    app.use("/api/admin", adminRoutes);
    app.use("/api/subscription", subscriptionRoutes);
    app.use("/api/ai", aiRoutes);

    // Global Centralized Fail-Safe Exception Catchment Endpoint Setup
    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      console.error("Global Infrastructure Error Caught:", err);
      res.status(500).json({
        error: true,
        message: "Internal Platform Error Architecture Core Interrupted.",
        details: err.message,
      });
    });

    app.listen(port, () => {
      console.log(`Server executing successfully on runtime environment port ${port}`);
      console.log(`Live API Routing Cluster: http://localhost:${port}`);
    });
  } catch (error) {
    console.error("Platform initialization protocol crash:", error);
    process.exit(1);
  }
}

startServer();

export default app;
