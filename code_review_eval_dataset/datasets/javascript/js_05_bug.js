function calculateAverage(numbers) {
    let total = 0;
    numbers.forEach(number => {
        total += number;
    });
    return total / numbers.length;
}

function getFirstItem(items) {
    return items[0].name;
}

console.log(calculateAverage([]));
