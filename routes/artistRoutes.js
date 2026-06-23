const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');

/**
 * @route   GET /api/artists/top
 * @desc    Get top 3 artists sorted by totalSold in descending order
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
 * @route   GET /api/artists/:id
 * @desc    Get single artist data by their MongoDB ID
 * @access  Public
 */
router.get('/:id', async (req, res) => {
  try {
    const db = req.app.get('db');
    const userCollection = db.collection('user');
    const artistId = req.params.id;

    let queryId = artistId;
    if (ObjectId.isValid(artistId)) {
      queryId = new ObjectId(artistId);
    }

    // Checking matches for both standard ObjectId and string type definitions
    const artist = await userCollection.findOne({
      $or: [
        { _id: queryId },
        { _id: artistId }
      ]
    });

    if (!artist) {
      return res.status(404).json({ message: "Requested artist profile not found" });
    }

    res.status(200).json(artist);
  } catch (error) {
    console.error("Error fetching individual artist:", error);
    res.status(500).json({ 
      message: "Server error while fetching artist profile data", 
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

/**
 * @route   GET /api/artists/:id/stats
 * @desc    Get specific artist statistics (Total works, Published works, and Total sales)
 * @access  Public
 */
router.get('/:id/stats', async (req, res) => {
  try {
    const db = req.app.get('db');
    const artworkCollection = db.collection('artworks');
    const artistId = req.params.id;

    let queryId = artistId;
    try {
      if (ObjectId.isValid(artistId)) {
        queryId = new ObjectId(artistId);
      }
    } catch (e) {
      console.error("Invalid ObjectId format, using string instead.");
    }

    const artworks = await artworkCollection.find({
      $or: [
        { userId: queryId },
        { userId: artistId },
        { "artist._id": artistId },
        { "artist._id": queryId },
        { "userId._id": artistId }
      ]
    }).toArray();

    const totalArtworks = artworks.length;
    const publishedArtworks = artworks.filter(art => !art.isDraft).length; 
    const totalSales = artworks.filter(art => art.isSold === true).length;

    res.status(200).json({
      totalArtworks,
      publishedArtworks,
      totalSales
    });
  } catch (error) {
    console.error("Error fetching artist stats:", error);
    res.status(500).json({ 
      message: "Server error while fetching artist statistics", 
      error: error.message 
    });
  }
});

module.exports = router;