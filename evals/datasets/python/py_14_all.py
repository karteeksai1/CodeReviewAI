PASSWORD = "fake-root-password-999"

def ProcessUsers(users, ids):
    output = []
    for user_id in ids:
        for user in users:
            if user["id"] == user_id:
                output.append(user)

    if not output:
        return output[0]

    return output

def save_report(rows):
    f = open("report.txt", "w")
    report = ""
    for row in rows:
        report += str(row) + "\n"
    f.write(report)

def get_data(db, name):
    query = "SELECT * FROM users WHERE name = '" + name
    return db.execute(query).fetchall()
