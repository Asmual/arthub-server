const express = require("express");
const router  = express.Router();
const { ObjectId } = require("mongodb");

const toOid = (id) => {
  try { return ObjectId.isValid(id) ? new ObjectId(id) : null; } catch { return null; }
};

// GET /api/artists/top — top 3 by totalSold
router.get("/top", async (req, res) => {
  try {
    const db = req.app.get("db");
    const artists = await db.collection("user")
      .find({ role: "artist" })
      .sort({ totalSold: -1 })
      .limit(3)
      .toArray();
    res.json(artists);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch top artists", error: err.message });
  }
});

// GET /api/artists — all artists, supports ?search=&specialty=
router.get("/", async (req, res) => {
  try {
    const db = req.app.get("db");
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

    const artists = await db.collection("user")
      .find(filter, { projection: { password: 0 } })
      .toArray();
    res.json(artists);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch artists", error: err.message });
  }
});

// GET /api/artists/:id — single artist profile
router.get("/:id", async (req, res) => {
  try {
    const db  = req.app.get("db");
    const oid = toOid(req.params.id);
    const artist = await db.collection("user").findOne(
      { $or: [{ _id: oid }, { _id: req.params.id }], role: "artist" },
      { projection: { password: 0 } }
    );
    if (!artist) return res.status(404).json({ message: "Artist not found" });
    res.json(artist);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch artist", error: err.message });
  }
});

// GET /api/artists/:id/stats — artworks count, sales count, revenue, followers
router.get("/:id/stats", async (req, res) => {
  try {
    const db       = req.app.get("db");
    const artistId = req.params.id;
    const oid      = toOid(artistId);

    const artist = await db.collection("user").findOne({
      $or: [{ _id: oid }, { _id: artistId }],
    });

    const artworks = await db.collection("artworks").find({
      $or: [
        { userId: oid }, { userId: artistId },
        { artistId: oid }, { artistId: artistId },
      ],
    }).toArray();

    const sold          = artworks.filter((a) => a.isSold === true);
    const totalArtworks = artworks.length;
    const totalSales    = sold.length;
    const totalRevenue  = sold.reduce((s, a) => s + (Number(a.price) || 0), 0);
    const followers     = artist?.followers ?? 0;

    res.json({ totalArtworks, totalSales, totalRevenue, followers });
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch artist stats", error: err.message });
  }
});

module.exports = router;
