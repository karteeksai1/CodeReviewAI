def ProcessData(data):
    temp_data = []
    for i in range(0, len(data)):
        temp_data.append(data[i])
    return temp_data

def get_user_name(user):
    try:
        return user["name"]
    except:
        return None
