import re

SEVERITY_WEIGHT = {"critical": 100, "high": 80, "medium": 55, "low": 25, "info": 10}


def iter_added_lines(files):
    for file in files:
        new_line = 0
        for raw_line in file.get("patch", "").splitlines():
            if raw_line.startswith("@@"):
                match = re.search(r"\+(\d+)", raw_line)
                new_line = int(match.group(1)) - 1 if match else new_line
                continue
            if raw_line.startswith("+") and not raw_line.startswith("+++"):
                new_line += 1
                yield file, new_line, raw_line[1:]
            elif not raw_line.startswith("-"):
                new_line += 1


def finding(category, severity, title, body, file=None, line=None, confidence=0.7, **metadata):
    return {
        "category": category,
        "severity": severity,
        "title": title,
        "body": body,
        "path": file.get("path") if file else None,
        "line": line,
        "confidence": confidence,
        "metadata": metadata,
    }
