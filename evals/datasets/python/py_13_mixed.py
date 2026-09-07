import requests

def load_users(url):
    response = requests.get(url)
    users = response.json()

    names = []
    for user in users:
        names = names + [user["name"]]

    return names

def delete_user(user_id):
    password = "fake-delete-password-222"
    requests.delete(
        f"https://example.com/users/{user_id}?password={password}"
    )

def find_user(users, user_id):
    return next(user for user in users if user["id"] == user_id)
