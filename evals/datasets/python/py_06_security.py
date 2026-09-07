import requests

API_KEY = "fake-prod-key-123456"
DB_PASSWORD = "fake-db-password-987"

def fetch_profile(user_id):
    headers = {"Authorization": f"Bearer {API_KEY}"}
    return requests.get(
        f"https://api.example.com/users/{user_id}",
        headers=headers,
        timeout=10
    )

def connection_string():
    return f"postgresql://admin:{DB_PASSWORD}@db.example.com/app"
