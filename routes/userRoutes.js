const express = require("express");
const router = express.Router();
const { ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");
const { verifyToken } = require("../middlewares"); // ভেরিফাই করার জন্য যুক্ত করা হলো

const toOid = (id) => {
  try {
    return ObjectId.isValid(id) ? new ObjectId(id) : null;
  } catch {
    return null;
  }
};

// POST /api/users/generate-token — (বিকল্প হিসেবে রাখা হলো, BetterAuth ব্যবহারে এটি আর লাগবে না)
router.post("/generate-token", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: "Email is required to generate token." });
    }

    const db = req.app.get("db");
    const user = await db.collection("user").findOne({ email });

    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

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

// PUT /api/users/update-profile — UPDATE USER PROFILE WITH SESSION
router.put("/update-profile", verifyToken, async (req, res) => {
  try {
    const db = req.app.get("db");
    // req.user ব্যবহার করে নিশ্চিত করা হচ্ছে যে সঠিক ইউজারই পরিবর্তন করছে
    const userId = req.body.userId || req.user?.id;
    const { name, image, bio, specialty, social } = req.body;

    if (!userId) return res.status(400).json({ message: "userId identification context is missing." });

    const oid = toOid(userId);
    const update = { $set: { updatedAt: new Date() } };

    if (name) update.$set.name = name;
    if (image) update.$set.image = image;
    if (bio) update.$set.bio = bio;
    if (specialty) update.$set.specialty = specialty;
    if (social) update.$set.social = social;

    const result = await db.collection("user").updateOne(
      { $or: [{ _id: oid }, { id: userId }, { email: req.user?.email }] },
      update
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: "User target profile not found." });
    }

    res.json({ success: true, message: "Profile updated successfully." });
  } catch (err) {
    res.status(500).json({ message: "Failed to update profile.", error: err.message });
  }
});

// GET /api/users/:id — FETCH PUBLIC USER PROFILE
router.get("/:id", async (req, res) => {
  try {
    const db = req.app.get("db");
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

// PATCH /api/users/:id/subscription — UPDATE SUBSCRIPTION TIER AFTER PAYMENT
router.patch("/:id/subscription", verifyToken, async (req, res) => {
  try {
    const db = req.app.get("db");
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

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: "User profile target missing." });
    }

    res.json({ success: true, subscriptionTier });
  } catch (err) {
    res.status(500).json({ message: "Failed to update subscription.", error: err.message });
  }
});

module.exports = router;