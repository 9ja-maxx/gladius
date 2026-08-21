# ⚔️ Gladius Arena Frontend

This directory contains the Next.js web application for the Gladius 1v1 Skill Adjudication Arena.

## Setup Instructions

1. **Install Dependencies:**
   ```bash
   npm install
   ```

2. **Configure Environment Variables:**
   Create a `.env.local` file in this directory:
   ```env
   NEXT_PUBLIC_CONTRACT_ADDRESS=0xYourDeployedContractAddress
   ```

3. **Run Development Server:**
   ```bash
   npm run dev
   ```

4. **Build for Production:**
   ```bash
   npm run build
   ```

## Key Technologies
- **Next.js:** App Router framework.
- **genlayer-js:** Integration library to interact with GenLayer Intelligent Contracts on Studionet.
- **EVM Wallet Integration:** Automatic chain addition/switching to GenLayer Studio Network (Chain ID: `61999`).
