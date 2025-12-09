// Paste-only index.js (replace your current file)
const express = require("express");
const { google } = require("googleapis");

const app = express();
const PORT = process.env.PORT || 3000;

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  "http://localhost"
);

oauth2Client.setCredentials({
  refresh_token: process.env.YT_REFRESH_TOKEN,
});

const youtube = google.youtube({
  version: "v3",
  auth: oauth2Client,
});

// --------- Utilities: parsing & link building ----------

// Normalize whitespace and basic punctuation
function normalizeText(s) {
  return (s || "")
    .replace(/\s+/g, " ")
    .replace(/[₹,]/g, "") // remove rupee symbol & commas for parsing
    .trim();
}

// Try to find a budget number and its unit (k, hazar, thousand)
function parseNumberWithUnit(text) {
  if (!text) return null;

  // Common patterns:
  // 2500
  // 2.5k / 2k / 2 K
  // 2k ke under
  // 2 hazar / 2हज़ार
  // under 2500
  // We'll search for number with optional decimal and optional unit nearby.

  const t = text;

  // 1) look for explicit "under <number>" or "<number> ke under"
  const underRegexes = [
    /\bunder\s+([0-9]+(?:\.[0-9]+)?)(\s*(k|K|thousand|हज़ार|हज़ार))?\b/i,
    /\b([0-9]+(?:\.[0-9]+)?)(\s*(k|K|thousand|हज़ार|हज़ार))?\s+ke\s+under\b/i,
    /\b([0-9]+(?:\.[0-9]+)?)(\s*(k|K|thousand|हज़ार|हज़ार))?\s+ke\b/i
  ];
  for (const rx of underRegexes) {
    const m = t.match(rx);
    if (m) {
      return { rawMatch: m[0], num: m[1], unit: (m[3] || "").toLowerCase(), multiplier: unitMultiplier(m[3]) };
    }
  }

  // 2) fallback: find the first standalone number (with optional unit)
  const generic = /\b([0-9]+(?:\.[0-9]+)?)(\s*(k|K|thousand|हज़ार|हज़ार))?\b/;
  const m2 = t.match(generic);
  if (m2) {
    return { rawMatch: m2[0], num: m2[1], unit: (m2[3] || "").toLowerCase(), multiplier: unitMultiplier(m2[3]) };
  }

  return null;
}

function unitMultiplier(unitToken) {
  if (!unitToken) return 1;
  const u = String(unitToken).toLowerCase();
  if (u === "k" || u === "thousand" || u === "हज़ार" || u === "हज़ार") return 1000;
  return 1;
}

// Main extractor: returns { need, budget } or null
function extractBudgetAndNeed(originalText) {
  if (!originalText || typeof originalText !== "string") return null;

  // Keep original for need extraction, but a normalized copy for number search
  const normalized = normalizeText(originalText);

  const parsed = parseNumberWithUnit(normalized);
  if (!parsed) {
    return null;
  }

  let { rawMatch, num, multiplier } = parsed;

  // Parse numeric value safely
  let budget = Number(num);
  if (isNaN(budget)) return null;

  // If unit multiplier exists, only apply if the unit was explicitly present
  // multiplier is already 1 or 1000
  budget = Math.round(budget * multiplier);

  // Remove only the exact matched substring from the original text to form the need.
  // Use a case-insensitive removal of the first occurrence.
  const re = new RegExp(escapeRegExp(rawMatch), "i");
  let need = originalText.replace(re, "").trim();

  // Additionally remove common filler words like "ke under", "under", "please", "bata do"
  need = need
    .replace(/\bke\s*under\b/gi, "")
    .replace(/\bunder\b/gi, "")
    .replace(/\bplease\b/gi, "")
    .replace(/\bbata\s+do\b/gi, "")
    .replace(/\bplease\b/gi, "")
    .replace(/\bpl\b/gi, "")
    .trim();

  // If the extracted need is empty or too short, try to take nearby words around the match
  if (!need || need.length < 2) {
    // attempt to extract up to 4 words before or after the matched number
    const windowRegex = new RegExp(`(?:\\b(?:[A-Za-z0-9अ-ह]+)\\b\\s*){0,4}${escapeRegExp(rawMatch)}(?:\\s*(?:\\b[A-Za-z0-9अ-ह]+\\b\\s*){0,6})`, "i");
    const win = normalized.match(windowRegex);
    if (win) {
      let candidate = win[0].replace(new RegExp(escapeRegExp(rawMatch), "i"), "").trim();
      candidate = candidate.replace(/\bke\b/gi, "").replace(/\bunder\b/gi, "").trim();
      if (candidate && candidate.length > need.length) need = candidate;
    }
  }

  // Final cleanup
  need = need.replace(/\s+/g, " ").trim();
  if (!need) return null;

  return { need, budget };
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Build Amazon search link safely
function buildAmazonSearchLink(need, budget) {
  const tag = (process.env.AMAZON_TAG || "").trim();
  const base = "https://www.amazon.in/s";

  const queryParts = [];
  if (need) queryParts.push(need.trim());
  if (budget) queryParts.push(`under ${budget} rupees`);

  const search = queryParts.join(" ");
  const params = new URLSearchParams();
  if (search) params.set("k", search);
  if (tag && tag !== "AMAZON_TAG") params.set("tag", tag); // avoid literal placeholder

  return `${base}?${params.toString()}`;
}

function generateReplyText(need, budget, link) {
  let budgetText = "aapke budget";
  if (budget) {
    // Format with Indian grouping
    budgetText = `approx ₹${Number(budget).toLocaleString("en-IN")}`;
  }

  return (
    `Aapki requirement: "${need}"\n` +
    `Aur budget: ${budgetText} ke hisaab se,\n` +
    `ye Amazon par best options ke liye search link hai:\n` +
    `${link}\n\n` +
    `Is link se aap direct products dekh sakte hain,\n` +
    `latest price, offer aur reviews real-time check kar sakte hain. 🙂`
  );
}

// --------------- Main bot logic ----------------

async function handleNewComments() {
  const response = await youtube.commentThreads.list({
    part: ["snippet"],
    videoId: process.env.VIDEO_ID,
    maxResults: 50,
    order: "time",
  });

  const items = response.data.items || [];
  const actions = [];

  for (const item of items) {
    try {
      const snippet = item.snippet;
      const topComment = snippet.topLevelComment;
      if (!topComment) continue;

      const commentId = topComment.id;
      const textOriginal = (topComment.snippet.textDisplay || "").trim();
      const totalReplyCount = snippet.totalReplyCount || 0;

      // skip if already replied
      if (totalReplyCount > 0) continue;

      const parsed = extractBudgetAndNeed(textOriginal);
      if (!parsed) {
        console.log("Skip (no budget/need found):", textOriginal);
        continue;
      }

      const { need, budget } = parsed;

      // Build affiliate link
      const affiliateLink = buildAmazonSearchLink(need, budget);

      // Final reply
      const replyText = generateReplyText(need, budget, affiliateLink);

      console.log("Replying to:", commentId, "need:", need, "budget:", budget);

      await youtube.comments.insert({
        part: ["snippet"],
        requestBody: {
          snippet: {
            parentId: commentId,
            textOriginal: replyText,
          },
        },
      });

      actions.push({ commentId, originalComment: textOriginal, need, budget, affiliateLink });
    } catch (err) {
      console.error("Error processing comment thread item:", err && err.message ? err.message : err);
      continue;
    }
  }

  return { processedComments: actions.length, replies: actions };
}

// ---------------- Express endpoints ----------------

app.get("/", (req, res) => {
  res.send("YouTube Auto Reply Bot is running.");
});

app.get("/check-comments", async (req, res) => {
  try {
    // quick sanity checks for environment
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.YT_REFRESH_TOKEN || !process.env.VIDEO_ID) {
      const missing = [];
      if (!process.env.GOOGLE_CLIENT_ID) missing.push("GOOGLE_CLIENT_ID");
      if (!process.env.GOOGLE_CLIENT_SECRET) missing.push("GOOGLE_CLIENT_SECRET");
      if (!process.env.YT_REFRESH_TOKEN) missing.push("YT_REFRESH_TOKEN");
      if (!process.env.VIDEO_ID) missing.push("VIDEO_ID");
      return res.status(500).json({ status: "error", message: "Missing env vars: " + missing.join(", ") });
    }

    // Warn if AMAZON_TAG unset or placeholder
    if (!process.env.AMAZON_TAG || process.env.AMAZON_TAG === "AMAZON_TAG") {
      console.warn("AMAZON_TAG missing or placeholder. Links will be created without tag.");
    }

    const result = await handleNewComments();
    res.json({ status: "ok", ...result });
  } catch (err) {
    console.error("Error in /check-comments:", err);
    res.status(500).json({ status: "error", message: err.message || err });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
