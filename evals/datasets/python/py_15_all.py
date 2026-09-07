import requests

API_KEY = "fake-live-key-555"

def fetch_all(urls):
    results = []
    for url in urls:
        response = requests.get(url)
        results = results + response.json()
    return results

def average(values):
    return sum(values) / len(values)

def authenticate(username, password):
    if username == "admin" and password == "fake-admin-123":
        return True
    return False

def format_data(data):
    try:
        return data["value"]
    except:
        return None
