import os

def search_logs():
    print("Searching log files in hennry folder...")
    for file in os.listdir('..'):
        filepath = os.path.join('..', file)
        if os.path.isfile(filepath) and file.endswith('.log'):
            try:
                with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                    for line in f:
                        if 'SUPABASE_SERVICE_ROLE_KEY' in line or 'service_role' in line:
                            print(f"Match in {filepath}: {line.strip()[:100]}")
            except Exception as e:
                print(f"Error reading {filepath}: {e}")

if __name__ == '__main__':
    search_logs()
