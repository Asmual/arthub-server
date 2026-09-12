const express = require("express");
const router = express.Router();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");
const { verifyToken, verifyRole } = require("../middlewares");

const CANDIDATE_SECRETS = Array.from(
  new Set(
    [
      process.env.JWT_SECRET,
      process.env.BETTER_AUTH_SECRET,
      "092de91c49c4ac4973f345857cc126380d4de54870b543d9131e5a8d288d5629",
      "h7HenqE4kAgeZTyX4Ue2AWO4ZxedhRyp",
    ].filter(Boolean)
  )
);

// Helper to safely convert string ID to MongoDB ObjectId
const toOid = (id) => {
  try {
    return ObjectId.isValid(id) ? new ObjectId(id) : null;
  } catch {
    return null;
  }
};

// Helper to validate external image URLs for Stripe
const isValidStripeImageUrl = (url) => {
  if (!url || typeof url !== "string") return false;
  const urlRegex = /^https:\/\/[a-zA-Z0-9-_.]+\.[a-zA-Z]{2,}\/.*\.(jpg|jpeg|png|webp|gif|svg)(\?.*)?$/i;
  return urlRegex.test(url) && !url.includes("localhost") && !url.includes("127.0.0.1");
};

// Resilient helper to resolve user identity from Header JWT or Request Body
const resolveCheckoutUser = async (req) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.split(" ")[1];
    for (const secret of CANDIDATE_SECRETS) {
      try {
        const decoded = jwt.verify(token, secret);
        if (decoded) return decoded;
      } catch {
        // Try next secret
      }
    }
    const decoded = jwt.decode(token);
    if (decoded && decoded.email) return decoded;
  }

  // Fallback to email in request body
  const bodyEmail = (req.body?.email || "").trim().toLowerCase();
  if (bodyEmail && bodyEmail.includes("@")) {
    const db = req.app.get("db");
    if (db) {
      let userDoc = await db.collection("user").findOne({ email: bodyEmail });
      if (!userDoc) {
        userDoc = await db.collection("users").findOne({ email: bodyEmail });
      }
      if (userDoc) {
        return {
          id: userDoc._id?.toString() || userDoc.id,
          email: userDoc.email,
          role: userDoc.role || "user",
          name: userDoc.name || "",
        };
      }
    }
    return { email: bodyEmail, role: "user" };
  }

  return null;
};

// Create a Stripe checkout session
router.post("/create-checkout-session", async (req, res) => {
  try {
    const db = req.app.get("db");
    const artworkCollection = db.collection("artworks");
    const { artworkId, price, name, email, phone } = req.body;

    const authenticatedUser = (await resolveCheckoutUser(req)) || {};
    const userEmail = (email && typeof email === "string" && email.includes("@"))
      ? email.trim()
      : authenticatedUser.email;
    const buyerId = authenticatedUser.id || authenticatedUser._id?.toString() || "";

    if (!userEmail) {
      return res.status(400).json({ success: false, message: "Valid email is required to proceed with checkout." });
    }

    if (!artworkId || !ObjectId.isValid(artworkId)) {
      return res.status(400).json({ success: false, message: "Invalid artwork ID." });
    }

    const artwork = await artworkCollection.findOne({ _id: new ObjectId(artworkId) });
    if (!artwork) {
      return res.status(404).json({ success: false, message: "Artwork not found in inventory." });
    }

    if (artwork.isSold) {
      return res.status(400).json({ success: false, message: "This artwork has already been sold." });
    }

    const artistEmail = (artwork.artistEmail || artwork.userEmail || "").trim().toLowerCase();
    const artistId = artwork.userId?.toString() || artwork.artistId?.toString();
    if (userEmail && artistEmail && userEmail.toLowerCase() === artistEmail) {
      return res.status(400).json({ success: false, message: "Artists cannot purchase their own artwork." });
    }
    if (buyerId && artistId && buyerId === artistId) {
      return res.status(400).json({ success: false, message: "Artists cannot purchase their own artwork." });
    }

    const clientBaseUrl = (
      process.env.CLIENT_URL ||
      process.env.BETTER_AUTH_URL ||
      "http://localhost:3000"
    ).replace(/\/$/, "");

    const productData = {
      name: artwork.title || "Original Artwork",
      description: artwork.category ? `Category: ${artwork.category}` : "Original ArtHub Piece",
    };

    if (artwork.image && isValidStripeImageUrl(artwork.image)) {
      productData.images = [artwork.image];
    }

    const sessionAmount = Math.round(Number(price || artwork.price) * 100);
    if (isNaN(sessionAmount) || sessionAmount <= 0) {
      return res.status(400).json({ success: false, message: "Invalid artwork price amount." });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      customer_email: userEmail,
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: productData,
            unit_amount: sessionAmount,
          },
          quantity: 1,
        },
      ],
      success_url: `${clientBaseUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${clientBaseUrl}/checkout/cancel?artworkId=${artworkId}`,
      metadata: {
        artworkId: artworkId.toString(),
        buyerId: buyerId ? buyerId.toString() : "",
        buyerEmail: userEmail,
        buyerName: name?.trim() || authenticatedUser.name || "",
        buyerPhone: phone?.trim() || "",
        artworkTitle: artwork.title || "Original Artwork",
        artistEmail: artistEmail,
        price: String(price || artwork.price),
      },
    });

    return res.status(200).json({ success: true, url: session.url, sessionId: session.id });
  } catch (error) {
    console.error("[PAYMENT ERROR] Create checkout session error:", error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// Verify and synchronize Stripe checkout session payment
router.post("/verify-payment-sync", async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) {
    return res.status(400).json({ success: false, message: "Missing sessionId parameter." });
  }

  try {
    const db = req.app.get("db");
    const orderCollection = db.collection("orders");
    const userCollection = db.collection("user");
    const artworkCollection = db.collection("artworks");

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== "paid") {
      return res.status(400).json({ success: false, message: "Payment has not been completed." });
    }

    const { artworkId, buyerId, buyerEmail, artistEmail, artworkTitle } = session.metadata || {};

    const existingOrder = await orderCollection.findOne({ transactionId: session.id });
    if (existingOrder) {
      return res.status(200).json({ success: true, data: existingOrder, message: "Order already verified and registered." });
    }

    const artworkOid = toOid(artworkId);
    const artworkDoc = artworkOid
      ? await artworkCollection.findOne({ $or: [{ _id: artworkOid }, { _id: artworkId }] })
      : await artworkCollection.findOne({ _id: artworkId });

    const finalArtistEmail = (artistEmail || artworkDoc?.artistEmail || artworkDoc?.userEmail || "").trim().toLowerCase();
    const finalBuyerEmail = (buyerEmail || session.customer_email || req.user?.email || "").trim().toLowerCase();
    const resolvedBuyerId = toOid(buyerId) || toOid(req.user?.id) || buyerId || req.user?.id || null;

    const structuredOrderPayload = {
      transactionId: session.id,
      type: "purchase",
      artworkId: artworkDoc ? artworkDoc._id : (artworkOid || artworkId),
      artworkTitle: artworkTitle || artworkDoc?.title || "Original Artwork",
      artworkImage: artworkDoc?.image || "",
      artworkDetails: artworkDoc ? {
        _id: artworkDoc._id,
        title: artworkDoc.title,
        image: artworkDoc.image,
        price: artworkDoc.price,
        category: artworkDoc.category,
        artistName: artworkDoc.artistName || artworkDoc.artist?.name,
        artistEmail: finalArtistEmail,
      } : null,
      buyerId: resolvedBuyerId,
      buyerEmail: finalBuyerEmail,
      artistEmail: finalArtistEmail,
      amount: session.amount_total / 100,
      price: session.amount_total / 100,
      currency: session.currency || "usd",
      status: "paid",
      paymentMethod: session.payment_method_types?.[0] || "card",
      date: new Date(),
      createdAt: new Date(),
    };

    await orderCollection.insertOne(structuredOrderPayload);

    // Update buyer purchase counter
    if (finalBuyerEmail) {
      await userCollection.updateOne(
        { email: finalBuyerEmail },
        { $inc: { purchasesCount: 1 } }
      );
    }

    // Decrement artwork stock and update status
    if (artworkDoc) {
      const currentQty = typeof artworkDoc.quantity === "number" ? artworkDoc.quantity : 1;
      const newQty = Math.max(0, currentQty - 1);
      await artworkCollection.updateOne(
        { _id: artworkDoc._id },
        {
          $set: {
            quantity: newQty,
            isSold: newQty === 0,
            buyerId: resolvedBuyerId,
            buyerEmail: finalBuyerEmail,
            soldAt: new Date(),
            updatedAt: new Date(),
          },
        }
      );
    }

    // Increment artist sales counter
    if (finalArtistEmail) {
      await userCollection.updateOne(
        { email: finalArtistEmail },
        { $inc: { totalSold: 1 } }
      );
    }

    return res.status(200).json({
      success: true,
      data: structuredOrderPayload,
      message: "Payment verified and order created successfully.",
    });
  } catch (error) {
    console.error("[PAYMENT ERROR] Verify payment sync error:", error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// Retrieve order details by Stripe session ID
router.get("/session/:sessionId", verifyToken, async (req, res) => {
  try {
    const db = req.app.get("db");
    const orderCollection = db.collection("orders");
    const { sessionId } = req.params;

    const order = await orderCollection.findOne({ transactionId: sessionId });
    if (order) {
      return res.status(200).json({ success: true, data: order });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (!session) {
      return res.status(404).json({ success: false, message: "Checkout session not found." });
    }

    return res.status(200).json({
      success: true,
      data: {
        transactionId: session.id,
        amount: session.amount_total / 100,
        currency: session.currency,
        status: session.payment_status,
        metadata: session.metadata,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// Fetch purchase orders for the authenticated buyer
router.get("/my-orders", verifyToken, async (req, res) => {
  try {
    const db = req.app.get("db");
    const orderCollection = db.collection("orders");
    const userEmail = req.user.email?.toLowerCase();
    const userId = req.user.id || req.user._id?.toString();
    const userOid = toOid(userId);

    const query = {
      $or: [
        { buyerEmail: userEmail },
        ...(userOid ? [{ buyerId: userOid }] : []),
        ...(userId ? [{ buyerId: userId }] : []),
      ],
    };

    const orders = await orderCollection
      .find(query)
      .sort({ date: -1, createdAt: -1 })
      .toArray();

    return res.status(200).json({ success: true, data: orders, orders });
  } catch (error) {
    console.error("[PAYMENT ERROR] Fetch my-orders error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to retrieve order history." });
  }
});

// Fetch purchase history by user identifier
router.get("/history/:userIdentifier", verifyToken, async (req, res) => {
  try {
    const db = req.app.get("db");
    const orderCollection = db.collection("orders");
    const { userIdentifier } = req.params;
    const identifierOid = toOid(userIdentifier);

    const query = {
      $or: [
        { buyerEmail: userIdentifier.toLowerCase() },
        { buyerEmail: req.user.email?.toLowerCase() },
        ...(identifierOid ? [{ buyerId: identifierOid }] : []),
        { buyerId: userIdentifier },
      ],
    };

    const orders = await orderCollection
      .find(query)
      .sort({ date: -1, createdAt: -1 })
      .toArray();

    return res.status(200).json({ success: true, data: orders, orders });
  } catch (error) {
    console.error("[PAYMENT ERROR] Fetch history error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to retrieve purchase history." });
  }
});

// Fetch sales orders for the authenticated artist
router.get("/my-sales", verifyToken, verifyRole(["artist", "admin"]), async (req, res) => {
  try {
    const db = req.app.get("db");
    const orderCollection = db.collection("orders");
    const artistEmail = (req.user.email || "").trim().toLowerCase();

    const sales = await orderCollection
      .find({ artistEmail: artistEmail })
      .sort({ date: -1, createdAt: -1 })
      .toArray();

    return res.status(200).json({ success: true, data: sales, sales });
  } catch (error) {
    console.error("[PAYMENT ERROR] Fetch my-sales error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to retrieve sales records." });
  }
});

// Fetch all transactions across the platform for admin
router.get("/all-transactions", verifyToken, verifyRole(["admin"]), async (req, res) => {
  try {
    const db = req.app.get("db");
    const orderCollection = db.collection("orders");

    const transactions = await orderCollection
      .find({})
      .sort({ date: -1, createdAt: -1 })
      .toArray();

    return res.status(200).json({ success: true, data: transactions, transactions });
  } catch (error) {
    console.error("[PAYMENT ERROR] Fetch all transactions error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to retrieve all transactions." });
  }
});

// Stripe webhook handler for background event processing
router.post("/webhook", async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (endpointSecret) {
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } else {
      event = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    }
  } catch (err) {
    console.error("[STRIPE WEBHOOK ERROR] Signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const db = req.app.get("db");
    const orderCollection = db.collection("orders");
    const userCollection = db.collection("user");
    const artworkCollection = db.collection("artworks");

    try {
      const { artworkId, buyerId, buyerEmail, artistEmail, artworkTitle } = session.metadata || {};
      const existingOrder = await orderCollection.findOne({ transactionId: session.id });

      if (!existingOrder) {
        const artworkOid = toOid(artworkId);
        const artworkDoc = artworkOid
          ? await artworkCollection.findOne({ $or: [{ _id: artworkOid }, { _id: artworkId }] })
          : await artworkCollection.findOne({ _id: artworkId });

        const finalArtistEmail = (artistEmail || artworkDoc?.artistEmail || artworkDoc?.userEmail || "").trim().toLowerCase();
        const finalBuyerEmail = (buyerEmail || session.customer_email || "").trim().toLowerCase();
        const resolvedBuyerId = toOid(buyerId) || buyerId;

        const structuredOrderPayload = {
          transactionId: session.id,
          type: "purchase",
          artworkId: artworkDoc ? artworkDoc._id : (artworkOid || artworkId),
          artworkTitle: artworkTitle || artworkDoc?.title || "Original Artwork",
          artworkImage: artworkDoc?.image || "",
          artworkDetails: artworkDoc ? {
            _id: artworkDoc._id,
            title: artworkDoc.title,
            image: artworkDoc.image,
            price: artworkDoc.price,
            category: artworkDoc.category,
            artistName: artworkDoc.artistName || artworkDoc.artist?.name,
            artistEmail: finalArtistEmail,
          } : null,
          buyerId: resolvedBuyerId,
          buyerEmail: finalBuyerEmail,
          artistEmail: finalArtistEmail,
          amount: session.amount_total / 100,
          price: session.amount_total / 100,
          currency: session.currency || "usd",
          status: "paid",
          paymentMethod: session.payment_method_types?.[0] || "card",
          date: new Date(),
          createdAt: new Date(),
        };

        await orderCollection.insertOne(structuredOrderPayload);

        if (finalBuyerEmail) {
          await userCollection.updateOne(
            { email: finalBuyerEmail },
            { $inc: { purchasesCount: 1 } }
          );
        }

        if (artworkDoc) {
          await artworkCollection.updateOne(
            { _id: artworkDoc._id },
            {
              $set: {
                isSold: true,
                buyerId: resolvedBuyerId,
                buyerEmail: finalBuyerEmail,
                soldAt: new Date(),
                updatedAt: new Date(),
              },
            }
          );
        }

        if (finalArtistEmail) {
          await userCollection.updateOne(
            { email: finalArtistEmail },
            { $inc: { totalSold: 1 } }
          );
        }
      }
    } catch (error) {
      console.error("[STRIPE WEBHOOK ERROR] Order settlement error:", error.message);
    }
  }

  res.json({ received: true });
});

module.exports = router;