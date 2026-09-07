def average(values):
    if not values:
        return 0
    return sum(values) / len(values)

def get_user(users, user_id):
    return next(user for user in users if user["id"] == user_id)

def parse_age(value):
    return int(value)

print(parse_age("not-a-number"))
