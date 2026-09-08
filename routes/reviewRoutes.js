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

// Add a new comment/review for an artwork
router.post("/", verifyToken, async (req, res) => {
  try {
    const commentCollection = getCommentCollection(req);
    const db = req.app.get("db");
    const userCollection = db.collection("user");
    const { artworkId, text, userName, userImage } = req.body;

    if (!artworkId || !text?.trim()) {
      return res.status(400).json({ error: true, message: "Artwork ID and text are required." });
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

    const doc = {
      artworkId,
      userId: req.user.id || req.user._id?.toString(),
      userEmail: req.user.email,
      userName: finalUserName || "Art Collector",
      userImage: finalUserImage || "",
      text: text.trim(),
      createdAt: new Date(),
    };

    const result = await commentCollection.insertOne(doc);
    return res.status(201).json({ success: true, ...doc, _id: result.insertedId });
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
    const reviews = await commentCollection
      .find({ artworkId: req.params.artworkId })
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

    return res.json(reviews);
  } catch (err) {
    console.error("[REVIEW ERROR] Fetch reviews error:", err.message);
    return res.status(500).json({ error: true, message: "Failed to fetch reviews.", details: err.message });
  }
});

// Update an existing comment (author only)
router.put("/:id", verifyToken, async (req, res) => {
  try {
    const commentCollection = getCommentCollection(req);
    const { text } = req.body;
    const oid = toOid(req.params.id);

    if (!oid) return res.status(400).json({ error: true, message: "Invalid review ID." });
    if (!text?.trim()) return res.status(400).json({ error: true, message: "Comment text cannot be empty." });

    const result = await commentCollection.updateOne(
      { _id: oid, userEmail: req.user.email },
      { $set: { text: text.trim(), updatedAt: new Date() } }
    );

    if (result.matchedCount === 0) {
      return res.status(403).json({ error: true, message: "Review not found or unauthorized to edit." });
    }

    return res.json({ success: true, message: "Review updated successfully." });
  } catch (err) {
    console.error("[REVIEW ERROR] Update review error:", err.message);
    return res.status(500).json({ error: true, message: "Failed to edit review.", details: err.message });
  }
});

// Delete a comment (author or admin)
router.delete("/:id", verifyToken, async (req, res) => {
  try {
    const commentCollection = getCommentCollection(req);
    const oid = toOid(req.params.id);

    if (!oid) return res.status(400).json({ error: true, message: "Invalid review ID." });

    const deleteFilter = req.user.role === "admin" ? { _id: oid } : { _id: oid, userEmail: req.user.email };
    const result = await commentCollection.deleteOne(deleteFilter);

    if (result.deletedCount === 0) {
      return res.status(403).json({ error: true, message: "Review not found or unauthorized to delete." });
    }

    return res.json({ success: true, message: "Review deleted successfully." });
  } catch (err) {
    console.error("[REVIEW ERROR] Delete review error:", err.message);
    return res.status(500).json({ error: true, message: "Failed to delete review.", details: err.message });
  }
});

module.exports = router;