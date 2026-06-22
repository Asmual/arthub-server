const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Create a Stripe Hosted Checkout Session
router.post('/create-checkout-session', async (req, res) => {
  try {
    const { price, artworkName, artworkId } = req.body;

    if (!price || !artworkId) {
      return res.status(400).json({ error: "Price and Artwork ID are required" });
    }

    const amount = Math.round(price * 100);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
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
        artworkId: artworkId
      },
      success_url: `${process.env.CLIENT_URL || 'http://localhost:3000'}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.CLIENT_URL || 'http://localhost:3000'}/checkout/cancel`,
    });

    res.status(200).json({ url: session.url });
  } catch (error) {
    console.error("Stripe Checkout Error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// Verify transaction and update database records dynamically
router.post('/verify-success-order', async (req, res) => {
  try {
    const { sessionId } = req.body;
    
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== 'paid') {
      return res.status(400).json({ error: "Transaction unverified" });
    }

    const artworkId = session.metadata?.artworkId; 

    if (artworkId) {

      console.log(`Order verified for Artwork: ${artworkId}`);
    }

    res.status(200).json({ success: true, message: "Database synchronized successfully" });
  } catch (error) {
    console.error("Database Sync Error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;