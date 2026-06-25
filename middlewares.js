// backend/middlewares/authMiddleware.js
const { ObjectId } = require("mongodb");

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


const verifyRole = (allowedRoles) => {
  return async (req, res, next) => {
    try {
      const db = req.app.get("db");
      
      const userEmail = req.headers.email; 

      if (!userEmail) {
        return res.status(401).json({ message: "User email tracking context missing." });
      }

      const user = await db.collection("user").findOne({ email: userEmail });

      if (!user || !allowedRoles.includes(user.role)) {
        return res.status(403).json({ message: "Forbidden! You do not have permission to view this data." });
      }

      req.user = user;
      next();
    } catch (error) {
      return res.status(500).json({ message: "Role verification breakdown.", error: error.message });
    }
  };
};

module.exports = { verifyToken, verifyRole };