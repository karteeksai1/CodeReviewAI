from pathlib import Path

def read_config(path):
    return Path(path).read_text(encoding="utf-8")

def count_lines(text):
    return len(text.splitlines())

if __name__ == "__main__":
    config = read_config("config.txt")
    print(count_lines(config))
