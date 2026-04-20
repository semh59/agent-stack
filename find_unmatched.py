def find_unmatched(file_path):
    with open(file_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    
    stack = []
    for line_num, line in enumerate(lines, 1):
        for char_num, char in enumerate(line, 1):
            if char in '{[(':
                stack.append((char, line_num, char_num))
            elif char in '}])':
                if not stack:
                    print(f"Extra closing {char} at {line_num}:{char_num}")
                    continue
                last_char, last_line, last_char_pos = stack.pop()
                if (char == '}' and last_char != '{') or \
                   (char == ']' and last_char != '[') or \
                   (char == ')' and last_char != '('):
                    print(f"Mismatched {char} at {line_num}:{char_num} (opens with {last_char} at {last_line}:{last_char_pos})")
    
    for char, line_num, char_num in stack:
        print(f"Unclosed {char} at {line_num}:{char_num}")

if __name__ == "__main__":
    find_unmatched('d:/PROJECT/agent-stack/AGENT/src/plugin.ts')
