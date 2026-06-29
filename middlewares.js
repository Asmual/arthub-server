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
      return res.status(401).json({
        error: true,
        message: "Unauthorized: No token provided.",
      });
    }

    // Extract the token payload
    const token = authHeader.split(" ")[1];

    // Verify token using centralized environment secret
    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
      if (err) {
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
      next();
    });
  } catch (error) {
    console.error("Authentication check failure:", error.message);
    return res.status(500).json({
      error: true,
      message: "Internal Authentication Error.",
    });
  }
}

/**
 * Higher-Order Middleware factory for Role-Based Access Control (RBAC)
 * Verifies live role inside MongoDB 'user' collection to prevent active token bypass
 * Usage: router.get('/path', verifyToken, verifyRole(['admin', 'artist']), handler)
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

      // Fetch the express shared instance of database setup via app.set('db')
      const db = req.app.get("db");
      
      // Query singular 'user' collection for live runtime sync authority
      const liveUser = await db.collection("user").findOne({ email: req.user.email });

      if (!liveUser) {
        return res.status(404).json({
          error: true,
          message: "Unauthorized: Registered application profile not found.",
        });
      }

      // Validate credentials access spectrum
      if (!allowedRoles.includes(liveUser.role)) {
        return res.status(403).json({
          error: true,
          message: "Forbidden: Insufficient platform account privileges.",
        });
      }

      // Sync potential runtime configuration mutations back to pipeline context
      req.user.role = liveUser.role;
      req.user._id = liveUser._id; // Attach actual MongoDB ObjectId instance

      next();
    } catch (error) {
      console.error("Role authorization layer crash:", error.message);
      return res.status(500).json({
        error: true,
        message: "Internal System Authorization Failure.",
      });
    }
  };
}

module.exports = { verifyToken, verifyRole };