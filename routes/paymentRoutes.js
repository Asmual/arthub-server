const express = require("express");
const router = express.Router();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { ObjectId } = require("mongodb");
const { verifyToken } = require("../middlewares");
const { getUserCollection, getArtworkCollection, getOrderCollection } = require("../models/collections");

/**
 * @route   GET /api/payment/all-transactions
 * @desc    Fetch comprehensive global transaction history records
 * @access  Private (JWT + Admin Role Authorization Check via Pipeline Guard)
 */
router.get("/all-transactions", verifyToken, async (req, res) => {
  try {
    const orderCollection = getOrderCollection(req);
    const userCollection = getUserCollection(req);
    
    const operationalProfile = await userCollection.findOne({ email: req.user.email });
    if (!operationalProfile || operationalProfile.role !== "admin") {
      return res.status(403).json({ success: false, message: "Forbidden: Administrative credentials mandatory." });
    }

    const transactions = await orderCollection
      .find({})
      .sort({ date: -1 })
      .toArray();

    return res.status(200).json(transactions);
  } catch (error) {
    console.error("Master Ledger Aggregation Failure:", error.message);
    return res.status(500).json({ success: false, message: "Internal server ledger tracking failure." });
  }
});

/**
 * @route   POST /api/payment/create-checkout-session
 * @desc    Initialize Stripe Dynamic Gateway checkout interface mapping session metadata payload
 * @access  Private (JWT Required)
 */
router.post("/create-checkout-session", verifyToken, async (req, res) => {
  try {
    const artworkCollection = getArtworkCollection(req);
    const { artworkId, price } = req.body;
    const userEmail = req.user.email;
    const buyerId = req.user.id; // Secure extraction from signed application JWT identity token

    if (!artworkId || !ObjectId.isValid(artworkId)) {
      return res.status(400).json({ success: false, message: "Invalid artwork reference identifier target." });
    }

    const artwork = await artworkCollection.findOne({ _id: new ObjectId(artworkId) });
    if (!artwork) {
      return res.status(404).json({ success: false, message: "Requested artwork missing from marketplace inventory." });
    }
   
    if (artwork.isSold === true) {
      return res.status(400).json({ success: false, message: "Transaction blocked: Artwork asset state is already set to Sold." });
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
              name: artwork.title || "Original Artwork Blueprint",
              images: artwork.image ? [artwork.image] : [],
              description: `Original Masterpiece processing map via ArtHub Network`,
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
        buyerId: buyerId, // MUST store application native MongoDB User ID configuration index
        buyerEmail: userEmail,
        artworkTitle: artwork.title || "Original Gallery Artwork",
        artistEmail: artwork.artistEmail || ""
      }
    });

    return res.status(200).json({ success: true, url: session.url });
  } catch (error) {
    console.error("Stripe Session Creation Failure:", error.message);
    return res.status(500).json({ success: false, message: "System core failed to securely construct checkout pipe session orchestration maps.", error: error.message });
  }
});

/**
 * @route   POST /api/payment/verify-payment-sync
 * @desc    Perform synchronous data validations post-redirection flow for client performance guarantees
 * @access  Private (JWT Required)
 */
router.post("/verify-payment-sync", verifyToken, async (req, res) => {
  const { sessionId } = req.body;
  try {
    const artworkCollection = getArtworkCollection(req);
    const orderCollection = getOrderCollection(req);
    const userCollection = getUserCollection(req);

    const session = await stripe.checkout.sessions.retrieve(sessionId);
   
    if (session.payment_status !== "paid") {
      return res.status(400).json({ success: false, message: "Unverified transaction settlement clearance profile tracked." });
    }

    const { artworkId, buyerId, buyerEmail, artistEmail, artworkTitle } = session.metadata;

    // Deduplicate transaction insertion routines
    const existingOrder = await orderCollection.findOne({ transactionId: session.id });
    if (existingOrder) {
      return res.status(200).json({ success: true, message: "Transaction maps already fully initialized and integrated inside database storage systems." });
    }

    // Flag artwork data object parameters out of public scope listings directly inside singular collection
    await artworkCollection.updateOne(
      { _id: new ObjectId(artworkId) },
      { $set: { isSold: true } }
    );

    const structuredOrderPayload = {
      transactionId: session.id,
      type: "purchase",
      artworkId: new ObjectId(artworkId),
      artworkTitle: artworkTitle,
      buyerId: buyerId, // Linked to MongoDB source of truth document configuration profile ID string
      buyerEmail: buyerEmail,
      artistEmail: artistEmail,
      amount: session.amount_total / 100,
      date: new Date()
    };

    await orderCollection.insertOne(structuredOrderPayload);

    // Dynamic increment execution paths for user purchase profiles
    await userCollection.updateOne(
      { email: buyerEmail },
      { $inc: { purchasesCount: 1 } }
    );

    return res.status(200).json({ success: true, message: "Stripe data metrics successfully integrated into application structural storage engines." });
  } catch (error) {
    console.error("Order Insertion Runtime Failure:", error.message);
    return res.status(500).json({ success: false, message: "Database ledger tracking failure mapping transaction paths.", error: error.message });
  }
});

/**
 * @route   POST /api/payment/webhook
 * @desc    Asynchronous operational failsafe handler dealing directly with raw system signals emitted from Stripe servers
 * @access  Public Gateway Configuration (Middleware Exclusion Rule Target)
 */
router.post("/webhook", async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error("Webhook Signature Verification Failed:", err.message);
    return res.status(400).send(`Webhook Error Integration Failure Sequence: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const artworkCollection = getArtworkCollection(req);
    const orderCollection = getOrderCollection(req);
    const userCollection = getUserCollection(req);

    try {
      const { artworkId, buyerId, buyerEmail, artistEmail, artworkTitle } = session.metadata;
      const existingOrder = await orderCollection.findOne({ transactionId: session.id });
     
      if (!existingOrder) {
        // Enforce inventory data state validation adjustments inside production database instances
        await artworkCollection.updateOne(
          { _id: new ObjectId(artworkId) },
          { $set: { isSold: true } }
        );

        const structuredOrderPayload = {
          transactionId: session.id,
          type: "purchase",
          artworkId: new ObjectId(artworkId),
          artworkTitle: artworkTitle,
          buyerId: buyerId,
          buyerEmail: buyerEmail,
          artistEmail: artistEmail,
          amount: session.amount_total / 100,
          date: new Date()
        };

        await orderCollection.insertOne(structuredOrderPayload);

        await userCollection.updateOne(
          { email: buyerEmail },
          { $inc: { purchasesCount: 1 } }
        );

        console.log(`Webhook Operational Broadcast Success: Order successfully tracked for transaction lifecycle index allocation ${session.id}`);
      }
    } catch (error) {
      console.error("Webhook Database Integration Pipeline Crash:", error.message);
      return res.status(500).json({ message: "Internal pipeline serialization architecture error caught during live operational state mutation." });
    }
  }

  res.json({ received: true });
});

module.exports = router;