"""Shared fixtures for backend tests.

Since the app auths via Emergent Google OAuth (which cannot be scripted),
we seed users/households/sessions directly in MongoDB and hit the protected
endpoints with `Authorization: Bearer <session_token>`.
"""
import os
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "https://receipt-tracker-app-3.preview.emergentagent.com"
BASE_URL = BASE_URL.rstrip("/")
API = f"{BASE_URL}/api"

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]


@pytest.fixture(scope="session")
def db():
    client = MongoClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


@pytest.fixture(scope="session")
def base_url():
    return BASE_URL


def _seed_household_user_session(db, email_prefix: str, seed_default_cats: bool = True,
                                 days_since_plan_start: int = 0,
                                 subscription_status: str = "trial",
                                 subscription_expires_at=None,
                                 is_founding_member: bool = False):
    """Seed a household + user + session. Returns dict with ids and token."""
    user_id = f"user_TEST_{uuid.uuid4().hex[:10]}"
    household_id = f"hh_TEST_{uuid.uuid4().hex[:8]}"
    invite_code = uuid.uuid4().hex[:8].upper()
    token = f"tok_TEST_{uuid.uuid4().hex}"
    email = f"TEST_{email_prefix}_{uuid.uuid4().hex[:6]}@example.com"

    plan_started_at = (datetime.now(timezone.utc) - timedelta(days=days_since_plan_start)).isoformat()
    sub_exp_iso = subscription_expires_at.isoformat() if isinstance(subscription_expires_at, datetime) else subscription_expires_at

    db.households.insert_one({
        "id": household_id,
        "name": f"TEST {email_prefix} Household",
        "invite_code": invite_code,
        "owner_user_id": user_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    db.users.insert_one({
        "user_id": user_id,
        "email": email,
        "name": f"TEST {email_prefix}",
        "picture": None,
        "household_id": household_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "plan_started_at": plan_started_at,
        "subscription_status": subscription_status,
        "subscription_expires_at": sub_exp_iso,
        "is_founding_member": is_founding_member,
    })
    db.user_sessions.insert_one({
        "session_token": token,
        "user_id": user_id,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
        "created_at": datetime.now(timezone.utc),
    })

    if seed_default_cats:
        defaults = [
            ("Groceries", "cart", "#34D399"), ("Utilities", "flash", "#FBBF24"),
            ("Rent", "home", "#A78BFA"), ("Transport", "car", "#60A5FA"),
            ("Dining", "restaurant", "#F87171"), ("Health", "medkit", "#F472B6"),
            ("Entertainment", "game-controller", "#22D3EE"), ("Other", "ellipsis-horizontal", "#9CA3AF"),
        ]
        for name, icon, color in defaults:
            db.categories.insert_one({
                "id": str(uuid.uuid4()),
                "household_id": household_id,
                "name": name, "icon": icon, "color": color,
                "subcategories": [],
                "created_at": datetime.now(timezone.utc).isoformat(),
            })

    return {
        "user_id": user_id,
        "household_id": household_id,
        "invite_code": invite_code,
        "token": token,
        "email": email,
    }


def _cleanup(db, household_ids, user_ids, tokens):
    if household_ids:
        db.households.delete_many({"id": {"$in": household_ids}})
        db.categories.delete_many({"household_id": {"$in": household_ids}})
        db.expenses.delete_many({"household_id": {"$in": household_ids}})
        db.budgets.delete_many({"household_id": {"$in": household_ids}})
        db.recurring_expenses.delete_many({"household_id": {"$in": household_ids}})
        db.bill_reminders.delete_many({"household_id": {"$in": household_ids}})
    if user_ids:
        db.users.delete_many({"user_id": {"$in": user_ids}})
    if tokens:
        db.user_sessions.delete_many({"session_token": {"$in": tokens}})


@pytest.fixture
def seed_a(db):
    data = _seed_household_user_session(db, "A")
    yield data
    _cleanup(db, [data["household_id"]], [data["user_id"]], [data["token"]])


@pytest.fixture
def seed_b(db):
    data = _seed_household_user_session(db, "B")
    yield data
    _cleanup(db, [data["household_id"]], [data["user_id"]], [data["token"]])


@pytest.fixture
def seed_factory(db):
    """Factory fixture to seed users with custom subscription phases. Auto-cleans."""
    created = {"households": [], "users": [], "tokens": []}

    def _make(prefix="X", days_since_plan_start=0, subscription_status="trial",
              subscription_expires_at=None, is_founding_member=False, seed_default_cats=True):
        d = _seed_household_user_session(
            db, prefix,
            seed_default_cats=seed_default_cats,
            days_since_plan_start=days_since_plan_start,
            subscription_status=subscription_status,
            subscription_expires_at=subscription_expires_at,
            is_founding_member=is_founding_member,
        )
        created["households"].append(d["household_id"])
        created["users"].append(d["user_id"])
        created["tokens"].append(d["token"])
        return d

    yield _make
    _cleanup(db, created["households"], created["users"], created["tokens"])


@pytest.fixture
def api():
    return API


@pytest.fixture
def auth_headers():
    def _make(token: str):
        return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    return _make


@pytest.fixture
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s
