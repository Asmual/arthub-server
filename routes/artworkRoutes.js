// routes/artworkRoutes.js
const express = require("express");
const router  = express.Router();
const { ObjectId } = require("mongodb");

const toOid = (id) => {
  try { return ObjectId.isValid(id) ? new ObjectId(id) : null; } catch { return null; }
};

// ─────────────────────────────────────────
// GET /api/artworks/featured
// ─────────────────────────────────────────
router.get("/featured", async (req, res) => {
  try {
    const db = req.app.get("db");
    const artworks = await db.collection("artworks").aggregate([
      { $match: { isSold: { $ne: true }, isDraft: { $ne: true } } },
      { $sample: { size: 6 } },
    ]).toArray();
    res.json(artworks);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch featured artworks", error: err.message });
  }
});

// ─────────────────────────────────────────
// GET /api/artworks — Browse with search, filter, sort, pagination
// FIX: artistId filter দিলে search $or overwrite হওয়ার bug ঠিক করা হয়েছে
// ─────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const db = req.app.get("db");
    const {
      search, category, artistId,
      minPrice, maxPrice, sort,
      page = 1, limit = 12,
    } = req.query;

    // সব filter conditions আলাদা array-এ রাখো, তারপর $and দিয়ে merge করো
    const andConditions = [];

    // Search filter
    if (search?.trim() && search !== "undefined") {
      const regex = new RegExp(search.trim(), "i");
      andConditions.push({ $or: [{ title: regex }, { artistName: regex }] });
    }

    // Category filter
    if (category?.trim() && category !== "undefined" && category !== "all") {
      andConditions.push({ category: { $regex: category.trim(), $options: "i" } });
    }

    // Artist filter — FIX: এটা আলাদা $or block, search-এর $or overwrite করে না
    if (artistId && artistId !== "undefined") {
      const oid = toOid(artistId);
      const artistConditions = [
        { userId: artistId },
        { artistId: artistId },
      ];
      if (oid) {
        artistConditions.push({ userId: oid });
        artistConditions.push({ artistId: oid });
      }
      andConditions.push({ $or: artistConditions });
    }

    // Price range filter
    if (
      (minPrice && minPrice !== "undefined") ||
      (maxPrice && maxPrice !== "undefined")
    ) {
      const priceFilter = {};
      if (minPrice && minPrice !== "undefined") priceFilter.$gte = Number(minPrice);
      if (maxPrice && maxPrice !== "undefined") priceFilter.$lte = Number(maxPrice);
      andConditions.push({ price: priceFilter });
    }

    // Final filter
    const finalFilter = andConditions.length > 0 ? { $and: andConditions } : {};

    // Sort
    const sortMap = {
      newest:       { createdAt: -1 },
      "price-asc":  { price: 1 },
      "price-desc": { price: -1 },
    };
    const sortOpt = sortMap[sort] || { createdAt: -1 };

    const currentPage  = Math.max(1, Number(page));
    const currentLimit = Math.max(1, Number(limit));
    const skip         = (currentPage - 1) * currentLimit;

    const total    = await db.collection("artworks").countDocuments(finalFilter);
    const artworks = await db.collection("artworks")
      .find(finalFilter)
      .sort(sortOpt)
      .skip(skip)
      .limit(currentLimit)
      .toArray();

    res.json({ artworks, total, page: currentPage, totalPages: Math.ceil(total / currentLimit) });
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch artworks", error: err.message });
  }
});

// ─────────────────────────────────────────
// GET /api/artworks/:id — single artwork with artist profile
// ─────────────────────────────────────────
router.get("/:id", async (req, res) => {
  try {
    const db  = req.app.get("db");
    const oid = toOid(req.params.id);

    const pipeline = [
      { $match: { $or: [{ _id: oid }, { _id: req.params.id }] } },
      {
        $lookup: {
          from: "users",
          let: { uid: "$userId" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $or: [
                    { $eq: ["$_id", { $toObjectId: "$$uid" }] },
                    { $eq: ["$_id", "$$uid"] },
                    { $eq: ["$uid", "$$uid"] },
                  ],
                },
              },
            },
          ],
          as: "artistProfile",
        },
      },
      { $addFields: { artistDetails: { $arrayElemAt: ["$artistProfile", 0] } } },
      { $project: { artistProfile: 0 } },
    ];

    const results = await db.collection("artworks").aggregate(pipeline).toArray();
    if (!results?.length) return res.status(404).json({ message: "Artwork not found" });

    const artwork = results[0];
    if (artwork.artistDetails) {
      artwork.artistName  = artwork.artistDetails.name     || artwork.artistName;
      artwork.artistImage = artwork.artistDetails.photoURL || artwork.artistDetails.image || "";
    }

    res.json(artwork);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch artwork", error: err.message });
  }
});

// ─────────────────────────────────────────
// POST /api/artworks — Create artwork
// ─────────────────────────────────────────
router.post("/", async (req, res) => {
  try {
    const db = req.app.get("db");
    const { title, description, price, category, image, userId, artistName } = req.body;

    if (!title || !price || !image || !userId) {
      return res.status(400).json({ message: "title, price, image, userId are required" });
    }

    const doc = {
      title,
      description: description || "",
      category:    category    || "",
      image,
      price:       Number(price),
      userId,
      artistName:  artistName  || "",
      isSold:      false,
      isDraft:     false,
      createdAt:   new Date(),
    };

    const result = await db.collection("artworks").insertOne(doc);
    res.status(201).json({ ...doc, _id: result.insertedId });
  } catch (err) {
    res.status(500).json({ message: "Failed to create artwork", error: err.message });
  }
});

// ─────────────────────────────────────────
// PUT /api/artworks/:id — Update artwork
// ─────────────────────────────────────────
router.put("/:id", async (req, res) => {
  try {
    const db  = req.app.get("db");
    const oid = toOid(req.params.id);
    const { title, description, price, category, image } = req.body;

    const result = await db.collection("artworks").findOneAndUpdate(
      { $or: [{ _id: oid }, { _id: req.params.id }] },
      {
        $set: {
          ...(title       !== undefined && { title }),
          ...(description !== undefined && { description }),
          ...(category    !== undefined && { category }),
          ...(image       !== undefined && { image }),
          ...(price       !== undefined && { price: Number(price) }),
          updatedAt: new Date(),
        },
      },
      { returnDocument: "after" }
    );

    if (!result) return res.status(404).json({ message: "Artwork not found" });
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: "Failed to update artwork", error: err.message });
  }
});

// ─────────────────────────────────────────
// DELETE /api/artworks/:id — Delete artwork
// ─────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  try {
    const db  = req.app.get("db");
    const oid = toOid(req.params.id);

    const result = await db.collection("artworks").deleteOne({
      $or: [{ _id: oid }, { _id: req.params.id }],
    });

    if (result.deletedCount === 0) return res.status(404).json({ message: "Artwork not found" });
    res.json({ message: "Artwork deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete artwork", error: err.message });
  }
});

// ─────────────────────────────────────────
// GET /api/artworks/:id/comments
// ─────────────────────────────────────────
router.get("/:id/comments", async (req, res) => {
  try {
    const db = req.app.get("db");
    const comments = await db.collection("reviews")
      .find({ artworkId: req.params.id })
      .sort({ createdAt: -1 })
      .toArray();
    res.json(comments);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch comments", error: err.message });
  }
});

// ─────────────────────────────────────────
// POST /api/artworks/:id/comments — Add comment (purchase required)
// ─────────────────────────────────────────
router.post("/:id/comments", async (req, res) => {
  try {
    const db = req.app.get("db");
    const { userId, userEmail, userName, userImage, text } = req.body;
    const artworkId = req.params.id;

    if (!userEmail || !text?.trim()) {
      return res.status(400).json({ message: "userEmail and text are required" });
    }

    const purchased = await db.collection("orders").findOne({
      artworkId,
      buyerEmail: userEmail,
      status: "paid",
    });

    if (!purchased) {
      return res.status(403).json({ message: "Purchase this artwork to leave a comment" });
    }

    const doc = {
      artworkId,
      userId,
      userEmail,
      userName:  userName  || "User",
      userImage: userImage || "",
      text:      text.trim(),
      createdAt: new Date(),
    };

    const result = await db.collection("reviews").insertOne(doc);
    res.status(201).json({ ...doc, _id: result.insertedId });
  } catch (err) {
    res.status(500).json({ message: "Failed to add comment", error: err.message });
  }
});

// ─────────────────────────────────────────
// PUT /api/artworks/:id/comments/:commentId — Edit comment
// ─────────────────────────────────────────
router.put("/:id/comments/:commentId", async (req, res) => {
  try {
    const db  = req.app.get("db");
    const oid = toOid(req.params.commentId);
    const { text, userEmail } = req.body;

    if (!text?.trim() || !userEmail) {
      return res.status(400).json({ message: "text and userEmail are required" });
    }

    const result = await db.collection("reviews").findOneAndUpdate(
      { $or: [{ _id: oid }, { _id: req.params.commentId }], userEmail },
      { $set: { text: text.trim(), updatedAt: new Date() } },
      { returnDocument: "after" }
    );

    if (!result) return res.status(404).json({ message: "Comment not found or unauthorized" });
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: "Failed to update comment", error: err.message });
  }
});

// ─────────────────────────────────────────
// DELETE /api/artworks/:id/comments/:commentId
// FIX: artworkOid এখন properly use হচ্ছে
// ─────────────────────────────────────────
router.delete("/:id/comments/:commentId", async (req, res) => {
  try {
    const db         = req.app.get("db");
    const commentOid = toOid(req.params.commentId);
    const artworkOid = toOid(req.params.id);
    const { userEmail, userId } = req.body;

    if (!userEmail && !userId) {
      return res.status(400).json({ message: "User credentials are required" });
    }

    const comment = await db.collection("reviews").findOne({
      $or: [{ _id: commentOid }, { _id: req.params.commentId }],
    });
    if (!comment) return res.status(404).json({ message: "Comment not found" });

    // FIX: artworkOid এখন query-তে ব্যবহার হচ্ছে
    const artwork = await db.collection("artworks").findOne({
      $or: [
        { _id: artworkOid },
        { _id: req.params.id },
      ],
    });

    const isCommentAuthor =
      (userEmail && comment.userEmail === userEmail) ||
      (userId   && comment.userId    === userId);

    const isArtworkOwner = artwork && (
      (userId && artwork.userId   === userId) ||
      (userId && artwork.artistId === userId)
    );

    if (!isCommentAuthor && !isArtworkOwner) {
      return res.status(403).json({ message: "Unauthorized to delete this comment" });
    }

    await db.collection("reviews").deleteOne({ _id: comment._id });
    res.json({ message: "Comment successfully deleted" });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete comment", error: err.message });
  }
});

module.exports = router;