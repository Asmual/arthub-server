const express = require("express");
const router  = express.Router();
const { ObjectId } = require("mongodb");
const { verifyToken } = require("../middlewares");
const { getUserCollection, getArtworkCollection } = require("../models/collections");

/**
 * Utility helper to safely cast string IDs to MongoDB ObjectIds
 */
const toOid = (id) => {
  try { return ObjectId.isValid(id) ? new ObjectId(id) : null; } catch { return null; }
};

/**
 * @route   GET /api/artists/top
 * @desc    Fetch top 3 artists mapped via processed sale aggregation volumes
 * @access  Public
 */
router.get("/top", async (req, res) => {
  try {
    const userCollection = getUserCollection(req);
    const artists = await userCollection
      .find({ role: "artist" })
      .sort({ totalSold: -1 })
      .limit(3)
      .project({ password: 0, hashedPassword: 0 })
      .toArray();
    res.json(artists);
  } catch (err) {
    res.status(500).json({ error: true, message: "Failed to compile top tier artist rosters.", details: err.message });
  }
});

/**
 * @route   GET /api/artists
 * @desc    Browse registered artist accounts with specialized text pattern matching filters
 * @access  Public
 */
router.get("/", async (req, res) => {
  try {
    const userCollection = getUserCollection(req);
    const { search, specialty } = req.query;
    const filter = { role: "artist" };

    if (search?.trim()) {
      filter.$or = [
        { name:      { $regex: search.trim(), $options: "i" } },
        { specialty: { $regex: search.trim(), $options: "i" } },
      ];
    }
    if (specialty?.trim()) {
      filter.specialty = { $regex: specialty.trim(), $options: "i" };
    }

    const artists = await userCollection
      .find(filter, { projection: { password: 0, hashedPassword: 0 } })
      .toArray();
    res.json(artists);
  } catch (err) {
    res.status(500).json({ error: true, message: "Failed to execute artist database directory searches.", details: err.message });
  }
});

/**
 * @route   GET /api/artists/:id
 * @desc    Fetch operational profile variables for an individual target artist account
 * @access  Public
 */
router.get("/:id", async (req, res) => {
  try {
    const userCollection = getUserCollection(req);
    const oid = toOid(req.params.id);
    
    const artist = await userCollection.findOne(
      { $or: [{ _id: oid }, { id: req.params.id }], role: "artist" },
      { projection: { password: 0, hashedPassword: 0 } }
    );
    if (!artist) return res.status(404).json({ error: true, message: "Target artist metric configuration registry record missing." });
    res.json(artist);
  } catch (err) {
    res.status(500).json({ error: true, message: "Failed to execute precise profile query matching.", details: err.message });
  }
});

/**
 * @route   GET /api/artists/:id/stats
 * @desc    Retrieve dynamic portfolio performance values and financial processing counters via database aggregation calculations
 * @access  Private (JWT Required)
 */
router.get("/:id/stats", verifyToken, async (req, res) => {
  try {
    const userCollection = getUserCollection(req);
    const artworkCollection = getArtworkCollection(req);
    const artistId = req.params.id;
    const oid = toOid(artistId);

    const artist = await userCollection.findOne({
      $or: [{ _id: oid }, { id: artistId }],
    });

    const artworkQuery = {
      $or: [{ userId: artistId }, { artistId: artistId }]
    };
    if (oid) {
      artworkQuery.$or.push({ userId: oid }, { artistId: oid });
    }

    const artworks = await artworkCollection.find(artworkQuery).toArray();

    // Dynamically resolve metrics internally straight from the source of truth
    const soldItems     = artworks.filter((a) => a.isSold === true);
    const totalArtworks = artworks.length;
    const totalSales    = soldItems.length;
    const totalRevenue  = soldItems.reduce((sum, current) => sum + (Number(current.price) || 0), 0);
    const followers     = artist?.followers ?? 0;

    res.json({ totalArtworks, totalSales, totalRevenue, followers });
  } catch (err) {
    res.status(500).json({ error: true, message: "Failed to compute portfolio analytical statistics.", details: err.message });
  }
});

module.exports = router;