const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Unauthorized: No token provided." });
    }

    const token = authHeader.split(" ")[1];
    const db = req.app.get("db");

    // Query the session collection directly using the real BetterAuth session token
    const sessionDoc = await db.collection("session").findOne({ token });
    if (!sessionDoc || new Date(sessionDoc.expiresAt) < new Date()) {
      return res.status(401).json({ message: "Unauthorized: Invalid or expired token." });
    }

    // Fetch associated user context from database
    const userDoc = await db.collection("user").findOne({ id: sessionDoc.userId });
    if (!userDoc) {
      return res.status(401).json({ message: "Unauthorized: Session user not found." });
    }

    // Attach user profile info to the request object
    req.user = { id: userDoc.id, email: userDoc.email, role: userDoc.role };
    req.decoded = req.user;
    
    next();
  } catch (err) {
    return res.status(401).json({ message: "Unauthorized: Token verification failed." });
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