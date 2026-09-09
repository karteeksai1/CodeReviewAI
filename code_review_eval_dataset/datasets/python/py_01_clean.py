def calculate_total(items):
    return sum(item["price"] * item["quantity"] for item in items)

def format_order(order_id, total):
    return {"id": order_id, "total": round(total, 2)}

if __name__ == "__main__":
    items = [{"price": 10, "quantity": 2}, {"price": 5, "quantity": 3}]
    print(format_order(101, calculate_total(items)))
