import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const SHOPIFY_TOKEN = process.env.SHOPIFY_STOREFRONT_TOKEN;
const SHOPIFY_DOMAIN = "rx3brg-0q.myshopify.com"; // replace with your store domain

async function fetchProducts() {
  const query = `
    {
      products(first: 5) {
        edges {
          node {
            id
            title
            description
            variants(first: 10) {
              edges {
                node {
                  id
                  title
                  availableForSale
                }
              }
            }
            priceRange {
              minVariantPrice {
                amount
              }
            }
          }
        }
      }
    }
  `;

  const response = await fetch(`https://${SHOPIFY_DOMAIN}/api/2023-07/graphql.json`, {
    method: "POST",
    headers: {
      "X-Shopify-Storefront-Access-Token": SHOPIFY_TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });

  const data = await response.json();
  return data.data.products.edges.map(edge => edge.node);
}

// Simple memory store — replace with real DB/session if needed
let userOrderMemory = {};

function isOrderComplete(order) {
  return (
    order.name &&
    order.address &&
    order.phone &&
    order.product &&
    order.size
  );
}

function getNextMissingField(order) {
  if (!order.name) return "full name";
  if (!order.address) return "delivery address";
  if (!order.phone) return "phone number";
  if (!order.product || !order.size) return "product name and size";
  return null;
}

export default async function handler(req, res) {
  const allowedOrigin = "https://aliharake.pro";
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  const { message } = req.body;
  const userId = "shopify-session"; // In production, use real session/user ID
  if (!userOrderMemory[userId]) userOrderMemory[userId] = {};
  const order = userOrderMemory[userId];

  // Use OpenAI to parse message and extract details
  try {
    const products = await fetchProducts();
    const productTitles = products.map(p => p.title).join("\n");

    const systemPrompt = `You are a helpful shopping assistant chatbot. You are collecting an order for a Shopify store. Products available:\n${productTitles}\n\nAsk the user for their name, address, phone number, product name and size. Accept height in cm and map it to sizes:\n- 140-160 cm: S\n- 160-180 cm: M\n- 180-195 cm: L\n- 195-205 cm: XL\n- 205+ cm: 2XL\nRespond with one missing field at a time, and once all fields are collected, summarize the order.`;

    const chatHistory = [
      { role: "system", content: systemPrompt },
      { role: "user", content: message }
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: chatHistory,
    });

    const reply = completion.choices[0].message.content;

    // Attempt to extract user info from the message
    if (!order.name) {
  const nameMatch = message.match(/(?:my name is|i am|i'm)\s+([a-zA-Z\s]+)/i);
  if (nameMatch) {
    order.name = nameMatch[1].trim();
  } else if (!order.address && !order.phone && message.trim().split(" ").length <= 4) {
    // Fallback: assume it's a name if it's short and no other fields exist yet
    order.name = message.trim();
  }
}

    if (!order.address && /address is|live at ([^\n]+)/i.test(message)) {
      const match = message.match(/address is|live at ([^\n]+)/i);
      order.address = match[1].trim();
    }
    if (!order.phone && /phone is|call me at ([0-9\-\+ ]+)/i.test(message)) {
      const match = message.match(/phone is|call me at ([0-9\-\+ ]+)/i);
      order.phone = match[1].trim();
    }
    if (!order.size && /\b(140|150|160|170|180|190|200|210)\b/.test(message)) {
      const height = parseInt(message.match(/\b(140|150|160|170|180|190|200|210)\b/)[0]);
      if (height < 160) order.size = "S";
      else if (height < 180) order.size = "M";
      else if (height < 195) order.size = "L";
      else if (height < 205) order.size = "XL";
      else order.size = "2XL";
    }
    if (!order.product) {
      for (let p of products) {
        if (message.toLowerCase().includes(p.title.toLowerCase())) {
          order.product = p.title;
          break;
        }
      }
    }

    if (!isOrderComplete(order)) {
      const missing = getNextMissingField(order);
      return res.status(200).json({ reply: `Please provide your ${missing}.` });
    }

    const matchedProduct = products.find(p => p.title.toLowerCase().includes(order.product.toLowerCase()));
    const matchedVariant = matchedProduct.variants.edges.find(edge =>
      edge.node.title.toLowerCase().includes(order.size.toLowerCase())
    );

    if (!matchedVariant || !matchedVariant.node.availableForSale) {
      return res.status(200).json({ reply: `Sorry, ${order.product} in size ${order.size} is out of stock.` });
    }

    const checkoutUrl = `https://${SHOPIFY_DOMAIN}/cart/${matchedVariant.node.id.split("/").pop()}:1`;

    userOrderMemory[userId] = null;

    return res.status(200).json({
      reply: `✅ Order confirmed!\n\n👤 Name: ${order.name}\n📍 Address: ${order.address}\n📞 Phone: ${order.phone}\n🛍️ Product: ${order.product} (${order.size})\n\n👉 [Click here to checkout](${checkoutUrl})`
    });

  } catch (error) {
    console.error("Order error:", error);
    return res.status(500).json({ error: "Order processing failed." });
  }
}
