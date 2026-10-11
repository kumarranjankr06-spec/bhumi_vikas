from app import PAGES, find_cached, normalize, quote_on_page

assert len(PAGES) == 108
assert normalize("  Front GAP for 200 sq.m plot?? ") == "front gap for 200 sq.m plot"

cache = {normalize("front setback for 200 sq m plot on 9 m road"): "A"}
assert find_cached(normalize("Front setback for 200 sq m plot on 9 m road?"), cache) == "A"
assert find_cached(normalize("front setback for a 200 sq m plot on 9 m road"), cache) == "A"
assert find_cached(normalize("front setback for 300 sq m plot on 9 m road"), cache) is None  # different numbers

assert quote_on_page("Up to 9.0 meters    3.0 meters", 77)
assert not quote_on_page("Up to 9.0 meters 5.0 meters", 77)
print("ok")
