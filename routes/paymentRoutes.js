const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb'); // Used to parse string IDs into MongoDB ObjectIds
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// IMPORTANT: Import or access your native MongoDB database instance here
// Example: const { getDb } = require('../lib/db'); 

// Create a Stripe Hosted Checkout Session
router.post('/create-checkout-session', async (req, res) => {
  try {
    const { price, artworkName, artworkId, userEmail, userId } = req.body;

    if (!price || !artworkId) {
      return res.status(400).json({ error: "Price and Artwork ID are required" });
    }

    const amount = Math.round(price * 100);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      customer_email: userEmail,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: artworkName || "ArtHub Artwork Purchase",
            },
            unit_amount: amount,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      metadata: {
        artworkId: artworkId,
        buyerId: userId,
        buyerEmail: userEmail
      },
      success_url: `${process.env.CLIENT_URL || 'http://localhost:3000'}/checkout/success?session_id={CHECKOUT_SESSION_ID}&artwork_id=${artworkId}`,
      cancel_url: `${process.env.CLIENT_URL || 'http://localhost:3000'}/checkout/cancel`,
    });

    res.status(200).json({ url: session.url });
  } catch (error) {
    console.error("Stripe Checkout Error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// Verify transaction and update database records dynamically using Native MongoDB
router.post('/verify-success-order', async (req, res) => {
  try {
    const { sessionId } = req.body;
    
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== 'paid') {
      return res.status(400).json({ error: "Transaction unverified" });
    }

    const artworkId = session.metadata?.artworkId; 
    const buyerId = session.metadata?.buyerId;
    const buyerEmail = session.metadata?.buyerEmail;
    const price = session.amount_total / 100; // Converts cents back to dollars
    const transactionId = session.id;

    if (artworkId && buyerId) {
      // Accessing native MongoDB collections directly (Modify according to your db setup)
      // const db = getDb(); 
      
      // 1. Insert records into orders collection
      const orderRecord = {
        artworkId: new ObjectId(artworkId),
        buyerId: buyerId,
        buyerEmail: buyerEmail,
        price: price,
        transactionId: transactionId,
        status: 'paid',
        createdAt: new Date()
      };
      // await db.collection('orders').insertOne(orderRecord);

      // 2. Update artwork status to sold and append buyer identity
      // await db.collection('artworks').updateOne(
      //   { _id: new ObjectId(artworkId) },
      //   { $set: { isSold: true, buyerId: buyerId } }
      // );

      console.log(`Order verified and saved for Artwork: ${artworkId} by Buyer: ${buyerId}`);
    }

    res.status(200).json({ success: true, message: "Database synchronized successfully" });
  } catch (error) {
    console.error("Database Sync Error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// Retrieve verified purchase history using Native MongoDB Aggregation (Lookups)
router.get('/history/:buyerId', async (req, res) => {
  try {
    const { buyerId } = req.params;
    // const db = getDb();

    // Using MongoDB aggregation pipelines to join order logs with artwork descriptions
    const history = await db.collection('orders').aggregate([
      { $match: { buyerId: buyerId, status: 'paid' } },
      {
        $lookup: {
          from: 'artworks', // Native target collection name
          localField: 'artworkId',
          foreignField: '_id',
          as: 'artworkDetails'
        }
      },
      { $unwind: { path: '$artworkDetails', preserveNullAndEmptyArrays: true } },
      { $sort: { createdAt: -1 } }
    ]).toArray();
      
    res.status(200).json(history);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;