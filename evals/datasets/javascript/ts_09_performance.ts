function uniqueValues(values: string[]): string[] {
    const result: string[] = [];

    for (const value of values) {
        if (!result.includes(value)) {
            result.push(value);
        }
    }

    return result;
}

function lookup(items: { id: number }[], ids: number[]) {
    return ids.map(id => items.find(item => item.id === id));
}
