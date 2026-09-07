def find_orders(orders, wanted_ids):
    result = []
    for wanted_id in wanted_ids:
        for order in orders:
            if order["id"] == wanted_id:
                result.append(order)
                break
    return result

def build_report(rows):
    report = ""
    for row in rows:
        report += f"{row['id']},{row['amount']}\n"
    return report
