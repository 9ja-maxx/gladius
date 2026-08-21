import subprocess
import sys

def main():
    print("Checking GenVM environment...")
    try:
        res = subprocess.run(["genlayer", "--version"], capture_output=True, text=True, check=True)
        print(f"GenLayer CLI version: {res.stdout.strip()}")
    except Exception as e:
        print("GenLayer CLI is not installed or not in PATH.", file=sys.stderr)
        
    try:
        res = subprocess.run(["pip", "show", "genvm-linter"], capture_output=True, text=True)
        if res.returncode == 0:
            for line in res.stdout.split("\n"):
                if line.startswith("Version:"):
                    print(f"GenVM Linter version: {line.split(':', 1)[1].strip()}")
                    break
    except Exception:
        pass

if __name__ == '__main__':
    main()
