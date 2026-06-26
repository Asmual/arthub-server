const { ObjectId } = require("mongodb");

// Middleware to verify if the request contains a valid authorization structure
const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
   
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Unauthorized access! Missing token." });
    }

    const token = authHeader.split(" ")[1];
    req.userToken = token;

    next();
  } catch (error) {
    return res.status(403).json({ message: "Forbidden access! Invalid token." });
  }
};

// Middleware to authorize specific user roles against MongoDB storage rows
const verifyRole = (allowedRoles) => {
  return async (req, res, next) => {
    try {
      const db = req.app.get("db");
      const userEmail = req.headers.email || req.headers["user-email"];

      if (!userEmail) {
        return res.status(401).json({ message: "User email tracking context missing." });
      }

      // Explicitly targeted unified "user" collection schema row matching
      const user = await db.collection("user").findOne({ email: userEmail });

      if (!user) {
        return res.status(404).json({ message: "User profile not found inside platform system." });
      }

      if (!allowedRoles.includes(user.role)) {
        return res.status(403).json({ message: "Forbidden! Lacking sufficient administrative clear level." });
      }

      req.user = user;
      next();
    } catch (error) {
      return res.status(500).json({ message: "Role verification breakdown.", error: error.message });
    }
  };
};

module.exports = { verifyToken, verifyRole };