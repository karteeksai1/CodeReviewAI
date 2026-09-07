function parseResponse(response) {
    if (!response || !response.ok) {
        return { error: "Request failed" };
    }
    return response.json();
}

async function loadUsers(fetcher) {
    const response = await fetcher("/users");
    return parseResponse(response);
}
