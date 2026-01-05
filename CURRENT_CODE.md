# CURRENT WORKING CODE (REFERENCE ONLY)

## index.js (as of Jan 2026)

```js
// ===== Paste-only optimized FULL index.js =====

require("dotenv").config();
const express = require("express");
const { google } = require("googleapis");
const mongoose = require("mongoose");
const OpenAI = require("openai");

/* ================= Mongo ================= */
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("Mongo Connected"))
  .catch(err => console.error(err.message));

const FinancialProduct = mongoose.model("FinancialProduct", new mongoose.Schema({
  name: String,
  type: String,
  subCategory: String,
  lifetimeFree: Boolean,
  minBudget: Number,
  maxBudget: Number,
  applyUrl: String,
  clicks: Number,
  replies: Number,
  active: Boolean
}));

// …
// PASTE FULL FILE EXACTLY
// …
