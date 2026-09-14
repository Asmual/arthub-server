const express = require("express");
const router = express.Router();
const { ObjectId } = require("mongodb");
const { verifyToken } = require("../middlewares");
const { getCommentCollection } = require("../models/collections");

// Utility helper to safely cast string ID to MongoDB ObjectId
const toOid = (id) => {
  try {
    return ObjectId.isValid(id) ? new ObjectId(id) : null;
  } catch {
    return null;
  }
};

/**
 * Helper to determine if a user has permission to edit or delete a review:
 * 1. Admin users
 * 2. Author of the review
 * 3. Artist / Owner of the artwork
 */
const canUserModifyReview = async (db, review, user) => {
  if (!review || !user) return false;
  if (user.role === "admin") return true;

  const userEmailLower = user.email ? user.email.toLowerCase().trim() : "";
  const userIdStr = user.id ? user.id.toString() : (user._id ? user._id.toString() : "");

  // 1. Check if user is the author of this review
  if (review.userEmail && review.userEmail.toLowerCase().trim() === userEmailLower) {
    return true;
  }

  // 2. Check if user is the owner/creator of the reviewed artwork
  if (review.artworkId) {
    const artworkCollection = db.collection("artworks");
    const artOid = toOid(review.artworkId);
    const artwork = await artworkCollection.findOne({
      $or: [
        ...(artOid ? [{ _id: artOid }] : []),
        { _id: review.artworkId },
        { id: review.artworkId },
      ],
    });

    if (artwork) {
      if (artwork.artistEmail && artwork.artistEmail.toLowerCase().trim() === userEmailLower) return true;
      if (artwork.userEmail && artwork.userEmail.toLowerCase().trim() === userEmailLower) return true;
      if (artwork.email && artwork.email.toLowerCase().trim() === userEmailLower) return true;
      if (artwork.userId && artwork.userId.toString() === userIdStr) return true;
      if (artwork.artistId && artwork.artistId.toString() === userIdStr) return true;
    }
  }

  return false;
};

/**
 * Helper to verify whether a user has actually purchased this artwork
 */
const hasUserPurchasedArtwork = async (db, artworkId, user) => {
  if (!artworkId || !user) return false;
  const userEmailLower = (user.email || "").toLowerCase().trim();
  const userIdStr = user.id ? user.id.toString() : (user._id ? user._id.toString() : "");

  const artworkCollection = db.collection("artworks");
  const orderCollection = db.collection("orders");
  const artOid = toOid(artworkId);

  // 1. Check artwork doc for direct buyer record
  const artworkDoc = await artworkCollection.findOne({
    $or: [
      ...(artOid ? [{ _id: artOid }] : []),
      { _id: artworkId },
      { id: artworkId },
    ],
  });

  if (artworkDoc) {
    if (artworkDoc.buyerEmail && artworkDoc.buyerEmail.toLowerCase().trim() === userEmailLower) return true;
    if (artworkDoc.buyerId && userIdStr && artworkDoc.buyerId.toString() === userIdStr) return true;
  }

  // 2. Check orders collection for paid order
  const orderFilter = {
    $and: [
      {
        $or: [
          ...(artOid ? [{ artworkId: artOid }, { "artworkDetails._id": artOid }] : []),
          { artworkId: artworkId.toString() },
          { "artworkDetails._id": artworkId.toString() },
        ],
      },
      {
        $or: [
          { buyerEmail: userEmailLower },
          ...(userIdStr ? [{ buyerId: userIdStr }, ...(toOid(userIdStr) ? [{ buyerId: toOid(userIdStr) }] : [])] : []),
        ],
      },
      {
        status: { $in: ["paid", "completed", "success"] },
      },
    ],
  };

  const verifiedOrder = await orderCollection.findOne(orderFilter);
  return Boolean(verifiedOrder);
};

// Check if user is eligible to review an artwork
router.get("/eligibility/:artworkId", verifyToken, async (req, res) => {
  try {
    const db = req.app.get("db");
    const { artworkId } = req.params;
    const userRole = (req.user.role || "").toLowerCase();

    if (userRole === "admin") {
      return res.json({
        canReview: false,
        reason: "admin",
        message: "Admin accounts cannot post artwork reviews.",
      });
    }

    if (userRole === "artist") {
      return res.json({
        canReview: false,
        reason: "artist",
        message: "Artists are not permitted to review artworks.",
      });
    }

    const hasBought = await hasUserPurchasedArtwork(db, artworkId, req.user);
    if (!hasBought) {
      return res.json({
        canReview: false,
        reason: "not_purchased",
        message: "You must purchase this artwork to unlock review and rating submission.",
      });
    }

    return res.json({ canReview: true, reason: "eligible" });
  } catch (err) {
    console.error("[REVIEW ELIGIBILITY ERROR]:", err.message);
    return res.status(500).json({ error: true, message: err.message });
  }
});

// Add a new comment/review for an artwork (Only verified buyers who purchased can review)
router.post("/", verifyToken, async (req, res) => {
  try {
    const commentCollection = getCommentCollection(req);
    const db = req.app.get("db");
    const userCollection = db.collection("user");
    const { artworkId, text, rating, userName, userImage, images } = req.body;

    if (!artworkId || !text?.trim()) {
      return res.status(400).json({ error: true, message: "Artwork ID and review text are required." });
    }

    // Role restrictions: Admins and Artists cannot review
    const userRole = (req.user.role || "").toLowerCase();
    if (userRole === "admin") {
      return res.status(403).json({ error: true, message: "Admin accounts cannot post artwork reviews." });
    }
    if (userRole === "artist") {
      return res.status(403).json({ error: true, message: "Artists are not permitted to review artworks." });
    }

    // Purchase verification: Must have bought the artwork
    const hasBought = await hasUserPurchasedArtwork(db, artworkId, req.user);
    if (!hasBought) {
      return res.status(403).json({
        error: true,
        message: "Only verified buyers who purchased this artwork can leave a review.",
      });
    }

    let finalUserName = userName;
    let finalUserImage = userImage;

    // Fetch user profile details if omitted from request payload
    if (!finalUserName || !finalUserImage) {
      const userDoc = await userCollection.findOne({ email: req.user.email });
      if (userDoc) {
        finalUserName = finalUserName || userDoc.name;
        finalUserImage = finalUserImage || userDoc.image;
      }
    }

    const parsedRating = Math.max(1, Math.min(5, Number(rating) || 5));

    // Process uploaded review images (max 3 images)
    const validImages = Array.isArray(images)
      ? images.filter((img) => typeof img === "string" && img.trim() !== "").slice(0, 3)
      : [];

    const doc = {
      artworkId: artworkId.toString(),
      userId: req.user.id || req.user._id?.toString(),
      userEmail: req.user.email,
      userName: finalUserName || "Verified Collector",
      userImage: finalUserImage || "",
      rating: parsedRating,
      text: text.trim(),
      images: validImages,
      isVerifiedBuyer: true,
      createdAt: new Date(),
    };

    const result = await commentCollection.insertOne(doc);
    return res.status(201).json({ success: true, ...doc, _id: result.insertedId.toString() });
  } catch (err) {
    console.error("[REVIEW ERROR] Create review error:", err.message);
    return res.status(500).json({ error: true, message: "Failed to post review.", details: err.message });
  }
});

// Fetch all reviews for a specific artwork
router.get("/:artworkId", async (req, res) => {
  try {
    const commentCollection = getCommentCollection(req);
    const db = req.app.get("db");
    const userCollection = db.collection("user");
    const { artworkId } = req.params;

    const oid = toOid(artworkId);
    const filter = oid
      ? { $or: [{ artworkId }, { artworkId: oid }] }
      : { artworkId };

    const reviews = await commentCollection
      .find(filter)
      .sort({ createdAt: -1 })
      .toArray();

    // Populate user profile info if missing from stored review documents
    const missingUserEmails = reviews
      .filter((r) => (!r.userName || !r.userImage) && r.userEmail)
      .map((r) => r.userEmail);

    if (missingUserEmails.length > 0) {
      const users = await userCollection
        .find({ email: { $in: missingUserEmails } })
        .project({ name: 1, email: 1, image: 1 })
        .toArray();
      const userMap = new Map(users.map((u) => [u.email.toLowerCase(), u]));

      reviews.forEach((r) => {
        if (r.userEmail) {
          const u = userMap.get(r.userEmail.toLowerCase());
          if (u) {
            if (!r.userName) r.userName = u.name || "Art Collector";
            if (!r.userImage) r.userImage = u.image || "";
          }
        }
      });
    }

    // Normalize rating and images
    const normalizedReviews = reviews.map((r) => ({
      ...r,
      _id: r._id.toString(),
      rating: typeof r.rating === "number" ? r.rating : 5,
      images: Array.isArray(r.images) ? r.images : [],
    }));

    return res.json(normalizedReviews);
  } catch (err) {
    console.error("[REVIEW ERROR] Fetch reviews error:", err.message);
    return res.status(500).json({ error: true, message: "Failed to fetch reviews.", details: err.message });
  }
});

// Update an existing comment (author, artwork owner, or admin)
router.put("/:id", verifyToken, async (req, res) => {
  try {
    const commentCollection = getCommentCollection(req);
    const db = req.app.get("db");
    const { text, rating, images } = req.body;
    const oid = toOid(req.params.id);

    if (!oid && !req.params.id) {
      return res.status(400).json({ error: true, message: "Invalid review ID." });
    }

    const query = oid ? { $or: [{ _id: oid }, { _id: req.params.id }] } : { _id: req.params.id };
    const existingReview = await commentCollection.findOne(query);

    if (!existingReview) {
      return res.status(404).json({ error: true, message: "Review not found." });
    }

    const isAuthorized = await canUserModifyReview(db, existingReview, req.user);
    if (!isAuthorized) {
      return res.status(403).json({ error: true, message: "Forbidden: You are not authorized to edit this review." });
    }

    const updatePayload = {
      updatedAt: new Date(),
    };
    if (text !== undefined && text.trim() !== "") {
      updatePayload.text = text.trim();
    }
    if (rating !== undefined) {
      updatePayload.rating = Math.max(1, Math.min(5, Number(rating) || 5));
    }
    if (Array.isArray(images)) {
      updatePayload.images = images.filter((img) => typeof img === "string" && img.trim() !== "").slice(0, 3);
    }

    await commentCollection.updateOne({ _id: existingReview._id }, { $set: updatePayload });

    return res.json({
      success: true,
      message: "Review updated successfully.",
      data: { ...existingReview, ...updatePayload, _id: existingReview._id.toString() },
    });
  } catch (err) {
    console.error("[REVIEW ERROR] Update review error:", err.message);
    return res.status(500).json({ error: true, message: "Failed to edit review.", details: err.message });
  }
});

// Delete a comment (author, artwork owner, or admin)
router.delete("/:id", verifyToken, async (req, res) => {
  try {
    const commentCollection = getCommentCollection(req);
    const db = req.app.get("db");
    const oid = toOid(req.params.id);

    if (!oid && !req.params.id) {
      return res.status(400).json({ error: true, message: "Invalid review ID." });
    }

    const query = oid ? { $or: [{ _id: oid }, { _id: req.params.id }] } : { _id: req.params.id };
    const existingReview = await commentCollection.findOne(query);

    if (!existingReview) {
      return res.status(404).json({ error: true, message: "Review not found." });
    }

    const isAuthorized = await canUserModifyReview(db, existingReview, req.user);
    if (!isAuthorized) {
      return res.status(403).json({ error: true, message: "Forbidden: You are not authorized to delete this review." });
    }

    await commentCollection.deleteOne({ _id: existingReview._id });

    return res.json({ success: true, message: "Review deleted successfully." });
  } catch (err) {
    console.error("[REVIEW ERROR] Delete review error:", err.message);
    return res.status(500).json({ error: true, message: "Failed to delete review.", details: err.message });
  }
});

module.exports = router;