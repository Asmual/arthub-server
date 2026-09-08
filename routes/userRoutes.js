const express = require("express");
const router = express.Router();
const { ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");
const { verifyToken } = require("../middlewares");
const { getUserCollection } = require("../models/collections");

/**
 * Utility helper to safely cast string IDs to MongoDB ObjectIds
 */
const toOid = (id) => {
  try {
    return ObjectId.isValid(id) ? new ObjectId(id) : null;
  } catch {
    return null;
  }
};

/**
 * @route   POST /api/users/generate-token
 * @desc    Generate a 7-day expiry JWT token after verification from Better Auth
 * @access  Public
 */
router.post("/generate-token", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: true, message: "Email is required to generate token." });
    }

    const userCollection = getUserCollection(req);
    const user = await userCollection.findOne({ email });

    if (!user) {
      return res.status(404).json({ error: true, message: "User not found in application database." });
    }

    const jwtSecret = process.env.JWT_SECRET || process.env.BETTER_AUTH_SECRET;
    if (!jwtSecret) {
      console.error("[AUTH CRITICAL ERROR] JWT secret is not configured in server environment.");
      return res.status(500).json({ error: true, message: "Token generation failed: JWT secret not configured." });
    }

    const assignedRole = user.role || "user";

    // Sign JWT with payload containing id, email, and role
    const token = jwt.sign(
      { 
        id: user._id?.toString() || user.id, 
        email: user.email, 
        role: assignedRole 
      },
      jwtSecret,
      { expiresIn: "7d" }
    );

    res.json({ success: true, token, role: assignedRole });
  } catch (err) {
    res.status(500).json({ error: true, message: "Token generation failed.", details: err.message });
  }
});

/**
 * @route   GET /api/users/profile
 * @desc    Fetch current authenticated user profile data from source of truth
 * @access  Private (JWT Required)
 */
router.get("/profile", verifyToken, async (req, res) => {
  try {
    const userCollection = getUserCollection(req);
    const user = await userCollection.findOne(
      { email: req.user.email },
      { projection: { password: 0, hashedPassword: 0 } }
    );

    if (!user) {
      return res.status(404).json({ error: true, message: "Profile data registry not found." });
    }

    res.json(user);
  } catch (err) {
    res.status(500).json({ error: true, message: "Failed to fetch profile information.", details: err.message });
  }
});

/**
 * @route   PUT /api/users/profile
 * @desc    Update editable fields inside the MongoDB user collection
 * @access  Private (JWT Required)
 */
router.put("/profile", verifyToken, async (req, res) => {
  try {
    const userCollection = getUserCollection(req);
    const { name, image, bio, specialty, speciality, phone } = req.body;

    const updateFields = { updatedAt: new Date() };

    if (name !== undefined) updateFields.name = name;
    if (image !== undefined) updateFields.image = image;
    if (bio !== undefined) updateFields.bio = bio;
    if (phone !== undefined) updateFields.phone = phone;

    const finalSpecialty = specialty !== undefined ? specialty : speciality;
    if (finalSpecialty !== undefined) {
      updateFields.specialty = finalSpecialty;
      updateFields.speciality = finalSpecialty;
    }

    const result = await userCollection.updateOne(
      { email: req.user.email },
      { $set: updateFields }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: true, message: "User profile not found." });
    }

    const updatedUser = await userCollection.findOne(
      { email: req.user.email },
      { projection: { password: 0, hashedPassword: 0 } }
    );

    return res.json({ success: true, message: "Profile updated successfully.", user: updatedUser });
  } catch (err) {
    console.error("[USER ERROR] Update profile error:", err.message);
    return res.status(500).json({ error: true, message: "Failed to update profile.", details: err.message });
  }
});

/**
 * @route   PATCH /api/users/change-password
 * @desc    Route stub instructing client to bypass backend for password alterations
 * @access  Private (JWT Required)
 */
router.patch("/change-password", verifyToken, async (req, res) => {
  // Better Auth handles credentials directly via client SDK session mappings
  res.status(200).json({ message: "Use BetterAuth to change password" });
});

/**
 * @route   PATCH /api/users/:id/subscription
 * @desc    Update subscription tier lifecycle status after successful payment processing
 * @access  Private (JWT Required)
 */
router.patch("/:id/subscription", verifyToken, async (req, res) => {
  try {
    const userCollection = getUserCollection(req);
    const oid = toOid(req.params.id);
    const { subscriptionTier } = req.body;

    const allowedTiers = ["free", "pro", "premium"];
    if (!allowedTiers.includes(subscriptionTier)) {
      return res.status(400).json({ error: true, message: "Invalid tier allocation. Allowed: free | pro | premium" });
    }

    const result = await userCollection.updateOne(
      { $or: [{ _id: oid }, { id: req.params.id }] },
      { $set: { subscriptionTier, updatedAt: new Date() } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: true, message: "User profile subscription target missing." });
    }

    res.json({ success: true, subscriptionTier });
  } catch (err) {
    res.status(500).json({ error: true, message: "Failed to update subscription structure.", details: err.message });
  }
});

/**
 * @route   GET /api/users/:id
 * @desc    Fetch public profile layout metrics for an artist or buyer
 * @access  Public
 */
router.get("/:id", async (req, res) => {
  try {
    const userCollection = getUserCollection(req);
    const oid = toOid(req.params.id);

    const user = await userCollection.findOne(
      { $or: [{ _id: oid }, { id: req.params.id }] },
      { projection: { password: 0, hashedPassword: 0, email: 0 } } // Exclude sensitive details from public view
    );

    if (!user) {
      return res.status(404).json({ error: true, message: "Public user trace not found." });
    }

    res.json(user);
  } catch (err) {
    res.status(500).json({ error: true, message: "Failed to fetch public user metadata.", details: err.message });
  }
});

module.exports = router;