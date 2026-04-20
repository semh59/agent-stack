import os

def check_braces(file_path):
    with open(file_path, 'r', encoding='utf-8') as f:
        text = f.read()
    
    counts = {
        '{': text.count('{'),
        '}': text.count('}'),
        '[': text.count('['),
        ']': text.count(']'),
        '(': text.count('('),
        ')': text.count(')')
    }
    
    print("Brace/Bracket/Paren counts:")
    for char, count in counts.items():
        print(f"  {char}: {count}")
    
    if counts['{'] != counts['}']:
        print(f"!!! Mismatched braces: {{ {counts['{']} vs }} {counts['}']}")
    if counts['['] != counts[']']:
        print(f"!!! Mismatched brackets: [ {counts['[']} vs ] {counts[']']}")
    if counts['('] != counts[')']:
        print(f"!!! Mismatched parens: ( {counts['(']} vs ) {counts[')']}")

if __name__ == "__main__":
    check_braces('d:/PROJECT/agent-stack/AGENT/src/plugin.ts')
