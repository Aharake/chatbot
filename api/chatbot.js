import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const SHOPIFY_TOKEN = process.env.SHOPIFY_STOREFRONT_TOKEN;
const SHOPIFY_DOMAIN = "rx3brg-0q.myshopify.com";

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

let userOrderMemory = {};

// Removed address from order completion
function isOrderComplete(order) {
  return (
    order.name &&
    order.phone &&
    order.product &&
    order.size
  );
}

// Removed address from missing fields
function getNextMissingField(order) {
  if (!order.name) return "full name";
  if (!order.phone) return "phone number";
  if (!order.product || !order.size) return "product name and size";
  return null;
}

const isSmallTalk = message => {
  const normalized = message.toLowerCase().trim();
  const greetings = [
    "hello", "hi", "hey", "ey", "good morning", "good evening",
    "warrup", "what's up", "sup", "yo", "howdy", "hey there"
  ];
  return greetings.some(p => normalized === p || normalized.includes(p));
};

const casualReplies = ["warrup", "what's up", "sup", "yo", "hey", "ey"];

export default async function handler(req, res) {
  const allowedOrigin = "https://aliharake.pro";
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  const { message } = req.body;
  const userId = "shopify-session";
  if (!userOrderMemory[userId]) userOrderMemory[userId] = {};
  const order = userOrderMemory[userId];

  try {
    if (isSmallTalk(message)) {
      return res.status(200).json({ reply: "👋 Hello! I'm your shopping assistant. I can help you place an order. Just tell me what you'd like to buy!" });
    }

    // Friendly fallback for casual greetings that are not recognized as full small talk
    if (casualReplies.some(c => message.toLowerCase().includes(c))) {
      return res.status(200).json({ reply: "🙂 Hey! To get started, please tell me your full name or what you'd like to buy." });
    }

    const products = await fetchProducts();
    const productTitles = products.map(p => p.title).join("\n");

    const systemPrompt = `You are a helpful shopping assistant chatbot. You are collecting an order for a Shopify store. Products available:\n${productTitles}\n\nAsk the user for their name, phone number, product name and size. Accept height in cm and map it to sizes:\n- 140-160 cm: S\n- 160-180 cm: M\n- 180-195 cm: L\n- 195-205 cm: XL\n- 205+ cm: 2XL\nRespond with one missing field at a time, and once all fields are collected, summarize the order. Don't ask the user to re-enter details they already gave. Just help if they ask questions.`;

    const chatHistory = [
      { role: "system", content: systemPrompt },
      { role: "user", content: message }
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: chatHistory,
    });

    const reply = completion.choices[0].message.content;

    // Store name if valid (simple heuristic)
    if (!order.name) {
      const words = message.trim().split(/\s+/);
      if (
        words.length >= 2 &&
        words.length <= 4 &&
        words.every(w => /^[a-zA-Z]{2,}$/.test(w))
      ) {
        order.name = message.trim();
      }
    }

    // Removed address extraction

    // Phone extraction
    if (!order.phone) {
      const phoneMatch = message.match(/(?:phone is|call me at)?\s*(\+?\d{7,15})/);
      if (phoneMatch) {
        order.phone = phoneMatch[1].trim();
      }
    }

    // Size extraction by explicit size or height mapping
    if (!order.size) {
      const sizeMatch = message.match(/\b(S|M|L|XL|2XL)\b/i);
      if (sizeMatch) {
        order.size = sizeMatch[1].toUpperCase();
      } else {
        const heightMatch = message.match(/\b(1[4-9][0-9]|2[0-1][0-9]|20[5-9])\b/);
        if (heightMatch) {
          const height = parseInt(heightMatch[0]);
          if (height < 160) order.size = "S";
          else if (height < 180) order.size = "M";
          else if (height < 195) order.size = "L";
          else if (height < 205) order.size = "XL";
          else order.size = "2XL";
        }
      }
    }

    // Product matching
    if (!order.product) {
      for (let p of products) {
        if (message.toLowerCase().includes(p.title.toLowerCase())) {
          order.product = p.title;
          break;
        }
      }
    }

    // If order incomplete, ask next missing field
    if (!isOrderComplete(order)) {
      const missing = getNextMissingField(order);
      return res.status(200).json({ reply: `Please provide your ${missing}.` });
    }

    // Check stock availability
    const matchedProduct = products.find(p => p.title.toLowerCase().includes(order.product.toLowerCase()));
    const matchedVariant = matchedProduct.variants.edges.find(edge =>
      edge.node.title.toLowerCase().includes(order.size.toLowerCase())
    );

    if (!matchedVariant || !matchedVariant.node.availableForSale) {
      return res.status(200).json({ reply: `Sorry, ${order.product} in size ${order.size} is out of stock.` });
    }

    const variantIdShort = matchedVariant.node.id.split("/").pop();
    const checkoutUrl = `https://${SHOPIFY_DOMAIN}/cart/${variantIdShort}:1`;

    // Clear order memory for next user
    userOrderMemory[userId] = {};

    return res.status(200).json({
      reply: `✅ Order confirmed!\n\n👤 Name: ${order.name}\n📞 Phone: ${order.phone}\n🛍️ Product: ${order.product} (${order.size})\n\n👉 <a href="${checkoutUrl}" target="_blank" rel="noopener noreferrer">Click here to checkout</a>\n\nIf you have any other questions, just ask!`
    });

  } catch (error) {
    console.error("Order error:", error);
    return res.status(500).json({ error: "Order processing failed." });
  }
}
