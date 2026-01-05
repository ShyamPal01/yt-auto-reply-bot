# YT Auto-Reply Monetization Bot – Master Project Context

## SYSTEM PURPOSE
Automatically reply to YouTube comments using ONLY internal product catalog,
with affiliate monetization, click tracking, and policy-safe language.
No generic GPT answers are allowed.

---

## CORE RULES (NON-NEGOTIABLE)

1. GPT must NEVER invent products.
2. Replies MUST use MongoDB FinancialProduct collection.
3. Every link must be a tracked link: /r/:productId
4. No emojis in replies.
5. No guarantees, pressure language, or financial promises.
6. If no product found → auto-add inactive placeholder.
7. Affiliate links are applied ONLY in backend (smartAffiliate).

---

## COMMENT FLOW

YouTube Comment
→ normalizeText
→ detectTone
→ extractNeed (keyword)
→ GPT intent fallback (if weak)
→ save intent to LearnedIntent
→ fetch FinancialProduct
→ budget + CTR ranking
→ reply with tracked links
→ save replies & clicks

---

## DATABASE MODELS

### FinancialProduct
Fields:
- name
- type (credit-card, phone, loan)
- subCategory
- lifetimeFree
- minBudget
- maxBudget
- applyUrl
- clicks
- replies
- active

### LearnedIntent
- phrase
- category
- subCategory
- budget
- createdAt

### Replied
- commentId
- createdAt

### PendingConversation
- user
- commentId
- step

### UserThrottle
- user
- lastReply

---

## AFFILIATE FALLBACK ORDER (STRICT)

1. Cuelinks
2. Amazon Tag
3. vCommission
4. Impact
5. Direct URL (final fallback)

Function used everywhere:
const link = await smartAffiliate(product.applyUrl);

---

## RANKING LOGIC

1. Budget fit (minBudget, maxBudget)
2. CTR = (clicks + 1) / (replies + 1)
3. Highest CTR first
4. Return top 3 only

---

## AUTO-LEARNING LOGIC

When GPT intent is used:
- Save phrase, category, subCategory, budget into LearnedIntent
- Future comments try LearnedIntent before GPT

---

## CLICK TRACKING

Endpoint:
/r/:id

Logic:
- Increment product.clicks
- Redirect using smartAffiliate

User-visible links must ALWAYS be:
/r/:productId

---

## CRON + TIMING

- Engine tick every 10 minutes
- Per comment delay: 6–15 seconds
- Per user: max 1 reply per hour
- Daily replies < 170

Reply delay of 1–3 hours is expected and safe.

---

## OPENAI POLICY SAFE MODE

Allowed:
- Neutral product suggestions
- “Apply here” language
- Informational tone

Forbidden:
- Guaranteed approval
- Income promises
- Manipulative urgency

---

## DEBUG CHECKLIST

If reply not sent:
- Engine tick running
- VIDEO_IDS correct
- extractNeed not null
- Product exists & active
- Budget fits
- Not already replied
- User throttle allows

---

## IMPORTANT GPT INSTRUCTION

When assisting this project:
- Treat this file as source of truth
- Never override rules
- Never suggest generic replies
- Always optimize for monetization + safety
