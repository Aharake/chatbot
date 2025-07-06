const fetch = require("node-fetch");
const { Configuration, OpenAIApi } = require("openai");

const openai = new OpenAIApi(new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
}));

const SHOPIFY_DOMAIN = process.env.SHOPIFY_SHOP_DOMAIN;
const ACCESS_TOKEN = process.env.SHOPIFY_ADMIN_API_TOKEN;

async function fetchProducts() {
  const res = await fetch(`https://${SHOPIFY_DOMAIN}/admin/api/2023-07/products.json`, {
    headers: {
      "X-Shopify-Access-Token": ACCESS_TOKEN,
      "Content-Type": "application/json"
    }
  });

  const data = await res.json();
  return data.products.map(p => `${p.title} - ${p.variants[0].price} USD`).join("\\n");
}

module.exports = async function chatbotHandler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { message } = req.body;
  try {
    const products = await fetchProducts();

    const openaiRes = await openai.createChatCompletion({
      model: "gpt-4",
      messages: [
        { role: "system", content: "You're a shopping assistant. These are the available products:\n" + products },
        { role: "user", content: message }
      ]
    });

    const reply = openaiRes.data.choices[0].message.content;
    res.json({ reply });
  } catch (err) {
    console.error("Chatbot error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
};
