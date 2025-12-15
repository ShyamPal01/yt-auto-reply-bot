// Paste-only optimized index.js
// Requirements:
// - package.json must NOT have "type": "module"
// - Set env vars on Render: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, YT_REFRESH_TOKEN, VIDEO_ID, AMAZON_TAG

const express = require("express");
const { google } = require("googleapis");

const app = express();
const PORT = process.env.PORT || 3000;

const REQUIRED_ENVS = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "YT_REFRESH_TOKEN", "VIDEO_ID", "AMAZON_TAG"];

// quick env check at startup
const missingEnvs = REQUIRED_ENVS.filter(k => !process.env[k] || !String(process.env[k]).trim());
if (missingEnvs.length > 0) {
  console.error("Missing required environment variables:", missingEnvs.join(", "));
  // still start server so you can see the message on Render logs, but mark unhealthy
}

// OAuth2 client (YouTube)
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

// ---------- Helpers ----------

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeText(s) {
  return (s || "")
    .replace(/\s+/g, " ")
    .replace(/[₹,]/g, "") // remove rupee symbol & commas for parsing
    .trim();
}

// Extract ASIN from an Amazon URL or text containing an Amazon url
function extractAsinFromUrl(str) {
  if (!str) return null;
  // patterns: /dp/ASIN or /gp/product/ASIN
  const m = String(str).match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
  return m ? m[1] : null;
}

function unitMultiplier(unitToken) {
  if (!unitToken) return 1;
  const u = String(unitToken).toLowerCase();
  if (u === "k" || u === "thousand" || u === "हज़ार" || u === "हज़ार") return 1000;
  if (u === "lakh" || u === "lac" || u === "लाख") return 100000;
  return 1;
}

// Try to find number with optional unit in text
function parseNumberWithUnit(text) {
  if (!text) return null;
  const t = text;

  const underRegexes = [
    /\bunder\s+([0-9]+(?:\.[0-9]+)?)(\s*(k|K|thousand|हज़ार|हज़ार|lakh|lac|लाख))?\b/i,
    /\b([0-9]+(?:\.[0-9]+)?)(\s*(k|K|thousand|हज़ार|हज़ार|lakh|lac|लाख))?\s+ke\s+under\b/i,
    /\b([0-9]+(?:\.[0-9]+)?)(\s*(k|K|thousand|हज़ार|हज़ार|lakh|lac|लाख))?\s+ke\b/i
  ];
  for (const rx of underRegexes) {
    const m = t.match(rx);
    if (m) {
      return { rawMatch: m[0], num: m[1], unit: (m[3] || "").toLowerCase(), multiplier: unitMultiplier(m[3]) };
    }
  }

  const generic = /\b([0-9]+(?:\.[0-9]+)?)(\s*(k|K|thousand|हज़ार|हज़ार|lakh|lac|लाख))?\b/;
  const m2 = t.match(generic);
  if (m2) {
    return { rawMatch: m2[0], num: m2[1], unit: (m2[3] || "").toLowerCase(), multiplier: unitMultiplier(m2[3]) };
  }
  return null;
}

function extractBudgetAndNeed(originalText) {
  if (!originalText || typeof originalText !== "string") return null;

  // If user pasted an Amazon product URL, try to get ASIN and treat as need = product
  const asinMaybe = extractAsinFromUrl(originalText);
  const normalized = normalizeText(originalText);

  const parsed = parseNumberWithUnit(normalized);
  if (!parsed && !asinMaybe) return null;

  let budget = null;
  if (parsed) {
    let { rawMatch, num, multiplier } = parsed;
    let val = Number(num);
    if (!isNaN(val)) {
      budget = Math.round(val * (multiplier || 1));
    }
    // remove the matched number phrase to form need
    const re = new RegExp(escapeRegExp(rawMatch), "i");
    let need = originalText.replace(re, "").trim();
    need = need
      .replace(/\bke\s*under\b/gi, "")
      .replace(/\bunder\b/gi, "")
      .replace(/\bplease\b/gi, "")
      .replace(/\bbata\s+do\b/gi, "")
      .replace(/\bpl\b/gi, "")
      .trim();

    // if too short, try window capture
    if (!need || need.length < 2) {
      const windowRegex = new RegExp(`(?:\\b(?:[A-Za-z0-9अ-ह]+)\\b\\s*){0,4}${escapeRegExp(parsed.rawMatch)}(?:\\s*(?:\\b[A-Za-z0-9अ-ह]+\\b\\s*){0,6})`, "i");
      const win = normalized.match(windowRegex);
      if (win) {
        let candidate = win[0].replace(new RegExp(escapeRegExp(parsed.rawMatch), "i"), "").trim();
        candidate = candidate.replace(/\bke\b/gi, "").replace(/\bunder\b/gi, "").trim();
        if (candidate && candidate.length > need.length) need = candidate;
      }
    }

    need = need.replace(/\s+/g, " ").trim();
    if (!need && asinMaybe) need = `product ${asinMaybe}`;
    if (!need) return null;
    return { need, budget, asin: asinMaybe || null };
  } else {
    // no budget but ASIN present -> user pasted a product url like "check this: https://.../dp/ASIN"
    const need = asinMaybe ? `product ${asinMaybe}` : null;
    return { need, budget: null, asin: asinMaybe || null };
  }
}

// Build affiliate link: prefer dp/ASIN/?tag=... else search link with tag
function buildAffiliateLink({ need, budget, asin }) {
  const tag = (process.env.AMAZON_TAG || "").trim();
  // enforce tag presence
  if (!tag) {
    throw new Error("AMAZON_TAG is not set. Please set AMAZON_TAG env var to your affiliate tracking id.");
  }

  if (asin) {
    // clean product-level link
    return `https://www.amazon.in/dp/${asin}/?tag=${encodeURIComponent(tag)}`;
  }

  const baseSearch = "https://www.amazon.in/s";
  const qparts = [];
  if (need) qparts.push(need.trim());
  if (budget) qparts.push(`under ${budget} rupees`);
  const search = qparts.join(" ");
  const params = new URLSearchParams();
  if (search) params.set("k", search);
  params.set("tag", tag);
  return `${baseSearch}?${params.toString()}`;
}

// Build reply with short disclosure
function buildReplyText(need, budget, affiliateLink) {
  const budgetText = budget
    ? `₹${Number(budget).toLocaleString("en-IN")}`
    : "aapke budget ke hisaab se";

  return (
`Aapki requirement:
${need}

Aur budget:
${budgetText}

Product Purchase Link:
${affiliateLink}

Note:
Is product link se purchase karne par aapko kisi bhi tarah ka
koi nuksaan nahi hoga, na hi aapko koi extra charge lagega.
Aapke discount me bhi koi fark nahi padega.
Isliye aap bina kisi confusion ke yahan se purchase kar sakte hain.

Agar aapko kisi aur product ki recommendation chahiye
to comment me apni requirement + budget zaroor likhen 😊

Thank you for your support 🙏`
  );
}

// --------------- Main logic ----------------

async function handleNewComments() {
  // fetch latest comment threads
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

      // skip already replied threads
      if (totalReplyCount > 0) continue;

      const parsed = extractBudgetAndNeed(textOriginal);
      if (!parsed) {
        console.log("Skip (no budget/need found):", textOriginal);
        continue;
      }

      const { need, budget, asin } = parsed;

      // build affiliate link (this will throw if AMAZON_TAG not set)
      const affiliateLink = buildAffiliateLink({ need, budget, asin });

      const replyText = buildReplyText(need, budget, affiliateLink);

      console.log("Replying to:", commentId, "need:", need, "budget:", budget, "link:", affiliateLink);

      // post reply
      await youtube.comments.insert({
        part: ["snippet"],
        requestBody: {
          snippet: {
            parentId: commentId,
            textOriginal: replyText,
          },
        },
      });

      // push action for response
      actions.push({ commentId, originalComment: textOriginal, need, budget, affiliateLink });
    } catch (err) {
      console.error("Error processing comment:", err && err.message ? err.message : err);
      // continue processing next comments without breaking
      continue;
    }
  }

  return { processedComments: actions.length, replies: actions };
}

// ---------------- HTTP endpoints ----------------

app.get("/", (req, res) => {
  res.send("YouTube Auto Reply Bot (affiliate-enforced) is running.");
});

app.get("/check-comments", async (req, res) => {
  try {
    // enforce presence of required envs before processing
    const stillMissing = REQUIRED_ENVS.filter(k => !process.env[k] || !String(process.env[k]).trim());
    if (stillMissing.length > 0) {
      const msg = `Missing required env vars: ${stillMissing.join(", ")}. Set them in Render environment before running.`;
      console.error(msg);
      return res.status(500).json({ status: "error", message: msg });
    }

    const result = await handleNewComments();
    res.json({ status: "ok", ...result });
  } catch (err) {
    console.error("Error in /check-comments:", err && err.message ? err.message : err);
    res.status(500).json({ status: "error", message: err.message || err });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
