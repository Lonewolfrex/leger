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
from datetime import datetime, timezone, timedelta


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


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
    date: str  # ISO string yyyy-mm-dd
    receipt_base64: Optional[str] = None  # data URI or raw base64

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


# =============== Auth Routes ===============

@api_router.post("/auth/session", response_model=AuthResponse)
async def create_session(payload: SessionRequest):
    # Exchange session_id with Emergent to get user info + session_token
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

    # Upsert user by email
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if user:
        user_id = user["user_id"]
        household_id = user["household_id"]
        await db.users.update_one(
            {"user_id": user_id},
            {"$set": {"name": name, "picture": picture}},
        )
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        # Create household for this new user
        household_id = f"hh_{uuid.uuid4().hex[:10]}"
        await db.households.insert_one({
            "id": household_id,
            "name": f"{name}'s Household",
            "invite_code": gen_invite_code(),
            "owner_user_id": user_id,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        await db.users.insert_one({
            "user_id": user_id,
            "email": email,
            "name": name,
            "picture": picture,
            "household_id": household_id,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        await ensure_default_categories(household_id)

    # Save session (7 days)
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
    # Clean up old household if empty and owned by this user
    remaining = await db.users.count_documents({"household_id": old_household_id})
    if remaining == 0:
        await db.households.delete_one({"id": old_household_id})
        await db.categories.delete_many({"household_id": old_household_id})
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


@api_router.get("/expenses", response_model=List[ExpenseOut])
async def list_expenses(
    start: Optional[str] = None,
    end: Optional[str] = None,
    category_id: Optional[str] = None,
    current=Depends(get_current_user),
):
    q = {"household_id": current["household_id"]}
    if start:
        q.setdefault("date", {})["$gte"] = start
    if end:
        q.setdefault("date", {})["$lte"] = end
    if category_id:
        q["category_id"] = category_id
    cursor = db.expenses.find(q, {"_id": 0}).sort([("date", -1), ("created_at", -1)])
    docs = await cursor.to_list(length=1000)
    cat_map, user_map = await _build_lookup_maps(current["household_id"])
    return [await _enrich_expense(d, cat_map, user_map) for d in docs]


@api_router.post("/expenses", response_model=ExpenseOut)
async def create_expense(payload: ExpenseIn, current=Depends(get_current_user)):
    # Validate category
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
        # last day of month
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

    return {
        "period": period,
        "start": start,
        "end": end,
        "total": total,
        "expense_count": len(docs),
        "by_category": by_category_list,
        "by_earner": by_earner_list,
    }


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
        logger.info("Indexes ensured")
    except Exception as e:
        logger.warning(f"Index creation warning: {e}")


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
