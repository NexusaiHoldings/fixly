"use server";

import Anthropic from "@anthropic-ai/sdk";
import { Pool } from "pg";

export interface PriceEstimate {
  id: string;
  trade_category: string;
  complexity_tier: "simple" | "moderate" | "complex";
  price_band_low: number;
  price_band_high: number;
  description: string;
  created_at: string;
}

interface ClaudeEstimateResponse {
  trade_category: string;
  complexity_tier: "simple" | "moderate" | "complex";
  price_band_low: number;
  price_band_high: number;
  reasoning: string;
}

const anthropicClient = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function ensureTable(): Promise<void> {
  const db = await pool.connect();
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS dispatch_price_estimates (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        trade_category TEXT NOT NULL,
        complexity_tier TEXT NOT NULL,
        price_band_low INTEGER NOT NULL,
        price_band_high INTEGER NOT NULL,
        description TEXT NOT NULL,
        photo_count INTEGER DEFAULT 0,
        reasoning TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  } finally {
    db.release();
  }
}

async function callClaudeVision(
  category: string,
  description: string,
  photoBuffers: { data: string; mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp" }[],
): Promise<ClaudeEstimateResponse> {
  type ImageBlock = { type: "image"; source: { type: "base64"; media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp"; data: string } };
  type TextBlock = { type: "text"; text: string };
  const imageContent: ImageBlock[] = photoBuffers.map((photo) => ({
    type: "image",
    source: {
      type: "base64",
      media_type: photo.mediaType,
      data: photo.data,
    },
  }));

  const promptText: TextBlock = {
    type: "text",
    text: `You are a professional tradesperson estimator. Analyze this ${category} service request.

Issue description: "${description}"

${photoBuffers.length > 0 ? "Please examine the photos provided and assess the scope of work." : "No photos were provided — base your estimate on the description alone."}

Return a JSON object with exactly these fields:
{
  "trade_category": "${category}",
  "complexity_tier": "simple" or "moderate" or "complex",
  "price_band_low": integer (USD, labour + parts included),
  "price_band_high": integer (USD, labour + parts included),
  "reasoning": "one sentence explanation"
}

Complexity guide:
- simple: routine repair, under 2 hours, standard parts — typical range $75–$350
- moderate: skilled multi-step work, 2–6 hours, specialist parts — typical range $350–$900
- complex: major repair or multi-day job, specialist skills, significant parts — typical range $900–$3500

Respond with ONLY the JSON object. No markdown, no code fences, no other text.`,
  };

  const response = await anthropicClient.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 512,
    messages: [
      {
        role: "user",
        content: [...imageContent, promptText],
      },
    ],
  });

  const rawText =
    response.content[0].type === "text" ? response.content[0].text.trim() : "{}";

  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Claude returned unparseable response: ${rawText.slice(0, 200)}`);
  }

  const parsed = JSON.parse(jsonMatch[0]) as Partial<ClaudeEstimateResponse>;

  const validTiers = ["simple", "moderate", "complex"] as const;
  const tier = validTiers.includes(parsed.complexity_tier as "simple" | "moderate" | "complex")
    ? (parsed.complexity_tier as "simple" | "moderate" | "complex")
    : "moderate";

  return {
    trade_category: parsed.trade_category ?? category,
    complexity_tier: tier,
    price_band_low: Number(parsed.price_band_low) || 150,
    price_band_high: Number(parsed.price_band_high) || 500,
    reasoning: parsed.reasoning ?? "",
  };
}

export async function generatePriceEstimate(formData: FormData): Promise<PriceEstimate> {
  const category = (formData.get("category") as string | null) ?? "";
  const description = (formData.get("description") as string | null) ?? "";

  if (!category || !description.trim()) {
    throw new Error("category and description are required");
  }

  const photoFiles = formData.getAll("photos") as File[];
  const photoBuffers: { data: string; mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp" }[] = [];

  const allowedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
  type AllowedMime = (typeof allowedTypes)[number];

  for (const file of photoFiles) {
    if (file.size === 0) continue;
    const mime = allowedTypes.includes(file.type as AllowedMime)
      ? (file.type as AllowedMime)
      : "image/jpeg";
    const arrayBuffer = await file.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    photoBuffers.push({ data: base64, mediaType: mime });
  }

  const estimate = await callClaudeVision(category, description, photoBuffers);

  await ensureTable();

  const db = await pool.connect();
  try {
    const result = await db.query<PriceEstimate>(
      `INSERT INTO dispatch_price_estimates
         (trade_category, complexity_tier, price_band_low, price_band_high, description, photo_count, reasoning)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, trade_category, complexity_tier, price_band_low, price_band_high, description, created_at`,
      [
        estimate.trade_category,
        estimate.complexity_tier,
        estimate.price_band_low,
        estimate.price_band_high,
        description,
        photoBuffers.length,
        estimate.reasoning,
      ],
    );
    return result.rows[0];
  } finally {
    db.release();
  }
}

export async function getEstimateById(id: string): Promise<PriceEstimate | null> {
  if (!id) return null;
  const db = await pool.connect();
  try {
    const result = await db.query<PriceEstimate>(
      `SELECT id, trade_category, complexity_tier, price_band_low, price_band_high, description, created_at
       FROM dispatch_price_estimates
       WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  } finally {
    db.release();
  }
}
