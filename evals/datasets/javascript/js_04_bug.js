const users = [
    { id: 1, name: "Alice" },
    { id: 2, name: "Bob" }
];

function getUser(id) {
    const user = users.find(user => user.id === id);
    return user.name;
}

console.log(getUser("1"));
