import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const SHOPIFY_TOKEN = process.env.SHOPIFY_STOREFRONT_TOKEN;
const SHOPIFY_DOMAIN = "rx3brg-0q.myshopify.com"; // replace with your actual store domain

async function fetchProducts() {
  const query = `
    {
      products(first: 5) {
        edges {
          node {
            title
            description
            onlineStoreUrl
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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const { message } = req.body;

  try {
    const products = await fetchProducts();

    const productList = products
      .map(p => `${p.title} - $${p.priceRange.minVariantPrice.amount}`)
      .join("\n");

    const openaiResponse = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",   // Use GPT-3.5 turbo here
      messages: [
        {
          role: "system",
          content: "You are a shopping assistant. Here's the list of products available:\n\n" + productList
        },
        {
          role: "user",
          content: message
        }
      ],
    });

    const reply = openaiResponse.choices[0].message.content;
    res.status(200).json({ reply });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error fetching products or generating reply" });
  }
}
