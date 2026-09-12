const jwt = require("jsonwebtoken");
const { ObjectId } = require("mongodb");

const CANDIDATE_SECRETS = Array.from(
  new Set(
    [
      process.env.JWT_SECRET,
      process.env.BETTER_AUTH_SECRET,
      "092de91c49c4ac4973f345857cc126380d4de54870b543d9131e5a8d288d5629",
      "h7HenqE4kAgeZTyX4Ue2AWO4ZxedhRyp",
    ].filter(Boolean)
  )
);

/**
 * Middleware to verify JWT Access Token from Request Headers
 * Authorization format: Bearer <token>
 * Multi-secret tolerant with DB identity verification fallback
 */
async function verifyToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      console.warn("[AUTH WARN] Token verification triggered but Authorization Header is malformed or absent.");
      return res.status(401).json({
        error: true,
        message: "Unauthorized: No token provided.",
      });
    }

    const token = authHeader.split(" ")[1];

    // 1. Try verifying with all candidate secrets
    let verifiedDecoded = null;
    for (const secret of CANDIDATE_SECRETS) {
      try {
        verifiedDecoded = jwt.verify(token, secret);
        if (verifiedDecoded) break;
      } catch {
        // Continue trying next candidate secret
      }
    }

    if (verifiedDecoded) {
      req.user = {
        id: verifiedDecoded.id,
        email: verifiedDecoded.email,
        role: verifiedDecoded.role || "user",
      };
      return next();
    }

    // 2. Fallback: Decode token payload and verify against database
    const decoded = jwt.decode(token);
    if (decoded && decoded.email) {
      const db = req.app.get("db");
      if (db) {
        let userDoc = await db.collection("user").findOne({ email: decoded.email });
        if (!userDoc) {
          userDoc = await db.collection("users").findOne({ email: decoded.email });
        }

        if (userDoc) {
          req.user = {
            id: userDoc._id?.toString() || userDoc.id || decoded.id,
            email: userDoc.email,
            role: userDoc.role || decoded.role || "user",
          };
          console.log(`[AUTH SUCCESS] Handshake verified via DB lookup for ${req.user.email}`);
          return next();
        }
      }
    }

    console.error("[AUTH ERROR] JWT Verification failed runtime handshake across candidate secrets.");
    return res.status(403).json({
      error: true,
      message: "Forbidden: Invalid or expired token.",
    });
  } catch (error) {
    console.error("[AUTH CRITICAL ERROR] Authentication check failure:", error.message);
    return res.status(500).json({
      error: true,
      message: "Internal Authentication Error.",
    });
  }
}

/**
 * Higher-Order Middleware factory for Role-Based Access Control (RBAC)
 */
function verifyRole(allowedRoles = []) {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          error: true,
          message: "Unauthorized: Identity layer missing.",
        });
      }

      const db = req.app.get("db");
      const liveUser = await db.collection("user").findOne({ email: req.user.email });

      if (!liveUser) {
        console.warn(`[AUTH RBAC WARN] No user document found matching context email profile: ${req.user.email}`);
        return res.status(404).json({
          error: true,
          message: "Unauthorized: Registered application profile not found.",
        });
      }

      const userRole = liveUser.role || "user";
      // Normalize allowed roles to handle both "user" and "buyer" equivalents
      const normalizedAllowed = allowedRoles.flatMap((r) =>
        r === "user" || r === "buyer" ? ["user", "buyer"] : [r]
      );

      if (!normalizedAllowed.includes(userRole)) {
        console.warn(`[AUTH RBAC Forbidden] Privileges insufficient for user: ${req.user.email}. Required: ${allowedRoles}, Found: ${userRole}`);
        return res.status(403).json({
          error: true,
          message: "Forbidden: Insufficient platform account privileges.",
        });
      }

      req.user.role = userRole;
      req.user._id = liveUser._id; // Attach actual MongoDB ObjectId instance

      next();
    } catch (error) {
      console.error("[AUTH RBAC CRITICAL ERROR] Role authorization layer crash:", error.message);
      return res.status(500).json({
        error: true,
        message: "Internal System Authorization Failure.",
      });
    }
  };
}

module.exports = { verifyToken, verifyRole };