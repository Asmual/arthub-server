// routes/artistRoutes.js
const express = require("express");
const router  = express.Router();
const { ObjectId } = require("mongodb");

const toOid = (id) => {
  try { return ObjectId.isValid(id) ? new ObjectId(id) : null; } catch { return null; }
};

// Helper: সব possible artist filter তৈরি করে
const buildArtistFilter = (artistId) => {
  const oid = toOid(artistId);
  const conditions = [
    { userId: artistId },
    { artistId: artistId },
  ];
  if (oid) {
    conditions.push({ userId: oid });
    conditions.push({ artistId: oid });
  }
  return { $or: conditions };
};

// ─────────────────────────────────────────
// GET /api/artists/top — top 3 artists by sales count
// ─────────────────────────────────────────
router.get("/top", async (req, res) => {
  try {
    const db = req.app.get("db");

    // orders collection থেকে artist-wise sales count বের করা
    const topSales = await db.collection("orders").aggregate([
      { $match: { type: "purchase", status: "paid" } },
      { $group: { _id: "$artistId", totalSold: { $sum: 1 } } },
      { $sort: { totalSold: -1 } },
      { $limit: 3 },
    ]).toArray();

    // যদি orders-এ data না থাকে তাহলে fallback: user collection থেকে
    if (!topSales.length) {
      const artists = await db.collection("user")
        .find({ role: "artist" })
        .sort({ totalSold: -1 })
        .limit(3)
        .project({ password: 0 })
        .toArray();
      return res.json(artists);
    }

    // artist info সহ return করা
    const artistIds = topSales.map((s) => toOid(s._id)).filter(Boolean);
    const artists = await db.collection("user")
      .find({ _id: { $in: artistIds } }, { projection: { password: 0 } })
      .toArray();

    const result = topSales.map((s) => {
      const artist = artists.find((a) => a._id.toString() === s._id?.toString());
      return { ...artist, totalSold: s.totalSold };
    }).filter(Boolean);

    res.json(result);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch top artists", error: err.message });
  }
});

// ─────────────────────────────────────────
// GET /api/artists — all artists with optional search/specialty filter
// ─────────────────────────────────────────
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

// ─────────────────────────────────────────
// GET /api/artists/:id — single artist profile
// ─────────────────────────────────────────
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

// ─────────────────────────────────────────
// GET /api/artists/:id/stats — Dashboard stats card data
// FIX: revenue এখন orders collection থেকে আসে, isSold থেকে না
// ─────────────────────────────────────────
router.get("/:id/stats", async (req, res) => {
  try {
    const db       = req.app.get("db");
    const artistId = req.params.id;
    const oid      = toOid(artistId);

    const artist = await db.collection("user").findOne({
      $or: [{ _id: oid }, { _id: artistId }],
    });

    if (!artist) {
      return res.status(404).json({ message: "Artist not found" });
    }

    // নিজের সব artworks
    const artworks = await db.collection("artworks")
      .find(buildArtistFilter(artistId))
      .toArray();

    const totalArtworks = artworks.length;
    const artworkIds    = artworks.map((a) => a._id.toString());

    // orders collection থেকে actual sales data
    const orders = await db.collection("orders").find({
      artworkId: { $in: artworkIds },
      type: "purchase",
      status: "paid",
    }).toArray();

    const totalSales   = orders.length;
    const totalRevenue = orders.reduce((sum, o) => sum + (Number(o.price) || 0), 0);
    const followers    = artist?.followers ?? 0;

    // এই মাসের sales
    const now       = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthlySales = orders.filter(
      (o) => new Date(o.createdAt) >= monthStart
    ).length;

    res.json({ totalArtworks, totalSales, totalRevenue, followers, monthlySales });
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch artist stats", error: err.message });
  }
});

// ─────────────────────────────────────────
// GET /api/artists/:id/artworks — artist-এর নিজের সব artworks
// NEW: Artist Dashboard > Manage Artworks এর জন্য
// ─────────────────────────────────────────
router.get("/:id/artworks", async (req, res) => {
  try {
    const db       = req.app.get("db");
    const artistId = req.params.id;

    const artworks = await db.collection("artworks")
      .find(buildArtistFilter(artistId))
      .sort({ createdAt: -1 })
      .toArray();

    res.json(artworks);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch artist artworks", error: err.message });
  }
});

// ─────────────────────────────────────────
// GET /api/artists/:id/sales — Artist Dashboard > Sales History
// NEW: buyer name, artwork title, date, amount সহ
// ─────────────────────────────────────────
router.get("/:id/sales", async (req, res) => {
  try {
    const db       = req.app.get("db");
    const artistId = req.params.id;

    // artist-এর সব artworks আগে আনো
    const artworks = await db.collection("artworks")
      .find(buildArtistFilter(artistId))
      .toArray();

    const artworkIds  = artworks.map((a) => a._id.toString());
    const artworkMap  = {};
    artworks.forEach((a) => { artworkMap[a._id.toString()] = a; });

    if (!artworkIds.length) return res.json([]);

    // ওই artworks এর সব paid orders
    const orders = await db.collection("orders").find({
      artworkId: { $in: artworkIds },
      type: "purchase",
      status: "paid",
    }).sort({ createdAt: -1 }).toArray();

    if (!orders.length) return res.json([]);

    // buyer info আনো (একবারে সব)
    const buyerEmails = [...new Set(orders.map((o) => o.buyerEmail).filter(Boolean))];
    const buyers = await db.collection("user")
      .find({ email: { $in: buyerEmails } }, { projection: { password: 0 } })
      .toArray();
    const buyerMap = {};
    buyers.forEach((b) => { buyerMap[b.email] = b; });

    const sales = orders.map((order) => {
      const artwork = artworkMap[order.artworkId] || {};
      const buyer   = buyerMap[order.buyerEmail]  || {};
      return {
        orderId:       order._id,
        transactionId: order.transactionId,
        artworkId:     order.artworkId,
        artworkTitle:  artwork.title       || "Unknown Artwork",
        artworkImage:  artwork.image       || "",
        buyerName:     buyer.name          || order.buyerEmail || "Anonymous",
        buyerEmail:    order.buyerEmail,
        amount:        order.price,
        purchaseDate:  order.createdAt,
      };
    });

    res.json(sales);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch sales history", error: err.message });
  }
});
// PATCH /api/artists/:id — update artist profile fields (bio, specialty, rating, etc.)
router.patch("/:id", async (req, res) => {
  try {
    const db  = req.app.get("db");
    const oid = toOid(req.params.id);

    const { bio, specialty, rating, location, website, phone, portfolio, experience, socialLinks, image, name } = req.body;

    const fields = { updatedAt: new Date() };
    if (name        !== undefined) fields.name        = name;
    if (image       !== undefined) fields.image       = image;
    if (bio         !== undefined) fields.bio         = bio;
    if (specialty   !== undefined) fields.specialty   = specialty;
    if (rating      !== undefined) fields.rating      = Number(rating);
    if (location    !== undefined) fields.location    = location;
    if (website     !== undefined) fields.website     = website;
    if (phone       !== undefined) fields.phone       = phone;
    if (portfolio   !== undefined) fields.portfolio   = portfolio;
    if (experience  !== undefined) fields.experience  = experience;
    if (socialLinks !== undefined) fields.socialLinks = socialLinks;

    const result = await db.collection("user").findOneAndUpdate(
      { $or: [{ _id: oid }, { id: req.params.id }, { uid: req.params.id }] },
      { $set: fields },
      { returnDocument: "after", projection: { password: 0, hashedPassword: 0 } }
    );

    if (!result) return res.status(404).json({ message: "Artist not found." });
    res.json({ message: "Profile updated.", user: result });
  } catch (err) {
    res.status(500).json({ message: "Failed to update artist profile.", error: err.message });
  }
});

module.exports = router;