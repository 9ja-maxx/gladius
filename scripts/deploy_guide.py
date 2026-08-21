import sys

def main():
    print("====================================================")
    print(" GladiusArena Intelligent Contract - Deploy Guide")
    print("====================================================\n")
    print("To deploy the contract to GenLayer Studionet, follow these steps:")
    print("1. Set target network config to studionet:")
    print("   genlayer network set studionet\n")
    print("2. Ensure you have created a deployer account:")
    print("   genlayer account create --name deployer\n")
    print("3. Unlock the account:")
    print("   genlayer account unlock --password <YOUR_PASSWORD>\n")
    print("4. Deploy the contract:")
    print("   genlayer deploy --contract contracts/gladius_arena.py\n")
    print("After deployment completes successfully:")
    print("- Copy the contract address.")
    print("- Update NEXT_PUBLIC_CONTRACT_ADDRESS in 'frontend/.env.local' or")
    print("- Set it directly in 'frontend/src/lib/genlayer.ts'.")
    print("====================================================")

if __name__ == '__main__':
    main()
