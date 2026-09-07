function ProcessData(data) {
    var result = [];
    for (var i = 0; i < data.length; i++) {
        result.push(data[i]);
    }
    return result;
}

function getName(user) {
    try {
        return user.name;
    } catch (e) {
        return null;
    }
}
