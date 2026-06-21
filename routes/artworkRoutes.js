const express = require('express');
const router = express.Router();

/**
 * @route   GET /api/artworks/featured
 * @desc    Get latest 6 artworks from the database
 * @access  Public
 */
router.get('/featured', async (req, res) => {
  try {
    const db = req.app.get('db');
    const artworkCollection = db.collection('artworks');

    const featuredArtworks = await artworkCollection
      .find({})
      .sort({ createdAt: -1 })
      .limit(6)
      .toArray();

    res.status(200).json(featuredArtworks);
  } catch (error) {
    console.error("Error fetching featured artworks:", error);
    res.status(500).json({ 
      message: "Server error while fetching featured artworks", 
      error: error.message 
    });
  }
});

module.exports = router;