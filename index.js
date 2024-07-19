const fs = require("fs");

// Map to translate configuration colors
const COLORS_MAP = {
  white: "ホワイト",
  gray: "グレー",
  black: "ブラック",
  brown: "ブラウン",
  beige: "ベージュ",
  yellow: "イエロー",
  green: "グリーン",
  blue: "ブルー",
  purple: "パープル",
  pink: "ピンク",
  red: "レッド",
  orange: "オレンジ",
  silver: "シルバー",
  gold: "ゴールド",
  others: "その他",
};

const SEARCH_API_ENDPOINT = "https://api.rinkan-online.com/api/search";
const RINKAN_PRODUCT_PAGE = "https://rinkan-online.com/products";

const TICK_RATE = 5 * 60 * 1000; // 5 minutes

const { keywords, colors, categories, brand, discord_webhook_url } = JSON.parse(
  fs.readFileSync("config.json", "utf-8")
);

// Built in text search function only allows for one keyword.
// If only using one keyword leverage the api's search function.
const useSearchFunction = keywords.length === 1;

// Create inital request with default params
let parameters = new URLSearchParams({
  sort: "latest",
  stockLimit: 1, // in stock
});

if (brand) {
  parameters.append("brand", brand);
}

if (useSearchFunction) {
  parameters.append("keyword", keywords[0]);
}

for (let colorName in colors) {
  if (colors[colorName]) {
    parameters.append("color[]", COLORS_MAP[colorName]);
  }
}

for (let category of categories) {
  parameters.append("category", category);
}

var lastTickDate = Date.now();

const init = async () => {
  while (true) {
    let start = Date.now();

    await tickFunction();

    let timeUntilNextTick = TICK_RATE - (Date.now() - start);

    await wait(timeUntilNextTick);
  }
};

const tickFunction = async () => {
  try {
    currentDate = Date.now();

    // We keep looping pages until we find a product that was created before the current ticx.
    // As items are sorted by latest, all items after that product will certainly be irrelevant.
    pageLoop: for (i = 1; ; i++) {
      let products = await fetchProducts(i);

      for (let product of products) {
        // If a product was created before the current tick, stop looping products and pages
        if (!productIsNew(product)) {
          break pageLoop;
        }

        // If not using search function, check if product matches keyword.
        // If it doesn't, return early
        if (!useSearchFunction && !productMatchesKeywords(product)) {
          continue;
        }

        await sendWebhook(product);

        // Delay to prevent discord webhook rate limit
        await wait(2000);
      }
    }

    lastTickDate = currentDate;
  } catch (error) {
    console.log(`Monitor error: ${error.message}`);
  }
};

const fetchProducts = async (page) => {
  const response = await fetch(
    `${SEARCH_API_ENDPOINT}?${parameters.toString()}&page=${page}`,
    { keepalive: true }
  );

  if (!response.ok) {
    throw new Error(response.status);
  }

  return (await response.json()).products;
};

// Check if product matches at least one keyword
const productMatchesKeywords = (product) => {
  // If there are no keywords, match all products
  if (keywords.length === 0) {
    return true;
  }

  const modelNameToLowerCase = product.model_name.toUpperCase();
  return keywords.some((keyword) =>
    modelNameToLowerCase.includes(keyword.toUpperCase())
  );
};

// Check if product is new (was created after last tick)
const productIsNew = (product) => {
  return new Date(product.created_at).getTime() > lastTickDate;
};

const sendWebhook = async (product) => {
  try {
    const webhook = {
      embeds: [
        {
          title: `${product.brand_name} - ${product.product_name}`,
          url: `${RINKAN_PRODUCT_PAGE}/${product.product_code}`,
          fields: [
            {
              name: "Size",
              value: product.size,
            },
            {
              name: "Product Condition",
              value: product.product_condition,
            },
            {
              name: "Price",
              value: `¥${product.price}`,
            },
          ],
          thumbnail: { url: product.images[0] },
        },
      ],
    };

    const response = await fetch(discord_webhook_url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(webhook),
    });

    if (!response.ok) {
      const responseJSON = await response.json();

      throw new Error(responseJSON.message);
    }
  } catch (error) {
    console.log(`Webhook error: ${error.message}`);
  }
};

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

init();
