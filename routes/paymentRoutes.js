const express = require("express");
const router = express.Router();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { ObjectId } = require("mongodb");
const { verifyToken } = require("../middlewares");

// Safe Import Handling: Supports both object destructuring and raw fallback imports
const orderModule = require("../models/Order");
const prepareOrderData = typeof orderModule === "function"
  ? orderModule
  : (orderModule.prepareOrderData || orderModule.default);

// -------------------------------------------------------------------------
// GET: Fetch all checkout orders from 'orders' collection (Admin Access Only)
// Route resolves to: GET /api/payment/all-transactions
// -------------------------------------------------------------------------
router.get("/all-transactions", verifyToken, async (req, res) => {
  try {
    const db = req.app.get("db");
    
    // Fallback chain to catch email from any token context or raw header safely
    const userEmail = req.user?.email || req.decoded?.email || req.headers.email;

    if (!userEmail) {
      return res.status(401).json({ success: false, message: "Unauthorized. User identity context missing." });
    }

    // Validate if requesting entity holds administrative clearance
    const requestingUser = await db.collection("user").findOne({ email: userEmail });
    if (!requestingUser || requestingUser.role !== "admin") {
      return res.status(403).json({ success: false, message: "Forbidden. Administrative privileges required." });
    }

    // Fetch transactions sorted from newest to oldest
    const transactions = await db.collection("orders")
      .find({})
      .sort({ _id: -1 })
      .toArray();

    return res.status(200).json(transactions);
  } catch (error) {
    console.error("Master Ledger Aggregation Failure:", error.message);
    return res.status(500).json({ success: false, message: "Internal server ledger tracking failure." });
  }
});

// -------------------------------------------------------------------------
// POST: Initialize Stripe Dynamic Checkout Session Safely
// Route resolves to: POST /api/payment/create-checkout-session
// -------------------------------------------------------------------------
router.post("/create-checkout-session", verifyToken, async (req, res) => {
  try {
    const db = req.app.get("db");
    const { artworkId, price } = req.body;
    const userEmail = req.headers.email || req.headers["user-email"] || req.body.userEmail || req.user?.email;

    if (!userEmail) {
      return res.status(400).json({ success: false, message: "User email tracking context missing." });
    }

    if (!artworkId || !ObjectId.isValid(artworkId)) {
      return res.status(400).json({ success: false, message: "Invalid artwork reference identifier." });
    }

    const artwork = await db.collection("artworks").findOne({ _id: new ObjectId(artworkId) });
    if (!artwork) {
      return res.status(404).json({ success: false, message: "Requested artwork missing from database." });
    }
   
    if (artwork.status === "Sold" || artwork.isSold) {
      return res.status(400).json({ success: false, message: "Transaction blocked. Artwork already sold." });
    }

    const clientBaseUrl = process.env.CLIENT_URL || "http://localhost:3000";

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      customer_email: userEmail,
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: artwork.title || "Original Artwork",
              images: artwork.image ? [artwork.image] : [],
              description: `Original Artwork Purchase from ArtHub Marketplace`,
            },
            unit_amount: Math.round(Number(price || artwork.price) * 100),
          },
          quantity: 1,
        },
      ],
      success_url: `${clientBaseUrl}/dashboard/user?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${clientBaseUrl}/artwork/${artworkId}`,
      metadata: {
        artworkId: artworkId.toString(),
        buyerEmail: userEmail,
        artistEmail: artwork.artistEmail || artwork.userEmail || ""
      }
    });

    return res.status(200).json({ success: true, url: session.url });
  } catch (error) {
    console.error("Stripe Session Creation Failure:", error.message);
    return res.status(500).json({ success: false, message: "System gateway failed to initialize.", error: error.message });
  }
});

// -------------------------------------------------------------------------
// POST: Standardized verification endpoint syncing successful Stripe sessions
// Route resolves to: POST /api/payment/verify-payment-sync
// -------------------------------------------------------------------------
router.post("/verify-payment-sync", verifyToken, async (req, res) => {
  const { sessionId } = req.body;
  try {
    const db = req.app.get("db");
   
    const session = await stripe.checkout.sessions.retrieve(sessionId);
   
    if (session.payment_status !== "paid") {
      return res.status(400).json({ success: false, message: "Unverified transaction clearance profile." });
    }

    const { artworkId, buyerEmail, artistEmail } = session.metadata;

    const artwork = await db.collection("artworks").findOne({ _id: new ObjectId(artworkId) });

    await db.collection("artworks").updateOne(
      { _id: new ObjectId(artworkId) },
      { $set: { status: "Sold", isPublished: false } }
    );

    if (typeof prepareOrderData !== "function") {
      throw new Error("System runtime failure: prepareOrderData compilation target is not available.");
    }

    const structuredOrderPayload = prepareOrderData({
      artworkId: artworkId,
      artworkTitle: artwork ? artwork.title : "Original Gallery Artwork",
      buyerId: session.customer || `cust_${new ObjectId().toString()}`,
      buyerEmail: buyerEmail || session.customer_details?.email,
      price: session.amount_total / 100,
      transactionId: session.id,
      type: "purchase",
      status: "paid"
    });

    await db.collection("orders").insertOne(structuredOrderPayload);

    await db.collection("user").updateOne(
      { email: buyerEmail },
      { $inc: { purchasesCount: 1 } }
    );

    return res.status(200).json({ success: true, message: "Stripe data mapped to orders collection successfully." });
  } catch (error) {
    console.error("Order Insertion Runtime Failure:", error.message);
    return res.status(500).json({ success: false, message: "Database ledger tracking failure.", error: error.message });
  }
});

// -------------------------------------------------------------------------
// POST: Stripe Webhook Listener (Handles direct events from Stripe)
// Route resolves to: POST /api/payment/webhook
// -------------------------------------------------------------------------
router.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error("Webhook Signature Verification Failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const db = req.app.get("db");

    try {
      const { artworkId, buyerEmail } = session.metadata;

      // 1. Check if the order already exists to prevent duplication
      const existingOrder = await db.collection("orders").findOne({ transactionId: session.id });
     
      if (!existingOrder) {
        const artwork = await db.collection("artworks").findOne({ _id: new ObjectId(artworkId) });

        // 2. Mark artwork as sold
        await db.collection("artworks").updateOne(
          { _id: new ObjectId(artworkId) },
          { $set: { status: "Sold", isPublished: false } }
        );

        // 3. Format and insert data into orders collection
        const structuredOrderPayload = prepareOrderData({
          artworkId: artworkId,
          artworkTitle: artwork ? artwork.title : "Original Gallery Artwork",
          buyerId: session.customer || `cust_${new ObjectId().toString()}`,
          buyerEmail: buyerEmail || session.customer_details?.email,
          price: session.amount_total / 100,
          transactionId: session.id,
          type: "purchase",
          status: "paid"
        });

        await db.collection("orders").insertOne(structuredOrderPayload);

        // 4. Update buyer purchase count
        await db.collection("user").updateOne(
          { email: buyerEmail },
          { $inc: { purchasesCount: 1 } }
        );

        console.log(`Webhook Success: Order successfully saved for session ${session.id}`);
      }
    } catch (error) {
      console.error("Webhook Database Error:", error.message);
      return res.status(500).json({ message: "Internal server error during database update." });
    }
  }

  res.json({ received: true });
});

module.exports = router;