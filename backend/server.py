from fastapi import FastAPI, APIRouter, Header, HTTPException, Depends
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import uuid
import httpx
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta, date


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


# =============== Constants ===============

FREE_DAYS = 30           # everyone: fully-free basic period
PREMIUM_TRIAL_DAYS = 60  # after day 30, premium features unlocked for 60 more days
TOTAL_TRIAL_DAYS = FREE_DAYS + PREMIUM_TRIAL_DAYS  # day 91+ requires paid
FOUNDING_LOCK_DAYS = 60  # can lock founding price during first 60 days
PRICE_MONTHLY = 15
PRICE_ANNUAL = 149
FOUNDING_ANNUAL_PRICE = 149  # locked forever for founding members


# =============== Models ===============

class SessionRequest(BaseModel):
    session_id: str

class UserOut(BaseModel):
    user_id: str
    email: str
    name: str
    picture: Optional[str] = None
    household_id: str

class AuthResponse(BaseModel):
    user: UserOut
    session_token: str

class Subcategory(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str

class CategoryIn(BaseModel):
    name: str
    icon: Optional[str] = "tag"
    color: Optional[str] = "#34D399"

class CategoryOut(BaseModel):
    id: str
    household_id: str
    name: str
    icon: str
    color: str
    subcategories: List[Subcategory] = []

class SubcategoryIn(BaseModel):
    name: str

class ExpenseIn(BaseModel):
    amount: float
    category_id: str
    subcategory_id: Optional[str] = None
    note: Optional[str] = ""
    date: str
    receipt_base64: Optional[str] = None

class ExpenseOut(BaseModel):
    id: str
    household_id: str
    amount: float
    category_id: str
    category_name: str
    subcategory_id: Optional[str] = None
    subcategory_name: Optional[str] = None
    note: str
    date: str
    receipt_base64: Optional[str] = None
    paid_by_user_id: str
    paid_by_name: str
    created_at: str

class JoinHouseholdIn(BaseModel):
    code: str

class HouseholdOut(BaseModel):
    id: str
    name: str
    invite_code: str
    members: List[Dict[str, Any]]

class BudgetIn(BaseModel):
    category_id: str
    amount: float
    period: str = "monthly"  # monthly only for now

class BudgetOut(BaseModel):
    id: str
    household_id: str
    category_id: str
    category_name: str
    category_color: str
    amount: float
    period: str
    spent: float
    percent: float
    remaining: float

class RecurringIn(BaseModel):
    amount: float
    category_id: str
    subcategory_id: Optional[str] = None
    note: Optional[str] = ""
    frequency: str = "monthly"       # monthly | weekly
    day_of_month: Optional[int] = None
    day_of_week: Optional[int] = None
    next_run_date: str               # YYYY-MM-DD
    is_active: bool = True

class RecurringOut(BaseModel):
    id: str
    household_id: str
    amount: float
    category_id: str
    category_name: str
    subcategory_id: Optional[str] = None
    subcategory_name: Optional[str] = None
    note: str
    frequency: str
    day_of_month: Optional[int] = None
    day_of_week: Optional[int] = None
    next_run_date: str
    is_active: bool
    created_by_user_id: str

class BillReminderIn(BaseModel):
    title: str
    amount: Optional[float] = None
    due_date: str   # YYYY-MM-DD
    repeat: str = "none"  # none | monthly

class BillReminderOut(BaseModel):
    id: str
    household_id: str
    title: str
    amount: Optional[float] = None
    due_date: str
    repeat: str
    created_by_user_id: str

class SubscriptionOut(BaseModel):
    plan_started_at: str
    days_since_start: int
    phase: str  # free | premium_trial | paid | expired
    days_until_next_phase: int
    premium_active: bool
    founding_offer_available: bool
    is_founding_member: bool
    price_monthly: int
    price_annual: int
    founding_annual_price: int
    subscription_expires_at: Optional[str] = None


# =============== Auth Helpers ===============

async def get_current_user(authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization.replace("Bearer ", "").strip()
    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")
    exp = session.get("expires_at")
    if isinstance(exp, datetime):
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        if exp < datetime.now(timezone.utc):
            raise HTTPException(status_code=401, detail="Session expired")
    user = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


DEFAULT_CATEGORIES = [
    {"name": "Groceries", "icon": "cart", "color": "#34D399"},
    {"name": "Utilities", "icon": "flash", "color": "#FBBF24"},
    {"name": "Rent", "icon": "home", "color": "#A78BFA"},
    {"name": "Transport", "icon": "car", "color": "#60A5FA"},
    {"name": "Dining", "icon": "restaurant", "color": "#F87171"},
    {"name": "Health", "icon": "medkit", "color": "#F472B6"},
    {"name": "Entertainment", "icon": "game-controller", "color": "#22D3EE"},
    {"name": "Other", "icon": "ellipsis-horizontal", "color": "#9CA3AF"},
]


async def ensure_default_categories(household_id: str):
    existing = await db.categories.count_documents({"household_id": household_id})
    if existing == 0:
        docs = []
        for c in DEFAULT_CATEGORIES:
            docs.append({
                "id": str(uuid.uuid4()),
                "household_id": household_id,
                "name": c["name"],
                "icon": c["icon"],
                "color": c["color"],
                "subcategories": [],
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
        if docs:
            await db.categories.insert_many(docs)


def gen_invite_code() -> str:
    return uuid.uuid4().hex[:8].upper()


def _parse_iso_dt(s: str) -> datetime:
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        dt = datetime.now(timezone.utc)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _subscription_snapshot(user: Dict[str, Any]) -> SubscriptionOut:
    plan_started = _parse_iso_dt(user.get("plan_started_at") or user.get("created_at") or datetime.now(timezone.utc).isoformat())
    days_since = (datetime.now(timezone.utc) - plan_started).days
    sub_status = user.get("subscription_status") or "trial"
    sub_expires_at = user.get("subscription_expires_at")
    sub_expires_dt: Optional[datetime] = None
    if sub_expires_at:
        sub_expires_dt = _parse_iso_dt(sub_expires_at)

    # Determine phase
    paid_active = (sub_status == "paid" and sub_expires_dt and sub_expires_dt > datetime.now(timezone.utc))

    if paid_active:
        phase = "paid"
        days_until_next = max(0, (sub_expires_dt - datetime.now(timezone.utc)).days)
        premium_active = True
    elif days_since < FREE_DAYS:
        phase = "free"
        days_until_next = FREE_DAYS - days_since
        premium_active = False
    elif days_since < TOTAL_TRIAL_DAYS:
        phase = "premium_trial"
        days_until_next = TOTAL_TRIAL_DAYS - days_since
        premium_active = True
    else:
        phase = "expired"
        days_until_next = 0
        premium_active = False

    founding_offer = (days_since < FOUNDING_LOCK_DAYS) and not user.get("is_founding_member") and not paid_active

    return SubscriptionOut(
        plan_started_at=plan_started.isoformat(),
        days_since_start=days_since,
        phase=phase,
        days_until_next_phase=days_until_next,
        premium_active=premium_active,
        founding_offer_available=founding_offer,
        is_founding_member=bool(user.get("is_founding_member")),
        price_monthly=PRICE_MONTHLY,
        price_annual=PRICE_ANNUAL,
        founding_annual_price=FOUNDING_ANNUAL_PRICE,
        subscription_expires_at=sub_expires_dt.isoformat() if sub_expires_dt else None,
    )


async def require_premium(user: Dict[str, Any]):
    snap = _subscription_snapshot(user)
    if not snap.premium_active:
        raise HTTPException(status_code=402, detail="Premium subscription required")


# =============== Auth Routes ===============

@api_router.post("/auth/session", response_model=AuthResponse)
async def create_session(payload: SessionRequest):
    async with httpx.AsyncClient(timeout=15.0) as http:
        try:
            resp = await http.get(
                "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
                headers={"X-Session-ID": payload.session_id},
            )
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Auth provider error: {e}")
    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail=f"Invalid session_id: {resp.text}")
    data = resp.json()
    email = data.get("email")
    name = data.get("name") or (email.split("@")[0] if email else "User")
    picture = data.get("picture")
    session_token = data.get("session_token")
    if not email or not session_token:
        raise HTTPException(status_code=400, detail="Malformed auth response")

    now_iso = datetime.now(timezone.utc).isoformat()
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if user:
        user_id = user["user_id"]
        household_id = user["household_id"]
        await db.users.update_one({"user_id": user_id}, {"$set": {"name": name, "picture": picture}})
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        household_id = f"hh_{uuid.uuid4().hex[:10]}"
        await db.households.insert_one({
            "id": household_id,
            "name": f"{name}'s Household",
            "invite_code": gen_invite_code(),
            "owner_user_id": user_id,
            "created_at": now_iso,
        })
        await db.users.insert_one({
            "user_id": user_id,
            "email": email,
            "name": name,
            "picture": picture,
            "household_id": household_id,
            "created_at": now_iso,
            "plan_started_at": now_iso,
            "subscription_status": "trial",
            "subscription_expires_at": None,
            "is_founding_member": False,
        })
        await ensure_default_categories(household_id)

    expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    await db.user_sessions.update_one(
        {"session_token": session_token},
        {"$set": {
            "session_token": session_token,
            "user_id": user_id,
            "expires_at": expires_at,
            "created_at": datetime.now(timezone.utc),
        }},
        upsert=True,
    )

    return AuthResponse(
        user=UserOut(user_id=user_id, email=email, name=name, picture=picture, household_id=household_id),
        session_token=session_token,
    )


@api_router.get("/auth/me", response_model=UserOut)
async def get_me(current=Depends(get_current_user)):
    return UserOut(
        user_id=current["user_id"],
        email=current["email"],
        name=current["name"],
        picture=current.get("picture"),
        household_id=current["household_id"],
    )


@api_router.post("/auth/logout")
async def logout(authorization: Optional[str] = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization.replace("Bearer ", "").strip()
        await db.user_sessions.delete_one({"session_token": token})
    return {"ok": True}


# =============== Subscription Routes ===============

@api_router.get("/subscription/status", response_model=SubscriptionOut)
async def sub_status(current=Depends(get_current_user)):
    return _subscription_snapshot(current)


class ActivateIn(BaseModel):
    plan: str  # "monthly" | "annual" | "founding_annual"
    # In production a payment_token / mandate_id would be verified against Razorpay / Google Play Billing.
    # For MVP the mobile client hands the entitlement flag over after the native flow completes.


@api_router.post("/subscription/activate", response_model=SubscriptionOut)
async def sub_activate(payload: ActivateIn, current=Depends(get_current_user)):
    now = datetime.now(timezone.utc)
    if payload.plan == "monthly":
        expires = now + timedelta(days=31)
        is_founding = current.get("is_founding_member", False)
    elif payload.plan == "annual":
        expires = now + timedelta(days=366)
        is_founding = current.get("is_founding_member", False)
    elif payload.plan == "founding_annual":
        snap = _subscription_snapshot(current)
        if not snap.founding_offer_available:
            raise HTTPException(400, "Founding offer no longer available")
        expires = now + timedelta(days=366)
        is_founding = True
    else:
        raise HTTPException(400, "Unknown plan")

    await db.users.update_one(
        {"user_id": current["user_id"]},
        {"$set": {
            "subscription_status": "paid",
            "subscription_expires_at": expires.isoformat(),
            "subscription_plan": payload.plan,
            "is_founding_member": is_founding,
        }},
    )
    fresh = await db.users.find_one({"user_id": current["user_id"]}, {"_id": 0})
    return _subscription_snapshot(fresh)


# =============== Household Routes ===============

@api_router.get("/household", response_model=HouseholdOut)
async def get_household(current=Depends(get_current_user)):
    hh = await db.households.find_one({"id": current["household_id"]}, {"_id": 0})
    if not hh:
        raise HTTPException(404, "Household not found")
    members_cursor = db.users.find({"household_id": hh["id"]}, {"_id": 0, "user_id": 1, "name": 1, "email": 1, "picture": 1})
    members = await members_cursor.to_list(length=100)
    return HouseholdOut(id=hh["id"], name=hh["name"], invite_code=hh["invite_code"], members=members)


@api_router.post("/household/join", response_model=HouseholdOut)
async def join_household(payload: JoinHouseholdIn, current=Depends(get_current_user)):
    hh = await db.households.find_one({"invite_code": payload.code.upper().strip()}, {"_id": 0})
    if not hh:
        raise HTTPException(404, "Invalid invite code")
    old_household_id = current["household_id"]
    await db.users.update_one({"user_id": current["user_id"]}, {"$set": {"household_id": hh["id"]}})
    remaining = await db.users.count_documents({"household_id": old_household_id})
    if remaining == 0:
        await db.households.delete_one({"id": old_household_id})
        await db.categories.delete_many({"household_id": old_household_id})
        await db.budgets.delete_many({"household_id": old_household_id})
        await db.recurring_expenses.delete_many({"household_id": old_household_id})
        await db.bill_reminders.delete_many({"household_id": old_household_id})
    members_cursor = db.users.find({"household_id": hh["id"]}, {"_id": 0, "user_id": 1, "name": 1, "email": 1, "picture": 1})
    members = await members_cursor.to_list(length=100)
    return HouseholdOut(id=hh["id"], name=hh["name"], invite_code=hh["invite_code"], members=members)


# =============== Category Routes ===============

def category_to_out(doc) -> CategoryOut:
    return CategoryOut(
        id=doc["id"],
        household_id=doc["household_id"],
        name=doc["name"],
        icon=doc.get("icon", "tag"),
        color=doc.get("color", "#34D399"),
        subcategories=[Subcategory(**s) for s in doc.get("subcategories", [])],
    )


@api_router.get("/categories", response_model=List[CategoryOut])
async def list_categories(current=Depends(get_current_user)):
    cursor = db.categories.find({"household_id": current["household_id"]}, {"_id": 0}).sort("name", 1)
    docs = await cursor.to_list(length=500)
    return [category_to_out(d) for d in docs]


@api_router.post("/categories", response_model=CategoryOut)
async def create_category(payload: CategoryIn, current=Depends(get_current_user)):
    doc = {
        "id": str(uuid.uuid4()),
        "household_id": current["household_id"],
        "name": payload.name.strip(),
        "icon": payload.icon or "tag",
        "color": payload.color or "#34D399",
        "subcategories": [],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.categories.insert_one(doc)
    doc.pop("_id", None)
    return category_to_out(doc)


@api_router.put("/categories/{category_id}", response_model=CategoryOut)
async def update_category(category_id: str, payload: CategoryIn, current=Depends(get_current_user)):
    result = await db.categories.find_one_and_update(
        {"id": category_id, "household_id": current["household_id"]},
        {"$set": {"name": payload.name.strip(), "icon": payload.icon or "tag", "color": payload.color or "#34D399"}},
        projection={"_id": 0},
        return_document=True,
    )
    if not result:
        raise HTTPException(404, "Category not found")
    return category_to_out(result)


@api_router.delete("/categories/{category_id}")
async def delete_category(category_id: str, current=Depends(get_current_user)):
    res = await db.categories.delete_one({"id": category_id, "household_id": current["household_id"]})
    if res.deleted_count == 0:
        raise HTTPException(404, "Category not found")
    return {"ok": True}


@api_router.post("/categories/{category_id}/subcategories", response_model=CategoryOut)
async def add_subcategory(category_id: str, payload: SubcategoryIn, current=Depends(get_current_user)):
    sub = {"id": str(uuid.uuid4()), "name": payload.name.strip()}
    result = await db.categories.find_one_and_update(
        {"id": category_id, "household_id": current["household_id"]},
        {"$push": {"subcategories": sub}},
        projection={"_id": 0},
        return_document=True,
    )
    if not result:
        raise HTTPException(404, "Category not found")
    return category_to_out(result)


@api_router.put("/categories/{category_id}/subcategories/{sub_id}", response_model=CategoryOut)
async def update_subcategory(category_id: str, sub_id: str, payload: SubcategoryIn, current=Depends(get_current_user)):
    result = await db.categories.find_one_and_update(
        {"id": category_id, "household_id": current["household_id"], "subcategories.id": sub_id},
        {"$set": {"subcategories.$.name": payload.name.strip()}},
        projection={"_id": 0},
        return_document=True,
    )
    if not result:
        raise HTTPException(404, "Subcategory not found")
    return category_to_out(result)


@api_router.delete("/categories/{category_id}/subcategories/{sub_id}", response_model=CategoryOut)
async def delete_subcategory(category_id: str, sub_id: str, current=Depends(get_current_user)):
    result = await db.categories.find_one_and_update(
        {"id": category_id, "household_id": current["household_id"]},
        {"$pull": {"subcategories": {"id": sub_id}}},
        projection={"_id": 0},
        return_document=True,
    )
    if not result:
        raise HTTPException(404, "Category not found")
    return category_to_out(result)


# =============== Expense Routes ===============

async def _enrich_expense(doc, cat_map, user_map) -> ExpenseOut:
    cat = cat_map.get(doc["category_id"], {})
    sub_name = None
    if doc.get("subcategory_id"):
        for s in cat.get("subcategories", []):
            if s["id"] == doc["subcategory_id"]:
                sub_name = s["name"]
                break
    return ExpenseOut(
        id=doc["id"],
        household_id=doc["household_id"],
        amount=doc["amount"],
        category_id=doc["category_id"],
        category_name=cat.get("name", "Unknown"),
        subcategory_id=doc.get("subcategory_id"),
        subcategory_name=sub_name,
        note=doc.get("note", ""),
        date=doc["date"],
        receipt_base64=doc.get("receipt_base64"),
        paid_by_user_id=doc["paid_by_user_id"],
        paid_by_name=user_map.get(doc["paid_by_user_id"], "Unknown"),
        created_at=doc.get("created_at", ""),
    )


async def _build_lookup_maps(household_id: str):
    cats = await db.categories.find({"household_id": household_id}, {"_id": 0}).to_list(length=500)
    cat_map = {c["id"]: c for c in cats}
    users = await db.users.find({"household_id": household_id}, {"_id": 0, "user_id": 1, "name": 1}).to_list(length=100)
    user_map = {u["user_id"]: u["name"] for u in users}
    return cat_map, user_map


def _next_recurring_date(current_date: date, frequency: str, day_of_month: Optional[int], day_of_week: Optional[int]) -> date:
    if frequency == "monthly":
        year, month = current_date.year, current_date.month + 1
        if month > 12:
            month = 1
            year += 1
        target_day = day_of_month or current_date.day
        # clamp for months with fewer days
        for d in range(target_day, 0, -1):
            try:
                return date(year, month, d)
            except ValueError:
                continue
        return current_date + timedelta(days=30)
    elif frequency == "weekly":
        return current_date + timedelta(days=7)
    else:
        return current_date + timedelta(days=30)


async def _run_due_recurring(household_id: str):
    """Auto-generate expense entries for any recurring templates whose next_run_date is today or earlier."""
    today = datetime.now(timezone.utc).date()
    cursor = db.recurring_expenses.find(
        {"household_id": household_id, "is_active": True, "next_run_date": {"$lte": today.isoformat()}},
        {"_id": 0},
    )
    templates = await cursor.to_list(length=200)
    for t in templates:
        run_date = date.fromisoformat(t["next_run_date"])
        safety = 0
        while run_date <= today and safety < 24:
            safety += 1
            new_expense = {
                "id": str(uuid.uuid4()),
                "household_id": household_id,
                "amount": float(t["amount"]),
                "category_id": t["category_id"],
                "subcategory_id": t.get("subcategory_id"),
                "note": (t.get("note") or "").strip() or "(recurring)",
                "date": run_date.isoformat(),
                "receipt_base64": None,
                "paid_by_user_id": t["created_by_user_id"],
                "created_at": datetime.now(timezone.utc).isoformat(),
                "from_recurring_id": t["id"],
            }
            await db.expenses.insert_one(new_expense)
            run_date = _next_recurring_date(run_date, t["frequency"], t.get("day_of_month"), t.get("day_of_week"))
        await db.recurring_expenses.update_one(
            {"id": t["id"]},
            {"$set": {"next_run_date": run_date.isoformat()}},
        )


@api_router.get("/expenses", response_model=List[ExpenseOut])
async def list_expenses(
    start: Optional[str] = None,
    end: Optional[str] = None,
    category_id: Optional[str] = None,
    paid_by: Optional[str] = None,
    min_amount: Optional[float] = None,
    max_amount: Optional[float] = None,
    q: Optional[str] = None,
    current=Depends(get_current_user),
):
    await _run_due_recurring(current["household_id"])
    query: Dict[str, Any] = {"household_id": current["household_id"]}
    if start:
        query.setdefault("date", {})["$gte"] = start
    if end:
        query.setdefault("date", {})["$lte"] = end
    if category_id:
        query["category_id"] = category_id
    if paid_by:
        query["paid_by_user_id"] = paid_by
    if min_amount is not None or max_amount is not None:
        amt_q: Dict[str, Any] = {}
        if min_amount is not None:
            amt_q["$gte"] = float(min_amount)
        if max_amount is not None:
            amt_q["$lte"] = float(max_amount)
        query["amount"] = amt_q
    if q:
        # case-insensitive substring on note
        query["note"] = {"$regex": q, "$options": "i"}
    cursor = db.expenses.find(query, {"_id": 0}).sort([("date", -1), ("created_at", -1)])
    docs = await cursor.to_list(length=2000)
    cat_map, user_map = await _build_lookup_maps(current["household_id"])
    return [await _enrich_expense(d, cat_map, user_map) for d in docs]


@api_router.post("/expenses", response_model=ExpenseOut)
async def create_expense(payload: ExpenseIn, current=Depends(get_current_user)):
    cat = await db.categories.find_one({"id": payload.category_id, "household_id": current["household_id"]}, {"_id": 0})
    if not cat:
        raise HTTPException(400, "Invalid category")
    if payload.subcategory_id:
        if not any(s["id"] == payload.subcategory_id for s in cat.get("subcategories", [])):
            raise HTTPException(400, "Invalid subcategory")
    doc = {
        "id": str(uuid.uuid4()),
        "household_id": current["household_id"],
        "amount": float(payload.amount),
        "category_id": payload.category_id,
        "subcategory_id": payload.subcategory_id,
        "note": (payload.note or "").strip(),
        "date": payload.date,
        "receipt_base64": payload.receipt_base64,
        "paid_by_user_id": current["user_id"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.expenses.insert_one(doc)
    doc.pop("_id", None)
    cat_map, user_map = await _build_lookup_maps(current["household_id"])
    return await _enrich_expense(doc, cat_map, user_map)


@api_router.get("/expenses/{expense_id}", response_model=ExpenseOut)
async def get_expense(expense_id: str, current=Depends(get_current_user)):
    doc = await db.expenses.find_one({"id": expense_id, "household_id": current["household_id"]}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Expense not found")
    cat_map, user_map = await _build_lookup_maps(current["household_id"])
    return await _enrich_expense(doc, cat_map, user_map)


@api_router.put("/expenses/{expense_id}", response_model=ExpenseOut)
async def update_expense(expense_id: str, payload: ExpenseIn, current=Depends(get_current_user)):
    update = {
        "amount": float(payload.amount),
        "category_id": payload.category_id,
        "subcategory_id": payload.subcategory_id,
        "note": (payload.note or "").strip(),
        "date": payload.date,
        "receipt_base64": payload.receipt_base64,
    }
    result = await db.expenses.find_one_and_update(
        {"id": expense_id, "household_id": current["household_id"]},
        {"$set": update},
        projection={"_id": 0},
        return_document=True,
    )
    if not result:
        raise HTTPException(404, "Expense not found")
    cat_map, user_map = await _build_lookup_maps(current["household_id"])
    return await _enrich_expense(result, cat_map, user_map)


@api_router.delete("/expenses/{expense_id}")
async def delete_expense(expense_id: str, current=Depends(get_current_user)):
    res = await db.expenses.delete_one({"id": expense_id, "household_id": current["household_id"]})
    if res.deleted_count == 0:
        raise HTTPException(404, "Expense not found")
    return {"ok": True}


# =============== Dashboard ===============

def _period_range(period: str) -> tuple[str, str]:
    now = datetime.now(timezone.utc)
    today = now.date()
    if period == "daily":
        start = today
        end = today
    elif period == "weekly":
        start = today - timedelta(days=today.weekday())
        end = start + timedelta(days=6)
    elif period == "monthly":
        start = today.replace(day=1)
        next_month = (start.replace(day=28) + timedelta(days=4)).replace(day=1)
        end = next_month - timedelta(days=1)
    elif period == "quarterly":
        q = (today.month - 1) // 3
        start_month = q * 3 + 1
        start = today.replace(month=start_month, day=1)
        end_month = start_month + 2
        end_year = today.year
        if end_month > 12:
            end_month -= 12
            end_year += 1
        last_start = datetime(end_year, end_month, 28).date()
        end = (last_start + timedelta(days=4)).replace(day=1) - timedelta(days=1)
    elif period == "biannual":
        if today.month <= 6:
            start = today.replace(month=1, day=1)
            end = today.replace(month=6, day=30)
        else:
            start = today.replace(month=7, day=1)
            end = today.replace(month=12, day=31)
    elif period == "yearly":
        start = today.replace(month=1, day=1)
        end = today.replace(month=12, day=31)
    else:
        raise HTTPException(400, "Invalid period")
    return start.isoformat(), end.isoformat()


@api_router.get("/dashboard")
async def dashboard(period: str = "monthly", current=Depends(get_current_user)):
    await _run_due_recurring(current["household_id"])
    start, end = _period_range(period)
    q = {
        "household_id": current["household_id"],
        "date": {"$gte": start, "$lte": end},
    }
    cursor = db.expenses.find(q, {"_id": 0})
    docs = await cursor.to_list(length=5000)
    cat_map, user_map = await _build_lookup_maps(current["household_id"])

    total = 0.0
    by_category: Dict[str, Dict[str, Any]] = {}
    by_earner: Dict[str, Dict[str, Any]] = {}

    for d in docs:
        amt = float(d.get("amount", 0))
        total += amt
        cid = d["category_id"]
        cat = cat_map.get(cid, {"name": "Unknown", "color": "#9CA3AF", "icon": "tag", "subcategories": []})
        if cid not in by_category:
            by_category[cid] = {
                "category_id": cid,
                "name": cat.get("name", "Unknown"),
                "color": cat.get("color", "#9CA3AF"),
                "icon": cat.get("icon", "tag"),
                "total": 0.0,
                "count": 0,
                "subcategories": {},
            }
        by_category[cid]["total"] += amt
        by_category[cid]["count"] += 1
        sid = d.get("subcategory_id")
        if sid:
            sub_name = "Other"
            for s in cat.get("subcategories", []):
                if s["id"] == sid:
                    sub_name = s["name"]
                    break
            sub_bucket = by_category[cid]["subcategories"].setdefault(sid, {"id": sid, "name": sub_name, "total": 0.0, "count": 0})
            sub_bucket["total"] += amt
            sub_bucket["count"] += 1

        uid = d["paid_by_user_id"]
        if uid not in by_earner:
            by_earner[uid] = {"user_id": uid, "name": user_map.get(uid, "Unknown"), "total": 0.0, "count": 0}
        by_earner[uid]["total"] += amt
        by_earner[uid]["count"] += 1

    by_category_list = []
    for c in by_category.values():
        c["subcategories"] = sorted(c["subcategories"].values(), key=lambda x: -x["total"])
        by_category_list.append(c)
    by_category_list.sort(key=lambda x: -x["total"])
    by_earner_list = sorted(by_earner.values(), key=lambda x: -x["total"])

    # Budget progress (only for monthly period since budgets are monthly)
    budgets_progress = []
    if period == "monthly":
        budgets = await db.budgets.find({"household_id": current["household_id"]}, {"_id": 0}).to_list(length=100)
        for b in budgets:
            spent = by_category.get(b["category_id"], {}).get("total", 0.0)
            cat = cat_map.get(b["category_id"], {})
            budgets_progress.append({
                "id": b["id"],
                "category_id": b["category_id"],
                "category_name": cat.get("name", "Unknown"),
                "category_color": cat.get("color", "#34D399"),
                "amount": float(b["amount"]),
                "spent": spent,
                "percent": (spent / float(b["amount"]) * 100.0) if b["amount"] else 0.0,
                "remaining": max(0.0, float(b["amount"]) - spent),
            })
        budgets_progress.sort(key=lambda x: -x["percent"])

    return {
        "period": period,
        "start": start,
        "end": end,
        "total": total,
        "expense_count": len(docs),
        "by_category": by_category_list,
        "by_earner": by_earner_list,
        "budgets": budgets_progress,
    }


# =============== Budgets ===============

async def _budget_out(doc, cat_map, spent_map) -> BudgetOut:
    cat = cat_map.get(doc["category_id"], {})
    spent = spent_map.get(doc["category_id"], 0.0)
    return BudgetOut(
        id=doc["id"],
        household_id=doc["household_id"],
        category_id=doc["category_id"],
        category_name=cat.get("name", "Unknown"),
        category_color=cat.get("color", "#34D399"),
        amount=float(doc["amount"]),
        period=doc.get("period", "monthly"),
        spent=spent,
        percent=(spent / float(doc["amount"]) * 100.0) if doc["amount"] else 0.0,
        remaining=max(0.0, float(doc["amount"]) - spent),
    )


async def _monthly_spent_map(household_id: str) -> Dict[str, float]:
    start, end = _period_range("monthly")
    cursor = db.expenses.find(
        {"household_id": household_id, "date": {"$gte": start, "$lte": end}},
        {"_id": 0, "category_id": 1, "amount": 1},
    )
    docs = await cursor.to_list(length=5000)
    m: Dict[str, float] = {}
    for d in docs:
        m[d["category_id"]] = m.get(d["category_id"], 0.0) + float(d.get("amount", 0))
    return m


@api_router.get("/budgets", response_model=List[BudgetOut])
async def list_budgets(current=Depends(get_current_user)):
    await require_premium(current)
    cats = await db.categories.find({"household_id": current["household_id"]}, {"_id": 0}).to_list(length=500)
    cat_map = {c["id"]: c for c in cats}
    spent_map = await _monthly_spent_map(current["household_id"])
    docs = await db.budgets.find({"household_id": current["household_id"]}, {"_id": 0}).to_list(length=200)
    return [await _budget_out(d, cat_map, spent_map) for d in docs]


@api_router.post("/budgets", response_model=BudgetOut)
async def create_budget(payload: BudgetIn, current=Depends(get_current_user)):
    await require_premium(current)
    cat = await db.categories.find_one({"id": payload.category_id, "household_id": current["household_id"]}, {"_id": 0})
    if not cat:
        raise HTTPException(400, "Invalid category")
    # One budget per category per household
    existing = await db.budgets.find_one({"category_id": payload.category_id, "household_id": current["household_id"]}, {"_id": 0})
    if existing:
        await db.budgets.update_one(
            {"id": existing["id"]},
            {"$set": {"amount": float(payload.amount), "period": payload.period}},
        )
        doc = await db.budgets.find_one({"id": existing["id"]}, {"_id": 0})
    else:
        doc = {
            "id": str(uuid.uuid4()),
            "household_id": current["household_id"],
            "category_id": payload.category_id,
            "amount": float(payload.amount),
            "period": payload.period,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.budgets.insert_one(doc)
    spent_map = await _monthly_spent_map(current["household_id"])
    cat_map = {cat["id"]: cat}
    return await _budget_out(doc, cat_map, spent_map)


@api_router.delete("/budgets/{budget_id}")
async def delete_budget(budget_id: str, current=Depends(get_current_user)):
    await require_premium(current)
    res = await db.budgets.delete_one({"id": budget_id, "household_id": current["household_id"]})
    if res.deleted_count == 0:
        raise HTTPException(404, "Budget not found")
    return {"ok": True}


# =============== Recurring Expenses ===============

async def _recurring_out(doc, cat_map) -> RecurringOut:
    cat = cat_map.get(doc["category_id"], {})
    sub_name = None
    if doc.get("subcategory_id"):
        for s in cat.get("subcategories", []):
            if s["id"] == doc["subcategory_id"]:
                sub_name = s["name"]
                break
    return RecurringOut(
        id=doc["id"],
        household_id=doc["household_id"],
        amount=float(doc["amount"]),
        category_id=doc["category_id"],
        category_name=cat.get("name", "Unknown"),
        subcategory_id=doc.get("subcategory_id"),
        subcategory_name=sub_name,
        note=doc.get("note", ""),
        frequency=doc.get("frequency", "monthly"),
        day_of_month=doc.get("day_of_month"),
        day_of_week=doc.get("day_of_week"),
        next_run_date=doc["next_run_date"],
        is_active=bool(doc.get("is_active", True)),
        created_by_user_id=doc.get("created_by_user_id", ""),
    )


@api_router.get("/recurring", response_model=List[RecurringOut])
async def list_recurring(current=Depends(get_current_user)):
    await require_premium(current)
    cats = await db.categories.find({"household_id": current["household_id"]}, {"_id": 0}).to_list(length=500)
    cat_map = {c["id"]: c for c in cats}
    docs = await db.recurring_expenses.find({"household_id": current["household_id"]}, {"_id": 0}).to_list(length=200)
    return [await _recurring_out(d, cat_map) for d in docs]


@api_router.post("/recurring", response_model=RecurringOut)
async def create_recurring(payload: RecurringIn, current=Depends(get_current_user)):
    await require_premium(current)
    cat = await db.categories.find_one({"id": payload.category_id, "household_id": current["household_id"]}, {"_id": 0})
    if not cat:
        raise HTTPException(400, "Invalid category")
    doc = {
        "id": str(uuid.uuid4()),
        "household_id": current["household_id"],
        "amount": float(payload.amount),
        "category_id": payload.category_id,
        "subcategory_id": payload.subcategory_id,
        "note": (payload.note or "").strip(),
        "frequency": payload.frequency,
        "day_of_month": payload.day_of_month,
        "day_of_week": payload.day_of_week,
        "next_run_date": payload.next_run_date,
        "is_active": payload.is_active,
        "created_by_user_id": current["user_id"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.recurring_expenses.insert_one(doc)
    doc.pop("_id", None)
    cat_map = {cat["id"]: cat}
    return await _recurring_out(doc, cat_map)


@api_router.put("/recurring/{recurring_id}", response_model=RecurringOut)
async def update_recurring(recurring_id: str, payload: RecurringIn, current=Depends(get_current_user)):
    await require_premium(current)
    result = await db.recurring_expenses.find_one_and_update(
        {"id": recurring_id, "household_id": current["household_id"]},
        {"$set": {
            "amount": float(payload.amount),
            "category_id": payload.category_id,
            "subcategory_id": payload.subcategory_id,
            "note": (payload.note or "").strip(),
            "frequency": payload.frequency,
            "day_of_month": payload.day_of_month,
            "day_of_week": payload.day_of_week,
            "next_run_date": payload.next_run_date,
            "is_active": payload.is_active,
        }},
        projection={"_id": 0},
        return_document=True,
    )
    if not result:
        raise HTTPException(404, "Recurring template not found")
    cats = await db.categories.find({"household_id": current["household_id"]}, {"_id": 0}).to_list(length=500)
    cat_map = {c["id"]: c for c in cats}
    return await _recurring_out(result, cat_map)


@api_router.delete("/recurring/{recurring_id}")
async def delete_recurring(recurring_id: str, current=Depends(get_current_user)):
    await require_premium(current)
    res = await db.recurring_expenses.delete_one({"id": recurring_id, "household_id": current["household_id"]})
    if res.deleted_count == 0:
        raise HTTPException(404, "Recurring template not found")
    return {"ok": True}


# =============== Bill Reminders ===============

@api_router.get("/reminders", response_model=List[BillReminderOut])
async def list_reminders(current=Depends(get_current_user)):
    await require_premium(current)
    docs = await db.bill_reminders.find({"household_id": current["household_id"]}, {"_id": 0}).sort("due_date", 1).to_list(length=200)
    return [BillReminderOut(**{k: v for k, v in d.items() if k in BillReminderOut.model_fields}) for d in docs]


@api_router.post("/reminders", response_model=BillReminderOut)
async def create_reminder(payload: BillReminderIn, current=Depends(get_current_user)):
    await require_premium(current)
    doc = {
        "id": str(uuid.uuid4()),
        "household_id": current["household_id"],
        "title": payload.title.strip(),
        "amount": payload.amount,
        "due_date": payload.due_date,
        "repeat": payload.repeat,
        "created_by_user_id": current["user_id"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.bill_reminders.insert_one(doc)
    doc.pop("_id", None)
    return BillReminderOut(**{k: v for k, v in doc.items() if k in BillReminderOut.model_fields})


@api_router.put("/reminders/{reminder_id}", response_model=BillReminderOut)
async def update_reminder(reminder_id: str, payload: BillReminderIn, current=Depends(get_current_user)):
    await require_premium(current)
    result = await db.bill_reminders.find_one_and_update(
        {"id": reminder_id, "household_id": current["household_id"]},
        {"$set": {
            "title": payload.title.strip(),
            "amount": payload.amount,
            "due_date": payload.due_date,
            "repeat": payload.repeat,
        }},
        projection={"_id": 0},
        return_document=True,
    )
    if not result:
        raise HTTPException(404, "Reminder not found")
    return BillReminderOut(**{k: v for k, v in result.items() if k in BillReminderOut.model_fields})


@api_router.delete("/reminders/{reminder_id}")
async def delete_reminder(reminder_id: str, current=Depends(get_current_user)):
    await require_premium(current)
    res = await db.bill_reminders.delete_one({"id": reminder_id, "household_id": current["household_id"]})
    if res.deleted_count == 0:
        raise HTTPException(404, "Reminder not found")
    return {"ok": True}


# =============== Export ===============

@api_router.get("/export/csv")
async def export_csv(
    start: Optional[str] = None,
    end: Optional[str] = None,
    current=Depends(get_current_user),
):
    await require_premium(current)
    q: Dict[str, Any] = {"household_id": current["household_id"]}
    if start:
        q.setdefault("date", {})["$gte"] = start
    if end:
        q.setdefault("date", {})["$lte"] = end
    cursor = db.expenses.find(q, {"_id": 0}).sort([("date", 1)])
    docs = await cursor.to_list(length=10000)
    cat_map, user_map = await _build_lookup_maps(current["household_id"])
    lines = ["Date,Category,Subcategory,Amount (INR),Paid By,Note"]

    def _esc(v: Any) -> str:
        s = "" if v is None else str(v)
        if any(c in s for c in [",", '"', "\n"]):
            s = '"' + s.replace('"', '""') + '"'
        return s

    for d in docs:
        cat = cat_map.get(d["category_id"], {})
        sub_name = ""
        if d.get("subcategory_id"):
            for s in cat.get("subcategories", []):
                if s["id"] == d["subcategory_id"]:
                    sub_name = s["name"]
                    break
        lines.append(",".join([
            _esc(d.get("date", "")),
            _esc(cat.get("name", "Unknown")),
            _esc(sub_name),
            _esc(f'{float(d.get("amount", 0)):.2f}'),
            _esc(user_map.get(d.get("paid_by_user_id", ""), "")),
            _esc(d.get("note", "")),
        ]))
    return {"filename": f"expenses_{start or 'all'}_{end or 'all'}.csv", "content": "\n".join(lines), "count": len(docs)}


@api_router.get("/")
async def root():
    return {"message": "Household Expense Tracker API"}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    try:
        await db.users.create_index("email", unique=True)
        await db.users.create_index("user_id", unique=True)
        await db.user_sessions.create_index("session_token", unique=True)
        await db.user_sessions.create_index("user_id")
        await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
        await db.households.create_index("id", unique=True)
        await db.households.create_index("invite_code", unique=True)
        await db.categories.create_index("id", unique=True)
        await db.categories.create_index("household_id")
        await db.expenses.create_index("id", unique=True)
        await db.expenses.create_index([("household_id", 1), ("date", -1)])
        await db.budgets.create_index("id", unique=True)
        await db.budgets.create_index([("household_id", 1), ("category_id", 1)])
        await db.recurring_expenses.create_index("id", unique=True)
        await db.recurring_expenses.create_index([("household_id", 1), ("next_run_date", 1)])
        await db.bill_reminders.create_index("id", unique=True)
        await db.bill_reminders.create_index([("household_id", 1), ("due_date", 1)])
        logger.info("Indexes ensured")
    except Exception as e:
        logger.warning(f"Index creation warning: {e}")


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
