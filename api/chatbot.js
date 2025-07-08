import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const SHOPIFY_TOKEN = process.env.SHOPIFY_STOREFRONT_TOKEN;
const SHOPIFY_DOMAIN = "rx3brg-0q.myshopify.com"; // your store domain

async function fetchProducts() {
  const query = `
    {
      products(first: 5) {
        edges {
          node {
            title
            description
            onlineStoreUrl
            variants(first: 10) {
              edges {
                node {
                  title
                  availableForSale
                  price {
                    amount
                  }
                }
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

export default async function handler(req, res) {
  // CORS headers
  const allowedOrigin = "https://aliharake.pro";
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  const { message } = req.body;
  if (!message || message.trim() === "") {
    return res.status(400).json({ error: "Message is required" });
  }

  try {
    console.log("Received message:", message);
    const products = await fetchProducts();

    // Generate product and variant info
    let productList = "";
    for (const product of products) {
      productList += `\n${product.title}:\n`;
      for (const variantEdge of product.variants.edges) {
        const v = variantEdge.node;
        const availability = v.availableForSale ? "In Stock" : "Out of Stock";
        productList += ` - ${v.title}: $${v.price.amount} (${availability})\n`;
      }
    }

    // Size recommendation logic
    const sizeGuide = `
Size recommendation based on height:
- 140cm - 160cm: S
- 160cm - 180cm: M
- 180cm - 195cm: L
- 195cm - 205cm: XL
- 205cm+: 2XL
    `.trim();

    const systemMessage = `
You are a smart shopping assistant for a clothing store.

Your tasks:
- Recommend product sizes based on height (in cm)
- Tell customers whether a specific size is in stock
- Always refer to product names and variant availability below.

${sizeGuide}

Here are the available products and variants:

${productList}
    `.trim();

    const openaiResponse = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: message }
      ],
    });

    const reply = openaiResponse.choices[0].message.content;
    console.log("OpenAI reply:", reply);
    res.status(200).json({ reply });

  } catch (error) {
    console.error("Handler error:", error.response?.data || error.message || error);
    res.status(500).json({ error: "Error fetching products or generating reply" });
  }
}
