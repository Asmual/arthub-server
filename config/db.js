const { MongoClient, ServerApiVersion } = require('mongodb');
require('dotenv').config();

const dns = require('node:dns');

dns.setServers(["1.1.1.1", "8.8.8.8"]);

const uri = process.env.MONGODB_URI; 

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function connectDB() {
  try {
    await client.connect();
    console.log("MongoDB Connected Successfully! ");
    
    const db = client.db("artHub"); 
    return db;
  } catch (error) {
    console.error("MongoDB Connection Failed!", error);
    process.exit(1);
  }
}

module.exports = connectDB;