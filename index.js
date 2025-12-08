import express from "express";
import { google } from "googleapis";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  "http://localhost" // Deploy में change होगा
);

// Set refresh token manually
oauth2Client.setCredentials({
  refresh_token: process.env.YT_REFRESH_TOKEN,
});

const youtube = google.youtube({
  version: "v3",
  auth: oauth2Client,
});

// --- SAMPLE PRODUCT LOGIC ---
// (Later हम इसे Amazon/Flipkart API से connect करेंगे)
function getBestProduct(budget) {
  if (budget < 8000) return "Redmi A3 – Budget King";
  if (budget < 12000) return "Realme Narzo N55 – Best under 12K";
  if (budget < 20000) return "iQOO Z6 Lite – Best Performance under 20K";
  return "Samsung M34 – Best Overall";
}

// --- AUTO REPLY FUNCTION ---
async function replyToComment(commentId, replyText) {
  await youtube.comments.insert({
    part: ["snippet"],
    requestBody: {
      snippet: {
        parentId: commentId,
        textOriginal: replyText,
      },
    },
  });
}

// --- MAIN COMMENT CHECKER ---
app.get("/check-comments", async (req, res) => {
  try {
    const response = await youtube.commentThreads.list({
      part: ["snippet"],
      videoId: process.env.VIDEO_ID, // जिस वीडियो पर bot चलाना है
      maxResults: 20,
    });

    const comments = response.data.items;

    for (let c of comments) {
      const comment = c.snippet.topLevelComment.snippet.textDisplay;

      // Budget extract karna
      const match = comment.match(/(\d{4,6})/);
      if (!match) continue;

      const budget = parseInt(match[1]);

      const product = getBestProduct(budget);

      const replyMessage = `Aapke budget ₹${budget} me best option: ${product}\nAffiliate link: https://amzn.to/yourlink`;

      await replyToComment(c.snippet.topLevelComment.id, replyMessage);
    }

    res.send("Auto-reply executed.");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error processing comments");
  }
});

// Server start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`BOT RUNNING on port ${PORT}…`));

