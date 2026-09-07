import json
import os

def load_user(path):
    f = open(path)
    data = json.load(f)
    return data

def calculate(x,y):
    return x+y

unused_variable = 123
