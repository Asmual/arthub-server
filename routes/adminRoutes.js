// routes/adminRoutes.js
const express = require("express");
const router = express.Router();
const { ObjectId } = require("mongodb");
const { verifyToken, verifyRole } = require("../middlewares.js");

const toOid = (id) => {
  try {
    return ObjectId.isValid(id) ? new ObjectId(id) : null;
  } catch {
    return null;
  }
};

router.use(verifyToken);
router.use(verifyRole(["admin"]));

/* ===========================
   USERS MANAGEMENT
=========================== */

// GET ALL USERS
router.get("/users", async (req, res) => {
  try {
    const db = req.app.get("db");

    const users = await db
      .collection("user")
      .find({}, { projection: { password: 0, hashedPassword: 0 } })
      .toArray();

    res.status(200).json(users);
  } catch (err) {
    res.status(500).json({
      message: "Failed to fetch users",
      error: err.message,
    });
  }
});

// UPDATE USER ROLE
router.patch("/users/:id/role", async (req, res) => {
  try {
    const db = req.app.get("db");
    const oid = toOid(req.params.id);
    const { role } = req.body;

    const allowedRoles = ["user", "artist", "admin"];

    if (!allowedRoles.includes(role)) {
      return res.status(400).json({
        message: "Invalid role",
      });
    }

    const result = await db.collection("user").findOneAndUpdate(
      {
        $or: [{ _id: oid }, { id: req.params.id }],
      },
      {
        $set: {
          role,
          updatedAt: new Date(),
        },
      },
      {
        returnDocument: "after",
      }
    );

    const updatedUser = result && result.value ? result.value : result;
    res.status(200).json(updatedUser);
  } catch (err) {
    res.status(500).json({
      message: "Failed to update role",
      error: err.message,
    });
  }
});

// DELETE USER
router.delete("/users/:id", async (req, res) => {
  try {
    const db = req.app.get("db");
    const oid = toOid(req.params.id);

    const result = await db.collection("user").deleteOne({
      $or: [{ _id: oid }, { id: req.params.id }],
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    res.status(200).json({
      message: "User deleted successfully",
    });
  } catch (err) {
    res.status(500).json({
      message: "Failed to delete user",
      error: err.message,
    });
  }
});

/* ===========================
   ARTWORK MANAGEMENT
=========================== */

// GET ALL ARTWORKS
router.get("/artworks", async (req, res) => {
  try {
    const db = req.app.get("db");

    const artworks = await db
      .collection("artworks")
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).json(artworks);
  } catch (err) {
    res.status(500).json({
      message: "Failed to fetch artworks",
      error: err.message,
    });
  }
});

// DELETE ARTWORK
router.delete("/artworks/:id", async (req, res) => {
  try {
    const db = req.app.get("db");
    const oid = toOid(req.params.id);

    const result = await db.collection("artworks").deleteOne({
      _id: oid,
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        message: "Artwork not found",
      });
    }

    res.status(200).json({
      message: "Artwork deleted successfully",
    });
  } catch (err) {
    res.status(500).json({
      message: "Failed to delete artwork",
      error: err.message,
    });
  }
});

/* ===========================
   ANALYTICS & DASHBOARD STATS
=========================== */

// OVERVIEW ANALYTICS
router.get("/analytics", async (req, res) => {
  try {
    const db = req.app.get("db");

    const [
      totalUsers,
      totalArtists,
      totalArtworks,
      revenueData,
    ] = await Promise.all([
      db.collection("user").countDocuments({
        role: { $in: ["user", "buyer"] },
      }),
      db.collection("user").countDocuments({
        role: "artist",
      }),
      db.collection("artworks").countDocuments(),
      db.collection("orders")
        .aggregate([
          {
            $group: {
              _id: null,
              totalRevenue: {
                $sum: { $ifNull: ["$amount", "$price"] },
              },
              totalSales: {
                $sum: 1,
              },
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
      message: "Failed to fetch analytics",
      error: err.message,
    });
  }
});

// DASHBOARD OVERVIEW API
router.get("/dashboard-stats", async (req, res) => {
  try {
    const db = req.app.get("db");
    
    if (!db) {
      return res.status(500).json({ message: "Database context connection lost." });
    }

    const [
      totalUsers,
      verifiedArtworks,
      transactionsCount,
      revenueResult,
      recentSales,
    ] = await Promise.all([
      db.collection("user").countDocuments(),
      db.collection("artworks").countDocuments(),
      db.collection("orders").countDocuments(),
      db.collection("orders")
        .aggregate([
          {
            $group: {
              _id: null,
              totalRevenue: {
                $sum: { $ifNull: ["$amount", "$price"] },
              },
            },
          },
        ])
        .toArray(),
      db.collection("orders")
        .find({})
        .sort({ createdAt: -1 })
        .limit(5)
        .toArray(),
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
      message: "Failed to load dashboard statistics from MongoDB",
      error: error.message,
    });
  }
});

/* ===========================
   SALES CHART
=========================== */

router.get("/analytics/sales-chart", async (req, res) => {
  try {
    const db = req.app.get("db");

    const chartData = await db
      .collection("orders")
      .aggregate([
        {
          $group: {
            _id: {
              $dateToString: {
                format: "%Y-%m",
                date: "$createdAt",
              },
            },
            sales: { $sum: 1 },
            revenue: {
              $sum: { $ifNull: ["$amount", "$price"] },
            },
          },
        },
        {
          $sort: { _id: 1 },
        },
      ])
      .toArray();

    res.status(200).json(chartData);
  } catch (err) {
    res.status(500).json({
      message: "Failed to fetch chart data",
      error: err.message,
    });
  }
});

/* ===========================
   PIE CHART CATEGORY DATA
=========================== */

router.get("/analytics/categories", async (req, res) => {
  try {
    const db = req.app.get("db");

    const categoryData = await db
      .collection("artworks")
      .aggregate([
        {
          $group: {
            _id: "$category",
            count: { $sum: 1 },
          },
        },
        {
          $sort: { count: -1 },
        },
      ])
      .toArray();

    res.status(200).json(categoryData);
  } catch (err) {
    res.status(500).json({
      message: "Failed to fetch category data",
      error: err.message,
    });
  }
});

module.exports = router;