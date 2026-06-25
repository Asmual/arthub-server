const express = require("express");
const router  = express.Router();
const { ObjectId } = require("mongodb");

const toOid = (id) => {
  try { return ObjectId.isValid(id) ? new ObjectId(id) : null; } catch { return null; }
};

// PUT /api/users/update-profile — update name, image, bio, specialty, social links
router.put("/update-profile", async (req, res) => {
  try {
    const db = req.app.get("db");
    const { userId, name, image, bio, specialty, social } = req.body;

    if (!userId) return res.status(400).json({ message: "userId is required" });

    const oid = toOid(userId);
    const update = { $set: { updatedAt: new Date() } };

    if (name)      update.$set.name      = name;
    if (image)     update.$set.image     = image;
    if (bio)       update.$set.bio       = bio;
    if (specialty) update.$set.specialty = specialty;
    if (social)    update.$set.social    = social;

    // BetterAuth stores id as string field, not always ObjectId
    const result = await db.collection("user").updateOne(
      { $or: [{ _id: oid }, { id: userId }, { email: userId }] },
      update
    );

    if (result.matchedCount === 0) return res.status(404).json({ message: "User not found" });
    res.json({ success: true, message: "Profile updated successfully" });
  } catch (err) {
    res.status(500).json({ message: "Failed to update profile", error: err.message });
  }
});

// GET /api/users/:id — fetch user profile (no password)
router.get("/:id", async (req, res) => {
  try {
    const db  = req.app.get("db");
    const oid = toOid(req.params.id);
    const user = await db.collection("user").findOne(
      { $or: [{ _id: oid }, { id: req.params.id }] },
      { projection: { password: 0, hashedPassword: 0 } }
    );
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch user", error: err.message });
  }
});

// PATCH /api/users/:id/subscription — update tier after payment
router.patch("/:id/subscription", async (req, res) => {
  try {
    const db  = req.app.get("db");
    const oid = toOid(req.params.id);
    const { subscriptionTier } = req.body;

    const allowed = ["free", "pro", "premium"];
    if (!allowed.includes(subscriptionTier)) {
      return res.status(400).json({ message: "Invalid tier. Use: free | pro | premium" });
    }

    const result = await db.collection("user").updateOne(
      { $or: [{ _id: oid }, { id: req.params.id }] },
      { $set: { subscriptionTier, updatedAt: new Date() } }
    );

    if (result.matchedCount === 0) return res.status(404).json({ message: "User not found" });
    res.json({ success: true, subscriptionTier });
  } catch (err) {
    res.status(500).json({ message: "Failed to update subscription", error: err.message });
  }
});

module.exports = router;
