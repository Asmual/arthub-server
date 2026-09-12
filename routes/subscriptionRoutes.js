const express = require("express");
const router = express.Router();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { ObjectId } = require("mongodb");
const { verifyToken, verifyRole } = require("../middlewares");

const PLAN_CONFIGS = {
  basic: {
    name: "ArtHub Basic Artist Plan",
    monthlyPrice: 10,
    yearlyPrice: 8 * 12,
    artLimit: "Up to 20 Artworks",
    limitNumber: 20,
    commission: "10% Platform Commission",
    description: "Upload up to 20 artworks, 10% platform fee, Full HD display, direct collector inquiries",
  },
  pro: {
    name: "ArtHub Pro Artist Plan",
    monthlyPrice: 20,
    yearlyPrice: 16 * 12,
    artLimit: "Up to 60 Artworks",
    limitNumber: 60,
    commission: "5% Platform Commission",
    description: "Upload up to 60 artworks, 5% platform fee, Verified Artist Badge, 2K display, priority placement",
  },
  ultimate: {
    name: "ArtHub Ultimate Studio Plan",
    monthlyPrice: 50,
    yearlyPrice: 40 * 12,
    artLimit: "Unlimited Artworks",
    limitNumber: Infinity,
    commission: "0% Platform Commission",
    description: "Unlimited artworks, 0% platform fee, Gold Master Badge, 4K display, 24/7 dedicated curator",
  },
};

const PLAN_LIMITS = {
  free: 5,
  basic: 20,
  pro: 60,
  ultimate: Infinity,
};

// Create a Stripe checkout session for artist subscriptions
router.post("/create-checkout-session", async (req, res) => {
  try {
    const { plan, interval = "monthly", email } = req.body;
    const userEmail = email || req.user?.email;

    if (!userEmail) {
      return res.status(401).json({ error: true, message: "User email is required for checkout." });
    }

    // Role check: Only Artists (and Admins) may purchase artist subscription packages
    const db = req.app.get("db");
    const user = (await db.collection("user").findOne({ email: userEmail })) ||
                 (await db.collection("users").findOne({ email: userEmail }));

    if (user && user.role !== "artist" && user.role !== "admin") {
      return res.status(403).json({
        error: true,
        requiresArtistUpgrade: true,
        message: "Subscription packages are exclusively for Artist accounts. Please upgrade your account to an Artist profile before purchasing.",
      });
    }

    const normalizedPlan = (plan || "").toLowerCase();
    const config = PLAN_CONFIGS[normalizedPlan];

    if (!config) {
      return res.status(400).json({ error: true, message: "Invalid subscription plan selected." });
    }

    const priceInDollars = interval === "yearly" ? config.yearlyPrice : config.monthlyPrice;
    const unitAmountCents = Math.round(priceInDollars * 100);

    const clientBaseUrl = (
      process.env.CLIENT_URL ||
      process.env.BETTER_AUTH_URL ||
      "http://localhost:3000"
    ).replace(/\/$/, "");

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      customer_email: userEmail,
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `${config.name} (${interval === "yearly" ? "Annual" : "Monthly"})`,
              description: config.description,
              images: [
                "https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?auto=format&fit=crop&w=800&q=80",
              ],
            },
            unit_amount: unitAmountCents,
          },
          quantity: 1,
        },
      ],
      success_url: `${clientBaseUrl}/pricing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${clientBaseUrl}/pricing/checkout?plan=${normalizedPlan}&interval=${interval}&canceled=true`,
      metadata: {
        type: "artist_subscription",
        plan: normalizedPlan,
        interval,
        artistEmail: userEmail,
        amount: String(priceInDollars),
        artLimit: config.artLimit,
      },
    });

    return res.status(200).json({
      success: true,
      url: session.url,
      sessionId: session.id,
    });
  } catch (error) {
    console.error("[SERVER SUBSCRIPTION ERROR] create-checkout-session:", error);
    return res.status(500).json({ error: true, message: error.message });
  }
});

// Verify and synchronize Stripe subscription payment
router.post("/verify-session", async (req, res) => {
  const { sessionId } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: true, message: "Missing sessionId parameter." });
  }

  try {
    const db = req.app.get("db");
    const userCollection = db.collection("user");
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== "paid") {
      return res.status(400).json({ error: true, message: "Payment has not been completed." });
    }

    const { plan, interval, artistEmail, amount, artLimit } = session.metadata || {};

    if (!plan || !artistEmail) {
      return res.status(400).json({ error: true, message: "Invalid session metadata." });
    }

    const durationDays = interval === "yearly" ? 365 : 30;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const subscriptionRecord = {
      plan: plan.toLowerCase(),
      status: "active",
      interval: interval || "monthly",
      amount: Number(amount || 0),
      artLimit: artLimit || (plan === "ultimate" ? "Unlimited" : plan === "pro" ? 60 : 20),
      stripeSessionId: sessionId,
      stripePaymentIntent: session.payment_intent || null,
      customerEmail: artistEmail,
      activatedAt: now,
      expiresAt: expiresAt,
      updatedAt: now,
    };

    await userCollection.updateOne(
      { email: artistEmail },
      {
        $set: {
          role: "artist",
          plan: plan.toLowerCase(),
          subscription: subscriptionRecord,
          subscriptionTier: plan.toLowerCase(),
          updatedAt: now,
        },
      }
    );

    // Also update users collection if present
    const usersCol = db.collection("users");
    if (usersCol) {
      await usersCol.updateOne(
        { email: artistEmail },
        {
          $set: {
            role: "artist",
            plan: plan.toLowerCase(),
            subscription: subscriptionRecord,
            subscriptionTier: plan.toLowerCase(),
            updatedAt: now,
          },
        }
      );
    }

    // Insert into subscriptions ledger
    await db.collection("subscriptions").insertOne({
      ...subscriptionRecord,
      createdAt: now,
    });

    return res.status(200).json({
      success: true,
      message: "Subscription verified and activated successfully.",
      plan: plan.toLowerCase(),
      subscription: subscriptionRecord,
    });
  } catch (error) {
    console.error("[SERVER SUBSCRIPTION ERROR] verify-session:", error);
    return res.status(500).json({ error: true, message: error.message });
  }
});

// Fetch current subscription status & quota for an artist
router.get("/", async (req, res) => {
  try {
    const db = req.app.get("db");
    const email = req.query.email || req.user?.email;

    if (!email) {
      return res.status(400).json({ error: true, message: "Email parameter required." });
    }

    const user = await db.collection("user").findOne({ email }) ||
                 await db.collection("users").findOne({ email });

    const plan = (user?.plan || user?.subscription?.plan || user?.subscriptionTier || "free").toLowerCase();
    const limit = PLAN_LIMITS[plan] ?? 5;

    const artworkCount = await db.collection("artworks").countDocuments({
      $or: [
        { artistEmail: email },
        { userEmail: email },
        { email: email },
      ],
    });

    const isUnlimited = limit === Infinity;
    const canUploadMore = isUnlimited || artworkCount < limit;

    return res.status(200).json({
      success: true,
      email,
      plan,
      artworkLimit: isUnlimited ? "Unlimited" : limit,
      limitNumber: limit,
      artworkCount,
      remainingSlots: isUnlimited ? "Unlimited" : Math.max(0, limit - artworkCount),
      canUploadMore,
      subscription: user?.subscription || {
        plan: "free",
        status: "active",
        price: 0,
      },
    });
  } catch (error) {
    console.error("[SERVER SUBSCRIPTION ERROR] get status:", error);
    return res.status(500).json({ error: true, message: error.message });
  }
});

// Admin Route: Get all subscriptions with quota usage
router.get("/admin", async (req, res) => {
  try {
    const db = req.app.get("db");
    const users = await db.collection("user").find({}, { projection: { password: 0 } }).toArray();
    const artworks = await db.collection("artworks").find({}).toArray();

    const countMap = {};
    artworks.forEach((art) => {
      const email = art.artistEmail || art.userEmail || art.email;
      if (email) countMap[email] = (countMap[email] || 0) + 1;
    });

    const enriched = users.map((u) => {
      const plan = (u.plan || u.subscription?.plan || u.subscriptionTier || "free").toLowerCase();
      const limit = PLAN_LIMITS[plan] ?? 5;
      const count = countMap[u.email] || 0;

      return {
        _id: u._id?.toString(),
        name: u.name || "ArtHub User",
        email: u.email,
        role: u.role || "user",
        image: u.image,
        plan,
        artworkLimit: limit === Infinity ? "Unlimited" : limit,
        limitNumber: limit,
        artworkCount: count,
        status: u.subscription?.status || "active",
        subscription: u.subscription || null,
        createdAt: u.createdAt,
      };
    });

    return res.status(200).json({ success: true, subscriptions: enriched });
  } catch (error) {
    console.error("[SERVER SUBSCRIPTION ERROR] admin list:", error);
    return res.status(500).json({ error: true, message: error.message });
  }
});

// Admin Route: Update or cancel artist subscription
router.put("/admin", async (req, res) => {
  try {
    const db = req.app.get("db");
    const { email, plan, action, status } = req.body;

    if (!email) {
      return res.status(400).json({ error: true, message: "Email required." });
    }

    const now = new Date();
    let targetPlan = plan ? plan.toLowerCase() : undefined;
    let targetStatus = status || "active";

    if (action === "unsubscribe" || action === "cancel") {
      targetPlan = "free";
      targetStatus = "canceled";
    } else if (action === "suspend" || action === "block") {
      targetStatus = "suspended";
    } else if (action === "reactivate") {
      targetStatus = "active";
    }

    const updateFields = {
      updatedAt: now,
    };

    if (targetPlan) {
      updateFields.plan = targetPlan;
      updateFields.subscriptionTier = targetPlan;
    }

    const currentSub = (await db.collection("user").findOne({ email }))?.subscription || {};
    updateFields.subscription = {
      ...currentSub,
      plan: targetPlan || currentSub.plan || "free",
      status: targetStatus,
      updatedAt: now,
    };

    await db.collection("user").updateOne({ email }, { $set: updateFields });
    await db.collection("users").updateOne({ email }, { $set: updateFields });

    return res.status(200).json({
      success: true,
      message: "Subscription updated successfully.",
      email,
      plan: updateFields.plan,
      status: targetStatus,
    });
  } catch (error) {
    console.error("[SERVER SUBSCRIPTION ERROR] admin update:", error);
    return res.status(500).json({ error: true, message: error.message });
  }
});

module.exports = router;
