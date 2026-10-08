import { Request } from "express";
import { Collection, Db, Document } from "mongodb";

export const getCollection = <T extends Document = any>(req: Request, collectionName: string): Collection<T> => {
  const db = req.app.get("db") as Db | undefined;
  if (!db) {
    throw new Error("Database instance configuration layer missing on app context.");
  }
  return db.collection<T>(collectionName);
};

export const getUserCollection = (req: Request) => getCollection(req, "user");
export const getOrderCollection = (req: Request) => getCollection(req, "orders");
export const getArtworkCollection = (req: Request) => getCollection(req, "artworks");
export const getCommentCollection = (req: Request) => getCollection(req, "reviews");
