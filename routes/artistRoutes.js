const express = require("express");
const router = express.Router();
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
 * Escapes special regex characters to prevent query failures
 */
const escapeRegex = (string) => {
  return string.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
};

/**
 * @route   GET /api/artists/top
 * @desc    Fetch top 3 artists mapped via processed sale aggregation volumes
 * @access  Public
 */
router.get("/top", async (req, res) => {
  try {
    const userCollection = getUserCollection(req);
    const artworkCollection = getArtworkCollection(req);

    const artists = await userCollection
      .find({ role: "artist" })
      .project({ password: 0, hashedPassword: 0 })
      .toArray();

    const artistsWithStats = await Promise.all(
      artists.map(async (artist) => {
        const artistStrId = artist._id.toString();
        
        const artworkQuery = {
          $or: [
            { userId: artistStrId },
            { artistId: artistStrId },
            { userId: artist._id },
            { artistId: artist._id },
            { artistEmail: artist.email },
            { userEmail: artist.email }
          ]
        };

        const artworks = await artworkCollection.find(artworkQuery).toArray();
        const totalArtworks = artworks.length;
        const totalSold = artworks.filter((a) => a.isSold === true).length;

        return {
          ...artist,
          totalArtworks,
          totalSold: artist.totalSold ?? totalSold,
        };
      })
    );

    // Sort and return top 4 artists based on total sales
    artistsWithStats.sort((a, b) => b.totalSold - a.totalSold);

    res.json(artistsWithStats.slice(0, 4));
  } catch (err) {
    res.status(500).json({ error: true, message: "Failed to compile top tier artist rosters.", details: err.message });
  }
});

/**
 * @route   GET /api/artists
 * @desc    Browse registered artist accounts with specialized text pattern matching filters and dynamic artwork metrics
 * @access  Public
 */
router.get("/", async (req, res) => {
  try {
    const userCollection = getUserCollection(req);
    const artworkCollection = getArtworkCollection(req);
    const { search, specialty } = req.query;
    const filter = { role: "artist" };

    if (search?.trim() && search !== "undefined" && search !== "null") {
      const sanitizedSearch = escapeRegex(search.trim());
      filter.$or = [
        { name:      { $regex: sanitizedSearch, $options: "i" } },
        { specialty: { $regex: sanitizedSearch, $options: "i" } },
      ];
    }
    if (specialty?.trim() && specialty !== "undefined" && specialty !== "null" && specialty !== "all") {
      filter.specialty = { $regex: escapeRegex(specialty.trim()), $options: "i" };
    }

    const artists = await userCollection
      .find(filter, { projection: { password: 0, hashedPassword: 0 } })
      .toArray();

    // Calculate artwork count dynamically for each artist
    const enrichedArtists = await Promise.all(
      artists.map(async (artist) => {
        const artistStrId = artist._id.toString();

        const artworkQuery = {
          $or: [
            { userId: artistStrId },
            { artistId: artistStrId },
            { userId: artist._id },
            { artistId: artist._id },
            { artistEmail: artist.email },
            { userEmail: artist.email }
          ]
        };

        const artworks = await artworkCollection.find(artworkQuery).toArray();
        const totalArtworks = artworks.length;
        const totalSold = artworks.filter((a) => a.isSold === true).length;

        return {
          ...artist,
          totalArtworks,
          totalSold: artist.totalSold ?? totalSold,
        };
      })
    );

    res.json(enrichedArtists);
  } catch (err) {
    res.status(500).json({ error: true, message: "Failed to execute artist database directory searches.", details: err.message });
  }
});

/**
 * @route   GET /api/artworks/search
 * @desc    Dedicated search endpoint redirecting or processing raw query params
 * @access  Public
 */
router.get("/search", async (req, res) => {
  try {
    const artworkCollection = getArtworkCollection(req);
    const { query } = req.query;
    
    const finalFilter = {};
    if (query?.trim()) {
      const sanitizedSearch = escapeRegex(query.trim());
      const searchRegex = new RegExp(sanitizedSearch, "i");
      finalFilter.$or = [{ title: searchRegex }, { artistName: searchRegex }];
    }

    const artworks = await artworkCollection.find(finalFilter).limit(12).toArray();
    res.json(artworks);
  } catch (err) {
    res.status(500).json({ error: true, message: "Search endpoint compilation error.", details: err.message });
  }
});

/**
 * @route   GET /api/artists/:id
 * @desc    Fetch operational profile variables for an individual target artist account with dynamic count
 * @access  Public
 */
router.get("/:id", async (req, res) => {
  try {
    const userCollection = getUserCollection(req);
    const artworkCollection = getArtworkCollection(req);
    const artistId = req.params.id;
    const oid = toOid(artistId);
   
    const artist = await userCollection.findOne(
      { $or: [{ _id: oid }, { id: artistId }], role: "artist" },
      { projection: { password: 0, hashedPassword: 0 } }
    );
    if (!artist) return res.status(404).json({ error: true, message: "Target artist metric configuration registry record missing." });

    const artworkQuery = {
      $or: [
        { userId: artistId },
        { artistId: artistId },
        { artistEmail: artist.email },
        { userEmail: artist.email }
      ]
    };
    if (oid) {
      artworkQuery.$or.push({ userId: oid }, { artistId: oid });
    }

    const artworks = await artworkCollection.find(artworkQuery).toArray();
    const totalArtworks = artworks.length;
    const totalSold = artworks.filter((a) => a.isSold === true).length;

    res.json({
      ...artist,
      totalArtworks,
      totalSold: artist.totalSold ?? totalSold,
    });
  } catch (err) {
    res.status(500).json({ error: true, message: "Failed to execute precise profile query matching.", details: err.message });
  }
});

/**
 * @route   GET /api/artist/:id/stats
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
      $or: [
        { userId: artistId },
        { artistId: artistId },
        { artistEmail: artist?.email },
        { userEmail: artist?.email }
      ].filter(Boolean)
    };
    if (oid) {
      artworkQuery.$or.push({ userId: oid }, { artistId: oid });
    }

    const artworks = await artworkCollection.find(artworkQuery).toArray();

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