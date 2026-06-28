// models/Order.js
const { ObjectId } = require("mongodb");

const prepareOrderData = (data) => {
  const order = {
    artworkId: data.artworkId ? new ObjectId(data.artworkId) : null,
    buyerId: data.buyerId || "",
    buyerEmail: data.buyerEmail ? data.buyerEmail.trim().toLowerCase() : "",
    price: Number(data.price) || 0,
    transactionId: data.transactionId || "",
    type: ["purchase", "subscription"].includes(data.type) ? data.type : "purchase",
    tier: ["free", "pro", "premium"].includes(data.tier) ? data.tier : null,
    status: ["paid", "failed", "pending"].includes(data.status) ? data.status : "paid",
    createdAt: data.createdAt || new Date(),
    updatedAt: new Date(),
  };

  if (!order.buyerId) throw new Error("Validation Error: buyerId is strictly required.");
  if (!order.transactionId) throw new Error("Validation Error: transactionId is strictly required.");
  if (order.price <= 0 && order.type === "purchase")
    throw new Error("Validation Error: price must be greater than 0.");

  return order;
};

module.exports = { prepareOrderData };