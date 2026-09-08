const jwt = require("jsonwebtoken");
const { ObjectId } = require("mongodb");

/**
 * Middleware to verify JWT Access Token from Request Headers
 * Authorization format: Bearer <token>
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
    const jwtSecret = process.env.JWT_SECRET || process.env.BETTER_AUTH_SECRET;

    if (!jwtSecret) {
      console.error("[AUTH CRITICAL ERROR] JWT secret key is not configured in server environment.");
      return res.status(500).json({
        error: true,
        message: "Internal Authentication Error: JWT secret not configured.",
      });
    }

    jwt.verify(token, jwtSecret, (err, decoded) => {
      if (err) {
        console.error(`[AUTH ERROR] JWT Verification failed runtime handshake: ${err.message}`);
        return res.status(403).json({
          error: true,
          message: "Forbidden: Invalid or expired token.",
        });
      }

      // Attach decoded payload identity to the request object
      req.user = {
        id: decoded.id,
        email: decoded.email,
        role: decoded.role,
      };
      
      console.log(`[AUTH SUCCESS] User ${req.user.email} authenticated token handshake.`);
      next();
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