import re

def check_range(file_path, start_line, end_line):
    with open(file_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    
    section = lines[start_line-1:end_line]
    text = "".join(section)
    text = re.sub(r'".*?"', '""', text)
    text = re.sub(r"'.*?'", "''", text)
    text = re.sub(r"`.*?`", "``", text)
    
    return text.count('{'), text.count('}')

if __name__ == "__main__":
    p = 'd:/PROJECT/agent-stack/AGENT/src/plugin.ts'
    print(f"450-900: {check_range(p, 450, 900)}")
    print(f"900-1525: {check_range(p, 900, 1525)}")
