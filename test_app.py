from fastapi.testclient import TestClient

from app import LOGIN_PASSWORD, LOGIN_USER, PAGES, app, find_cached, normalize, quote_on_page

# Login: everything is locked until the right username and password are given.
web = TestClient(app, follow_redirects=False)
assert web.get("/").headers["location"] == "/login.html"
assert web.get("/login.html").status_code == 200
assert web.post("/api/ask", json={"question": "x"}).status_code == 401
assert web.post("/api/login", json={"username": LOGIN_USER, "password": "wrong"}).status_code == 401
assert web.post("/api/login", json={"username": LOGIN_USER, "password": LOGIN_PASSWORD}).status_code == 200
assert web.get("/").status_code == 200
assert web.get("/login.html").headers["location"] == "/"
web.post("/api/logout")
assert web.get("/").status_code == 307

assert len(PAGES) == 108
assert normalize("  Front GAP for 200 sq.m plot?? ") == "front gap for 200 sq.m plot"

cache = {normalize("front setback for 200 sq m plot on 9 m road"): "A"}
assert find_cached(normalize("Front setback for 200 sq m plot on 9 m road?"), cache) == "A"
assert find_cached(normalize("front setback for a 200 sq m plot on 9 m road"), cache) == "A"
assert find_cached(normalize("front setback for 300 sq m plot on 9 m road"), cache) is None  # different numbers

assert quote_on_page("Up to 9.0 meters    3.0 meters", 77)
assert not quote_on_page("Up to 9.0 meters 5.0 meters", 77)
print("ok")
