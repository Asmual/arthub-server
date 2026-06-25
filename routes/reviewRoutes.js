const express = require("express");
const router  = express.Router();
const { ObjectId } = require("mongodb");

// POST /api/reviews
router.post("/", async (req, res) => {
  try {
    const db = req.app.get("db");
    const { artworkId, userEmail, userName, userImage, text } = req.body;

    if (!artworkId || !userEmail || !text?.trim()) {
      return res.status(400).json({ message: "artworkId, userEmail, text are required" });
    }

    const doc = {
      artworkId, userEmail,
      userName:  userName  || "User",
      userImage: userImage || "",
      text:      text.trim(),
      createdAt: new Date(),
    };

    const result = await db.collection("reviews").insertOne(doc);
    res.status(201).json({ ...doc, _id: result.insertedId });
  } catch (err) {
    res.status(500).json({ message: "Failed to create review", error: err.message });
  }
});

// GET /api/reviews/:artworkId
router.get("/:artworkId", async (req, res) => {
  try {
    const db = req.app.get("db");
    const reviews = await db.collection("reviews")
      .find({ artworkId: req.params.artworkId })
      .sort({ createdAt: -1 })
      .toArray();
    res.json(reviews);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch reviews", error: err.message });
  }
});

// PUT /api/reviews/:id — owner only (matched by userEmail)
router.put("/:id", async (req, res) => {
  try {
    const db  = req.app.get("db");
    const { text, userEmail } = req.body;
    const result = await db.collection("reviews").updateOne(
      { _id: new ObjectId(req.params.id), userEmail },
      { $set: { text: text.trim(), updatedAt: new Date() } }
    );
    if (result.matchedCount === 0) {
      return res.status(403).json({ message: "Not found or unauthorized" });
    }
    res.json({ message: "Review updated" });
  } catch (err) {
    res.status(500).json({ message: "Failed to update review", error: err.message });
  }
});

// DELETE /api/reviews/:id — owner only
router.delete("/:id", async (req, res) => {
  try {
    const db  = req.app.get("db");
    const { userEmail } = req.body;
    const result = await db.collection("reviews").deleteOne({
      _id: new ObjectId(req.params.id), userEmail,
    });
    if (result.deletedCount === 0) {
      return res.status(403).json({ message: "Not found or unauthorized" });
    }
    res.json({ message: "Review deleted" });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete review", error: err.message });
  }
});

module.exports = router;
