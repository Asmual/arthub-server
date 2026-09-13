const express = require("express");
const router = express.Router();

/**
 * @route   POST /api/ai/describe-artwork
 * @desc    Analyze uploaded artwork image and auto-generate title, description, category, tags & price
 * @access  Public / Authenticated
 */
router.post("/describe-artwork", async (req, res) => {
  try {
    const { imageUrl, imageBase64, mimeType = "image/jpeg" } = req.body;

    if (!imageUrl && !imageBase64) {
      return res.status(400).json({
        error: true,
        message: "An image URL or imageBase64 data is required.",
      });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error: true,
        message: "Gemini API key is not configured in server environment.",
      });
    }

    let base64Data = imageBase64;
    let resolvedMime = mimeType;

    if (!base64Data && imageUrl) {
      const imgRes = await fetch(imageUrl);
      if (!imgRes.ok) {
        return res.status(400).json({
          error: true,
          message: "Failed to download image from provided URL.",
        });
      }
      const arrayBuffer = await imgRes.arrayBuffer();
      base64Data = Buffer.from(arrayBuffer).toString("base64");
      const headerContentType = imgRes.headers.get("content-type");
      if (headerContentType) {
        resolvedMime = headerContentType.split(";")[0].trim();
      }
    }

    const systemPrompt = `
You are a world-class art curator, gallery director, and fine-art appraiser at ArtHub.
Analyze the provided artwork image and generate high-caliber metadata.
Return a STRICT JSON object with the following fields:
- "title": (string) A creative, captivating, professional artwork title.
- "description": (string) 2-3 engaging, eloquent paragraphs describing the artwork's mood, aesthetic style, brushwork, emotional resonance, and deeper artistic story.
- "category": (string) Exactly one of: "Painting", "Abstract", "Drawing", "Digital Art", "Photography", "Sculpture", "Contemporary", "Illustration".
- "tags": (array of 5 to 8 strings) Meaningful, relevant art tags (e.g. ["Oil on Canvas", "Expressionism", "Vibrant", "Modern Decor"]).
- "suggestedPrice": (number) Realistic estimated marketplace price in USD between 50 and 2000 based on aesthetic complexity.
- "dominantColors": (array of 3 to 5 strings) Hex color codes representing the dominant palette in the artwork.
`;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`;

    const geminiRes = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: systemPrompt },
              {
                inlineData: {
                  mimeType: resolvedMime || "image/jpeg",
                  data: base64Data,
                },
              },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.7,
        },
      }),
    });

    if (!geminiRes.ok) {
      const errData = await geminiRes.json().catch(() => ({}));
      console.error("[SERVER GEMINI API ERROR]:", errData);
      return res.status(geminiRes.status).json({
        error: true,
        message: errData?.error?.message || "Gemini vision analysis failed.",
      });
    }

    const geminiData = await geminiRes.json();
    const rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawText) {
      return res.status(500).json({
        error: true,
        message: "No response received from Gemini vision model.",
      });
    }

    const parsed = JSON.parse(rawText);

    res.json({
      success: true,
      data: parsed,
    });
  } catch (err) {
    console.error("[SERVER AI DESCRIBE ERROR]:", err);
    res.status(500).json({
      error: true,
      message: err.message || "Failed to process artwork with AI.",
    });
  }
});

/**
 * @route   POST /api/ai/art-advisor
 * @desc    Curate artwork recommendations based on buyer space, mood, colors, or budget
 * @access  Public
 */
router.post("/art-advisor", async (req, res) => {
  try {
    const { messages = [], userPrompt = "" } = req.body;
    const activePrompt = userPrompt || (messages[messages.length - 1]?.content) || "Hello! Can you recommend some beautiful artworks for my home?";

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error: true,
        message: "Gemini API key is not configured in server environment.",
      });
    }

    const db = req.app.get("db");
    const artworksCollection = db.collection("artworks");

    const availableArtworks = await artworksCollection
      .find({ isSold: { $ne: true } })
      .sort({ createdAt: -1 })
      .limit(35)
      .toArray();

    const catalog = availableArtworks.map((a) => ({
      id: a._id?.toString(),
      title: a.title || "Untitled Masterpiece",
      price: Number(a.price || 0),
      category: a.category || "Painting",
      artistName: a.artistName || "Featured Artist",
      image: a.image || "",
      tags: Array.isArray(a.tags) ? a.tags : [],
      dominantColors: Array.isArray(a.dominantColors) ? a.dominantColors : [],
      description: a.description ? a.description.substring(0, 160) + "..." : "",
    }));

    const systemPrompt = `
You are "ArtHub AI Advisor" — an articulate, warm, and sophisticated fine-art curator and interior art consultant.
Your mission is to help art lovers, collectors, and homeowners find the ideal artwork from ArtHub's authentic collection based on room decor, wall colors, lighting, mood, theme, or budget.

CURRENT AVAILABLE ARTHUB GALLERY CATALOG:
${JSON.stringify(catalog, null, 2)}

CURATOR INSTRUCTIONS:
1. Speak warmly, eloquently, and informatively like a top gallery director.
2. Analyze the user's inquiry (e.g. wall color, living room, office, mood, budget, or art style).
3. Recommend 1 to 3 suitable artworks from the catalog above that match their vision or budget.
4. For each recommended piece, include a thoughtful "curatorNote" explaining WHY it harmonizes with their space (e.g., color contrast, mood synergy, stylistic balance).
5. If their budget or specific request isn't an exact match, recommend the closest creative alternatives and explain why they'd still look fantastic.
6. Only recommend artworks that exist in the provided catalog with valid IDs, images, and prices.

OUTPUT FORMAT (STRICT JSON):
{
  "reply": (string) Your conversational curator response (supports markdown for bolding and style),
  "recommendedArtworks": [
    {
      "id": (string matching id from catalog),
      "title": (string),
      "price": (number),
      "category": (string),
      "artistName": (string),
      "image": (string url),
      "curatorNote": (string explaining why this artwork fits their space/request)
    }
  ],
  "suggestedPrompts": [
    (array of 3 short clickable follow-up suggestions for the user)
  ]
}
`;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`;

    const geminiRes = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: systemPrompt },
              { text: `User Inquiry: ${activePrompt}` },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.7,
        },
      }),
    });

    if (!geminiRes.ok) {
      const errData = await geminiRes.json().catch(() => ({}));
      return res.status(geminiRes.status).json({
        error: true,
        message: errData?.error?.message || "Failed to generate curator recommendation.",
      });
    }

    const geminiData = await geminiRes.json();
    const rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawText) {
      return res.status(500).json({
        error: true,
        message: "No response received from AI advisor.",
      });
    }

    const parsed = JSON.parse(rawText);

    res.json({
      success: true,
      data: parsed,
    });
  } catch (err) {
    console.error("[SERVER AI ART ADVISOR ERROR]:", err);
    res.status(500).json({
      error: true,
      message: err.message || "Failed to process advisor request.",
    });
  }
});

module.exports = router;
