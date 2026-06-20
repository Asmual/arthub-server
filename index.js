const express = require('express');
const cors = require('cors');
require('dotenv').config();
const connectDB = require('./config/db');

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

async function startServer() {
  try {
    const db = await connectDB();

    app.get('/', (req, res) => {
      res.send('ArtHub Server is running... ');
    });

    const artistCollection = db.collection('artists');


  } catch (error) {
    console.error("Failed to start server:", error);
  }
}

startServer();

app.listen(port, () => {
  console.log(`Server is running on port: ${port} `);
});