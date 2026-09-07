function calculateTotal(items) {
    return items.reduce((total, item) => {
        return total + item.price * item.quantity;
    }, 0);
}

function formatOrder(order) {
    return {
        id: order.id,
        total: Number(order.total.toFixed(2))
    };
}

console.log(formatOrder({ id: 1, total: calculateTotal([{ price: 10, quantity: 2 }]) }));
