const express = require('express');
const { ObjectId } = require('mongodb');
const router = express.Router();

/**
 * @route   POST /api/reviews
 * @desc    Persist a new comment bound to a unique user session and artwork
 * @access  Public (Verification handled via payload parsing)
 */
router.post('/', async (req, res) => {
  try {
    const db = req.app.get('db');
    const reviewCollection = db.collection('reviews');

    const { artworkId, userEmail, userName, userImage, text } = req.body;

    if (!artworkId || !userEmail || !text.trim()) {
      return res.status(400).json({ message: "Required parameters are missing" });
    }

    const newReview = {
      artworkId,
      userEmail,
      userName: userName || "Authenticated User",
      userImage: userImage || "",
      text: text.trim(),
      createdAt: new Date()
    };

    const result = await reviewCollection.insertOne(newReview);
    res.status(201).json({ message: "Review created", reviewId: result.insertedId });
  } catch (error) {
    console.error("Post review tracking fault:", error);
    res.status(500).json({ message: "Internal runtime server error", error: error.message });
  }
});

/**
 * @route   GET /api/reviews/:artworkId
 * @desc    Fetch ordered reviews matching target artwork reference identifier
 * @access  Public
 */
router.get('/:artworkId', async (req, res) => {
  try {
    const db = req.app.get('db');
    const reviewCollection = db.collection('reviews');
    const { artworkId } = req.params;

    const reviews = await reviewCollection
      .find({ artworkId: artworkId })
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).json(reviews);
  } catch (error) {
    console.error("Get reviews tracking fault:", error);
    res.status(500).json({ message: "Database query fault encountered", error: error.message });
  }
});

/**
 * @route   PUT /api/reviews/:id
 * @desc    Update text document attributes of a specific comment instance
 * @access  Public (Enforced client ownership checks matching email context)
 */
router.put('/:id', async (req, res) => {
  try {
    const db = req.app.get('db');
    const reviewCollection = db.collection('reviews');
    const { id } = req.params;
    const { text, userEmail } = req.body;

    const query = { _id: new ObjectId(id), userEmail: userEmail };
    const update = { $set: { text: text.trim(), updatedAt: new Date() } };

    const result = await reviewCollection.updateOne(query, update);

    if (result.matchedCount === 0) {
      return res.status(403).json({ message: "Unauthorized change attempt or document missing" });
    }

    res.status(200).json({ message: "Review modified successfully" });
  } catch (error) {
    console.error("Modify review tracking fault:", error);
    res.status(500).json({ message: "Database patch failed", error: error.message });
  }
});

/**
 * @route   DELETE /api/reviews/:id
 * @desc    Purge a comment collection document matching specific entry context
 * @access  Public (Enforced client ownership checks matching email context)
 */
router.delete('/:id', async (req, res) => {
  try {
    const db = req.app.get('db');
    const reviewCollection = db.collection('reviews');
    const { id } = req.params;
    const { userEmail } = req.body;

    const query = { _id: new ObjectId(id), userEmail: userEmail };
    const result = await reviewCollection.deleteOne(query);

    if (result.deletedCount === 0) {
      return res.status(403).json({ message: "Unauthorized purge attempt or document missing" });
    }

    res.status(200).json({ message: "Review deleted successfully" });
  } catch (error) {
    console.error("Purge review tracking fault:", error);
    res.status(500).json({ message: "Database drop processing failed", error: error.message });
  }
});

module.exports = router;