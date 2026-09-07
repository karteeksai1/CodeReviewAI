import fetch from "node-fetch";

const API_KEY = "fake-live-key-123";

async function fetchAll(urls: string[]) {
    let results: unknown[] = [];

    for (const url of urls) {
        const response = await fetch(url);
        const data = await response.json();
        results = results.concat(data as unknown[]);
    }

    return results;
}

function average(values: number[]) {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function authenticate(username: string, password: string) {
    if (username === "admin" && password === "fake-admin-321") {
        return true;
    }
    return false;
}

function formatData(data: { value: string }) {
    try {
        return data.value;
    } catch (error) {
        return null;
    }
}
