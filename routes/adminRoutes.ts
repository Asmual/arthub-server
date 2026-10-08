import express, { Response } from "express";
import { ObjectId } from "mongodb";
import { verifyToken, verifyRole } from "../middlewares";
import { getUserCollection, getArtworkCollection, getOrderCollection } from "../models/collections";
import { AuthenticatedRequest } from "../types";

const router = express.Router();

/**
 * Utility helper to safely cast string IDs to MongoDB ObjectIds
 */
const toOid = (id: string): ObjectId | null => {
  try {
    return ObjectId.isValid(id) ? new ObjectId(id) : null;
  } catch {
    return null;
  }
};

// Apply centralized structural middleware boundaries across all administrative router paths
router.use(verifyToken as any);
router.use(verifyRole(["admin"]) as any);

/* =========================================================================
   USERS MANAGEMENT (ADMIN ONLY)
========================================================================= */

/**
 * @route   GET /api/admin/users
 * @desc    Fetch all registered application profiles excluding highly sensitive credential logs
 */
router.get("/users", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userCollection = getUserCollection(req);
    const users = await userCollection
      .find({}, { projection: { password: 0, hashedPassword: 0 } })
      .toArray();

    return res.status(200).json(users);
  } catch (err: any) {
    return res.status(500).json({
      error: true,
      message: "Failed to fetch platform users.",
      details: err.message,
    });
  }
});

/**
 * @route   PATCH /api/admin/users/:id/role
 * @desc    Update specific profile capability authorizations inside source of truth
 */
router.patch("/users/:id/role", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const userCollection = getUserCollection(req);
    const oid = toOid(id);
    const { role } = req.body;

    const allowedRoles = ["user", "artist", "admin"];
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ error: true, message: "Invalid role structural context assigned." });
    }

    const query = oid ? { $or: [{ _id: oid }, { id }] } : { id };

    const result = await userCollection.findOneAndUpdate(
      query as any,
      { $set: { role, updatedAt: new Date() } },
      { returnDocument: "after" }
    );

    const updatedUser = (result as any)?.value || result;
    return res.status(200).json(updatedUser);
  } catch (err: any) {
    return res.status(500).json({
      error: true,
      message: "Failed to mutate user role assignment.",
      details: err.message,
    });
  }
});

/**
 * @route   PATCH /api/admin/users/:id/status
 * @desc    Block or unblock a user/artist
 */
router.patch("/users/:id/status", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const userCollection = getUserCollection(req);
    const oid = toOid(id);
    const { isBlocked } = req.body;

    const blockedFlag = Boolean(isBlocked);
    const query = oid ? { $or: [{ _id: oid }, { id }] } : { id };

    const result = await userCollection.findOneAndUpdate(
      query as any,
      {
        $set: {
          isBlocked: blockedFlag,
          status: blockedFlag ? "blocked" : "active",
          updatedAt: new Date(),
        },
      },
      { returnDocument: "after" }
    );

    const updatedUser = (result as any)?.value || result;
    if (!updatedUser) {
      return res.status(404).json({ error: true, message: "User not found." });
    }

    return res.status(200).json({ success: true, user: updatedUser });
  } catch (err: any) {
    return res.status(500).json({
      error: true,
      message: "Failed to update user status.",
      details: err.message,
    });
  }
});

/**
 * @route   DELETE /api/admin/users/:id
 * @desc    Purge specific target profile document from master user collection registry
 */
router.delete("/users/:id", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const userCollection = getUserCollection(req);
    const oid = toOid(id);

    const query = oid ? { $or: [{ _id: oid }, { id }] } : { id };
    const result = await userCollection.deleteOne(query as any);

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: true, message: "Target user matrix registry entry not found." });
    }

    return res.status(200).json({ success: true, message: "User deleted successfully." });
  } catch (err: any) {
    return res.status(500).json({
      error: true,
      message: "Failed to execute user profile purge workflow.",
      details: err.message,
    });
  }
});

/* =========================================================================
   ARTWORK MANAGEMENT
========================================================================= */

/**
 * @route   GET /api/admin/artworks
 * @desc    Fetch all cataloged listings inside centralized singular artwork collection
 */
router.get("/artworks", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const artworkCollection = getArtworkCollection(req);
    const artworks = await artworkCollection
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    const normalized = artworks.map((art: any) => {
      const stock = typeof art.quantity === "number" ? art.quantity : 10;
      return {
        ...art,
        quantity: stock,
        isSold: stock === 0,
      };
    });

    return res.status(200).json(normalized);
  } catch (err: any) {
    return res.status(500).json({
      error: true,
      message: "Failed to fetch platform art marketplace listings.",
      details: err.message,
    });
  }
});

/**
 * @route   PATCH /api/admin/artworks/:id/stock
 * @desc    Disallowed for admin: Only the creator/artist can manage artwork stock
 */
router.patch("/artworks/:id/stock", async (_req: AuthenticatedRequest, res: Response) => {
  return res.status(403).json({
    error: true,
    message: "Admin accounts cannot modify artwork stock. Only the artist who created the artwork can change its stock.",
  });
});

/**
 * @route   POST /api/admin/artworks/reset-stock
 * @desc    Initialize all artworks to have stock quantity = 10 and isSold = false
 */
router.post("/artworks/reset-stock", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const artworkCollection = getArtworkCollection(req);
    const result = await artworkCollection.updateMany(
      { $or: [{ quantity: { $exists: false } }, { quantity: null }, { isSold: true }] },
      { $set: { quantity: 10, isSold: false, updatedAt: new Date() } }
    );
    return res.status(200).json({ success: true, modifiedCount: result.modifiedCount });
  } catch (err: any) {
    return res.status(500).json({ error: true, message: "Failed to reset artwork stock.", details: err.message });
  }
});

/**
 * @route   DELETE /api/admin/artworks/:id
 * @desc    Remove artwork object listing maps entirely from ecosystem records
 */
router.delete("/artworks/:id", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const artworkCollection = getArtworkCollection(req);
    const oid = toOid(id);

    const query = oid
      ? { $or: [{ _id: oid }, { _id: id }, { id }] }
      : { $or: [{ _id: id }, { id }] };

    const result = await artworkCollection.deleteOne(query as any);

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: true, message: "Artwork item lookup footprint not found." });
    }

    return res.status(200).json({ success: true, message: "Artwork deleted successfully from marketplace database." });
  } catch (err: any) {
    return res.status(500).json({
      error: true,
      message: "Failed to destroy targeted marketplace artwork asset.",
      details: err.message,
    });
  }
});

/* =========================================================================
   ANALYTICS & DASHBOARD STATS
========================================================================= */

/**
 * @route   GET /api/admin/analytics
 * @desc    Compile basic core structural metric calculations via high-performance promise threading
 */
router.get("/analytics", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userCollection = getUserCollection(req);
    const artworkCollection = getArtworkCollection(req);
    const orderCollection = getOrderCollection(req);

    const [totalUsers, totalArtists, totalArtworks, revenueData] = await Promise.all([
      userCollection.countDocuments({ role: { $in: ["user", "buyer"] } }),
      userCollection.countDocuments({ role: "artist" }),
      artworkCollection.countDocuments(),
      orderCollection
        .aggregate([
          {
            $group: {
              _id: null,
              totalRevenue: { $sum: "$amount" },
              totalSales: { $sum: 1 },
            },
          },
        ])
        .toArray(),
    ]);

    const analytics = revenueData[0] || {};

    return res.status(200).json({
      totalUsers,
      totalArtists,
      totalArtworks,
      totalRevenue: analytics.totalRevenue || 0,
      totalSales: analytics.totalSales || 0,
    });
  } catch (err: any) {
    return res.status(500).json({
      error: true,
      message: "Failed to compile aggregate platform data metrics.",
      details: err.message,
    });
  }
});

/**
 * @route   GET /api/admin/dashboard-stats
 * @desc    Fetch advanced operational ledger items and real-time transaction tracking flows
 */
router.get("/dashboard-stats", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userCollection = getUserCollection(req);
    const artworkCollection = getArtworkCollection(req);
    const orderCollection = getOrderCollection(req);

    const [totalUsers, verifiedArtworks, transactionsCount, revenueResult, recentSales] = await Promise.all([
      userCollection.countDocuments(),
      artworkCollection.countDocuments(),
      orderCollection.countDocuments(),
      orderCollection
        .aggregate([
          {
            $group: {
              _id: null,
              totalRevenue: { $sum: "$amount" },
            },
          },
        ])
        .toArray(),
      orderCollection.find({}).sort({ date: -1, createdAt: -1 }).limit(5).toArray(),
    ]);

    return res.status(200).json({
      totalUsers,
      verifiedArtworks,
      transactionsCount,
      platformRevenue: revenueResult[0]?.totalRevenue || 0,
      recentSales,
    });
  } catch (error: any) {
    return res.status(500).json({
      error: true,
      message: "Failed to load dashboard operational statistics from live MongoDB cluster.",
      details: error.message,
    });
  }
});

/**
 * @route   GET /api/admin/analytics/sales-chart
 * @desc    Aggregate chronologically mapped transaction historical data pools for UI line charts
 */
router.get("/analytics/sales-chart", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const orderCollection = getOrderCollection(req);
    const chartData = await orderCollection
      .aggregate([
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m", date: "$date" } },
            sales: { $sum: 1 },
            revenue: { $sum: "$amount" },
          },
        },
        { $sort: { _id: 1 } },
      ])
      .toArray();

    return res.status(200).json(chartData);
  } catch (err: any) {
    return res.status(500).json({
      error: true,
      message: "Failed to map chronological ledger parameters.",
      details: err.message,
    });
  }
});

/**
 * @route   GET /api/admin/analytics/categories
 * @desc    Compile visual category metric statistics for analytical interface graphs
 */
router.get("/analytics/categories", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const artworkCollection = getArtworkCollection(req);
    const categoryData = await artworkCollection
      .aggregate([
        {
          $group: {
            _id: "$category",
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
      ])
      .toArray();

    return res.status(200).json(categoryData);
  } catch (err: any) {
    return res.status(500).json({
      error: true,
      message: "Failed to categorize inventory metrics.",
      details: err.message,
    });
  }
});

export default router;
