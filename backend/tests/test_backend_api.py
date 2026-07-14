"""End-to-end backend API tests for the Household Expense Tracker.

Covers: auth (me/logout), household get/join, categories & subcategories CRUD,
expenses CRUD (with base64 receipt), dashboard aggregation, and data isolation.
"""
import base64
import uuid
from datetime import date, datetime, timezone, timedelta

import requests


# ---------- Auth ----------

class TestAuth:
    def test_me_without_token_returns_401(self, api, client):
        r = client.get(f"{api}/auth/me")
        assert r.status_code == 401, r.text

    def test_me_with_invalid_token_returns_401(self, api, client):
        r = client.get(f"{api}/auth/me", headers={"Authorization": "Bearer nope_invalid_token"})
        assert r.status_code == 401

    def test_me_with_valid_token(self, api, client, seed_a, auth_headers):
        r = client.get(f"{api}/auth/me", headers=auth_headers(seed_a["token"]))
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["user_id"] == seed_a["user_id"]
        assert data["email"] == seed_a["email"]
        assert data["household_id"] == seed_a["household_id"]

    def test_me_with_expired_session(self, api, client, db, auth_headers):
        # Manually seed an expired session
        user_id = f"user_TEST_{uuid.uuid4().hex[:10]}"
        household_id = f"hh_TEST_{uuid.uuid4().hex[:8]}"
        token = f"tok_TEST_exp_{uuid.uuid4().hex}"
        db.households.insert_one({"id": household_id, "name": "TEST exp", "invite_code": uuid.uuid4().hex[:8].upper(),
                                  "owner_user_id": user_id, "created_at": datetime.now(timezone.utc).isoformat()})
        db.users.insert_one({"user_id": user_id, "email": f"TEST_exp_{uuid.uuid4().hex[:6]}@example.com",
                             "name": "TEST exp", "picture": None, "household_id": household_id,
                             "created_at": datetime.now(timezone.utc).isoformat()})
        db.user_sessions.insert_one({
            "session_token": token, "user_id": user_id,
            "expires_at": datetime.now(timezone.utc) - timedelta(days=1),
            "created_at": datetime.now(timezone.utc) - timedelta(days=8),
        })
        try:
            r = client.get(f"{api}/auth/me", headers=auth_headers(token))
            assert r.status_code == 401
        finally:
            db.user_sessions.delete_one({"session_token": token})
            db.users.delete_one({"user_id": user_id})
            db.households.delete_one({"id": household_id})

    def test_logout_deletes_session(self, api, client, db, seed_a, auth_headers):
        # confirm session exists
        assert db.user_sessions.find_one({"session_token": seed_a["token"]}) is not None
        r = client.post(f"{api}/auth/logout", headers=auth_headers(seed_a["token"]))
        assert r.status_code == 200
        assert r.json().get("ok") is True
        assert db.user_sessions.find_one({"session_token": seed_a["token"]}) is None
        # further call with token should now be 401
        r2 = client.get(f"{api}/auth/me", headers=auth_headers(seed_a["token"]))
        assert r2.status_code == 401


# ---------- Household ----------

class TestHousehold:
    def test_get_household_returns_members_and_invite_code(self, api, client, seed_a, auth_headers):
        r = client.get(f"{api}/household", headers=auth_headers(seed_a["token"]))
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["id"] == seed_a["household_id"]
        assert isinstance(data.get("invite_code"), str)
        assert len(data["invite_code"]) == 8
        assert data["invite_code"] == seed_a["invite_code"]
        assert isinstance(data["members"], list)
        assert any(m["user_id"] == seed_a["user_id"] for m in data["members"])

    def test_join_household_success(self, api, client, seed_a, seed_b, auth_headers, db):
        # user B joins A's household using A's invite code
        r = client.post(f"{api}/household/join", json={"code": seed_a["invite_code"]},
                        headers=auth_headers(seed_b["token"]))
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["id"] == seed_a["household_id"]
        member_ids = [m["user_id"] for m in data["members"]]
        assert seed_a["user_id"] in member_ids
        assert seed_b["user_id"] in member_ids
        # verify DB
        u = db.users.find_one({"user_id": seed_b["user_id"]})
        assert u["household_id"] == seed_a["household_id"]

    def test_join_household_unknown_code_404(self, api, client, seed_a, auth_headers):
        r = client.post(f"{api}/household/join", json={"code": "ZZZZZZZZ"},
                        headers=auth_headers(seed_a["token"]))
        assert r.status_code == 404


# ---------- Categories ----------

class TestCategories:
    def test_list_default_categories_seeded(self, api, client, seed_a, auth_headers):
        r = client.get(f"{api}/categories", headers=auth_headers(seed_a["token"]))
        assert r.status_code == 200
        cats = r.json()
        assert len(cats) == 8
        names = {c["name"] for c in cats}
        assert {"Groceries", "Utilities", "Rent", "Transport", "Dining",
                "Health", "Entertainment", "Other"}.issubset(names)
        # shape checks
        for c in cats:
            assert "id" in c and "household_id" in c and "icon" in c and "color" in c
            assert c["household_id"] == seed_a["household_id"]

    def test_create_update_delete_category(self, api, client, seed_a, auth_headers):
        h = auth_headers(seed_a["token"])
        r = client.post(f"{api}/categories", json={"name": "TEST_Books", "icon": "book", "color": "#123456"}, headers=h)
        assert r.status_code == 200, r.text
        cat = r.json()
        assert cat["name"] == "TEST_Books"
        assert cat["icon"] == "book"
        cid = cat["id"]

        # verify via GET list
        list_r = client.get(f"{api}/categories", headers=h)
        assert any(c["id"] == cid for c in list_r.json())

        # update
        r = client.put(f"{api}/categories/{cid}", json={"name": "TEST_Books2", "icon": "book2", "color": "#654321"}, headers=h)
        assert r.status_code == 200
        assert r.json()["name"] == "TEST_Books2"
        assert r.json()["color"] == "#654321"

        # delete
        r = client.delete(f"{api}/categories/{cid}", headers=h)
        assert r.status_code == 200
        # confirm gone
        list_r2 = client.get(f"{api}/categories", headers=h)
        assert not any(c["id"] == cid for c in list_r2.json())

    def test_subcategory_crud(self, api, client, seed_a, auth_headers):
        h = auth_headers(seed_a["token"])
        cats = client.get(f"{api}/categories", headers=h).json()
        cid = cats[0]["id"]

        # add sub
        r = client.post(f"{api}/categories/{cid}/subcategories", json={"name": "TEST_Sub1"}, headers=h)
        assert r.status_code == 200
        subs = r.json()["subcategories"]
        assert any(s["name"] == "TEST_Sub1" for s in subs)
        sub_id = next(s["id"] for s in subs if s["name"] == "TEST_Sub1")

        # update sub
        r = client.put(f"{api}/categories/{cid}/subcategories/{sub_id}", json={"name": "TEST_Sub1b"}, headers=h)
        assert r.status_code == 200
        assert any(s["id"] == sub_id and s["name"] == "TEST_Sub1b" for s in r.json()["subcategories"])

        # delete sub
        r = client.delete(f"{api}/categories/{cid}/subcategories/{sub_id}", headers=h)
        assert r.status_code == 200
        assert not any(s["id"] == sub_id for s in r.json()["subcategories"])


# ---------- Expenses ----------

def _tiny_png_b64():
    # 1x1 transparent PNG
    raw = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
    )
    return "data:image/png;base64," + base64.b64encode(raw).decode()


class TestExpenses:
    def test_create_list_get_update_delete_expense_with_receipt(self, api, client, seed_a, auth_headers):
        h = auth_headers(seed_a["token"])
        cats = client.get(f"{api}/categories", headers=h).json()
        cid = cats[0]["id"]

        # add a subcategory
        sub_resp = client.post(f"{api}/categories/{cid}/subcategories", json={"name": "TEST_SubX"}, headers=h).json()
        sub_id = next(s["id"] for s in sub_resp["subcategories"] if s["name"] == "TEST_SubX")

        receipt = _tiny_png_b64()
        today = date.today().isoformat()

        r = client.post(f"{api}/expenses", json={
            "amount": 123.45,
            "category_id": cid,
            "subcategory_id": sub_id,
            "note": "TEST purchase",
            "date": today,
            "receipt_base64": receipt,
        }, headers=h)
        assert r.status_code == 200, r.text
        exp = r.json()
        assert exp["amount"] == 123.45
        assert exp["category_id"] == cid
        assert exp["subcategory_id"] == sub_id
        assert exp["category_name"] == cats[0]["name"]
        assert exp["subcategory_name"] == "TEST_SubX"
        assert exp["paid_by_user_id"] == seed_a["user_id"]
        assert exp["paid_by_name"] == f"TEST A"
        assert exp["receipt_base64"] == receipt
        eid = exp["id"]

        # list
        list_r = client.get(f"{api}/expenses", headers=h)
        assert list_r.status_code == 200
        assert any(e["id"] == eid for e in list_r.json())

        # get by id
        got = client.get(f"{api}/expenses/{eid}", headers=h)
        assert got.status_code == 200
        assert got.json()["receipt_base64"] == receipt

        # update
        upd = client.put(f"{api}/expenses/{eid}", json={
            "amount": 200.0, "category_id": cid, "subcategory_id": None,
            "note": "TEST upd", "date": today, "receipt_base64": None,
        }, headers=h)
        assert upd.status_code == 200
        assert upd.json()["amount"] == 200.0
        assert upd.json()["subcategory_id"] is None
        assert upd.json()["receipt_base64"] is None

        # filter by category
        f_r = client.get(f"{api}/expenses", params={"category_id": cid}, headers=h)
        assert f_r.status_code == 200
        assert all(e["category_id"] == cid for e in f_r.json())
        assert any(e["id"] == eid for e in f_r.json())

        # filter by date range excluding today
        yesterday = (date.today() - timedelta(days=1)).isoformat()
        f2 = client.get(f"{api}/expenses", params={"start": yesterday, "end": yesterday}, headers=h)
        assert f2.status_code == 200
        assert not any(e["id"] == eid for e in f2.json())

        # delete
        d = client.delete(f"{api}/expenses/{eid}", headers=h)
        assert d.status_code == 200
        # verify 404
        assert client.get(f"{api}/expenses/{eid}", headers=h).status_code == 404

    def test_create_expense_invalid_category(self, api, client, seed_a, auth_headers):
        h = auth_headers(seed_a["token"])
        r = client.post(f"{api}/expenses", json={
            "amount": 10.0, "category_id": "not-a-cat", "date": date.today().isoformat(),
        }, headers=h)
        assert r.status_code == 400


# ---------- Dashboard ----------

class TestDashboard:
    def test_dashboard_monthly_aggregates(self, api, client, seed_a, auth_headers):
        h = auth_headers(seed_a["token"])
        cats = client.get(f"{api}/categories", headers=h).json()
        c1, c2 = cats[0], cats[1]
        today = date.today().isoformat()

        # create 3 expenses across 2 categories today
        for amt, cid in [(100.0, c1["id"]), (50.0, c1["id"]), (30.0, c2["id"])]:
            r = client.post(f"{api}/expenses", json={
                "amount": amt, "category_id": cid, "date": today, "note": "TEST dash",
            }, headers=h)
            assert r.status_code == 200

        r = client.get(f"{api}/dashboard", params={"period": "monthly"}, headers=h)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["total"] >= 180.0
        assert d["expense_count"] >= 3
        assert "start" in d and "end" in d
        # by_category structure
        cat_totals = {c["category_id"]: c for c in d["by_category"]}
        assert cat_totals[c1["id"]]["total"] >= 150.0
        assert cat_totals[c1["id"]]["count"] >= 2
        assert cat_totals[c2["id"]]["total"] >= 30.0
        # includes color/icon
        assert "color" in cat_totals[c1["id"]]
        assert "icon" in cat_totals[c1["id"]]
        # by_earner
        assert any(e["user_id"] == seed_a["user_id"] and e["total"] >= 180.0 for e in d["by_earner"])

    def test_dashboard_all_periods_valid(self, api, client, seed_a, auth_headers):
        h = auth_headers(seed_a["token"])
        for p in ["daily", "weekly", "monthly", "quarterly", "biannual", "yearly"]:
            r = client.get(f"{api}/dashboard", params={"period": p}, headers=h)
            assert r.status_code == 200, f"{p}: {r.text}"
            data = r.json()
            assert data["period"] == p
            assert "start" in data and "end" in data
            assert isinstance(data["total"], (int, float))

    def test_dashboard_invalid_period(self, api, client, seed_a, auth_headers):
        r = client.get(f"{api}/dashboard", params={"period": "bogus"}, headers=auth_headers(seed_a["token"]))
        assert r.status_code == 400


# ---------- Data Isolation ----------

class TestIsolation:
    def test_user_a_cannot_see_household_b_categories(self, api, client, seed_a, seed_b, auth_headers):
        # A creates a category
        h_a = auth_headers(seed_a["token"])
        h_b = auth_headers(seed_b["token"])
        cr = client.post(f"{api}/categories", json={"name": "TEST_SecretA"}, headers=h_a)
        assert cr.status_code == 200
        secret_id = cr.json()["id"]

        # B lists categories - must not see A's
        b_list = client.get(f"{api}/categories", headers=h_b).json()
        assert not any(c["id"] == secret_id for c in b_list)

        # B cannot update/delete A's category
        upd = client.put(f"{api}/categories/{secret_id}", json={"name": "hijack"}, headers=h_b)
        assert upd.status_code == 404
        d = client.delete(f"{api}/categories/{secret_id}", headers=h_b)
        assert d.status_code == 404

    def test_user_a_cannot_see_household_b_expenses(self, api, client, seed_a, seed_b, auth_headers):
        # B creates an expense in own household
        h_a = auth_headers(seed_a["token"])
        h_b = auth_headers(seed_b["token"])
        cats_b = client.get(f"{api}/categories", headers=h_b).json()
        cr = client.post(f"{api}/expenses", json={
            "amount": 999.0, "category_id": cats_b[0]["id"], "date": date.today().isoformat(),
        }, headers=h_b)
        assert cr.status_code == 200
        eid = cr.json()["id"]

        # A cannot see or fetch it
        a_list = client.get(f"{api}/expenses", headers=h_a).json()
        assert not any(e["id"] == eid for e in a_list)
        g = client.get(f"{api}/expenses/{eid}", headers=h_a)
        assert g.status_code == 404
        d = client.delete(f"{api}/expenses/{eid}", headers=h_a)
        assert d.status_code == 404
