const { ObjectId } = require('mongodb');

router.post('/verify-success-order', async (req, res) => {
  try {
    const { sessionId, artworkId, buyerId, buyerEmail, price } = req.body;

    const orderDocument = {
      artworkId: new ObjectId(artworkId),
      buyerId: buyerId,
      buyerEmail: buyerEmail,
      price: Number(price),
      transactionId: sessionId,
      status: 'paid',
      createdAt: new Date()
    };

    const result = await db.collection('orders').insertOne(orderDocument);

    await db.collection('artworks').updateOne(
      { _id: new ObjectId(artworkId) },
      { $set: { isSold: true, buyerId: buyerId } }
    );

    res.status(201).json({ 
      success: true, 
      message: "Order recorded successfully", 
      orderId: result.insertedId 
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});