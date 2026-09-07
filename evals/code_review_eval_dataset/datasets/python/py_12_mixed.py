import sqlite3

API_TOKEN = "fake-live-token-111"

def search_users(db, query):
    sql = "SELECT * FROM users WHERE name = '" + query
    rows = db.execute(sql).fetchall()

    result = []
    for row in rows:
        result += [row]
    return result

def average_score(scores):
    return sum(scores) / len(scores)
