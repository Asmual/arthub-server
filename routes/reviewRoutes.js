const express = require("express");
const router  = express.Router();
const { ObjectId } = require("mongodb");
const { verifyToken } = require("../middlewares");
const { getCommentCollection } = require("../models/collections");

/**
 * Utility helper to safely cast string IDs to MongoDB ObjectIds
 */
const toOid = (id) => {
  try { return ObjectId.isValid(id) ? new ObjectId(id) : null; } catch { return null; }
};

/**
 * @route   POST /api/reviews
 * @desc    Add a standalone global interactions feedback data packet
 * @access  Private (JWT Required)
 */
router.post("/", verifyToken, async (req, res) => {
  try {
    const commentCollection = getCommentCollection(req);
    const { artworkId, text } = req.body;

    if (!artworkId || !text?.trim()) {
      return res.status(400).json({ error: true, message: "Required payload markers (artworkId, text) must be provided." });
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
    res.status(500).json({ error: true, message: "Failed to register feedback transaction log.", details: err.message });
  }
});

/**
 * @route   GET /api/reviews/:artworkId
 * @desc    Retrieve structured product interactions index feed arrays sorted by date parameters
 * @access  Public
 */
router.get("/:artworkId", async (req, res) => {
  try {
    const commentCollection = getCommentCollection(req);
    const reviews = await commentCollection
      .find({ artworkId: req.params.artworkId })
      .sort({ createdAt: -1 })
      .toArray();
    res.json(reviews);
  } catch (err) {
    res.status(500).json({ error: true, message: "Failed to fetch interaction database listings for entity index context.", details: err.message });
  }
});

/**
 * @route   PUT /api/reviews/:id
 * @desc    Mutate specific logging structure contents filtered rigidly via profile identifier matching
 * @access  Private (JWT Required)
 */
router.put("/:id", verifyToken, async (req, res) => {
  try {
    const commentCollection = getCommentCollection(req);
    const { text } = req.body;
    const oid = toOid(req.params.id);

    if (!oid) return res.status(400).json({ error: true, message: "Invalid structurally formatted comment locator parameter id." });

    const result = await commentCollection.updateOne(
      { _id: oid, userEmail: req.user.email },
      { $set: { text: text.trim(), updatedAt: new Date() } }
    );
    if (result.matchedCount === 0) {
      return res.status(403).json({ error: true, message: "Target profile match missing or execution parameters blocked via unauthorized lifecycle identity context." });
    }
    res.json({ success: true, message: "Comment/Review profile metrics updated successfully inside database layer." });
  } catch (err) {
    res.status(500).json({ error: true, message: "Failed to edit commentary database parameters.", details: err.message });
  }
});

/**
 * @route   DELETE /api/reviews/:id
 * @desc    Secure core data entity drop utilizing ownership state validations
 * @access  Private (JWT Required)
 */
router.delete("/:id", verifyToken, async (req, res) => {
  try {
    const commentCollection = getCommentCollection(req);
    const oid = toOid(req.params.id);

    if (!oid) return res.status(400).json({ error: true, message: "Invalid target structural comment payload tracking context parameters identification marker." });

    const result = await commentCollection.deleteOne({ _id: oid, userEmail: req.user.email });
    if (result.deletedCount === 0) {
      return res.status(403).json({ error: true, message: "Termination operation rejected: Target resource footprint missing or verification ownership constraints active." });
    }
    res.json({ success: true, message: "Review deleted successfully from ecosystem repository registers." });
  } catch (err) {
    res.status(500).json({ error: true, message: "Failed to execute drop procedure on target comment log records.", details: err.message });
  }
});

module.exports = router;