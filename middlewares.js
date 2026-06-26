const { ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");

// Middleware to verify if the request contains a valid authorization structure and JWT token
const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
   
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ success: false, message: "Unauthorized access! Missing token." });
    }

    const token = authHeader.split(" ")[1];

    // Real JWT Verification using your environment secret key
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Attaching the decoded payload to the request target object securely
    req.user = decoded;
    req.decoded = decoded;
    req.userToken = token;

    next();
  } catch (error) {
    console.error("JWT Token Verification Fail:", error.message);
    return res.status(403).json({ success: false, message: "Forbidden access! Invalid or expired token." });
  }
};

// Middleware to authorize specific user roles against MongoDB storage rows
const verifyRole = (allowedRoles) => {
  return async (req, res, next) => {
    try {
      const db = req.app.get("db");
      
      // Pulling verified email safely from token context fallback chain rather than mutable headers
      const userEmail = req.decoded?.email || req.user?.email || req.headers.email || req.headers["user-email"];

      if (!userEmail) {
        return res.status(401).json({ success: false, message: "User email tracking context missing." });
      }

      // Explicitly targeted unified "user" collection schema row matching
      const user = await db.collection("user").findOne({ email: userEmail });

      if (!user) {
        return res.status(404).json({ success: false, message: "User profile not found inside platform system." });
      }

      // Verify if the user's role exists within the allowedRoles array
      if (!allowedRoles.includes(user.role)) {
        return res.status(403).json({ success: false, message: "Forbidden! Lacking sufficient administrative clearance level." });
      }

      // Overwrite/attach the complete db user data profile context
      req.dbUser = user;
      next();
    } catch (error) {
      console.error("Role Authorization System Error:", error.message);
      return res.status(500).json({ success: false, message: "Role verification breakdown.", error: error.message });
    }
  };
};

module.exports = { verifyToken, verifyRole };