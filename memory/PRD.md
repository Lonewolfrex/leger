# Household Expense Tracker — PRD

## Overview
Mobile app (Expo React Native) for households to track shared expenses across multiple earners. Includes CRUD for expenses (with receipt images), CRUD for categories/subcategories, and a category-wise dashboard across multiple periods.

## Users
- Any household member ("earner") who signs in with Google.
- Multiple earners can be part of the same household by sharing an invite code.

## Auth
- Emergent-managed Google OAuth (`https://auth.emergentagent.com`).
- Session token stored in `expo-secure-store`; used as Bearer for all `/api` calls.

## Core Features
1. **Auth & Household**
   - Google sign-in on first launch.
   - Each new user auto-creates a household with a shareable 8-char invite code.
   - Existing users can join another household with `POST /api/household/join`.

2. **Categories & Subcategories (CRUD)**
   - Default categories seeded on first login (Groceries, Utilities, Rent, Transport, Dining, Health, Entertainment, Other).
   - Full CRUD via `/api/categories`, plus subcategory CRUD nested under each category.
   - Each category has name, icon (Ionicons key), color swatch.

3. **Expenses (CRUD)**
   - Fields: amount (INR), category, optional subcategory, date, note, receipt (base64 image), paid-by earner (current user).
   - Endpoints: `GET/POST /api/expenses`, `GET/PUT/DELETE /api/expenses/{id}`.
   - Receipts attached via camera or gallery (`expo-image-picker`), stored as base64.

4. **Dashboard**
   - `GET /api/dashboard?period=daily|weekly|monthly|quarterly|biannual|yearly`.
   - Returns total, expense count, per-category totals (with subcategory breakdown), per-earner totals.
   - Frontend renders numeric list breakdown with a proportional bar per category (list-based, no charts as requested).

5. **Profile**
   - Displays current user, household members, invite code (copyable), join-another-household action, sign out.

## Tech
- Backend: FastAPI + Motor (MongoDB), routes under `/api`, timezone-aware datetimes, UUID string IDs, `_id` excluded from responses.
- Frontend: Expo Router file-based routing, TypeScript, dark emerald theme, tab navigation (Dashboard / Expenses / Categories / Profile), modal for add/edit expense.

## Design
- Dark-first finance app aesthetic: `#0C0D0F` surface, `#34D399` emerald accent.
- Dense card lists, sticky period-selector chips, glowing hero card on dashboard.
- INR currency (`₹`) with Indian-style comma grouping.
