const express = require('express');
const router = express.Router();

// Native MongoDB Route to sync and maintain user updates permanently
router.put('/update-profile', async (req, res) => {
  try {
    const { userId, name, image } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "User identity identification parameter missing" });
    }

    // Directly updating native collection attributes initialized by your auth setup
    const result = await db.collection('user').updateOne(
      { id: userId }, // BetterAuth maps primary identifier string as 'id' field, not always ObjectId
      { 
        $set: { 
          name: name, 
          image: image,
          updatedAt: new Date()
        } 
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: "Target user context record not found" });
    }

    res.status(200).json({ success: true, message: "Native collection metrics updated successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;