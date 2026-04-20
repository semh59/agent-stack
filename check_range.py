import re

def check_range(file_path, start_line, end_line):
    with open(file_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    
    section = lines[start_line-1:end_line]
    text = "".join(section)
    # Remove strings
    text = re.sub(r'".*?"', '""', text)
    text = re.sub(r"'.*?'", "''", text)
    text = re.sub(r"`.*?`", "``", text)
    
    print(f"Stats for lines {start_line}-{end_line}:")
    print(f"  {{: {text.count('{')}, }}: {text.count('}')}")
    print(f"  [: {text.count('[')}, ]: {text.count(']')}")

if __name__ == "__main__":
    check_range('d:/PROJECT/agent-stack/AGENT/src/plugin.ts', 450, 1525)
