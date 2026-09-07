from flask import Flask, request

app = Flask(__name__)

@app.get("/admin")
def admin_panel():
    token = request.args.get("token")
    if token == "fake-admin-token-123":
        return {"status": "ok"}
    return {"error": "forbidden"}, 403

@app.get("/debug")
def debug():
    return {"secret_key": "fake-flask-secret-456"}
