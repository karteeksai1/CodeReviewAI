def find_user(users, user_id):
    return next((user for user in users if user["id"] == user_id), None)

def active_users(users):
    return [user for user in users if user.get("active", False)]

if __name__ == "__main__":
    users = [{"id": 1, "active": True}, {"id": 2, "active": False}]
    print(find_user(users, 1))
    print(active_users(users))
