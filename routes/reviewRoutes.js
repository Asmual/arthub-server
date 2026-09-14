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

// Add a new comment/review for an artwork
router.post("/", verifyToken, async (req, res) => {
  try {
    const commentCollection = getCommentCollection(req);
    const db = req.app.get("db");
    const userCollection = db.collection("user");
    const { artworkId, text, rating, userName, userImage } = req.body;

    if (!artworkId || !text?.trim()) {
      return res.status(400).json({ error: true, message: "Artwork ID and review text are required." });
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

    const doc = {
      artworkId: artworkId.toString(),
      userId: req.user.id || req.user._id?.toString(),
      userEmail: req.user.email,
      userName: finalUserName || "Art Collector",
      userImage: finalUserImage || "",
      rating: parsedRating,
      text: text.trim(),
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

    // Normalize rating to always have a valid number
    const normalizedReviews = reviews.map((r) => ({
      ...r,
      _id: r._id.toString(),
      rating: typeof r.rating === "number" ? r.rating : 5,
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
    const { text, rating } = req.body;
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