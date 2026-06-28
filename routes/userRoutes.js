// routes/userRoutes.js
const express = require("express");
const router = express.Router();
const { ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");

const toOid = (id) => {
  try {
    return ObjectId.isValid(id) ? new ObjectId(id) : null;
  } catch {
    return null;
  }
};

// POST /api/users/generate-token
router.post("/generate-token", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email is required." });

    const db = req.app.get("db");
    const user = await db.collection("user").findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found." });

    const token = jwt.sign(
      { email: user.email, role: user.role, id: user._id?.toString() || user.id },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({ token, role: user.role });
  } catch (err) {
    res.status(500).json({ message: "Token generation failed.", error: err.message });
  }
});

// PUT /api/users/update-profile
router.put("/update-profile", async (req, res) => {
  try {
    const db = req.app.get("db");
    const { userId, name, image, bio, specialty, social } = req.body;
    if (!userId) return res.status(400).json({ message: "userId is required." });

    const oid = toOid(userId);
    const update = { $set: { updatedAt: new Date() } };

    if (name)      update.$set.name      = name;
    if (image)     update.$set.image     = image;
    if (bio)       update.$set.bio       = bio;
    if (specialty) update.$set.specialty = specialty;
    if (social)    update.$set.social    = social;

    const result = await db.collection("user").updateOne(
      { $or: [{ _id: oid }, { id: userId }, { email: userId }] },
      update
    );

    if (result.matchedCount === 0) return res.status(404).json({ message: "User not found." });
    res.json({ success: true, message: "Profile updated successfully." });
  } catch (err) {
    res.status(500).json({ message: "Failed to update profile.", error: err.message });
  }
});

// GET /api/users/profile — fetch artist extra fields by userId query param
router.get("/profile", async (req, res) => {
  try {
    const db = req.app.get("db");
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ message: "userId query param is required." });

    const oid  = toOid(userId);
    const user = await db.collection("user").findOne(
      { $or: [{ _id: oid }, { id: userId }, { uid: userId }] },
      { projection: { password: 0, hashedPassword: 0 } }
    );

    if (!user) return res.status(404).json({ message: "User not found." });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch profile.", error: err.message });
  }
});

// PATCH /api/users/profile — save artist-specific profile fields
router.patch("/profile", async (req, res) => {
  try {
    const db = req.app.get("db");
    const { userId, specialty, bio, location, website, phone, portfolio, experience, socialLinks } = req.body;
    if (!userId) return res.status(400).json({ message: "userId is required." });

    const oid = toOid(userId);

    const fields = {};
    if (specialty  !== undefined) fields.specialty  = specialty;
    if (bio        !== undefined) fields.bio        = bio;
    if (location   !== undefined) fields.location   = location;
    if (website    !== undefined) fields.website    = website;
    if (phone      !== undefined) fields.phone      = phone;
    if (portfolio  !== undefined) fields.portfolio  = portfolio;
    if (experience !== undefined) fields.experience = experience;
    if (socialLinks)              fields.socialLinks = socialLinks;

    const result = await db.collection("user").findOneAndUpdate(
      { $or: [{ _id: oid }, { id: userId }, { uid: userId }] },
      { $set: { ...fields, updatedAt: new Date() } },
      { returnDocument: "after" }
    );

    if (!result) return res.status(404).json({ message: "User not found." });
    res.json({ message: "Artist profile updated successfully." });
  } catch (err) {
    res.status(500).json({ message: "Failed to update profile.", error: err.message });
  }
});

// GET /api/users/:id — fetch public user profile by id
router.get("/:id", async (req, res) => {
  try {
    const db  = req.app.get("db");
    const oid = toOid(req.params.id);

    const user = await db.collection("user").findOne(
      { $or: [{ _id: oid }, { id: req.params.id }] },
      { projection: { password: 0, hashedPassword: 0 } }
    );

    if (!user) return res.status(404).json({ message: "User not found." });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch user.", error: err.message });
  }
});

// PATCH /api/users/:id/subscription — update subscription tier after payment
router.patch("/:id/subscription", async (req, res) => {
  try {
    const db  = req.app.get("db");
    const oid = toOid(req.params.id);
    const { subscriptionTier } = req.body;

    const allowed = ["free", "pro", "premium"];
    if (!allowed.includes(subscriptionTier)) {
      return res.status(400).json({ message: "Invalid tier. Allowed: free | pro | premium" });
    }

    const result = await db.collection("user").updateOne(
      { $or: [{ _id: oid }, { id: req.params.id }] },
      { $set: { subscriptionTier, updatedAt: new Date() } }
    );

    if (result.matchedCount === 0) return res.status(404).json({ message: "User not found." });
    res.json({ success: true, subscriptionTier });
  } catch (err) {
    res.status(500).json({ message: "Failed to update subscription.", error: err.message });
  }
});

module.exports = router;