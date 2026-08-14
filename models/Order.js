/**
 * Helper to structure and validate order documents before inserting into the MongoDB 'orders' collection.
 * Normalizes user data and ensures compliance with transaction tracking properties.
 */
const prepareOrderData = (data) => {
  const order = {
    artworkId: data.artworkId || null,
    buyerId: data.buyerId || "",
    buyerEmail: data.buyerEmail ? data.buyerEmail.trim().toLowerCase() : "",
    artistEmail: data.artistEmail ? data.artistEmail.trim().toLowerCase() : "",
    artworkTitle: data.artworkTitle || "",
    amount: Number(data.amount || data.price) || 0,
    transactionId: data.transactionId || "",
    status: ["paid", "failed", "pending"].includes(data.status) ? data.status : "paid",
    createdAt: data.createdAt || new Date(),
    updatedAt: new Date()
  };

  // Runtime assertion enforcing strict system-wide validation rules
  if (!order.buyerId) {
    throw new Error("Validation Error: buyerId is strictly required.");
  }
  if (!order.transactionId) {
    throw new Error("Validation Error: transactionId is strictly required.");
  }
  if (order.amount <= 0) {
    throw new Error("Validation Error: financial transaction amount must be greater than 0.");
  }

  return order;
};

module.exports = { prepareOrderData };