/**
 * Global database collection registry helper for Native MongoDB Driver.
 * Ensures consistent collection names matching the production database architecture.
 */
const getCollection = (req, collectionName) => {
  const db = req.app.get("db");
  if (!db) {
    throw new Error("Database instance configuration layer missing on app context.");
  }
  return db.collection(collectionName);
};

module.exports = {
  getUserCollection: (req) => getCollection(req, "user"),
  getOrderCollection: (req) => getCollection(req, "orders"),
  getArtworkCollection: (req) => getCollection(req, "artworks"),
  getCommentCollection: (req) => getCollection(req, "reviews"),
};