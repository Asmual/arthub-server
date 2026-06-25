const express = require("express");
const router  = express.Router();
const { ObjectId } = require("mongodb");
const stripe  = require("stripe")(process.env.STRIPE_SECRET_KEY);

// Helper to safely convert string IDs to MongoDB ObjectId
const toOid = (id) => {
  try { 
    return ObjectId.isValid(id) ? new ObjectId(id) : null; 
  } catch { 
    return null; 
  }
};

// Purchase limits based on user subscription tiers
const TIER_LIMITS = { free: 3, pro: 9, premium: Infinity };

/**
 * @route   POST /api/payments/create-artwork-session
 * @desc    Creates a Stripe checkout session for artwork purchases with tier validation
 */
router.post("/create-artwork-session", async (req, res) => {
  try {
    const db = req.app.get("db");
    const { userId, buyerEmail, artworkId, title, price, image } = req.body;

    if (!userId || !artworkId || !price) {
      return res.status(400).json({ message: "userId, artworkId, and price are required" });
    }

    const clientBaseUrl = process.env.CLIENT_URL || "http://localhost:3000";

    // Validate user subscription tier limits
    const oid = toOid(userId);
    const buyer = await db.collection("user").findOne({ $or: [{ _id: oid }, { id: userId }, { email: buyerEmail }] });
    const tier = buyer?.subscriptionTier || "free";
    const max = TIER_LIMITS[tier] ?? 3;

    if (max !== Infinity) {
      const count = await db.collection("orders").countDocuments({
        $or: [{ buyerId: userId }, { buyerEmail: buyerEmail }],
        status: "paid",
        type: "purchase"
      });
      if (count >= max) {
        return res.status(403).json({
          message: `Your ${tier} plan allows only ${max} purchases. Please upgrade your subscription tier.`,
          upgradeRequired: true,
        });
      }
    }

    // Initialize Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      customer_email: buyerEmail || undefined,
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: {
            name: title || "Artwork Purchase",
            images: image ? [image] : []
          },
          unit_amount: Math.round(Number(price) * 100),
        },
        quantity: 1,
      }],
      mode: "payment",
      success_url: `${clientBaseUrl.replace(/\/$/, "")}/checkout/success?session_id={CHECKOUT_SESSION_ID}&artwork_id=${artworkId}&userId=${userId}`,
      cancel_url:  `${clientBaseUrl.replace(/\/$/, "")}/checkout/cancel`,
      metadata: {
        userId,
        buyerEmail: buyerEmail || "",
        artworkId,
        type: "purchase",
        price: String(price)
      },
    });

    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error("Stripe artwork session creation failed:", err.message);
    res.status(500).json({ message: "Failed to create checkout session", error: err.message });
  }
});

/**
 * @route   POST /api/payments/create-subscription-session
 * @desc    Creates a Stripe checkout session for standard tier subscription upgrades
 */
router.post("/create-subscription-session", async (req, res) => {
  try {
    const { userId, tier } = req.body;
    const prices = { pro: 999, premium: 1999 };
    
    if (!prices[tier]) {
      return res.status(400).json({ message: "Invalid tier. Use: pro | premium" });
    }

    const clientBaseUrl = process.env.CLIENT_URL || "http://localhost:3000";

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: { name: `ArtHub ${tier.charAt(0).toUpperCase() + tier.slice(1)} Plan` },
          unit_amount: prices[tier],
        },
        quantity: 1,
      }],
      mode: "payment",
      success_url: `${clientBaseUrl.replace(/\/$/, "")}/checkout/success?session_id={CHECKOUT_SESSION_ID}&userId=${userId}&tier=${tier}`,
      cancel_url:  `${clientBaseUrl.replace(/\/$/, "")}/checkout/cancel`,
      metadata: { userId, tier, type: "subscription" },
    });

    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error("Stripe subscription session creation failed:", err.message);
    res.status(500).json({ message: "Failed to create subscription session", error: err.message });
  }
});

/**
 * @route   POST /api/payments/verify-success-order
 * @desc    Verifies Stripe payment status and updates orders and inventory datasets
 */
router.post("/verify-success-order", async (req, res) => {
  try {
    const db = req.app.get("db");
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({ message: "Session ID is required" });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (!session || session.payment_status !== "paid") {
      return res.status(400).json({ message: "Stripe verification failed or session unpaid" });
    }

    const { userId, buyerEmail, artworkId, type, price } = session.metadata;

    // Enforce idempotency to prevent duplicate transaction entries
    const existing = await db.collection("orders").findOne({ transactionId: sessionId });
    if (existing) {
      return res.json({ success: true, message: "Order already recorded", orderId: existing._id });
    }

    // Process Subscription dynamic updates
    if (type === "subscription") {
      const tier = session.metadata.tier;
      const oid = toOid(userId);
      
      await db.collection("user").updateOne(
        { $or: [{ _id: oid }, { id: userId }] },
        { $set: { subscriptionTier: tier, updatedAt: new Date() } }
      );

      const result = await db.collection("orders").insertOne({
        userId, tier, type: "subscription",
        transactionId: sessionId, status: "paid", createdAt: new Date()
      });
      
      return res.status(201).json({ success: true, message: "Subscription verified", orderId: result.insertedId });
    }

    // Process Standard Artwork asset logs
    const order = {
      artworkId,
      buyerId: userId,
      buyerEmail,
      price: Number(price),
      transactionId: sessionId,
      type: "purchase",
      status: "paid",
      createdAt: new Date(),
    };

    const result = await db.collection("orders").insertOne(order);

    // Update artwork inventory entity status to sold
    const oid = toOid(artworkId);
    await db.collection("artworks").updateOne(
      { $or: [{ _id: oid }, { _id: artworkId }] },
      { $set: { isSold: true, buyerId: userId, soldAt: new Date() } }
    );

    res.status(201).json({ success: true, message: "Order processed successfully", orderId: result.insertedId });
  } catch (err) {
    console.error("Order verification logic runtime error:", err);
    res.status(500).json({ message: "Failed to verify order payload", error: err.message });
  }
});

/**
 * @route   POST /api/payments/verify-subscription
 * @desc    Fallback processing route handler for direct subscription recording adjustments
 */
router.post("/verify-subscription", async (req, res) => {
  try {
    const db = req.app.get("db");
    const { sessionId, userId, tier } = req.body;

    const existing = await db.collection("orders").findOne({ transactionId: sessionId });
    if (existing) {
      return res.json({ success: true, message: "Subscription already recorded" });
    }

    const oid = toOid(userId);
    await db.collection("user").updateOne(
      { $or: [{ _id: oid }, { id: userId }] },
      { $set: { subscriptionTier: tier, updatedAt: new Date() } }
    );

    await db.collection("orders").insertOne({
      userId, tier, type: "subscription",
      transactionId: sessionId, status: "paid", createdAt: new Date(),
    });

    res.json({ success: true, message: `Subscription updated to ${tier}` });
  } catch (err) {
    res.status(500).json({ message: "Failed to verify subscription", error: err.message });
  }
});

/**
 * @route   GET /api/payments/history/:buyerId
 * @desc    Retrieves unified user transaction records using aggregate cross-lookup rules
 */
router.get("/history/:buyerId", async (req, res) => {
  try {
    const db = req.app.get("db");
    const { buyerId } = req.params;

    const history = await db.collection("orders").aggregate([
      {
        $match: {
          $or: [{ buyerId: buyerId }, { buyerEmail: buyerId }],
          status: "paid",
          type: "purchase"
        }
      },
      {
        $addFields: {
          artworkOid: {
            $cond: {
              if: { $regexMatch: { input: "$artworkId", regex: /^[0-9a-fA-F]{24}$/ } },
              then: { $toObjectId: "$artworkId" },
              else: null
            }
          }
        }
      },
      {
        $lookup: {
          from: "artworks",
          let: { artId: "$artworkId", artOid: "$artworkOid" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $or: [
                    { $eq: ["$_id", "$$artOid"] },
                    { $eq: ["$_id", "$$artId"] }
                  ]
                }
              }
            }
          ],
          as: "artworkDetails",
        },
      },
      { $unwind: { path: "$artworkDetails", preserveNullAndEmptyArrays: true } },
      { $sort: { createdAt: -1 } },
    ]).toArray();

    res.json(history);
  } catch (err) {
    console.error("History data query operational failure:", err);
    res.status(500).json({ message: "Failed to fetch purchase history ledger", error: err.message });
  }
});

/**
 * @route   GET /api/payments/sales/:artistId
 * @desc    Compiles item sales distribution workflows for artist dynamic pipelines
 */
router.get("/sales/:artistId", async (req, res) => {
  try {
    const db = req.app.get("db");
    const { artistId } = req.params;
    const oid = toOid(artistId);

    const artistArtworks = await db.collection("artworks").find({
      $or: [{ userId: oid }, { userId: artistId }, { artistId: oid }, { artistId }],
    }, { projection: { _id: 1 } }).toArray();

    const artworkIds = artistArtworks.map((a) => String(a._id));

    const sales = await db.collection("orders").aggregate([
      { $match: { artworkId: { $in: artworkIds }, status: "paid", type: "purchase" } },
      {
        $addFields: {
          artworkOid: {
            $cond: {
              if: { $regexMatch: { input: "$artworkId", regex: /^[0-9a-fA-F]{24}$/ } },
              then: { $toObjectId: "$artworkId" },
              else: null
            }
          }
        }
      },
      {
        $lookup: {
          from: "artworks",
          let: { artId: "$artworkId", artOid: "$artworkOid" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $or: [
                    { $eq: ["$_id", "$$artOid"] },
                    { $eq: ["$_id", "$$artId"] }
                  ]
                }
              }
            }
          ],
          as: "artworkDetails",
        },
      },
      { $unwind: { path: "$artworkDetails", preserveNullAndEmptyArrays: true } },
      { $sort: { createdAt: -1 } },
    ]).toArray();

    res.json(sales);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch sales history logs", error: err.message });
  }
});

/**
 * @route   GET /api/payments/all-transactions
 * @desc    Admin structural visibility controller retrieving all platform tracking metrics
 */
router.get("/all-transactions", async (req, res) => {
  try {
    const db = req.app.get("db");
    const transactions = await db.collection("orders")
      .find({})
      .sort({ createdAt: -1 })
      .toArray();
    res.json(transactions);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch transactions tracking registry", error: err.message });
  }
});

module.exports = router;