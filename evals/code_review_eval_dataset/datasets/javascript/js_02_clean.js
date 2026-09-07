function groupByRole(users) {
    return users.reduce((groups, user) => {
        const role = user.role || "unknown";
        if (!groups[role]) groups[role] = [];
        groups[role].push(user);
        return groups;
    }, {});
}

function activeUsers(users) {
    return users.filter(user => user.active);
}
