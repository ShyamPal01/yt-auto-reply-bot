require("dotenv").config();
const express = require("express");
const { google } = require("googleapis");
const { URLSearchParams } = require("url");

const app = express();
const PORT = process.env.PORT || 3000;

// --- OAuth2 Client Setup (YouTube ke liye) ---
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  "http://localhost" // redirect yaha use nahi ho raha
);

oauth2Client.setCredentials({
  refresh_token: process.env.YT_REFRESH_TOKEN,
});

const youtube = google.youtube({
  version: "v3",
  auth: oauth2Client,
});

// ---------------- HELPER FUNCTIONS ----------------

// Comment se budget + requirement nikalna
function extractBudgetAndNeed(text) {
  if (!text) return null;

  // Commas / ₹ / rs remove karke normalize
  let normalized = text
    .replace(/₹/g, " ")
    .replace(/rs\.?/gi, " ")
    .replace(/rupaye?/gi, " ")
    .replace(/रुपये?/gi, " ")
    .replace(/,/g, "");

  // Number detect with optional "k / hazar"
  const regex = /(\d+)(\s*(k|K|हज़ार|हजार))?/;
  const match = normalized.match(regex);

  if (!match) {
    return null;
  }

  let numberPart = match[1];
  let unit = match[3];

  let budget = parseInt(numberPart, 10);
  if (isNaN(budget)) return null;

  if (unit && /k|K|हज़ार|हजार/.test(unit)) {
    budget = budget * 1000;
  }

  // Requirement = original text se matched budget part hata ke
  const need = text.replace(match[0], "").trim();

  if (!need) {
    // Agar kuch bhi requirement nahi bachi to skip
    return null;
  }

  return {
    need,
    budget,
  };
}

// Amazon affiliate search link banana
function buildAmazonSearchLink(need, budget) {
  const tag = process.env.AMAZON_TAG || "";
  const base = "https://www.amazon.in/s";

  const queryParts = [];
  if (need) queryParts.push(need.trim());
  if (budget) queryParts.push(`under ${budget} rupees`);

  const search = queryParts.join(" ");

  const params = new URLSearchParams();
  if (search) params.set("k", search);
  if (tag) params.set("tag", tag);

  return `${base}?${params.toString()}`;
}

// Reply ka final text banana (Hinglish)
function generateReplyText(need, budget, link) {
  let budgetText = "aapke budget";
  if (budget) {
    budgetText = `approx ₹${budget.toLocaleString("en-IN")}`;
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

// New comments check + reply karna
async function handleNewComments() {
  // Latest comments read
  const response = await youtube.commentThreads.list({
    part: ["snippet"],
    videoId: process.env.VIDEO_ID,
    maxResults: 50,
    order: "time",
  });

  const items = response.data.items || [];
  const actions = [];

  for (const item of items) {
    const snippet = item.snippet;
    const topComment = snippet.topLevelComment;

    if (!topComment) continue;

    const commentId = topComment.id;
    const textOriginal = topComment.snippet.textDisplay || "";
    const totalReplyCount = snippet.totalReplyCount || 0;

    // Agar already reply ho chuka hai to skip
    if (totalReplyCount > 0) {
      continue;
    }

    // Comment se budget + need nikalna
    const parsed = extractBudgetAndNeed(textOriginal);
    if (!parsed) {
      // Agar format samajh nahi aaya to filhaal skip
      console.log("Skip (no budget/need found):", textOriginal);
      continue;
    }

    const { need, budget } = parsed;

    // Amazon affiliate search link
    const affiliateLink = buildAmazonSearchLink(need, budget);

    // Final reply text
    const replyText = generateReplyText(need, budget, affiliateLink);

    console.log("Replying to:", commentId, "->", replyText);

    // YouTube pe reply bhejna
    await youtube.comments.insert({
      part: ["snippet"],
      requestBody: {
        snippet: {
          parentId: commentId,
          textOriginal: replyText,
        },
      },
    });

    actions.push({
      commentId,
      originalComment: textOriginal,
      need,
      budget,
      affiliateLink,
    });
  }

  return {
    processedComments: actions.length,
    replies: actions,
  };
}

// ---------------- EXPRESS ROUTES ----------------

app.get("/", (req, res) => {
  res.send("YouTube Auto Reply Bot is running.");
});

// Cron-job.org ya manual hit ke liye endpoint
app.get("/check-comments", async (req, res) => {
  try {
    const result = await handleNewComments();
    res.json({
      status: "ok",
      ...result,
    });
  } catch (err) {
    console.error("Error in /check-comments:", err);
    res.status(500).json({
      status: "error",
      message: err.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
