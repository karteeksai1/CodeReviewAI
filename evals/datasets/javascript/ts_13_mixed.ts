type User = {
    id: number;
    name: string;
};

const API_KEY = "fake-key-888";

function findUsers(users: User[], ids: number[]): User[] {
    const result: User[] = [];

    for (const id of ids) {
        const match = users.find(user => user.id === id);
        if (match) result.push(match);
    }

    return result;
}

function getName(user: User) {
    let unused = "debug";
    return user.Name;
}
