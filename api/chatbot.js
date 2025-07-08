import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const SHOPIFY_TOKEN = process.env.SHOPIFY_STOREFRONT_TOKEN;
const SHOPIFY_DOMAIN = "rx3brg-0q.myshopify.com";

// -----------------------------
// Fetch Products and Variants
// -----------------------------
async function fetchProducts() {
  const query = `
    {
      products(first: 10) {
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

// -----------------------------
// Recommend Size by Height
// -----------------------------
function recommendSize(height) {
  if (height >= 140 && height < 160) return "S";
  if (height >= 160 && height < 180) return "M";
  if (height >= 180 && height < 195) return "L";
  if (height >= 195 && height < 210) return "XL";
  return "2XL";
}

// -----------------------------
// Create Checkout Link
// -----------------------------
async function createCheckoutLineItems(variantId) {
  const checkoutQuery = `
    mutation {
      checkoutCreate(input: {
        lineItems: [
          {
            variantId: "${variantId}",
            quantity: 1
          }
        ]
      }) {
        checkout {
          id
          webUrl
        }
        userErrors {
          field
          message
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
    body: JSON.stringify({ query: checkoutQuery }),
  });

  const result = await response.json();
  return result.data.checkoutCreate.checkout.webUrl;
}

// -----------------------------
// API Handler
// -----------------------------
export default async function handler(req, res) {
  // --- CORS ---
  const allowedOrigin = "https://aliharake.pro";
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const { message, height, name, phone, address, selectedProduct, selectedSize } = req.body;

  if (!message || message.trim() === "") {
    return res.status(400).json({ error: "Message is required" });
  }

  try {
    const products = await fetchProducts();

    // Recommend size if height is provided
    const sizeSuggestion = height ? recommendSize(parseInt(height)) : null;

    // If order info is provided
    if (selectedProduct && selectedSize) {
      const product = products.find(p => p.title.toLowerCase() === selectedProduct.toLowerCase());

      if (!product) {
        return res.status(404).json({ reply: `Product "${selectedProduct}" not found.` });
      }

      const variant = product.variants.edges.find(v =>
        v.node.title.toLowerCase().includes(selectedSize.toLowerCase())
      );

      if (!variant || !variant.node.availableForSale) {
        return res.status(404).json({ reply: `Size ${selectedSize} is out of stock for ${selectedProduct}.` });
      }

      const checkoutUrl = await createCheckoutLineItems(variant.node.id);

      return res.status(200).json({
        reply: `Thanks ${name}! Your order for ${selectedProduct} (Size ${selectedSize}) is ready.\n\n📦 Address: ${address}\n📞 Phone: ${phone}\n\nClick below to complete your purchase:\n${checkoutUrl}`
      });
    }

    // Else, continue conversation with product list and size suggestion
    const productList = products
      .map(p => {
        const prices = p.variants.edges.map(v => `$${v.node.price.amount}`).join(", ");
        return `${p.title} - Available sizes: ${p.variants.edges.map(v => v.node.title).join(", ")} - Prices: ${prices}`;
      })
      .join("\n\n");

    const systemPrompt = `You are a helpful shopping assistant. Available products:\n\n${productList}\n\nIf the user provides height, recommend size (S: 140–160cm, M: 160–180cm, L: 180–195cm, XL: 195–210cm, 2XL: above).\nIf they provide name, address, phone, and product/size, confirm and give them the checkout URL.`;

    const openaiResponse = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message }
      ],
    });

    const reply = openaiResponse.choices[0].message.content;
    res.status(200).json({ reply, sizeSuggestion });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Something went wrong processing the request." });
  }
}
