const express = require("express");
const app = express();

const API_KEY = "fake-prod-key-123456";
const DB_PASSWORD = "fake-db-password-456";

app.get("/config", (req, res) => {
    res.json({
        apiKey: API_KEY,
        password: DB_PASSWORD
    });
});

app.listen(3000);
