/* eslint-disable no-undef */
const express = require("express");
const router = express.Router();
const { ObjectId } = require("mongodb");
const { verifyToken, verifyRole } = require("../middlewares");
const { getArtworkCollection, getUserCollection, getCommentCollection, getOrderCollection } = require("../models/collections");

const toOid = (id) => {
  try {
    return ObjectId.isValid(id) ? new ObjectId(id) : null;
  } catch {
    return null;
  }
};

const escapeRegex = (string) => {
  return string.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
};

const isValidDirectImageUrl = (url) => {
  if (!url || typeof url !== "string") return false;
  const URL_REGEX = /^https:\/\/[a-zA-Z0-9-_.]+\.[a-zA-Z]{2,}\/.*\.(jpg|jpeg|png|webp|gif|svg)(\?.*)?$/i;
  return URL_REGEX.test(url);
};

router.get("/featured", async (req, res) => {
  try {
    const artworkCollection = getArtworkCollection(req);
    const artworks = await artworkCollection.aggregate([
      { $match: { isDraft: { $ne: true } } },
      { $sample: { size: 6 } },
    ]).toArray();
    res.json(artworks);
  } catch (err) {
    res.status(500).json({ error: true, message: "Failed to fetch featured artworks.", details: err.message });
  }
});

router.get("/", async (req, res) => {
  try {
    const artworkCollection = getArtworkCollection(req);
    let { search, category, artistId, email, minPrice, maxPrice, sort, page = 1, limit = 12 } = req.query;

    const finalFilter = {};

    if (search?.trim() && search !== "undefined" && search !== "null") {
      const sanitizedSearch = escapeRegex(search.trim());
      const searchRegex = new RegExp(sanitizedSearch, "i");
      finalFilter.$or = [{ title: searchRegex }, { artistName: searchRegex }];
    }

    if (category?.trim() && category !== "undefined" && category !== "null" && category !== "all") {
      finalFilter.category = { $regex: escapeRegex(category.trim()), $options: "i" };
    }

    if (email?.trim() && email !== "undefined" && email !== "null") {
      finalFilter.artistEmail = email.trim();
    }

    if (artistId && artistId !== "undefined" && artistId !== "null") {
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
      if (minPrice && minPrice !== "undefined" && !isNaN(minPrice)) finalFilter.price.$gte = Number(minPrice);
      if (maxPrice && maxPrice !== "undefined" && !isNaN(maxPrice)) finalFilter.price.$lte = Number(maxPrice);
      if (Object.keys(finalFilter.price).length === 0) delete finalFilter.price;
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

router.post("/", verifyToken, verifyRole(["artist", "admin"]), async (req, res) => {
  try {
    const artworkCollection = getArtworkCollection(req);
    const userCollection = getUserCollection(req);
    const { title, description, price, category, image } = req.body;
   
    if (!title || !price || !image) {
      return res.status(400).json({ error: true, message: "Required payload matrix indices (title, price, image) missing." });
    }

    if (!isValidDirectImageUrl(image)) {
      return res.status(400).json({ error: true, message: "The resource link provided must be a valid, direct HTTPS image URL." });
    }

    const artistProfile = await userCollection.findOne({ email: req.user.email });
    if (!artistProfile) {
      return res.status(404).json({ error: true, message: "Associated platform artist identity record missing." });
    }

    const currentTier = artistProfile.subscriptionTier || "free";
   
    const totalExistingArtworks = await artworkCollection.countDocuments({
      $or: [
        { userId: req.user.id },
        { userId: toOid(req.user.id) }
      ]
    });

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

router.put("/:id", verifyToken, verifyRole(["artist", "admin"]), async (req, res) => {
  try {
    const artworkCollection = getArtworkCollection(req);
    const oid = toOid(req.params.id);
    const { title, description, price, category, image, isSold } = req.body;

    const existingArtwork = await artworkCollection.findOne({ $or: [{ _id: oid }, { _id: req.params.id }] });
    if (!existingArtwork) return res.status(404).json({ error: true, message: "Artwork listing profile target missing." });

    if (existingArtwork.userId !== req.user.id && req.user.role !== "admin") {
      return res.status(403).json({ error: true, message: "Forbidden: Ownership mapping validation mismatch." });
    }

    if (image !== undefined && !isValidDirectImageUrl(image)) {
      return res.status(400).json({ error: true, message: "The modified link resource must be a valid, direct HTTPS image URL." });
    }
   
    const updatePayload = {
      updatedAt: new Date()
    };
    if (title !== undefined) updatePayload.title = title;
    if (description !== undefined) updatePayload.description = description;
    if (category !== undefined) updatePayload.category = category;
    if (image !== undefined) updatePayload.image = image;
    if (price !== undefined) updatePayload.price = Number(price);
    if (isSold !== undefined) updatePayload.isSold = Boolean(isSold);

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

router.post("/:id/comments", verifyToken, async (req, res) => {
  try {
    const commentCollection = getCommentCollection(req);
    const orderCollection = getOrderCollection(req);
    const { text } = req.body;
    const artworkId = req.params.id;

    if (!text?.trim()) {
      return res.status(400).json({ error: true, message: "Comment feedback core message body parameter required." });
    }

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