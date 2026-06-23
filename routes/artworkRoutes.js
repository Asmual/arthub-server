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

/**
 * @route   GET /api/artworks/search
 * @desc    Live search artworks by title or artist name
 * @access  Public
 */
router.get('/search', async (req, res) => {
  try {
    const { query } = req.query;
    const db = req.app.get('db');
    const artworkCollection = db.collection('artworks');

    if (!query || query.trim() === '') {
      return res.status(200).json([]);
    }

    // Performs case-insensitive regex search on title and artistName fields safely
    const searchResults = await artworkCollection
      .find({
        $or: [
          { title: { $regex: query, $options: 'i' } },
          { artistName: { $regex: query, $options: 'i' } }
        ]
      })
      .toArray();

    res.status(200).json(searchResults);
  } catch (error) {
    console.error("Search API Error:", error);
    res.status(500).json({ 
      message: "Server error during search", 
      error: error.message 
    });
  }
});

module.exports = router;