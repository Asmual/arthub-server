import { ObjectId } from "mongodb";
import { Request } from "express";

export interface AuthUser {
  id?: string;
  _id?: ObjectId | string;
  email: string;
  role: "user" | "artist" | "admin" | "buyer" | string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

export interface UserDoc {
  _id?: ObjectId | string;
  id?: string;
  name?: string;
  email: string;
  role?: string;
  image?: string;
  bio?: string;
  location?: string;
  phone?: string;
  status?: "active" | "suspended" | string;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

export interface ArtworkDoc {
  _id?: ObjectId | string;
  title: string;
  description?: string;
  artistName?: string;
  artistEmail: string;
  artistId?: string;
  price: number;
  category: string;
  image: string;
  stock?: number;
  soldCount?: number;
  isFeatured?: boolean;
  featured?: boolean;
  tags?: string[];
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

export interface OrderDoc {
  _id?: ObjectId | string;
  artworkId: ObjectId | string | null;
  buyerId: string;
  buyerEmail: string;
  artistEmail: string;
  artworkTitle: string;
  amount: number;
  transactionId: string;
  status: "paid" | "failed" | "pending";
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

export interface ReviewDoc {
  _id?: ObjectId | string;
  artworkId: ObjectId | string;
  userEmail: string;
  userName?: string;
  userImage?: string;
  rating: number;
  comment: string;
  createdAt?: Date | string;
}

export interface SubscriptionDoc {
  _id?: ObjectId | string;
  userEmail: string;
  userId?: string;
  plan: string;
  status: "active" | "canceled" | "expired" | string;
  startDate?: Date | string;
  endDate?: Date | string;
  stripeSessionId?: string;
  createdAt?: Date | string;
}
