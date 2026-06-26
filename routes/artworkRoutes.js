const express = require("express");
const router = express.Router();
const { ObjectId } = require("mongodb");

// Helper function to safely convert string to MongoDB ObjectId
const toOid = (id) => {
  try {
    return ObjectId.isValid(id) ? new ObjectId(id) : null;
  } catch {
    return null;
  }
};

// ==========================================
// ARTWORK ENDPOINTS
// ==========================================

// GET /api/artworks/featured — Fetch 6 random unsold artworks for the homepage
router.get("/featured", async (req, res) => {
  try {
    const db = req.app.get("db");
    const artworks = await db
      .collection("artworks")
      .aggregate([
        { $match: { isSold: { $ne: true }, isDraft: { $ne: true } } },
        { $sample: { size: 6 } },
      ])
      .toArray();
    res.json(artworks);
  } catch (err) {
    res.status(500).json({
      message: "Failed to fetch featured artworks",
      error: err.message,
    });
  }
});

// GET /api/artworks — Browse artworks with search, categories, filters, and pagination
router.get("/", async (req, res) => {
  try {
    const db = req.app.get("db");
    let {
      search,
      category,
      artistId,
      minPrice,
      maxPrice,
      sort,
      page = 1,
      limit = 12,
    } = req.query;

    // ১. একটি সিঙ্গেল অবজেক্ট হিসেবে ফিল্টার কন্ডিশন তৈরি করা (যাতে $and এর ঝামেলা না হয়)
    const finalFilter = {};

    // ড্রাফট ও বিক্রি হয়ে যাওয়া আর্টওয়ার্ক ফিল্টার আউট করা (ঐচ্ছিক, প্রয়োজন হলে রাখতে পারো)
    // finalFilter.isSold = { $ne: true };
    // finalFilter.isDraft = { $ne: true };

    // সার্চ ফিল্টার হ্যান্ডেলিং (Title অথবা Artist Name দিয়ে)
    if (search && search.trim() !== "" && search !== "undefined") {
      const searchRegex = new RegExp(search.trim(), "i");
      finalFilter.$or = [
        { title: searchRegex },
        { artistName: searchRegex }
      ];
    }

    // ক্যাটাগরি ফিল্টার হ্যান্ডেলিং
    if (category && category.trim() !== "" && category !== "undefined" && category !== "all") {
      finalFilter.category = { $regex: category.trim(), $options: "i" };
    }

    // আর্টিস্ট আইডি ফিল্টার হ্যান্ডελিং
    if (artistId && artistId !== "undefined") {
      const oid = toOid(artistId);
      finalFilter.$or = [
        { userId: oid },
        { userId: artistId },
        { artistId: oid },
        { artistId: artistId },
      ];
    }

    // প্রাইজ রেঞ্জ ফিল্টার হ্যান্ডেলিং
    if ((minPrice && minPrice !== "undefined") || (maxPrice && maxPrice !== "undefined")) {
      finalFilter.price = {};
      if (minPrice && minPrice !== "undefined") finalFilter.price.$gte = Number(minPrice);
      if (maxPrice && maxPrice !== "undefined") finalFilter.price.$lte = Number(maxPrice);
    }

    // সর্টিং মেকানিজম
    const sortMap = {
      newest: { createdAt: -1 },
      "price-asc": { price: 1 },
      "price-desc": { price: -1 },
    };
    const sortOpt = sortMap[sort] || { createdAt: -1 };
   
    const currentPage = Math.max(1, Number(page));
    const currentLimit = Math.max(1, Number(limit));
    const skip = (currentPage - 1) * currentLimit;

    // ডেটাবেজ কোয়েরি এক্সিকিউশন
    const total = await db.collection("artworks").countDocuments(finalFilter);
    const artworks = await db
      .collection("artworks")
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
    res.status(500).json({ message: "Failed to fetch artworks", error: err.message });
  }
});

// GET /api/artworks/:id — Fetch single artwork dynamically with complete artist profile details
router.get("/:id", async (req, res) => {
  try {
    const db = req.app.get("db");
    const oid = toOid(req.params.id);

    const artworkPipeline = [
      {
        $match: {
          $or: [{ _id: oid }, { _id: req.params.id }],
        },
      },
      {
        $lookup: {
          from: "users",
          let: { artistIdentifier: "$userId" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $or: [
                    { $eq: ["$_id", { $toObjectId: "$$artistIdentifier" }] },
                    { $eq: ["$_id", "$$artistIdentifier"] },
                    { $eq: ["$uid", "$$artistIdentifier"] },
                  ],
                },
              },
            },
          ],
          as: "artistProfile",
        },
      },
      {
        $addFields: {
          artistDetails: { $arrayElemAt: ["$artistProfile", 0] },
        },
      },
      {
        $project: {
          artistProfile: 0,
        },
      },
    ];

    const results = await db.collection("artworks").aggregate(artworkPipeline).toArray();
   
    if (!results || results.length === 0) {
      return res.status(404).json({ message: "Artwork not found" });
    }

    const artwork = results[0];

    if (artwork.artistDetails) {
      artwork.artistName = artwork.artistDetails.name || artwork.artistName;
      artwork.artistImage = artwork.artistDetails.photoURL || artwork.artistDetails.image || "";
    }

    res.json(artwork);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch artwork", error: err.message });
  }
});

// POST /api/artworks — Create a new artwork record (Artists authorization scope)
router.post("/", async (req, res) => {
  try {
    const db = req.app.get("db");
    const { title, description, price, category, image, userId, artistName } = req.body;
   
    if (!title || !price || !image || !userId) {
      return res.status(400).json({ message: "title, price, image, userId are required" });
    }
   
    const doc = {
      title,
      description,
      category,
      image,
      price: Number(price),
      userId,
      artistName: artistName || "",
      isSold: false,
      isDraft: false,
      createdAt: new Date(),
    };
   
    const result = await db.collection("artworks").insertOne(doc);
    res.status(201).json({ ...doc, _id: result.insertedId });
  } catch (err) {
    res.status(500).json({ message: "Failed to create artwork", error: err.message });
  }
});

// PUT /api/artworks/:id — Modify existing artwork attributes
router.put("/:id", async (req, res) => {
  try {
    const db = req.app.get("db");
    const oid = toOid(req.params.id);
    const { title, description, price, category, image } = req.body;
   
    const result = await db
      .collection("artworks")
      .findOneAndUpdate(
        { $or: [{ _id: oid }, { _id: req.params.id }] },
        {
          $set: {
            title,
            description,
            category,
            image,
            price: Number(price),
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

// DELETE /api/artworks/:id — Remove artwork from system catalog
router.delete("/:id", async (req, res) => {
  try {
    const db = req.app.get("db");
    const oid = toOid(req.params.id);
   
    const result = await db.collection("artworks").deleteOne({
      $or: [{ _id: oid }, { _id: req.params.id }],
    });
   
    if (result.deletedCount === 0) {
      return res.status(404).json({ message: "Artwork not found" });
    }
    res.json({ message: "Artwork deleted" });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete artwork", error: err.message });
  }
});

// ==========================================
// COMMENTS / REVIEWS ENDPOINTS
// ==========================================

// GET /api/artworks/:id/comments — Retrieve review feed linked to specific artwork
router.get("/:id/comments", async (req, res) => {
  try {
    const db = req.app.get("db");
    const comments = await db
      .collection("reviews")
      .find({ artworkId: req.params.id })
      .sort({ createdAt: -1 })
      .toArray();
    res.json(comments);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch comments", error: err.message });
  }
});

// POST /api/artworks/:id/comments — Submit new comment
router.post("/:id/comments", async (req, res) => {
  try {
    const db = req.app.get("db");
    const { userId, userEmail, userName, userImage, text } = req.body;
    const artworkId = req.params.id;

    if (!userEmail || !text?.trim()) {
      return res.status(400).json({ message: "userEmail and text are required" });
    }

    const purchased = await db.collection("orders").findOne({
      artworkId: artworkId,
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
      userName: userName || "User",
      userImage: userImage || "",
      text: text.trim(),
      createdAt: new Date(),
    };
   
    const result = await db.collection("reviews").insertOne(doc);
    res.status(201).json({ ...doc, _id: result.insertedId });
  } catch (err) {
    res.status(500).json({ message: "Failed to add comment", error: err.message });
  }
});

// PUT /api/artworks/:id/comments/:commentId — Edit personal comment
router.put("/:id/comments/:commentId", async (req, res) => {
  try {
    const db = req.app.get("db");
    const oid = toOid(req.params.commentId);
    const { text, userEmail } = req.body;
   
    const result = await db
      .collection("reviews")
      .findOneAndUpdate(
        { $or: [{ _id: oid }, { _id: req.params.commentId }], userEmail },
        { $set: { text: text.trim(), updatedAt: new Date() } },
        { returnDocument: "after" }
      );
     
    if (!result) {
      return res.status(404).json({ message: "Comment not found or unauthorized" });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: "Failed to update comment", error: err.message });
  }
});

// DELETE /api/artworks/:id/comments/:commentId — Remove comments
router.delete("/:id/comments/:commentId", async (req, res) => {
  try {
    const db = req.app.get("db");
    const commentOid = toOid(req.params.commentId);
    const artworkOid = toOid(req.params.id);
    const { userEmail, userId } = req.body;

    if (!userEmail && !userId) {
      return res.status(400).json({ message: "User credentials are required" });
    }

    const comment = await db.collection("reviews").findOne({
      $or: [{ _id: commentOid }, { _id: req.params.commentId }],
    });

    if (!comment) {
      return res.status(404).json({ message: "Comment not found" });
    }

    const artwork = await db.collection("artworks").findOne({
      $or: [{ _id: artworkOid }, { _id: req.params.id }],
    });

    const isCommentAuthor = (userEmail && comment.userEmail === userEmail) || (userId && comment.userId === userId);
    const isArtworkOwner = artwork && ((userId && artwork.userId === userId) || (userId && artwork.artistId === userId));

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