// middlewares.js
// const { auth } = require("./auth"); // Make sure this points correctly to your BetterAuth configuration file
const { ObjectId } = require("mongodb");

const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Unauthorized: No token provided." });
    }

    const token = authHeader.split(" ")[1];
    console.log("Incoming Token:", token);

    // Verify the BetterAuth session using the session token directly
    const session = await auth.api.getSession({
      headers: {
        authorization: `Bearer ${token}`
      }
    });
    console.log("Resolved Session:", session);

    if (!session || !session.user) {
      return res.status(401).json({ message: "Unauthorized: Invalid or expired token." });
    }

    // Attach user information to the request object
    req.user = session.user;
    req.decoded = { email: session.user.email }; 
    req.session = session.session;

    next();
  } catch (err) {
    return res.status(401).json({ message: "Unauthorized: Invalid or expired token." });
  }
};

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
