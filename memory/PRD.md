# Household Expense Tracker — PRD

## Overview
Mobile app (Expo React Native) for households to track shared expenses across multiple earners. Full CRUD for expenses (with receipts), categories/subcategories, plus dashboard, budgets, recurring expenses, bill reminders, and CSV export. Monetized via a staged trial → subscription model.

## Users
- Any household member ("earner") who signs in with Google.
- Multiple earners can be part of the same household by sharing an invite code.

## Auth
- Emergent-managed Google OAuth (`https://auth.emergentagent.com`).
- Session token stored in `expo-secure-store`; used as Bearer for all `/api` calls.

## Monetization Model (staged 90-day trial)
- **Day 0–29 (`free` phase):** every user gets the free features. Premium features are locked.
- **Day 30–89 (`premium_trial` phase):** premium features unlock free of charge for all users.
- **Day 90+ (`expired`):** premium features locked unless subscribed.
- **Pricing:** ₹15/month, ₹149/year, or ₹149/year "Founding" lock (available in first 60 days only; renewal price never increases while active).
- **Backend endpoints:** `GET /api/subscription/status`, `POST /api/subscription/activate`.
- **NOTE:** Activation currently trusts the client. Production wiring should verify Razorpay UPI AutoPay / Google Play Billing tokens before flipping `subscription_status='paid'`.

### Free features (never gated)
- Auth, household + invite codes, multi-earner sharing
- Expenses CRUD with base64 receipts
- Categories + subcategories CRUD
- Dashboard with all 6 periods (Daily/Weekly/Monthly/Quarterly/Half-yearly/Yearly)
- Search/filter of expenses (kept free to avoid frustration; UI locks the search icon behind premium banner as a soft upsell)

### Premium features (gated by `require_premium`)
- **Budget goals** per category with over-spend nudges on dashboard
- **Recurring expenses** (auto-generated via lazy runner on `GET /api/expenses` and `/api/dashboard`)
- **Bill reminders** with local notification scheduling on device (via `expo-notifications`)
- **CSV export** with preset ranges (this month, last month, this year, financial year, custom)
- **Advanced search & filters** UI (q / category / paid_by / min / max)

## Tech
- **Backend:** FastAPI + Motor (MongoDB), all routes under `/api`, timezone-aware datetimes, UUID string ids, `_id` excluded from every response.
- **Collections:** `users`, `user_sessions`, `households`, `categories`, `expenses`, `budgets`, `recurring_expenses`, `bill_reminders`.
- **Frontend:** Expo Router file-based routing, TypeScript, dark emerald theme.
- **Tabs:** Dashboard / Expenses / Categories / Profile.
- **Extra routes:** `/subscription`, `/budgets`, `/recurring`, `/reminders`, `/export`, `/expense/add`, `/expense/edit`.

## Design
- Dark-first finance app aesthetic: `#0C0D0F` surface, `#34D399` emerald accent.
- Global `PremiumBanner` on Dashboard/Expenses/Profile shows the trial phase, days remaining, and CTA to `/subscription`.
- `LockedFeatureSheet` bottom-sheet used when a free-phase user taps a premium feature.
- INR (`₹`) with Indian-style comma grouping.
- Timeline visualization on `/subscription` with 3 milestones (day 0 · day 30 · day 90).

## Testing
- `/app/backend/tests/test_backend_api.py` + `/app/backend/tests/test_premium_features.py`: 39/39 tests passing (iteration 2).
