"""
Direct-mode unit tests for the GladiusArena intelligent contract.
These tests use direct VM execution and mock LLM calls.
"""

import sys
import json
from datetime import datetime as real_datetime, timezone

CONTRACT = "contracts/gladius_arena.py"
LLM_PATTERN = r".*evaluating a 1v1 skill contest.*"


class MockDatetime:
    """
    Mock class for datetime that allows setting a fixed timestamp in unit tests.
    """
    mock_now_timestamp = None

    @classmethod
    def now(cls, tz=None):
        if cls.mock_now_timestamp is not None:
            return real_datetime.fromtimestamp(cls.mock_now_timestamp, tz=timezone.utc)
        return real_datetime.now(tz)


def _setup_mock_time(contract_path):
    """
    Patches the loaded contract module's datetime import with our MockDatetime.
    """
    gladius_module = None
    for name, module in list(sys.modules.items()):
        if "gladius_arena" in name and not name.endswith("test_gladius_arena"):
            gladius_module = module
            break
            
    if gladius_module:
        gladius_module.datetime = MockDatetime
    MockDatetime.mock_now_timestamp = None


def _mock_referee(direct_vm, winner: int, score_c: int, score_o: int, reasoning: str):
    """
    Utility helper to mock LLM consensus verdicts.
    """
    direct_vm.clear_mocks()
    direct_vm.mock_llm(
        LLM_PATTERN,
        json.dumps(
            {
                "winner": winner,
                "score_challenger": score_c,
                "score_opponent": score_o,
                "reasoning": reasoning,
            }
        ),
    )


def test_duel_lifecycle(direct_vm, direct_deploy, direct_owner, direct_bob):
    # Deploy contract
    direct_vm.sender = direct_owner
    arena = direct_deploy(CONTRACT)
    _setup_mock_time(CONTRACT)

    # 1. Open a duel
    stake_amount = 10 * 10**18  # 10 GEN
    direct_vm.value = stake_amount
    
    # Check opening validation
    with direct_vm.expect_revert("Must stake GEN tokens to open a duel"):
        direct_vm.value = 0
        arena.open_duel("Coding", "Write a python reverse-string function")

    direct_vm.value = stake_amount
    cid = arena.open_duel("Coding", "Write a python reverse-string function")
    assert int(cid) == 1
    assert int(arena.get_duel_count()) == 1

    duel = arena.get_duel(cid)
    assert duel["id"] == 1
    assert duel["category"] == "Coding"
    assert duel["status"] == 0  # Open
    assert int(duel["stake_challenger"]) == stake_amount
    assert int(duel["stake_opponent"]) == 0

    # 2. Match the duel
    direct_vm.sender = direct_bob
    
    # Check matching self
    with direct_vm.expect_revert("Cannot match your own duel"):
        with direct_vm.prank(direct_owner):
            direct_vm.value = stake_amount
            arena.match_duel(cid)

    # Check incorrect stake
    with direct_vm.expect_revert("Must match the challenger's stake exactly"):
        direct_vm.value = stake_amount - 1
        arena.match_duel(cid)

    direct_vm.value = stake_amount
    arena.match_duel(cid)

    duel = arena.get_duel(cid)
    assert duel["status"] == 1  # Matched
    assert duel["opponent"].lower() == "0x" + direct_bob.hex().lower()
    assert int(duel["stake_opponent"]) == stake_amount

    # 3. Submit solutions
    with direct_vm.expect_revert("Solution text cannot be empty"):
        arena.submit_solution(cid, "")

    with direct_vm.expect_revert("Sender is not a registered participant of this duel"):
        # Random address tries to submit
        random_addr = b'\x11' * 20
        with direct_vm.prank(random_addr):
            arena.submit_solution(cid, "print('hello')")

    # Challenger submits
    direct_vm.sender = direct_owner
    arena.submit_solution(cid, "def rev(s): return s[::-1]")

    # Double submit check
    with direct_vm.expect_revert("Challenger has already submitted a solution"):
        arena.submit_solution(cid, "def rev2(s): return s")

    duel = arena.get_duel(cid)
    assert duel["status"] == 1  # Still matched (only 1 submitted)
    assert duel["solution_challenger"] == "def rev(s): return s[::-1]"

    # Opponent submits
    direct_vm.sender = direct_bob
    arena.submit_solution(cid, "def rev(s): return ''.join(reversed(s))")

    duel = arena.get_duel(cid)
    assert duel["status"] == 2  # SolutionsSubmitted
    assert duel["solution_opponent"] == "def rev(s): return ''.join(reversed(s))"

    # 4. Evaluate the duel
    _mock_referee(direct_vm, 1, 9, 8, "Challenger wrote a more concise solution.")
    
    # Scribe or participant triggers evaluation
    arena.evaluate_duel(cid)

    duel = arena.get_duel(cid)
    assert duel["status"] == 3  # Judged
    assert duel["winner"].lower() == "0x" + direct_owner.hex().lower()
    assert duel["score_challenger"] == 9
    assert duel["score_opponent"] == 8
    assert duel["verdict_reasoning"] == "Challenger wrote a more concise solution."

    # Equivalence check testing: validator matches within variance
    assert direct_vm.run_validator() is True

    # Validator variance failure (winner discrepancy)
    _mock_referee(direct_vm, 2, 7, 9, "Opponent won instead.")
    assert direct_vm.run_validator() is False


def test_cancel_open_duel(direct_vm, direct_deploy, direct_owner, direct_bob):
    direct_vm.sender = direct_owner
    arena = direct_deploy(CONTRACT)
    _setup_mock_time(CONTRACT)

    # Open duel
    stake = 5 * 10**18
    direct_vm.value = stake
    cid = arena.open_duel("Writing", "Write a haiku about computers")

    # Unauthorized cancel check
    with direct_vm.expect_revert("Only the challenger can cancel this duel"):
        with direct_vm.prank(direct_bob):
            arena.cancel_duel(cid)

    # Cancel
    arena.cancel_duel(cid)
    duel = arena.get_duel(cid)
    assert duel["status"] == 4  # Canceled

    # Cannot match canceled duel
    with direct_vm.expect_revert("Duel is not open for matchmaking"):
        direct_vm.sender = direct_bob
        direct_vm.value = stake
        arena.match_duel(cid)


def test_timeout_refund_mutual_idle(direct_vm, direct_deploy, direct_owner, direct_bob):
    # Deploy
    direct_vm.sender = direct_owner
    arena = direct_deploy(CONTRACT)
    _setup_mock_time(CONTRACT)

    # Open & Match
    stake = 10**18
    direct_vm.value = stake
    cid = arena.open_duel("Math", "Compute 50th fibonacci number")
    
    direct_vm.sender = direct_bob
    direct_vm.value = stake
    arena.match_duel(cid)

    # Attempt early refund (fails)
    with direct_vm.expect_revert("Timeout limit of 24 hours has not elapsed since last action"):
        arena.claim_timeout_refund(cid)

    # Fast forward time by 24 hours + 1 second (86401 seconds)
    duel = arena.get_duel(cid)
    original_last_action = duel["last_action_at"]
    MockDatetime.mock_now_timestamp = original_last_action + 86401

    # Neither submitted solutions - refund both
    arena.claim_timeout_refund(cid)
    duel = arena.get_duel(cid)
    assert duel["status"] == 4  # Refunded
    assert duel["verdict_reasoning"] == "Duel canceled due to mutual inactivity."


def test_timeout_refund_challenger_wins(direct_vm, direct_deploy, direct_owner, direct_bob):
    # Deploy
    direct_vm.sender = direct_owner
    arena = direct_deploy(CONTRACT)
    _setup_mock_time(CONTRACT)

    # Open & Match
    stake = 10**18
    direct_vm.value = stake
    cid = arena.open_duel("Math", "Compute 50th fibonacci number")
    
    direct_vm.sender = direct_bob
    direct_vm.value = stake
    arena.match_duel(cid)

    # Challenger submits, Opponent does not
    direct_vm.sender = direct_owner
    arena.submit_solution(cid, "Challenger's math proof")

    # Fast forward
    duel = arena.get_duel(cid)
    MockDatetime.mock_now_timestamp = duel["last_action_at"] + 86401

    # Challenger claims pot
    arena.claim_timeout_refund(cid)
    duel = arena.get_duel(cid)
    assert duel["status"] == 4  # Resolved/Refunded
    assert duel["winner"].lower() == "0x" + direct_owner.hex().lower()
    assert "Opponent forfeited" in duel["verdict_reasoning"]
