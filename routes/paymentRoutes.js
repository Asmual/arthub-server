const express = require("express");
const router = express.Router();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { ObjectId } = require("mongodb");
const { verifyToken, verifyRole } = require("../middlewares");

const toOid = (id) => {
  try {
    return ObjectId.isValid(id) ? new ObjectId(id) : null;
  } catch {
    return null;
  }
};

router.get("/all-transactions", verifyToken, async (req, res) => {
  try {
    console.log(`[PAYMENT LOG] Fetching all transactions. Initiator: ${req.user.email}`);
    const db = req.app.get("db");
    const orderCollection = db.collection("orders");
    const userCollection = db.collection("user");
   
    const operationalProfile = await userCollection.findOne({ email: req.user.email });
    if (!operationalProfile || operationalProfile.role !== "admin") {
      console.warn(`[PAYMENT WARN] Unauthorized admin access attempt by: ${req.user.email}`);
      return res.status(403).json({ success: false, message: "Forbidden: Administrative credentials mandatory." });
    }

    const transactions = await orderCollection
      .find({})
      .sort({ date: -1 })
      .toArray();

    return res.status(200).json({ success: true, data: transactions });
  } catch (error) {
    console.error("[PAYMENT ERROR] Master Ledger Aggregation Failure:", error.message);
    return res.status(500).json({ success: false, message: "Internal server ledger tracking failure." });
  }
});


router.get("/my-orders", verifyToken, async (req, res) => {
  try {
    console.log(`[PAYMENT LOG] Fetching orders for user: ${req.user.email}`);
    const db = req.app.get("db");
    const orderCollection = db.collection("orders");
    const userEmail = req.user.email;

    if (!userEmail) {
      return res.status(400).json({ success: false, message: "User email identity context missing from authorization token." });
    }

    const orders = await orderCollection
      .find({ buyerEmail: userEmail })
      .sort({ date: -1 })
      .toArray();

    return res.status(200).json({ success: true, data: orders });
  } catch (error) {
    console.error("[PAYMENT ERROR] Buyer Orders System Retrieval Failure:", error.message);
    return res.status(500).json({ success: false, message: "Internal server error mapping customer order ledger paths." });
  }
});

router.post("/create-checkout-session", verifyToken, async (req, res) => {
  try {
    const db = req.app.get("db");
    const artworkCollection = db.collection("artworks");
    const { artworkId, price } = req.body;
    const userEmail = req.user.email;
    const buyerId = req.user.id;

    if (!artworkId || !ObjectId.isValid(artworkId)) {
      return res.status(400).json({ success: false, message: "Invalid artwork reference identifier target." });
    }

    const artwork = await artworkCollection.findOne({ _id: new ObjectId(artworkId) });
    if (!artwork) {
      return res.status(404).json({ success: false, message: "Requested artwork missing from marketplace inventory." });
    }

    const clientBaseUrl = process.env.CLIENT_URL || "http://localhost:3000";

    const isValidDirectImageUrl = (url) => {
      if (!url || typeof url !== "string") return false;
      const URL_REGEX = /^https:\/\/[a-zA-Z0-9-_.]+\.[a-zA-Z]{2,}\/.*\.(jpg|jpeg|png|webp|gif|svg)(\?.*)?$/i;
      return URL_REGEX.test(url) && !url.includes("localhost") && !url.includes("127.0.0.1");
    };

    const productData = {
      name: artwork.title || "Original Artwork Blueprint",
      description: `Original Masterpiece processing map via ArtHub Network`,
    };

    if (artwork.image && isValidDirectImageUrl(artwork.image)) {
      productData.images = [artwork.image];
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
            unit_amount: Math.round(Number(price || artwork.price) * 100),
          },
          quantity: 1,
        },
      ],
      success_url: `${clientBaseUrl}/dashboard/user?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${clientBaseUrl}/browse/${artworkId}`,
      metadata: {
        artworkId: artworkId.toString(),
        buyerId: buyerId,
        buyerEmail: userEmail,
        artworkTitle: artwork.title || "Original Gallery Artwork",
        artistEmail: artwork.artistEmail || artwork.userEmail || "" 
      }
    });

    return res.status(200).json({ success: true, url: session.url });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/verify-payment-sync", verifyToken, async (req, res) => {
  const { sessionId } = req.body;
  try {
    const db = req.app.get("db");
    const orderCollection = db.collection("orders");
    const userCollection = db.collection("user");
    const artworkCollection = db.collection("artworks");

    const session = await stripe.checkout.sessions.retrieve(sessionId);
   
    if (session.payment_status !== "paid") {
      return res.status(400).json({ success: false, message: "Unverified transaction settlement clearance profile tracked." });
    }

    const { artworkId, buyerId, buyerEmail, artistEmail, artworkTitle } = session.metadata || {};

    const existingOrder = await orderCollection.findOne({ transactionId: session.id });
    if (existingOrder) {
      return res.status(200).json({ success: true, message: "Transaction maps already integrated." });
    }

    const artworkOid = toOid(artworkId);
    const artworkDoc = artworkOid
      ? await artworkCollection.findOne({ $or: [{ _id: artworkOid }, { _id: artworkId }] })
      : await artworkCollection.findOne({ _id: artworkId });

    const finalArtistEmail = (artistEmail || artworkDoc?.artistEmail || "").trim().toLowerCase();

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
        artistName: artworkDoc.artistName,
        artistEmail: artworkDoc.artistEmail
      } : null,
      buyerId: toOid(buyerId) || buyerId,
      buyerEmail: buyerEmail,
      artistEmail: finalArtistEmail,
      amount: session.amount_total / 100,
      price: session.amount_total / 100,
      status: "paid",
      date: new Date(),
      createdAt: new Date()
    };

    await orderCollection.insertOne(structuredOrderPayload);

    // Update buyer purchase counter
    await userCollection.updateOne(
      { email: buyerEmail },
      { $inc: { purchasesCount: 1 } }
    );

    // Mark artwork as sold
    if (artworkDoc) {
      await artworkCollection.updateOne(
        { _id: artworkDoc._id },
        {
          $set: {
            isSold: true,
            buyerId: toOid(buyerId) || buyerId,
            buyerEmail: buyerEmail,
            updatedAt: new Date()
          }
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

    return res.status(200).json({ success: true, message: "Stripe data metrics successfully integrated." });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
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

        const finalArtistEmail = (artistEmail || artworkDoc?.artistEmail || "").trim().toLowerCase();

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
            artistName: artworkDoc.artistName,
            artistEmail: artworkDoc.artistEmail
          } : null,
          buyerId: toOid(buyerId) || buyerId,
          buyerEmail: buyerEmail,
          artistEmail: finalArtistEmail,
          amount: session.amount_total / 100,
          price: session.amount_total / 100,
          status: "paid",
          date: new Date(),
          createdAt: new Date()
        };

        await orderCollection.insertOne(structuredOrderPayload);

        await userCollection.updateOne(
          { email: buyerEmail },
          { $inc: { purchasesCount: 1 } }
        );

        if (artworkDoc) {
          await artworkCollection.updateOne(
            { _id: artworkDoc._id },
            {
              $set: {
                isSold: true,
                buyerId: toOid(buyerId) || buyerId,
                buyerEmail: buyerEmail,
                updatedAt: new Date()
              }
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
      console.error("[WEBHOOK CRITICAL ERROR]", error.message);
    }
  }

  res.json({ received: true });
});


router.get("/my-sales", verifyToken, verifyRole(["artist"]), async (req, res) => {
  try {
    const db = req.app.get("db");
    const orderCollection = db.collection("orders");
    
    const artistEmail = req.user.email ? req.user.email.trim().toLowerCase() : "";

    console.log(`[PAYMENT LOG] Fetching sales for artist email: ${artistEmail}`);

    const sales = await orderCollection
      .find({ artistEmail: artistEmail })
      .sort({ date: -1 })
      .toArray();

    return res.status(200).json({ success: true, data: sales });
  } catch (err) {
    return res.status(500).json({
      error: true,
      message: "Database read fault encountered while generating order ledgers.",
      details: err.message
    });
  }
});

module.exports = router;