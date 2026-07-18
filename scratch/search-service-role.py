import os

def search_files():
    print("Searching for service_role...")
    for root, dirs, files in os.walk('.'):
        # Skip node_modules and .git
        if 'node_modules' in dirs:
            dirs.remove('node_modules')
        if '.git' in dirs:
            dirs.remove('.git')
        if 'dist' in dirs:
            dirs.remove('dist')

        for file in files:
            filepath = os.path.join(root, file)
            try:
                with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                    content = f.read()
                    if 'service_role' in content:
                        print(f"File containing service_role: {filepath}")
            except Exception:
                pass

if __name__ == '__main__':
    search_files()
