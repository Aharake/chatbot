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

    let productList = "";
    for (const product of products) {
      productList += `\n${product.title}:\n`;
      for (const variantEdge of product.variants.edges) {
        const v = variantEdge.node;
        const availability = v.availableForSale ? "In Stock" : "Out of Stock";
        productList += ` - ${v.title}: $${v.price.amount} (${availability})\n`;
      }
    }

    const sizeGuide = `
Size recommendation based on height:
- 140cm - 160cm: S
- 160cm - 180cm: M
- 180cm - 195cm: L
- 195cm - 205cm: XL
- 205cm+: 2XL
    `.trim();

    const faqAnswers = `
Extra Information for FAQs:

1. Sizes Available: Sizes usually include S, M, L, XL, and 2XL. Availability varies by product.
2. How to know your size: Refer to this size guide:\n${sizeGuide}
3. Size Guide: Use the chart above to determine your recommended size by height.
4. Authentic vs Replica: Jerseys are replicas, but very high quality and detailed.
5. Kids Sizes: Yes, we offer kids' sizes.
6. Customization: Yes, you can add a name/number for $6. It takes about an extra week.
7. Restock Info: If an item is out of stock, ordering it means it usually arrives within 1–2 weeks.
8. Other Teams/Leagues: Yes! We offer various teams and leagues. Here's a sample:\n${productList}
9. Accessories: Yes, we sell socks, shorts, and other items. Please check the site for available accessories.
    `.trim();

    const systemMessage = `
You are a smart shopping assistant for a clothing store.

Your tasks:
- Answer common customer questions listed in FAQs below.
- Recommend product sizes based on height (in cm).
- Indicate whether a size is in stock or not based on the product data.

${faqAnswers}

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
