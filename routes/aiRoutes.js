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

module.exports = router;
