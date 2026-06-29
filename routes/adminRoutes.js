const express = require("express");
const router = express.Router();
const { ObjectId } = require("mongodb");
const { verifyToken, verifyRole } = require("../middlewares.js");
const { getUserCollection, getArtworkCollection, getOrderCollection } = require("../models/collections");

/**
 * Utility helper to safely cast string IDs to MongoDB ObjectIds
 */
const toOid = (id) => {
  try {
    return ObjectId.isValid(id) ? new ObjectId(id) : null;
  } catch {
    return null;
  }
};

// Apply centralized structural middleware boundaries across all administrative router paths
router.use(verifyToken);
router.use(verifyRole(["admin"]));

/* =========================================================================
   USERS MANAGEMENT (ADMIN ONLY)
========================================================================= */

/**
 * @route   GET /api/admin/users
 * @desc    Fetch all registered application profiles excluding highly sensitive credential logs
 */
router.get("/users", async (req, res) => {
  try {
    const userCollection = getUserCollection(req);
    const users = await userCollection
      .find({}, { projection: { password: 0, hashedPassword: 0 } })
      .toArray();

    res.status(200).json(users);
  } catch (err) {
    res.status(500).json({
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
router.patch("/users/:id/role", async (req, res) => {
  try {
    const userCollection = getUserCollection(req);
    const oid = toOid(req.params.id);
    const { role } = req.body;

    const allowedRoles = ["user", "artist", "admin"];
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ error: true, message: "Invalid role structural context assigned." });
    }

    const result = await userCollection.findOneAndUpdate(
      { $or: [{ _id: oid }, { id: req.params.id }] },
      { $set: { role, updatedAt: new Date() } },
      { returnDocument: "after" }
    );

    const updatedUser = result && result.value ? result.value : result;
    res.status(200).json(updatedUser);
  } catch (err) {
    res.status(500).json({
      error: true,
      message: "Failed to mutate user role assignment.",
      details: err.message,
    });
  }
});

/**
 * @route   DELETE /api/admin/users/:id
 * @desc    Purge specific target profile document from master user collection registry
 */
router.delete("/users/:id", async (req, res) => {
  try {
    const userCollection = getUserCollection(req);
    const oid = toOid(req.params.id);

    const result = await userCollection.deleteOne({
      $or: [{ _id: oid }, { id: req.params.id }],
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: true, message: "Target user matrix registry entry not found." });
    }

    res.status(200).json({ success: true, message: "User deleted successfully." });
  } catch (err) {
    res.status(500).json({
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
router.get("/artworks", async (req, res) => {
  try {
    const artworkCollection = getArtworkCollection(req);
    const artworks = await artworkCollection
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).json(artworks);
  } catch (err) {
    res.status(500).json({
      error: true,
      message: "Failed to fetch platform art marketplace listings.",
      details: err.message,
    });
  }
});

/**
 * @route   DELETE /api/admin/artworks/:id
 * @desc    Remove artwork object listing maps entirely from ecosystem records
 */
router.delete("/artworks/:id", async (req, res) => {
  try {
    const artworkCollection = getArtworkCollection(req);
    const oid = toOid(req.params.id);

    const result = await artworkCollection.deleteOne({ _id: oid });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: true, message: "Artwork item lookup footprint not found." });
    }

    res.status(200).json({ success: true, message: "Artwork deleted successfully from marketplace database." });
  } catch (err) {
    res.status(500).json({
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
router.get("/analytics", async (req, res) => {
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

    res.status(200).json({
      totalUsers,
      totalArtists,
      totalArtworks,
      totalRevenue: analytics.totalRevenue || 0,
      totalSales: analytics.totalSales || 0,
    });
  } catch (err) {
    res.status(500).json({
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
router.get("/dashboard-stats", async (req, res) => {
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
      orderCollection.find({}).sort({ date: -1 }).limit(5).toArray(),
    ]);

    res.status(200).json({
      totalUsers,
      verifiedArtworks,
      transactionsCount,
      platformRevenue: revenueResult[0]?.totalRevenue || 0,
      recentSales,
    });
  } catch (error) {
    res.status(500).json({
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
router.get("/analytics/sales-chart", async (req, res) => {
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

    res.status(200).json(chartData);
  } catch (err) {
    res.status(500).json({
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
router.get("/analytics/categories", async (req, res) => {
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

    res.status(200).json(categoryData);
  } catch (err) {
    res.status(500).json({
      error: true,
      message: "Failed to categorize inventory metrics.",
      details: err.message,
    });
  }
});

module.exports = router;