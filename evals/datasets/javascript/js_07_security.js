const express = require("express");
const app = express();

app.delete("/users/:id", (req, res) => {
    const userId = req.params.id;
    deleteUser(userId);
    res.json({ message: "deleted" });
});

function deleteUser(id) {
    console.log("Deleting", id);
}

app.listen(3000);
