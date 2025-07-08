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

const isSmallTalk = message => {
  const normalized = message.toLowerCase();
  return ["hello", "hi", "hey", "good morning", "good evening"].some(p => normalized.includes(p));
};

const isProductInquiry = message => {
  return /(in stock|available|have|stock)/i.test(message);
};

function mapHeightToSize(height) {
  if (height >= 205) return "2XL";
  if (height >= 195) return "XL";
  if (height >= 180) return "L";
  if (height >= 160) return "M";
  if (height >= 140) return "S";
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
  const msgLower = message.toLowerCase();

  try {
    if (isSmallTalk(message)) {
      return res.status(200).json({
        reply: "👋 Hello! I'm your shopping assistant. I can help you with product info and sizing. Ask me about our products!"
      });
    }

    // Check for height in cm (e.g. "I'm 175 cm tall")
    const heightMatch = message.match(/\b(1[4-9][0-9]|2[0-1][0-9]|205|20[6-9]|210|215|220)\b/);
    let detectedSize = null;
    if (heightMatch) {
      const height = parseInt(heightMatch[0], 10);
      detectedSize = mapHeightToSize(height);
    }

    if (isProductInquiry(message)) {
      const products = await fetchProducts();
      const matchedProduct = products.find(p =>
        msgLower.includes(p.title.toLowerCase())
      );

      if (matchedProduct) {
        const availableVariants = matchedProduct.variants.edges.filter(v => v.node.availableForSale);
        if (availableVariants.length > 0) {
          let sizeMsg = "";
          if (detectedSize) {
            sizeMsg = ` Based on your height, the recommended size is ${detectedSize}.`;
          }
          return res.status(200).json({
            reply: `Yes, ${matchedProduct.title} is available in sizes: ${availableVariants.map(v => v.node.title).join(", ")}.${sizeMsg}`
          });
        } else {
          return res.status(200).json({
            reply: `Sorry, ${matchedProduct.title} is currently out of stock.`
          });
        }
      } else {
        return res.status(200).json({
          reply: `Sorry, I couldn't find that product. Please ask about another item or browse our products.`
        });
      }
    }

    // Fallback to GPT-3.5 for anything else, telling it not to ask for personal info
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: "You are a friendly shopping assistant chatbot that helps users with product info and sizing advice. Do not ask for orders or personal info."
        },
        { role: "user", content: message }
      ],
    });

    const reply = completion.choices[0].message.content;

    return res.status(200).json({ reply });

  } catch (error) {
    console.error("Error:", error);
    return res.status(500).json({ error: "Something went wrong." });
  }
}
