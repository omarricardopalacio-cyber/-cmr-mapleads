import os

def search_files():
    print("Searching parent directory for .env files...")
    # Parent directory is one level up
    for file in os.listdir('..'):
        filepath = os.path.join('..', file)
        if os.path.isfile(filepath) and (file.endswith('.env') or file == '.env'):
            print(f"Found env file in parent: {filepath}")
            try:
                with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                    print(f"--- Contents of {filepath} ---")
                    print(f.read())
                    print("-----------------------------")
            except Exception as e:
                print(f"Error reading {filepath}: {e}")

if __name__ == '__main__':
    search_files()
