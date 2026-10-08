import { MongoClient, ServerApiVersion, Db } from "mongodb";
import dotenv from "dotenv";
import dns from "node:dns";

dotenv.config();

dns.setServers(["1.1.1.1", "8.8.8.8"]);

const uri = process.env.MONGODB_URI;

if (!uri) {
  console.error("MONGODB_URI is not defined in environment variables!");
}

const client = new MongoClient(uri || "", {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

export async function connectDB(): Promise<Db> {
  try {
    await client.connect();
    const db = client.db("artHub");
    return db;
  } catch (error) {
    console.error("MongoDB Connection Failed!", error);
    process.exit(1);
  }
}

export default connectDB;
