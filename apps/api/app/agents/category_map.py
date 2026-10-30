"""Brand categories derived from Qloo brand tags, plus the usual-sponsor map per event type."""
from __future__ import annotations

import re

# (category_key, label, substrings matched against Qloo tag ids/names, checked in order)
CATEGORY_RULES: list[tuple[str, str, tuple[str, ...]]] = [
    ("sports_org", "Sports teams & leagues", ("sports_organization",)),
    ("tobacco", "Tobacco & vaping", ("tobacco", "cigar", "vape", "vaping", "nicotine")),
    ("gambling", "Gambling & betting", ("gambling", "casino", "betting", "sportsbook", "lottery")),
    ("crypto", "Crypto", ("crypto", "bitcoin", "blockchain")),
    ("energy_drink", "Energy drinks", ("energy_drink", "drinks:energy", "energy drink")),
    ("alcohol", "Beer, wine & spirits", ("alcohol", "beer", "brewer", "spirits", "liquor", "wine", "vodka",
                                         "whiskey", "tequila", "seltzer", "cider", "rum", "gin")),
    ("beverage", "Beverages", ("drinks", "beverage", "soda", "water", "coffee", "tea", "juice", "carbonated")),
    ("food_delivery", "Food & delivery", ("delivery", "restaurant", "fast_food", "food_and_beverage", "snack",
                                          "food", "grocery", "candy", "confection")),
    ("telecom", "Telecom", ("telecom", "wireless", "mobile_network", "carrier", "internet_service")),
    ("automotive", "Automotive", ("automotive", "auto", "car_", "vehicle", "motorcycle")),
    ("financial", "Financial services", ("financ", "bank", "credit_card", "payment", "insurance", "fintech")),
    ("tech_gaming", "Tech & gaming", ("video_game", "gaming", "technology", "electronics", "software",
                                      "consumer_electronics", "computer", "tech", "streaming", "audio")),
    ("music_gear", "Music gear & audio", ("musical_instrument", "instrument", "headphone", "speaker", "vinyl",
                                          "record")),
    ("apparel", "Apparel & footwear", ("fashion", "apparel", "clothing", "footwear", "shoe", "sneaker",
                                       "streetwear", "denim", "eyewear", "accessor", "jewelry")),
    ("beauty", "Beauty & personal care", ("beauty", "cosmetic", "skincare", "personal_care", "fragrance",
                                          "hair")),
    ("outdoor_sports", "Outdoor & sporting goods", ("sporting", "outdoor", "athletic", "fitness", "sport")),
    ("travel", "Travel & hospitality", ("travel", "hotel", "airline", "hospitality", "cruise", "rideshare")),
    ("media", "Media & entertainment", ("media", "entertainment", "publishing", "magazine", "television",
                                        "radio", "film")),
    ("retail", "Retail", ("retail", "department_store", "store", "shopping", "marketplace", "ecommerce")),
    ("home", "Home & lifestyle", ("home", "furniture", "decor", "kitchen", "lifestyle")),
]

CATEGORY_LABELS = {k: label for k, label, _ in CATEGORY_RULES} | {"other": "Other", "local_place": "Local place"}

EXCLUSION_TO_CATEGORIES = {
    "alcohol": {"alcohol"},
    "tobacco": {"tobacco"},
    "gambling": {"gambling"},
    "crypto": {"crypto"},
}

EVENT_TYPES = ["festival", "concert_tour", "comedy", "sports_fan", "conference", "food_festival", "college_fest",
               "club_night", "other"]

EVENT_TYPE_LABELS = {
    "festival": "festival", "concert_tour": "concert tour", "comedy": "comedy show or tour",
    "sports_fan": "sports fan event", "conference": "conference", "food_festival": "food festival",
    "college_fest": "college fest", "club_night": "club night", "other": "event",
}

# Categories that conventionally sponsor each event type ("Natural fits").
NATURAL_CATEGORIES: dict[str, set[str]] = {
    "festival": {"beverage", "alcohol", "energy_drink", "telecom", "apparel", "food_delivery", "financial"},
    "concert_tour": {"beverage", "alcohol", "telecom", "financial", "automotive", "apparel"},
    "comedy": {"beverage", "alcohol", "food_delivery", "media", "telecom", "financial"},
    "sports_fan": {"beverage", "alcohol", "energy_drink", "apparel", "automotive", "outdoor_sports", "financial"},
    "conference": {"tech_gaming", "financial", "telecom", "travel", "beverage"},
    "food_festival": {"food_delivery", "beverage", "alcohol", "home", "retail"},
    "college_fest": {"beverage", "energy_drink", "telecom", "food_delivery", "tech_gaming", "apparel"},
    "club_night": {"alcohol", "energy_drink", "beverage", "music_gear", "apparel"},
    "other": {"beverage", "food_delivery", "financial", "telecom"},
}

# Default sponsor slots per event type: (slot name, category_key)
DEFAULT_SLOTS: dict[str, list[tuple[str, str]]] = {
    "festival": [("Official beverage partner", "beverage"), ("Apparel", "apparel"), ("Energy drink", "energy_drink"),
                 ("Food & delivery", "food_delivery"), ("Telecom", "telecom"), ("Tech/gaming", "tech_gaming")],
    "concert_tour": [("Official beverage partner", "beverage"), ("Apparel", "apparel"), ("Telecom", "telecom"),
                     ("Automotive", "automotive"), ("Financial services", "financial"), ("Tech/gaming", "tech_gaming")],
    "comedy": [("Title sponsor", "media"), ("Official beverage partner", "beverage"),
               ("Food & delivery", "food_delivery"), ("Apparel", "apparel"), ("Tech/gaming", "tech_gaming")],
}
for _t in EVENT_TYPES:
    DEFAULT_SLOTS.setdefault(_t, [("Official beverage partner", "beverage"), ("Apparel", "apparel"),
                                  ("Food & delivery", "food_delivery"), ("Tech/gaming", "tech_gaming")])

# Activation types Marquee may suggest ("Where to start"), keyed by category.
ACTIVATIONS = ["Sampling booth", "Co-branded stage", "Fan-experience lounge", "Merch collab",
               "Content series", "Ticket-holder perk", "Pop-up shop", "Hydration & charging stations"]

CATEGORY_ACTIVATION = {
    "beverage": "Sampling booth", "alcohol": "Fan-experience lounge", "energy_drink": "Sampling booth",
    "apparel": "Merch collab", "food_delivery": "Ticket-holder perk", "telecom": "Hydration & charging stations",
    "tech_gaming": "Fan-experience lounge", "financial": "Ticket-holder perk", "automotive": "Fan-experience lounge",
    "music_gear": "Co-branded stage", "media": "Content series", "beauty": "Pop-up shop",
    "retail": "Pop-up shop", "outdoor_sports": "Pop-up shop", "travel": "Ticket-holder perk",
    "home": "Pop-up shop", "other": "Content series", "local_place": "Ticket-holder perk",
}


def _matches(needle: str, text: str, tokens: set[str]) -> bool:
    # short needles must match a whole token ("rum" must not match "instrument")
    return needle in tokens if len(needle) < 6 else needle in text


def classify(tags: list[dict] | None, description: str | None = None) -> str:
    """Pick a category from Qloo brand-genre tags first, then other tags, then the Qloo description."""
    tags = tags or []
    genre = [t.get("id", "") or "" for t in tags if "genre:brand" in (t.get("id") or "")]
    genre.sort(key=len, reverse=True)  # most specific genre tag first
    skip = ("competitor_brand", "similar_brand", "wikipedia_category", "aesthetic")
    others = [(t.get("id") or "") for t in tags
              if "genre:brand" not in (t.get("id") or "") and not any(s in (t.get("id") or "") for s in skip)]
    for pool in (genre, others, [description or ""]):
        for text in pool:
            text = text.lower().replace(" ", "_")
            tokens = set(re.split(r"[:_\-.,/()]+", text))
            for key, _label, needles in CATEGORY_RULES:
                if any(_matches(n, text, tokens) for n in needles):
                    return key
    return "other"


# Qloo brand-genre tag URNs used to seed discovery per category (found with qloo_find_tags; see QLOO_PROBE.md)
CATEGORY_SEED_TAGS = {
    "beverage": "urn:tag:genre:brand:food_and_beverage:drinks",
    "alcohol": "urn:tag:genre:brand:wine_and_spirits",
    "energy_drink": "urn:tag:genre:brand:food_and_beverage:drinks:energy_drink",
    "telecom": "urn:tag:genre:brand:telecom",
    "apparel": "urn:tag:genre:brand:fashion",
    "food_delivery": "urn:tag:genre:brand:food_and_beverage",
    "automotive": "urn:tag:genre:brand:automotive",
    "tech_gaming": "urn:tag:genre:brand:electronics",
    "media": "urn:tag:genre:brand:entertainment:media",
}


def shelf_for(category_key: str, event_type: str) -> str:
    return "natural" if category_key in NATURAL_CATEGORIES.get(event_type, NATURAL_CATEGORIES["other"]) else "hidden"


# never sponsors: teams and leagues are properties, not brands that buy sponsorship
NON_SPONSOR_CATEGORIES = {"sports_org"}


def excluded_categories(exclude: list[str]) -> set[str]:
    out: set[str] = set(NON_SPONSOR_CATEGORIES)
    for e in exclude or []:
        out |= EXCLUSION_TO_CATEGORIES.get(e.lower(), {e.lower()})
    return out
