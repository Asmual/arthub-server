const jwt = require("jsonwebtoken");

// Verify JWT token from Authorization header
const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Unauthorized: No token provided." });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    req.user = decoded;
    req.decoded = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: "Unauthorized: Invalid or expired token." });
  }
};

// Verify user role against allowed roles from DB
const verifyRole = (allowedRoles) => {
  return async (req, res, next) => {
    try {
      const db = req.app.get("db");
      const userEmail = req.decoded?.email || req.user?.email;

      if (!userEmail) {
        return res.status(401).json({ success: false, message: "Token missing email context." });
      }

      const user = await db.collection("user").findOne({ email: userEmail });

      if (!user) {
        return res.status(404).json({ success: false, message: "User not found in database." });
      }

      if (!allowedRoles.includes(user.role)) {
        return res.status(403).json({ success: false, message: "Forbidden: Insufficient role privileges." });
      }

      req.dbUser = user;
      next();
    } catch (error) {
      return res.status(500).json({ success: false, message: "Role verification failed.", error: error.message });
    }
  };
};

module.exports = { verifyToken, verifyRole };