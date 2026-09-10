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
      { $sample: { size: 8 } },
    ]).toArray();
    const normalized = artworks.map((art) => {
      const stock = typeof art.quantity === "number" ? art.quantity : 10;
      return {
        ...art,
        quantity: stock,
        isSold: stock === 0,
      };
    });
    res.json(normalized);
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

      const userCollection = getUserCollection(req);
      const matchingArtists = await userCollection
        .find({ $or: [{ name: searchRegex }, { email: searchRegex }] }, { projection: { _id: 1, email: 1 } })
        .toArray();

      const matchedArtistIds = matchingArtists.map((a) => a._id.toString());
      const matchedArtistOids = matchingArtists.map((a) => a._id);
      const matchedArtistEmails = matchingArtists.map((a) => a.email).filter(Boolean);

      finalFilter.$or = [
        { title: searchRegex },
        { artistName: searchRegex },
        { category: searchRegex },
        ...(matchedArtistIds.length > 0
          ? [
              { userId: { $in: [...matchedArtistIds, ...matchedArtistOids] } },
              { artistId: { $in: [...matchedArtistIds, ...matchedArtistOids] } },
            ]
          : []),
        ...(matchedArtistEmails.length > 0
          ? [
              { artistEmail: { $in: matchedArtistEmails } },
              { userEmail: { $in: matchedArtistEmails } },
            ]
          : []),
      ];
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

    const normalizedArtworks = artworks.map((art) => {
      const stock = typeof art.quantity === "number" ? art.quantity : 10;
      return {
        ...art,
        quantity: stock,
        isSold: stock === 0,
      };
    });

    res.json({
      artworks: normalizedArtworks,
      total,
      page: currentPage,
      totalPages: Math.ceil(total / currentLimit),
    });
  } catch (err) {
    res.status(500).json({ error: true, message: "Failed to fetch catalog artworks.", details: err.message });
  }
});

// Search artworks dynamically by title, artist name, category, or email
router.get("/search", async (req, res) => {
  try {
    const artworkCollection = getArtworkCollection(req);
    const userCollection = getUserCollection(req);
    const query = (req.query.query || req.query.q || req.query.search || "").trim();

    if (!query || query === "undefined" || query === "null") {
      return res.json([]);
    }

    const sanitizedQuery = escapeRegex(query);
    const regex = new RegExp(sanitizedQuery, "i");

    // Match artist profiles from user collection
    const matchingArtists = await userCollection
      .find(
        { $or: [{ name: regex }, { email: regex }] },
        { projection: { _id: 1, name: 1, image: 1, email: 1 } }
      )
      .toArray();

    const matchedArtistIds = matchingArtists.map((a) => a._id.toString());
    const matchedArtistOids = matchingArtists.map((a) => a._id);
    const matchedArtistEmails = matchingArtists.map((a) => a.email).filter(Boolean);

    const filter = {
      isDraft: { $ne: true },
      $or: [
        { title: regex },
        { artistName: regex },
        { category: regex },
        ...(matchedArtistIds.length > 0
          ? [
              { userId: { $in: [...matchedArtistIds, ...matchedArtistOids] } },
              { artistId: { $in: [...matchedArtistIds, ...matchedArtistOids] } },
            ]
          : []),
        ...(matchedArtistEmails.length > 0
          ? [
              { artistEmail: { $in: matchedArtistEmails } },
              { userEmail: { $in: matchedArtistEmails } },
            ]
          : []),
      ],
    };

    const artworks = await artworkCollection
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(10)
      .toArray();

    // Ensure artist name is populated on matching items
    const populated = await Promise.all(
      artworks.map(async (art) => {
        if (!art.artistName && (art.userId || art.artistId)) {
          const rawId = art.userId || art.artistId;
          const uOid = toOid(rawId);
          const artistDoc = await userCollection.findOne({
            $or: [{ _id: uOid }, { id: rawId }],
          });
          if (artistDoc) {
            art.artistName = artistDoc.name;
          }
        }
        return art;
      })
    );

    return res.json(populated);
  } catch (err) {
    console.error("[ARTWORK SEARCH ERROR]", err.message);
    return res.status(500).json({ error: true, message: "Search failed.", details: err.message });
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
    const stock = typeof artwork.quantity === "number" ? artwork.quantity : 10;
    artwork.quantity = stock;
    artwork.isSold = stock === 0;

    res.json(artwork);
  } catch (err) {
    res.status(500).json({ error: true, message: "Failed to fetch distinct artwork asset metrics.", details: err.message });
  }
});

router.post("/sync-stock", verifyToken, verifyRole(["artist", "admin"]), async (req, res) => {
  try {
    const artworkCollection = getArtworkCollection(req);
    const result = await artworkCollection.updateMany(
      { $or: [{ quantity: { $exists: false } }, { quantity: null }, { isSold: true }] },
      { $set: { quantity: 10, isSold: false, updatedAt: new Date() } }
    );
    res.json({ success: true, message: "Artworks stock synchronized successfully.", modifiedCount: result.modifiedCount });
  } catch (err) {
    res.status(500).json({ error: true, message: "Failed to synchronize stock.", details: err.message });
  }
});

router.patch("/:id/stock", verifyToken, verifyRole(["artist", "admin"]), async (req, res) => {
  try {
    const artworkCollection = getArtworkCollection(req);
    const oid = toOid(req.params.id);
    const { delta, quantity } = req.body;

    const existingArtwork = await artworkCollection.findOne({ $or: [{ _id: oid }, { _id: req.params.id }] });
    if (!existingArtwork) return res.status(404).json({ error: true, message: "Artwork listing not found." });

    if (existingArtwork.userId !== req.user.id && req.user.role !== "admin") {
      return res.status(403).json({ error: true, message: "Forbidden: Ownership mapping validation mismatch." });
    }

    let newQuantity;
    if (typeof quantity === "number") {
      newQuantity = Math.max(0, quantity);
    } else if (typeof delta === "number") {
      const currentQty = typeof existingArtwork.quantity === "number" ? existingArtwork.quantity : 10;
      newQuantity = Math.max(0, currentQty + delta);
    } else {
      return res.status(400).json({ error: true, message: "Provide delta or quantity." });
    }

    const isSold = newQuantity === 0;

    const result = await artworkCollection.findOneAndUpdate(
      { _id: existingArtwork._id },
      { $set: { quantity: newQuantity, isSold, updatedAt: new Date() } },
      { returnDocument: "after" }
    );

    const updatedDoc = result && result.value ? result.value : result;
    res.json({ success: true, data: updatedDoc });
  } catch (err) {
    res.status(500).json({ error: true, message: "Failed to update artwork stock.", details: err.message });
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

    const currentTier = (artistProfile.plan || artistProfile.subscription?.plan || artistProfile.subscriptionTier || "free").toLowerCase();
   
    const totalExistingArtworks = await artworkCollection.countDocuments({
      $or: [
        { userId: req.user.id },
        { userId: toOid(req.user.id) },
        { artistEmail: req.user.email },
        { userEmail: req.user.email },
      ]
    });

    const TIER_LIMITS = { free: 5, basic: 20, pro: 60, ultimate: Infinity };
    const maxAllowed = TIER_LIMITS[currentTier] ?? 5;

    if (maxAllowed !== Infinity && totalExistingArtworks >= maxAllowed) {
      return res.status(403).json({
        error: true,
        code: "PLAN_LIMIT_REACHED",
        message: `Tier limit exceeded. ${currentTier.toUpperCase()} tier profiles are limited to ${maxAllowed} artworks. Please upgrade to a higher plan to add more.`,
        currentCount: totalExistingArtworks,
        limit: maxAllowed,
        plan: currentTier,
      });
    }


    const initialQty = req.body.quantity !== undefined ? Math.max(0, parseInt(req.body.quantity, 10)) : 10;
    const resolvedQty = isNaN(initialQty) ? 10 : initialQty;
   
    const doc = {
      title,
      description: description || "",
      category: category || "Uncategorized",
      image,
      price: Number(price),
      quantity: resolvedQty,
      userId: req.user.id,
      artistEmail: req.user.email,
      artistName: artistProfile.name || "Anonymous Artist",
      isSold: resolvedQty === 0,
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

    if (req.body.quantity !== undefined) {
      const parsedQty = Math.max(0, parseInt(req.body.quantity, 10));
      updatePayload.quantity = isNaN(parsedQty) ? 0 : parsedQty;
      updatePayload.isSold = updatePayload.quantity === 0;
    } else if (isSold !== undefined) {
      updatePayload.isSold = Boolean(isSold);
      if (updatePayload.isSold) {
        updatePayload.quantity = 0;
      }
    }

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