import express, { Request, Response } from "express";
import { ObjectId, Db } from "mongodb";
import jwt from "jsonwebtoken";
import { verifyToken } from "../middlewares";
import { getUserCollection } from "../models/collections";
import { AuthenticatedRequest } from "../types";

const router = express.Router();

/**
 * Utility helper to safely cast string IDs to MongoDB ObjectIds
 */
const toOid = (id: string | undefined | null): ObjectId | null => {
  if (!id) return null;
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
router.post("/generate-token", async (req: Request, res: Response) => {
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

    return res.json({ success: true, token, role: assignedRole });
  } catch (err: any) {
    return res.status(500).json({ error: true, message: "Token generation failed.", details: err.message });
  }
});

/**
 * @route   GET /api/users/profile
 * @desc    Fetch current authenticated user profile data from source of truth
 * @access  Private (JWT Required)
 */
router.get("/profile", verifyToken as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userCollection = getUserCollection(req);
    const user = await userCollection.findOne(
      { email: req.user!.email },
      { projection: { password: 0, hashedPassword: 0 } }
    );

    if (!user) {
      return res.status(404).json({ error: true, message: "Profile data registry not found." });
    }

    return res.json(user);
  } catch (err: any) {
    return res.status(500).json({ error: true, message: "Failed to fetch profile information.", details: err.message });
  }
});

/**
 * @route   PUT /api/users/profile
 * @desc    Update editable fields inside the MongoDB user collection
 * @access  Private (JWT Required)
 */
router.put("/profile", verifyToken as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userCollection = getUserCollection(req);
    const { name, image, bio, specialty, speciality, phone } = req.body;

    const updateFields: any = { updatedAt: new Date() };

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
      { email: req.user!.email },
      { $set: updateFields }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: true, message: "User profile not found." });
    }

    const updatedUser = await userCollection.findOne(
      { email: req.user!.email },
      { projection: { password: 0, hashedPassword: 0 } }
    );

    // Sync artist image and name across their artworks
    const db = req.app.get("db") as Db;
    if (db && (image !== undefined || name !== undefined)) {
      const artworkUpdate: any = {};
      if (image !== undefined) artworkUpdate.artistImage = image;
      if (name !== undefined) artworkUpdate.artistName = name;
      const userIdStr = updatedUser?._id?.toString();
      await db.collection("artworks").updateMany(
        {
          $or: [
            { artistEmail: req.user!.email },
            { artistEmail: req.user!.email.toLowerCase() },
            { userEmail: req.user!.email },
            ...(userIdStr ? [{ userId: userIdStr }, { artistId: userIdStr }] : []),
          ],
        },
        { $set: artworkUpdate }
      );
    }

    return res.json({ success: true, message: "Profile updated successfully.", user: updatedUser });
  } catch (err: any) {
    console.error("[USER ERROR] Update profile error:", err.message);
    return res.status(500).json({ error: true, message: "Failed to update profile.", details: err.message });
  }
});

/**
 * @route   PATCH /api/users/change-password
 * @desc    Route stub instructing client to bypass backend for password alterations
 * @access  Private (JWT Required)
 */
router.patch("/change-password", verifyToken as any, async (_req: AuthenticatedRequest, res: Response) => {
  // Better Auth handles credentials directly via client SDK session mappings
  return res.status(200).json({ message: "Use BetterAuth to change password" });
});

/**
 * @route   PATCH /api/users/:id/subscription
 * @desc    Update subscription tier lifecycle status after successful payment processing
 * @access  Private (JWT Required)
 */
router.patch("/:id/subscription", verifyToken as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userCollection = getUserCollection(req);
    const id = req.params.id as string;
    const oid = toOid(id);
    const { subscriptionTier } = req.body;

    const allowedTiers = ["free", "pro", "premium"];
    if (!allowedTiers.includes(subscriptionTier)) {
      return res.status(400).json({ error: true, message: "Invalid tier allocation. Allowed: free | pro | premium" });
    }

    const query = oid ? { $or: [{ _id: oid }, { id }] } : { id };

    const result = await userCollection.updateOne(
      query as any,
      { $set: { subscriptionTier, updatedAt: new Date() } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: true, message: "User profile subscription target missing." });
    }

    return res.json({ success: true, subscriptionTier });
  } catch (err: any) {
    return res.status(500).json({ error: true, message: "Failed to update subscription structure.", details: err.message });
  }
});

/**
 * @route   GET /api/users/:id
 * @desc    Fetch public profile layout metrics for an artist or buyer
 * @access  Public
 */
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const userCollection = getUserCollection(req);
    const id = req.params.id as string;
    const oid = toOid(id);

    const query = oid ? { $or: [{ _id: oid }, { id }] } : { id };

    const user = await userCollection.findOne(
      query as any,
      { projection: { password: 0, hashedPassword: 0, email: 0 } } // Exclude sensitive details from public view
    );

    if (!user) {
      return res.status(404).json({ error: true, message: "Public user trace not found." });
    }

    return res.json(user);
  } catch (err: any) {
    return res.status(500).json({ error: true, message: "Failed to fetch public user metadata.", details: err.message });
  }
});

/**
 * @route   POST /api/users/upgrade-to-artist
 * @desc    Upgrade user account role to artist in database
 * @access  Public / Authenticated
 */
router.post("/upgrade-to-artist", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { email } = req.body;
    const targetEmail = email || req.user?.email;

    if (!targetEmail) {
      return res.status(400).json({ error: true, message: "User email is required to upgrade role." });
    }

    const userCollection = getUserCollection(req);
    const db = req.app.get("db") as Db;

    const user = await userCollection.findOne({ email: targetEmail });
    if (!user) {
      return res.status(404).json({ error: true, message: "User account not found." });
    }

    const now = new Date();
    const updateFields: any = {
      role: "artist",
      updatedAt: now,
    };

    if (!(user as any).plan && !(user as any).subscription?.plan) {
      updateFields.plan = "free";
      updateFields.subscription = {
        plan: "free",
        status: "active",
        interval: "free",
        amount: 0,
        artLimit: 5,
        activatedAt: now,
        updatedAt: now,
      };
    }

    await userCollection.updateOne({ email: targetEmail }, { $set: updateFields });

    const usersCol = db.collection("users");
    if (usersCol) {
      await usersCol.updateOne({ email: targetEmail }, { $set: updateFields });
    }

    return res.json({
      success: true,
      message: "Account upgraded to artist successfully.",
      role: "artist",
    });
  } catch (err: any) {
    console.error("[USER ROUTES ERROR] upgrade-to-artist:", err);
    return res.status(500).json({ error: true, message: "Failed to upgrade account to artist.", details: err.message });
  }
});

export default router;
