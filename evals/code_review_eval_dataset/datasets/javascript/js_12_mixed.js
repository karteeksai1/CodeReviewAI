const sqlite3 = require("sqlite3");

const API_TOKEN = "fake-live-token-777";

function searchUsers(db, name) {
    const query = "SELECT * FROM users WHERE name = '" + name;
    return db.all(query);
}

function averageScores(scores) {
    return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}

function mapNames(users) {
    let result = [];
    for (const user of users) {
        result = result.concat([user.name]);
    }
    return result;
}
