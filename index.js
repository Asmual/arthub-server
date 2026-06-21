const express = require('express');
const cors = require('cors');
require('dotenv').config();
const connectDB = require('./config/db');

const app = express();
const port = process.env.PORT || 5000;

app.use(cors({
  origin: true, 
  credentials: true
}));

app.use(express.json());

async function startServer() {
  try {
    const db = await connectDB();
    console.log("MongoDB Connected Successfully!");

    app.set('db', db);

    app.get('/', (req, res) => {
      res.send('ArtHub Server is running...');
    });

    // API Route Mounts
    const artistRoutes = require('./routes/artistRoutes');
    app.use('/api/artists', artistRoutes);

    const artworkRoutes = require('./routes/artworkRoutes');
    app.use('/api/artworks', artworkRoutes);

    const reviewRoutes = require('./routes/reviewRoutes');
    app.use('/api/reviews', reviewRoutes);

    app.listen(port, () => {
      console.log(`Server is running on port: ${port}`);
    });

  } catch (error) {
    console.error("Failed to start server:", error);
  }
}

startServer();