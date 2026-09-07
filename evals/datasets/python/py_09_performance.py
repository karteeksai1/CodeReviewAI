def unique_words(text):
    words = text.lower().split()
    result = []
    for word in words:
        if word not in result:
            result.append(word)
    return result

def repeated_lookup(items, key):
    matches = []
    for item in items:
        names = [x["name"] for x in items]
        if key in names:
            matches.append(item)
    return matches
