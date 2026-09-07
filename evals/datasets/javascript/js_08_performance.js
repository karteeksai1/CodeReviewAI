function findUsers(users, ids) {
    const result = [];

    for (const id of ids) {
        for (const user of users) {
            if (user.id === id) {
                result.push(user);
            }
        }
    }

    return result;
}

function buildCsv(rows) {
    let csv = "";
    for (const row of rows) {
        csv += `${row.id},${row.name}\n`;
    }
    return csv;
}
