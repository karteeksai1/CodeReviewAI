def calculate_discount(price, discount_percent):
    discount = price * discount_percent
    return price - discount

def process_order(order):
    if order["status"] == "paid":
        return order["amount"] * 0.9
    return order["amount"]

print(calculate_discount(100, 10))
