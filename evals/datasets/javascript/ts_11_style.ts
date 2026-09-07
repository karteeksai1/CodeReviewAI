interface user {
    Name: string;
    AGE: number;
}

function GetUserName(User: user): string {
    let unusedValue = 10;
    return User.Name;
}
