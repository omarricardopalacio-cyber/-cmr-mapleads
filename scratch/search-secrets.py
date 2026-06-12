import os

def search_files():
    print("Searching for SUPABASE_SERVICE_ROLE_KEY or env files...")
    for root, dirs, files in os.walk('.'):
        # Skip node_modules and .git
        if 'node_modules' in dirs:
            dirs.remove('node_modules')
        if '.git' in dirs:
            dirs.remove('.git')
        if '.tanstack' in dirs:
            dirs.remove('.tanstack')
        if 'dist' in dirs:
            dirs.remove('dist')

        for file in files:
            filepath = os.path.join(root, file)
            # Look for environment files
            if file.endswith('.env') or file == '.env':
                print(f"Found env file: {filepath}")
                try:
                    with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                        print(f"--- Contents of {filepath} ---")
                        print(f.read())
                        print("-----------------------------")
                except Exception as e:
                    print(f"Error reading {filepath}: {e}")
            
            # Search for keyword
            try:
                with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                    content = f.read()
                    if 'SUPABASE_SERVICE_ROLE_KEY' in content:
                        print(f"File containing keyword: {filepath}")
            except Exception:
                pass

if __name__ == '__main__':
    search_files()
