#!/usr/bin/env python3
"""
Populates Gladius contract history on Studionet with live transactions.
Generates unique wallets, funds them from the master key, and executes
a series of duel states (Open, Matched, SolutionsSubmitted, Judged, Canceled).
"""

import sys
import time
from eth_account import Account
from genlayer_py import create_account, create_client
from genlayer_py.chains import studionet

ADDR = "0x1d4c3b281FE4d4EAa61cA3AC08AF2a994e83174D"
MASTER_KEY = "0x865c6773bcd46f894a56092ca318c2d4931d49ed8e60ddc4c8a709b67683e699"

# Create master client
master_acct = create_account(MASTER_KEY)
master_client = create_client(chain=studionet, account=master_acct)

print(f"Master Account Address: {master_acct.address}")

# 1. Generate 3 unique test accounts
acct_a = Account.create()
acct_b = Account.create()
acct_c = Account.create()

print(f"Generated Challenger A: {acct_a.address}")
print(f"Generated Participant B: {acct_b.address}")
print(f"Generated Participant C: {acct_c.address}")

# 2. Fund them
def fund_acct(client, master, recipient, amount_gen):
    nonce_hex = client.provider.make_request(method='eth_getTransactionCount', params=[master.address, 'latest'])['result']
    tx = {
        'to': recipient,
        'value': int(amount_gen * 10**18),
        'gas': 21000,
        'gasPrice': 0,
        'nonce': int(nonce_hex, 16),
        'chainId': 61999
    }
    signed = master.sign_transaction(tx)
    tx_hash = client.provider.make_request(
        method='eth_sendRawTransaction', 
        params=[client.w3.to_hex(signed.raw_transaction)]
    )['result']
    print(f"Funding {recipient} with {amount_gen} GEN (hash: {tx_hash})...")
    client.w3.eth.wait_for_transaction_receipt(tx_hash)
    print(f"Funded {recipient[:8]}... successfully!")

print("\n--- Phase 1: Funding Test Accounts ---")
fund_acct(master_client, master_acct, acct_a.address, 150)
fund_acct(master_client, master_acct, acct_b.address, 150)
fund_acct(master_client, master_acct, acct_c.address, 150)

# Create distinct clients for each participant
client_a = create_client(chain=studionet, account=create_account(acct_a.key.hex()))
client_b = create_client(chain=studionet, account=create_account(acct_b.key.hex()))
client_c = create_client(chain=studionet, account=create_account(acct_c.key.hex()))

# Contract Write/Read Wrappers
def get_duel_count(client):
    return int(client.read_contract(address=ADDR, function_name="get_duel_count", args=[]))

def open_duel(client, account, category, prompt, stake_gen):
    print(f"[{account.address[:8]}...] Opening duel in '{category}' with stake {stake_gen} GEN...")
    tx_hash = client.write_contract(
        address=ADDR,
        function_name="open_duel",
        account=create_account(account.key.hex()),
        value=int(stake_gen * 10**18),
        args=[category, prompt]
    )
    print(f"Consensus tx hash: {tx_hash}")
    return tx_hash

def match_duel(client, account, duel_id, stake_gen):
    print(f"[{account.address[:8]}...] Matching duel #{duel_id} with stake {stake_gen} GEN...")
    tx_hash = client.write_contract(
        address=ADDR,
        function_name="match_duel",
        account=create_account(account.key.hex()),
        value=int(stake_gen * 10**18),
        args=[int(duel_id)]
    )
    print(f"Consensus tx hash: {tx_hash}")
    return tx_hash

def submit_solution(client, account, duel_id, solution):
    print(f"[{account.address[:8]}...] Submitting solution to duel #{duel_id}...")
    tx_hash = client.write_contract(
        address=ADDR,
        function_name="submit_solution",
        account=create_account(account.key.hex()),
        args=[int(duel_id), solution]
    )
    print(f"Consensus tx hash: {tx_hash}")
    return tx_hash

def evaluate_duel(client, account, duel_id):
    print(f"[{account.address[:8]}...] Triggering evaluation for duel #{duel_id}...")
    tx_hash = client.write_contract(
        address=ADDR,
        function_name="evaluate_duel",
        account=create_account(account.key.hex()),
        args=[int(duel_id)]
    )
    print(f"Consensus tx hash: {tx_hash}")
    return tx_hash

def cancel_duel(client, account, duel_id):
    print(f"[{account.address[:8]}...] Canceling duel #{duel_id}...")
    tx_hash = client.write_contract(
        address=ADDR,
        function_name="cancel_duel",
        account=create_account(account.key.hex()),
        args=[int(duel_id)]
    )
    print(f"Consensus tx hash: {tx_hash}")
    return tx_hash

print("\n--- Phase 2: Seeding Historical Duels ---")

# === DUEL 1: Coding (Judged) ===
print("\n--- Seeding Duel #1 (Coding, Judged) ---")
open_duel(client_a, acct_a, "Coding", "Write a Python function to sort a list of numbers using bubble sort.", 10)
d1_id = get_duel_count(master_client)
print(f"Duel #1 ID: {d1_id}")

match_duel(client_b, acct_b, d1_id, 10)

submit_solution(client_a, acct_a, d1_id, "def bubble_sort(arr):\n    n = len(arr)\n    for i in range(n):\n        for j in range(0, n-i-1):\n            if arr[j] > arr[j+1]:\n                arr[j], arr[j+1] = arr[j+1], arr[j]\n    return arr")
submit_solution(client_b, acct_b, d1_id, "def bubble_sort(l):\n    return sorted(l)")

evaluate_duel(master_client, master_acct, d1_id)
duel1 = master_client.read_contract(address=ADDR, function_name="get_duel", args=[int(d1_id)])
print(f"Result -> Status: {duel1['status']}, Winner: {duel1['winner']}, Reason: {duel1['verdict_reasoning']}")

# === DUEL 2: Writing (Judged) ===
print("\n--- Seeding Duel #2 (Writing, Judged) ---")
open_duel(client_b, acct_b, "Writing", "Write a 3-line haiku about artificial intelligence.", 15)
d2_id = get_duel_count(master_client)
print(f"Duel #2 ID: {d2_id}")

match_duel(client_c, acct_c, d2_id, 15)

submit_solution(client_b, acct_b, d2_id, "Silicon thinking\nElectrons spark inside brain\nMachines learn our ways")
submit_solution(client_c, acct_c, d2_id, "Glowing screen of light\nWhispers answers in the dark\nHuman mind reborn")

evaluate_duel(master_client, master_acct, d2_id)
duel2 = master_client.read_contract(address=ADDR, function_name="get_duel", args=[int(d2_id)])
print(f"Result -> Status: {duel2['status']}, Winner: {duel2['winner']}, Reason: {duel2['verdict_reasoning']}")

# === DUEL 3: Design (Open) ===
print("\n--- Seeding Duel #3 (Design, Open) ---")
open_duel(client_a, acct_a, "Design", "Design a minimalist dark mode color palette configuration in JSON.", 20)
d3_id = get_duel_count(master_client)
print(f"Duel #3 ID: {d3_id} (Remains Open)")

# === DUEL 4: Trivia (Canceled) ===
print("\n--- Seeding Duel #4 (Trivia, Canceled) ---")
open_duel(client_c, acct_c, "Trivia", "What is the capital of Nigeria? (Specify city name and coordinates)", 12)
d4_id = get_duel_count(master_client)
print(f"Duel #4 ID: {d4_id}")
cancel_duel(client_c, acct_c, d4_id)
duel4 = master_client.read_contract(address=ADDR, function_name="get_duel", args=[int(d4_id)])
print(f"Result -> Status: {duel4['status']}")

print("\n✓ Contract history populated successfully!")
