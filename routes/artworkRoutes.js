const express = require("express");
const router = express.Router();
const { ObjectId } = require("mongodb");
const { verifyToken, verifyRole } = require("../middlewares");
const { getArtworkCollection, getUserCollection, getCommentCollection, getOrderCollection } = require("../models/collections");

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

/**
 * @route   GET /api/artworks/featured
 * @desc    Retrieve 6 random unsold items for dynamic homepage feed
 * @access  Public
 */
router.get("/featured", async (req, res) => {
  try {
    const artworkCollection = getArtworkCollection(req);
    const artworks = await artworkCollection.aggregate([
      { $match: { isSold: { $ne: true }, isDraft: { $ne: true } } },
      { $sample: { size: 6 } },
    ]).toArray();
    res.json(artworks);
  } catch (err) {
    res.status(500).json({ error: true, message: "Failed to fetch featured artworks.", details: err.message });
  }
});

/**
 * @route   GET /api/artworks
 * @desc    Browse paginated catalog with comprehensive search query support
 * @access  Public
 */
router.get("/", async (req, res) => {
  try {
    const artworkCollection = getArtworkCollection(req);
    let { search, category, artistId, minPrice, maxPrice, sort, page = 1, limit = 12 } = req.query;

    const finalFilter = {};

    if (search?.trim() && search !== "undefined") {
      const searchRegex = new RegExp(search.trim(), "i");
      finalFilter.$or = [{ title: searchRegex }, { artistName: searchRegex }];
    }

    if (category?.trim() && category !== "undefined" && category !== "all") {
      finalFilter.category = { $regex: category.trim(), $options: "i" };
    }

    if (artistId && artistId !== "undefined") {
      const oid = toOid(artistId);
      finalFilter.$or = [
        { userId: artistId },
        { artistId: artistId }
      ];
      if (oid) {
        finalFilter.$or.push({ userId: oid }, { artistId: oid });
      }
    }

    if ((minPrice && minPrice !== "undefined") || (maxPrice && maxPrice !== "undefined")) {
      finalFilter.price = {};
      if (minPrice && minPrice !== "undefined") finalFilter.price.$gte = Number(minPrice);
      if (maxPrice && maxPrice !== "undefined") finalFilter.price.$lte = Number(maxPrice);
    }

    const sortMap = {
      newest: { createdAt: -1 },
      "price-asc": { price: 1 },
      "price-desc": { price: -1 },
    };
    const sortOpt = sortMap[sort] || { createdAt: -1 };
   
    const currentPage = Math.max(1, Number(page));
    const currentLimit = Math.max(1, Number(limit));
    const skip = (currentPage - 1) * currentLimit;

    const total = await artworkCollection.countDocuments(finalFilter);
    const artworks = await artworkCollection
      .find(finalFilter)
      .sort(sortOpt)
      .skip(skip)
      .limit(currentLimit)
      .toArray();

    res.json({
      artworks,
      total,
      page: currentPage,
      totalPages: Math.ceil(total / currentLimit),
    });
  } catch (err) {
    res.status(500).json({ error: true, message: "Failed to fetch catalog artworks.", details: err.message });
  }
});

/**
 * @route   GET /api/artworks/:id
 * @desc    Detailed profile lookup using aggregate join logic from singular user collection
 * @access  Public
 */
router.get("/:id", async (req, res) => {
  try {
    const artworkCollection = getArtworkCollection(req);
    const oid = toOid(req.params.id);

    const artworkPipeline = [
      { $match: { $or: [{ _id: oid }, { _id: req.params.id }] } },
      {
        $lookup: {
          from: "user",
          let: { artistIdentifier: "$userId" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $or: [
                    { $eq: ["$_id", "$$artistIdentifier"] },
                    { $eq: [{ $toString: "$_id" }, "$$artistIdentifier"] },
                    { $eq: ["$id", "$$artistIdentifier"] }
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

    const results = await artworkCollection.aggregate(artworkPipeline).toArray();
    if (!results || results.length === 0) return res.status(404).json({ error: true, message: "Artwork item lookup profile missing." });

    const artwork = results[0];
    if (artwork.artistDetails) {
      artwork.artistName = artwork.artistDetails.name || artwork.artistName;
      artwork.artistImage = artwork.artistDetails.image || "";
    }

    res.json(artwork);
  } catch (err) {
    res.status(500).json({ error: true, message: "Failed to fetch distinct artwork asset metrics.", details: err.message });
  }
});

/**
 * @route   POST /api/artworks
 * @desc    Add a new single portfolio entry under structural sub-tier allocation limits
 * @access  Private (JWT + Artist/Admin Role Guard Required)
 */
router.post("/", verifyToken, verifyRole(["artist", "admin"]), async (req, res) => {
  try {
    const artworkCollection = getArtworkCollection(req);
    const userCollection = getUserCollection(req);
    const { title, description, price, category, image } = req.body;
   
    if (!title || !price || !image) {
      return res.status(400).json({ error: true, message: "Required payload matrix indices (title, price, image) missing." });
    }

    const artistProfile = await userCollection.findOne({ email: req.user.email });
    if (!artistProfile) {
      return res.status(404).json({ error: true, message: "Associated platform artist identity record missing." });
    }

    // Evaluate dynamic account capability parameters against inventory metrics
    const currentTier = artistProfile.subscriptionTier || "free";
    const totalExistingArtworks = await artworkCollection.countDocuments({ userId: req.user.id });

    if (currentTier === "free" && totalExistingArtworks >= 3) {
      return res.status(403).json({ error: true, message: "Tier limit exceeded. Free tier profiles are limited to 3 listings." });
    }
    if (currentTier === "pro" && totalExistingArtworks >= 9) {
      return res.status(403).json({ error: true, message: "Tier limit exceeded. Pro tier profiles are limited to 9 listings." });
    }
   
    const doc = {
      title,
      description: description || "",
      category: category || "Uncategorized",
      image,
      price: Number(price),
      userId: req.user.id,
      artistEmail: req.user.email,
      artistName: artistProfile.name || "Anonymous Artist",
      isSold: false,
      isDraft: false,
      createdAt: new Date(),
    };
   
    const result = await artworkCollection.insertOne(doc);
    res.status(201).json({ success: true, ...doc, _id: result.insertedId });
  } catch (err) {
    res.status(500).json({ error: true, message: "Failed to register portfolio artwork item entry.", details: err.message });
  }
});

/**
 * @route   PUT /api/artworks/:id
 * @desc    Apply metadata property changes safely with ownership checking
 * @access  Private (JWT + Artist/Admin Role Guard Required)
 */
router.put("/:id", verifyToken, verifyRole(["artist", "admin"]), async (req, res) => {
  try {
    const artworkCollection = getArtworkCollection(req);
    const oid = toOid(req.params.id);
    const { title, description, price, category, image } = req.body;

    const existingArtwork = await artworkCollection.findOne({ $or: [{ _id: oid }, { _id: req.params.id }] });
    if (!existingArtwork) return res.status(404).json({ error: true, message: "Artwork listing profile target missing." });

    // Enforce isolation ownership rule context
    if (existingArtwork.userId !== req.user.id && req.user.role !== "admin") {
      return res.status(403).json({ error: true, message: "Forbidden: Ownership mapping validation mismatch." });
    }
   
    const updatePayload = {
      updatedAt: new Date()
    };
    if (title !== undefined) updatePayload.title = title;
    if (description !== undefined) updatePayload.description = description;
    if (category !== undefined) updatePayload.category = category;
    if (image !== undefined) updatePayload.image = image;
    if (price !== undefined) updatePayload.price = Number(price);

    const result = await artworkCollection.findOneAndUpdate(
      { _id: existingArtwork._id },
      { $set: updatePayload },
      { returnDocument: "after" }
    );
     
    const updatedDoc = result.value || result;
    res.json({ success: true, data: updatedDoc });
  } catch (err) {
    res.status(500).json({ error: true, message: "Failed to update catalog artwork metadata fields.", details: err.message });
  }
});

/**
 * @route   DELETE /api/artworks/:id
 * @desc    Terminate standard catalog data entry with strict access validation checks
 * @access  Private (JWT + Artist/Admin Role Guard Required)
 */
router.delete("/:id", verifyToken, verifyRole(["artist", "admin"]), async (req, res) => {
  try {
    const artworkCollection = getArtworkCollection(req);
    const oid = toOid(req.params.id);
   
    const existingArtwork = await artworkCollection.findOne({ $or: [{ _id: oid }, { _id: req.params.id }] });
    if (!existingArtwork) return res.status(404).json({ error: true, message: "Artwork catalog item target missing." });

    if (existingArtwork.userId !== req.user.id && req.user.role !== "admin") {
      return res.status(403).json({ error: true, message: "Forbidden: Ownership profile verification barrier." });
    }

    await artworkCollection.deleteOne({ _id: existingArtwork._id });
    res.json({ success: true, message: "Artwork deleted successfully from live index channels." });
  } catch (err) {
    res.status(500).json({ error: true, message: "Failed to terminate data footprint maps.", details: err.message });
  }
});

/**
 * @route   GET /api/artworks/:id/comments
 * @desc    Query dynamic interactions feedback feed for single context entity
 * @access  Public
 */
router.get("/:id/comments", async (req, res) => {
  try {
    const commentCollection = getCommentCollection(req);
    const comments = await commentCollection
      .find({ artworkId: req.params.id })
      .sort({ createdAt: -1 })
      .toArray();
    res.json(comments);
  } catch (err) {
    res.status(500).json({ error: true, message: "Failed to compile linear item commentary streams.", details: err.message });
  }
});

/**
 * @route   POST /api/artworks/:id/comments
 * @desc    Authenticated entry with order receipt verification validation
 * @access  Private (JWT Required)
 */
router.post("/:id/comments", verifyToken, async (req, res) => {
  try {
    const commentCollection = getCommentCollection(req);
    const orderCollection = getOrderCollection(req);
    const { text } = req.body;
    const artworkId = req.params.id;

    if (!text?.trim()) {
      return res.status(400).json({ error: true, message: "Comment feedback core message body parameter required." });
    }

    // Verify buyer transaction verification status prior to feedback ingestion loop processing
    const purchased = await orderCollection.findOne({
      artworkId: toOid(artworkId) || artworkId,
      buyerEmail: req.user.email,
    });
   
    if (!purchased) {
      return res.status(403).json({ error: true, message: "Transaction barrier: Verified asset purchase receipt verification required." });
    }

    const doc = {
      artworkId,
      userId: req.user.id,
      userEmail: req.user.email,
      text: text.trim(),
      createdAt: new Date(),
    };
   
    const result = await commentCollection.insertOne(doc);
    res.status(201).json({ success: true, ...doc, _id: result.insertedId });
  } catch (err) {
    res.status(500).json({ error: true, message: "Failed to log commentary data node.", details: err.message });
  }
});

module.exports = router;