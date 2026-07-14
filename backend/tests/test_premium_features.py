"""Tests for iteration 2 features: subscription phases, premium gating,
budgets CRUD, recurring expenses (with lazy auto-run), bill reminders,
CSV export, extended expense filters, and cross-household isolation of
premium collections.
"""
from datetime import date, datetime, timezone, timedelta


# ---------- Subscription Snapshot & Phases ----------

class TestSubscriptionStatus:
    def test_new_user_free_phase(self, api, client, seed_a, auth_headers):
        r = client.get(f"{api}/subscription/status", headers=auth_headers(seed_a["token"]))
        assert r.status_code == 200, r.text
        s = r.json()
        assert s["phase"] == "free"
        assert s["days_since_start"] <= 1
        assert s["premium_active"] is False
        assert s["founding_offer_available"] is True
        assert s["is_founding_member"] is False
        assert s["price_monthly"] == 15
        assert s["price_annual"] == 149
        assert s["founding_annual_price"] == 149

    def test_premium_trial_phase(self, api, client, seed_factory, auth_headers):
        u = seed_factory(prefix="TRIAL", days_since_plan_start=40)
        r = client.get(f"{api}/subscription/status", headers=auth_headers(u["token"]))
        assert r.status_code == 200
        s = r.json()
        assert s["phase"] == "premium_trial"
        assert s["premium_active"] is True
        # 30 + 60 - 40 = 50 days left roughly
        assert 45 <= s["days_until_next_phase"] <= 55

    def test_expired_phase(self, api, client, seed_factory, auth_headers):
        u = seed_factory(prefix="EXP", days_since_plan_start=100)
        r = client.get(f"{api}/subscription/status", headers=auth_headers(u["token"]))
        s = r.json()
        assert s["phase"] == "expired"
        assert s["premium_active"] is False
        assert s["founding_offer_available"] is False

    def test_paid_phase(self, api, client, seed_factory, auth_headers):
        future = datetime.now(timezone.utc) + timedelta(days=200)
        u = seed_factory(prefix="PAID", days_since_plan_start=20,
                         subscription_status="paid", subscription_expires_at=future)
        r = client.get(f"{api}/subscription/status", headers=auth_headers(u["token"]))
        s = r.json()
        assert s["phase"] == "paid"
        assert s["premium_active"] is True
        # paid users should NOT see the founding offer as available
        assert s["founding_offer_available"] is False
        assert s["subscription_expires_at"] is not None


# ---------- Subscription Activate ----------

class TestSubscriptionActivate:
    def test_founding_lock_within_60_days(self, api, client, seed_factory, auth_headers):
        u = seed_factory(prefix="FLK", days_since_plan_start=10)
        r = client.post(f"{api}/subscription/activate",
                        json={"plan": "founding_annual"},
                        headers=auth_headers(u["token"]))
        assert r.status_code == 200, r.text
        s = r.json()
        assert s["phase"] == "paid"
        assert s["is_founding_member"] is True
        assert s["premium_active"] is True
        # ~1 year expiry
        exp = datetime.fromisoformat(s["subscription_expires_at"].replace("Z", "+00:00"))
        delta = (exp - datetime.now(timezone.utc)).days
        assert 360 <= delta <= 370

        # status now shows founding_offer_available=False
        st = client.get(f"{api}/subscription/status", headers=auth_headers(u["token"])).json()
        assert st["founding_offer_available"] is False
        assert st["is_founding_member"] is True

    def test_founding_offer_unavailable_after_60_days(self, api, client, seed_factory, auth_headers):
        u = seed_factory(prefix="FLKOLD", days_since_plan_start=70)
        r = client.post(f"{api}/subscription/activate",
                        json={"plan": "founding_annual"},
                        headers=auth_headers(u["token"]))
        assert r.status_code == 400, r.text

    def test_monthly_and_annual_still_work_after_60_days(self, api, client, seed_factory, auth_headers):
        u1 = seed_factory(prefix="MO", days_since_plan_start=70)
        r = client.post(f"{api}/subscription/activate",
                        json={"plan": "monthly"},
                        headers=auth_headers(u1["token"]))
        assert r.status_code == 200
        s = r.json()
        assert s["phase"] == "paid"
        assert s["is_founding_member"] is False
        exp = datetime.fromisoformat(s["subscription_expires_at"].replace("Z", "+00:00"))
        assert 28 <= (exp - datetime.now(timezone.utc)).days <= 33

        u2 = seed_factory(prefix="AN", days_since_plan_start=70)
        r2 = client.post(f"{api}/subscription/activate",
                         json={"plan": "annual"},
                         headers=auth_headers(u2["token"]))
        assert r2.status_code == 200
        s2 = r2.json()
        assert s2["phase"] == "paid"
        exp2 = datetime.fromisoformat(s2["subscription_expires_at"].replace("Z", "+00:00"))
        assert 360 <= (exp2 - datetime.now(timezone.utc)).days <= 370

    def test_unknown_plan_400(self, api, client, seed_a, auth_headers):
        r = client.post(f"{api}/subscription/activate", json={"plan": "lifetime"},
                        headers=auth_headers(seed_a["token"]))
        assert r.status_code == 400


# ---------- Premium Gating (402) ----------

PREMIUM_ENDPOINTS_GET = ["/budgets", "/recurring", "/reminders", "/export/csv"]


class TestPremiumGating:
    def test_free_user_blocked_on_all_premium_endpoints(self, api, client, seed_a, auth_headers):
        h = auth_headers(seed_a["token"])
        # GET-only endpoints
        for path in PREMIUM_ENDPOINTS_GET:
            r = client.get(f"{api}{path}", headers=h)
            assert r.status_code == 402, f"{path}: expected 402 got {r.status_code} {r.text}"

        # POST endpoints — payload doesn't matter because gate runs first
        cid_fake = "any"
        for path, payload in [
            ("/budgets", {"category_id": cid_fake, "amount": 100}),
            ("/recurring", {"amount": 10, "category_id": cid_fake,
                            "next_run_date": date.today().isoformat()}),
            ("/reminders", {"title": "TEST rem", "due_date": date.today().isoformat()}),
        ]:
            r = client.post(f"{api}{path}", json=payload, headers=h)
            assert r.status_code == 402, f"POST {path}: expected 402 got {r.status_code}"

    def test_premium_trial_user_can_access(self, api, client, seed_factory, auth_headers):
        u = seed_factory(prefix="PT", days_since_plan_start=45)
        h = auth_headers(u["token"])
        r1 = client.get(f"{api}/budgets", headers=h)
        r2 = client.get(f"{api}/recurring", headers=h)
        r3 = client.get(f"{api}/reminders", headers=h)
        r4 = client.get(f"{api}/export/csv", headers=h)
        assert r1.status_code == 200
        assert r2.status_code == 200
        assert r3.status_code == 200
        assert r4.status_code == 200
        assert isinstance(r1.json(), list)
        csv = r4.json()
        assert "content" in csv and "filename" in csv and "count" in csv


# ---------- Budgets ----------

class TestBudgets:
    def test_create_list_uniqueness_update_delete(self, api, client, seed_factory, auth_headers):
        u = seed_factory(prefix="BG", days_since_plan_start=45)
        h = auth_headers(u["token"])
        cats = client.get(f"{api}/categories", headers=h).json()
        cid = cats[0]["id"]

        # POST creates
        r = client.post(f"{api}/budgets", json={"category_id": cid, "amount": 5000},
                        headers=h)
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["category_id"] == cid
        assert b["amount"] == 5000
        assert b["category_name"] == cats[0]["name"]
        assert b["spent"] == 0.0
        assert b["percent"] == 0.0
        assert b["remaining"] == 5000.0
        b_id = b["id"]

        # POST same category → updates (no duplicate)
        r2 = client.post(f"{api}/budgets", json={"category_id": cid, "amount": 8000},
                         headers=h)
        assert r2.status_code == 200
        b2 = r2.json()
        assert b2["amount"] == 8000
        # list has only 1 budget for this category
        lst = client.get(f"{api}/budgets", headers=h).json()
        same_cat = [x for x in lst if x["category_id"] == cid]
        assert len(same_cat) == 1
        assert same_cat[0]["amount"] == 8000

        # add matching expense → percent updates
        today = date.today().isoformat()
        ex = client.post(f"{api}/expenses", json={
            "amount": 2000.0, "category_id": cid, "date": today, "note": "TEST budget-hit",
        }, headers=h)
        assert ex.status_code == 200
        lst2 = client.get(f"{api}/budgets", headers=h).json()
        entry = next(x for x in lst2 if x["category_id"] == cid)
        assert entry["spent"] >= 2000.0
        assert abs(entry["percent"] - (entry["spent"] / 8000.0 * 100.0)) < 0.01
        assert entry["remaining"] == max(0.0, 8000.0 - entry["spent"])

        # DELETE
        d = client.delete(f"{api}/budgets/{b_id}", headers=h)
        assert d.status_code == 200
        lst3 = client.get(f"{api}/budgets", headers=h).json()
        assert not any(x["id"] == b_id for x in lst3)

    def test_budget_invalid_category(self, api, client, seed_factory, auth_headers):
        u = seed_factory(prefix="BGV", days_since_plan_start=45)
        r = client.post(f"{api}/budgets",
                        json={"category_id": "not-a-real-cat", "amount": 100},
                        headers=auth_headers(u["token"]))
        assert r.status_code == 400


# ---------- Recurring Expenses ----------

class TestRecurring:
    def test_create_auto_run_via_list_expenses(self, api, client, seed_factory, auth_headers, db):
        u = seed_factory(prefix="RC", days_since_plan_start=45)
        h = auth_headers(u["token"])
        cats = client.get(f"{api}/categories", headers=h).json()
        cid = cats[0]["id"]

        yesterday = (date.today() - timedelta(days=1)).isoformat()
        r = client.post(f"{api}/recurring", json={
            "amount": 1500.0, "category_id": cid,
            "note": "TEST_RECUR rent",
            "frequency": "monthly", "next_run_date": yesterday, "is_active": True,
        }, headers=h)
        assert r.status_code == 200, r.text
        tpl = r.json()
        assert tpl["next_run_date"] == yesterday
        tpl_id = tpl["id"]

        # Trigger lazy run via GET /api/expenses
        exps = client.get(f"{api}/expenses", headers=h).json()
        generated = [e for e in exps if e["note"] == "TEST_RECUR rent"]
        assert len(generated) >= 1

        # DB row for the template should have next_run_date advanced (>= today)
        tpl_doc = db.recurring_expenses.find_one({"id": tpl_id})
        assert tpl_doc is not None
        assert tpl_doc["next_run_date"] >= date.today().isoformat()

    def test_weekly_advances_by_7_days(self, api, client, seed_factory, auth_headers, db):
        u = seed_factory(prefix="RW", days_since_plan_start=45)
        h = auth_headers(u["token"])
        cats = client.get(f"{api}/categories", headers=h).json()
        cid = cats[0]["id"]
        yesterday = (date.today() - timedelta(days=1)).isoformat()
        r = client.post(f"{api}/recurring", json={
            "amount": 100.0, "category_id": cid, "note": "TEST_WEEK",
            "frequency": "weekly", "next_run_date": yesterday, "is_active": True,
        }, headers=h)
        assert r.status_code == 200
        tpl_id = r.json()["id"]
        # trigger
        client.get(f"{api}/expenses", headers=h)
        tpl_doc = db.recurring_expenses.find_one({"id": tpl_id})
        # yesterday + 7 days
        expected_min = (date.today() - timedelta(days=1) + timedelta(days=7)).isoformat()
        assert tpl_doc["next_run_date"] >= expected_min

    def test_update_and_delete_recurring(self, api, client, seed_factory, auth_headers):
        u = seed_factory(prefix="RUD", days_since_plan_start=45)
        h = auth_headers(u["token"])
        cats = client.get(f"{api}/categories", headers=h).json()
        cid = cats[0]["id"]
        r = client.post(f"{api}/recurring", json={
            "amount": 50.0, "category_id": cid, "note": "TEST_R",
            "frequency": "monthly",
            "next_run_date": (date.today() + timedelta(days=30)).isoformat(),
            "is_active": True,
        }, headers=h)
        rid = r.json()["id"]

        upd = client.put(f"{api}/recurring/{rid}", json={
            "amount": 75.0, "category_id": cid, "note": "TEST_R_upd",
            "frequency": "monthly",
            "next_run_date": (date.today() + timedelta(days=30)).isoformat(),
            "is_active": False,
        }, headers=h)
        assert upd.status_code == 200
        assert upd.json()["amount"] == 75.0
        assert upd.json()["is_active"] is False

        d = client.delete(f"{api}/recurring/{rid}", headers=h)
        assert d.status_code == 200
        d2 = client.delete(f"{api}/recurring/{rid}", headers=h)
        assert d2.status_code == 404


# ---------- Bill Reminders ----------

class TestReminders:
    def test_crud(self, api, client, seed_factory, auth_headers):
        u = seed_factory(prefix="RM", days_since_plan_start=45)
        h = auth_headers(u["token"])
        r = client.post(f"{api}/reminders", json={
            "title": "TEST Electricity", "amount": 1200.0,
            "due_date": (date.today() + timedelta(days=5)).isoformat(),
            "repeat": "monthly",
        }, headers=h)
        assert r.status_code == 200, r.text
        rem = r.json()
        assert rem["title"] == "TEST Electricity"
        assert rem["repeat"] == "monthly"
        rid = rem["id"]

        lst = client.get(f"{api}/reminders", headers=h).json()
        assert any(x["id"] == rid for x in lst)

        upd = client.put(f"{api}/reminders/{rid}", json={
            "title": "TEST Electricity B", "amount": 1500.0,
            "due_date": (date.today() + timedelta(days=6)).isoformat(),
            "repeat": "none",
        }, headers=h)
        assert upd.status_code == 200
        assert upd.json()["title"] == "TEST Electricity B"
        assert upd.json()["repeat"] == "none"

        d = client.delete(f"{api}/reminders/{rid}", headers=h)
        assert d.status_code == 200
        assert client.delete(f"{api}/reminders/{rid}", headers=h).status_code == 404


# ---------- CSV Export ----------

class TestCsvExport:
    def test_csv_header_and_escaping(self, api, client, seed_factory, auth_headers):
        u = seed_factory(prefix="CSV", days_since_plan_start=45)
        h = auth_headers(u["token"])
        cats = client.get(f"{api}/categories", headers=h).json()
        cid = cats[0]["id"]

        today = date.today().isoformat()
        tricky_note = 'a, b "c" d\ne'
        r = client.post(f"{api}/expenses", json={
            "amount": 42.5, "category_id": cid, "date": today, "note": tricky_note,
        }, headers=h)
        assert r.status_code == 200

        exp_r = client.get(f"{api}/export/csv",
                           params={"start": today, "end": today}, headers=h)
        assert exp_r.status_code == 200, exp_r.text
        payload = exp_r.json()
        assert set(payload.keys()) >= {"filename", "content", "count"}
        assert payload["count"] >= 1
        content = payload["content"]
        lines = content.split("\n")
        assert lines[0] == "Date,Category,Subcategory,Amount (INR),Paid By,Note"
        # Escaped note should appear as "a, b ""c"" d\ne" wrapped in quotes with doubled inner quotes
        assert '"a, b ""c"" d\ne"' in content

    def test_csv_date_range_filter_excludes(self, api, client, seed_factory, auth_headers):
        u = seed_factory(prefix="CSVF", days_since_plan_start=45)
        h = auth_headers(u["token"])
        cats = client.get(f"{api}/categories", headers=h).json()
        cid = cats[0]["id"]
        today = date.today().isoformat()
        client.post(f"{api}/expenses", json={
            "amount": 10.0, "category_id": cid, "date": today, "note": "TEST_in",
        }, headers=h)
        yesterday = (date.today() - timedelta(days=1)).isoformat()
        exp_r = client.get(f"{api}/export/csv",
                           params={"start": yesterday, "end": yesterday}, headers=h)
        assert exp_r.status_code == 200
        assert exp_r.json()["count"] == 0


# ---------- Dashboard Budgets Field ----------

class TestDashboardBudgets:
    def test_budgets_present_in_monthly_empty_in_others(self, api, client, seed_factory, auth_headers):
        u = seed_factory(prefix="DBG", days_since_plan_start=45)
        h = auth_headers(u["token"])
        cats = client.get(f"{api}/categories", headers=h).json()
        cid = cats[0]["id"]
        # create a budget
        client.post(f"{api}/budgets", json={"category_id": cid, "amount": 3000}, headers=h)
        # add an expense
        client.post(f"{api}/expenses", json={
            "amount": 500.0, "category_id": cid,
            "date": date.today().isoformat(), "note": "TEST_dash_bg",
        }, headers=h)

        m = client.get(f"{api}/dashboard", params={"period": "monthly"}, headers=h).json()
        assert isinstance(m.get("budgets"), list)
        assert len(m["budgets"]) >= 1
        entry = next(b for b in m["budgets"] if b["category_id"] == cid)
        assert entry["amount"] == 3000
        assert entry["spent"] >= 500

        for p in ["weekly", "yearly"]:
            d = client.get(f"{api}/dashboard", params={"period": p}, headers=h).json()
            assert d.get("budgets") == []


# ---------- Extended Expense Filters (available to all users) ----------

class TestExpenseFiltersExtended:
    def test_q_paid_by_min_max(self, api, client, seed_a, auth_headers):
        h = auth_headers(seed_a["token"])
        cats = client.get(f"{api}/categories", headers=h).json()
        cid = cats[0]["id"]
        today = date.today().isoformat()
        # 3 expenses: different amounts and notes
        rows = [
            (50.0, "milk and eggs"),
            (500.0, "Big Bazaar groceries"),
            (5000.0, "Rent payment"),
        ]
        ids = []
        for amt, note in rows:
            r = client.post(f"{api}/expenses", json={
                "amount": amt, "category_id": cid, "date": today, "note": note,
            }, headers=h)
            assert r.status_code == 200
            ids.append(r.json()["id"])

        # q filter (case-insensitive substring)
        r1 = client.get(f"{api}/expenses", params={"q": "BAZAAR"}, headers=h).json()
        assert any(e["id"] == ids[1] for e in r1)
        assert not any(e["id"] == ids[0] for e in r1)

        # min_amount
        r2 = client.get(f"{api}/expenses", params={"min_amount": 400}, headers=h).json()
        for e in r2:
            assert e["amount"] >= 400

        # max_amount
        r3 = client.get(f"{api}/expenses", params={"max_amount": 100}, headers=h).json()
        for e in r3:
            assert e["amount"] <= 100

        # min+max combined
        r4 = client.get(f"{api}/expenses",
                        params={"min_amount": 100, "max_amount": 1000}, headers=h).json()
        amts = [e["amount"] for e in r4]
        assert all(100 <= a <= 1000 for a in amts)

        # paid_by = current user → all 3 present
        r5 = client.get(f"{api}/expenses",
                        params={"paid_by": seed_a["user_id"]}, headers=h).json()
        found_ids = {e["id"] for e in r5}
        assert set(ids).issubset(found_ids)

        # paid_by = someone else → 0
        r6 = client.get(f"{api}/expenses",
                        params={"paid_by": "user_NONEXISTENT"}, headers=h).json()
        assert not any(e["id"] in ids for e in r6)


# ---------- Cross-Household Isolation ----------

class TestPremiumIsolation:
    def test_budgets_recurring_reminders_isolated(self, api, client, seed_factory, auth_headers):
        a = seed_factory(prefix="ISOA", days_since_plan_start=45)
        b = seed_factory(prefix="ISOB", days_since_plan_start=45)
        ha = auth_headers(a["token"])
        hb = auth_headers(b["token"])
        cats_a = client.get(f"{api}/categories", headers=ha).json()
        cid_a = cats_a[0]["id"]

        # A creates a budget, a recurring, and a reminder
        b_a = client.post(f"{api}/budgets",
                          json={"category_id": cid_a, "amount": 1000}, headers=ha).json()
        r_a = client.post(f"{api}/recurring", json={
            "amount": 10.0, "category_id": cid_a, "note": "TEST_iso",
            "frequency": "monthly",
            "next_run_date": (date.today() + timedelta(days=10)).isoformat(),
            "is_active": True,
        }, headers=ha).json()
        rem_a = client.post(f"{api}/reminders", json={
            "title": "TEST_iso_rem",
            "due_date": (date.today() + timedelta(days=3)).isoformat(),
            "repeat": "none",
        }, headers=ha).json()

        # B lists — must not see any of A's rows
        bl = client.get(f"{api}/budgets", headers=hb).json()
        rl = client.get(f"{api}/recurring", headers=hb).json()
        ml = client.get(f"{api}/reminders", headers=hb).json()
        assert not any(x["id"] == b_a["id"] for x in bl)
        assert not any(x["id"] == r_a["id"] for x in rl)
        assert not any(x["id"] == rem_a["id"] for x in ml)

        # B cannot delete A's rows
        assert client.delete(f"{api}/budgets/{b_a['id']}", headers=hb).status_code == 404
        assert client.delete(f"{api}/recurring/{r_a['id']}", headers=hb).status_code == 404
        assert client.delete(f"{api}/reminders/{rem_a['id']}", headers=hb).status_code == 404
