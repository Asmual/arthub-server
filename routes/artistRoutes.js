const express = require('express');
const router = express.Router();

/**
 * @route   GET /api/artists/top
 * @desc    Get top 3 artists sorted by totalSold in descending order from user collection
 * @access  Public
 */
router.get('/top', async (req, res) => {
  try {
    const db = req.app.get('db');
    const userCollection = db.collection('user');

    const allArtists = await userCollection.find({ role: "artist" }).toArray();

    const topArtists = allArtists
      .sort((a, b) => Number(b.totalSold || 0) - Number(a.totalSold || 0))
      .slice(0, 3);

    res.status(200).json(topArtists);
  } catch (error) {
    console.error("Error fetching top artists:", error);
    res.status(500).json({ 
      message: "Server error while fetching top artists", 
      error: error.message 
    });
  }
});

/**
 * @route   GET /api/artists
 * @desc    Get all artists from the user database collection
 * @access  Public
 */
router.get('/', async (req, res) => {
  try {
    const db = req.app.get('db');
    const userCollection = db.collection('user');

    const artists = await userCollection.find({ role: "artist" }).toArray();
    res.status(200).json(artists);
  } catch (error) {
    console.error("Error fetching all artists:", error);
    res.status(500).json({ 
      message: "Server error while fetching all artists", 
      error: error.message 
    });
  }
});

module.exports = router;