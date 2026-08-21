# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *
from dataclasses import dataclass
from datetime import datetime, timezone
import json
import typing


@allow_storage
@dataclass
class Duel:
    """
    Represents the full state and parameters of a 1v1 skill duel.
    By using allow_storage, this is stored natively inside GenVM state
    without relying on manual JSON serialization.
    """
    duel_id: u256
    challenger: Address
    opponent: Address
    category: str
    prompt: str
    solution_challenger: str
    solution_opponent: str
    stake_challenger: u256
    stake_opponent: u256
    status: u256  # 0 = Open, 1 = Matched, 2 = SolutionsSubmitted, 3 = Judged, 4 = Canceled
    winner: Address
    verdict_reasoning: str
    score_challenger: u256
    score_opponent: u256
    created_at: u256
    last_action_at: u256


class GladiusArena(gl.Contract):
    """
    GladiusArena is a decentralized 1v1 challenge platform where participants stake GEN
    tokens on subjective skills. Validator nodes evaluate submissions using LLMs and compare
    scores within a defined tolerance to reach consensus.
    """
    owner: Address
    duel_count: u256
    duels: TreeMap[u256, Duel]
    duel_ids: DynArray[u256]

    def __init__(self):
        """
        Constructor sets the owner and resets the duel counters.
        """
        self.owner = gl.message.sender_address
        self.duel_count = u256(0)

    @gl.public.write.payable
    def open_duel(self, category: str, prompt: str) -> u256:
        """
        Allows a user to open a new duel by specifying a category, prompt instructions,
        and staking GEN tokens. Returns the new duel ID.
        """
        value = gl.message.value
        if value == u256(0):
            raise gl.advanced.user_error_immediate("Must stake GEN tokens to open a duel")

        self.duel_count = u256(int(self.duel_count) + 1)
        cid = self.duel_count
        
        # Deterministic timestamp fetched during execution
        current_time = u256(int(datetime.now(timezone.utc).timestamp()))

        self.duels[cid] = Duel(
            duel_id=cid,
            challenger=gl.message.sender_address,
            opponent=Address("0x0000000000000000000000000000000000000000"),
            category=category.strip(),
            prompt=prompt.strip(),
            solution_challenger="",
            solution_opponent="",
            stake_challenger=value,
            stake_opponent=u256(0),
            status=u256(0),  # Open
            winner=Address("0x0000000000000000000000000000000000000000"),
            verdict_reasoning="",
            score_challenger=u256(0),
            score_opponent=u256(0),
            created_at=current_time,
            last_action_at=current_time,
        )
        self.duel_ids.append(cid)
        return cid

    @gl.public.write.payable
    def match_duel(self, duel_id: u256) -> None:
        """
        Accepts an open duel. The opponent matches the challenger's stake exactly.
        """
        if duel_id not in self.duels:
            raise gl.advanced.user_error_immediate("Duel does not exist")
            
        duel = self.duels[duel_id]
        if duel.status != u256(0):
            raise gl.advanced.user_error_immediate("Duel is not open for matchmaking")
        if gl.message.sender_address == duel.challenger:
            raise gl.advanced.user_error_immediate("Cannot match your own duel")
            
        value = gl.message.value
        if value != duel.stake_challenger:
            raise gl.advanced.user_error_immediate("Must match the challenger's stake exactly")

        duel.opponent = gl.message.sender_address
        duel.stake_opponent = value
        duel.status = u256(1)  # Matched / Solution phase
        
        current_time = u256(int(datetime.now(timezone.utc).timestamp()))
        duel.last_action_at = current_time
        
        self.duels[duel_id] = duel

    @gl.public.write
    def submit_solution(self, duel_id: u256, solution: str) -> None:
        """
        Allows either the challenger or opponent to submit their drafted solution.
        Transitions to SolutionsSubmitted once both are uploaded.
        """
        if duel_id not in self.duels:
            raise gl.advanced.user_error_immediate("Duel does not exist")
            
        duel = self.duels[duel_id]
        if duel.status != u256(1):
            raise gl.advanced.user_error_immediate("Duel is not accepting solution submissions")

        sender = gl.message.sender_address
        solution_clean = solution.strip()
        if not solution_clean:
            raise gl.advanced.user_error_immediate("Solution text cannot be empty")

        if sender == duel.challenger:
            if duel.solution_challenger:
                raise gl.advanced.user_error_immediate("Challenger has already submitted a solution")
            duel.solution_challenger = solution_clean
        elif sender == duel.opponent:
            if duel.solution_opponent:
                raise gl.advanced.user_error_immediate("Opponent has already submitted a solution")
            duel.solution_opponent = solution_clean
        else:
            raise gl.advanced.user_error_immediate("Sender is not a registered participant of this duel")

        current_time = u256(int(datetime.now(timezone.utc).timestamp()))
        duel.last_action_at = current_time

        # Update status if both have submitted their answers
        if duel.solution_challenger and duel.solution_opponent:
            duel.status = u256(2)  # SolutionsSubmitted / Ready for Judgment

        self.duels[duel_id] = duel

    @gl.public.write
    def evaluate_duel(self, duel_id: u256) -> dict:
        """
        Triggers the non-deterministic AI consensus workflow to grade solutions and payout the winner.
        """
        if duel_id not in self.duels:
            raise gl.advanced.user_error_immediate("Duel does not exist")
            
        duel = self.duels[duel_id]
        if duel.status != u256(2):
            raise gl.advanced.user_error_immediate("Solutions must be submitted before triggering judgment")

        # Copy data locally for reachability inside the non-deterministic closures
        category = str(duel.category)
        prompt = str(duel.prompt)
        sol_a = str(duel.solution_challenger)
        sol_b = str(duel.solution_opponent)

        def leader_fn() -> dict:
            """
            Executes LLM scoring on the leader node.
            """
            eval_prompt = f"""You are a professional, neutral referee evaluating a 1v1 skill contest.

CATEGORY: {category}
DUEL TASK: {prompt}

CHALLENGER SUBMISSION:
{sol_a}

OPPONENT SUBMISSION:
{sol_b}

Grade both submissions strictly based on:
1. Correctness: Full alignment with the duel task instructions.
2. Structure & Clarity: Logic, elegance, and presentation.
3. Ingenuity: Unique approaches or smart implementation details.
4. Robustness: Handling of exceptions, constraints, and edge cases.

Provide your response as a single valid JSON block.
Do NOT include markdown fences (such as ```json) or conversational text.
Use exactly this schema:
- "winner": integer (1 for Challenger, 2 for Opponent)
- "score_challenger": integer (from 1 to 10)
- "score_opponent": integer (from 1 to 10)
- "reasoning": a single-sentence clear explanation of the decision.

Example response:
{{"winner": 1, "score_challenger": 9, "score_opponent": 7, "reasoning": "Challenger handled all edge cases, while Opponent missed empty inputs."}}"""

            raw_response = gl.nondet.exec_prompt(eval_prompt)
            
            # Clean possible markdown block wrappers
            cleaned = raw_response.strip()
            if cleaned.startswith("```"):
                lines = cleaned.split("\n")
                lines = [line for line in lines if not line.strip().startswith("```")]
                cleaned = "\n".join(lines).strip()

            parsed = json.loads(cleaned)
            
            return {
                "winner": int(max(1, min(2, int(parsed.get("winner", 1))))),
                "score_challenger": int(max(1, min(10, int(parsed.get("score_challenger", 5))))),
                "score_opponent": int(max(1, min(10, int(parsed.get("score_opponent", 5))))),
                "reasoning": str(parsed.get("reasoning", "")).strip(),
            }

        def validator_fn(leader_result) -> bool:
            """
            Validates the leader's outcome by re-running the evaluation and checking bounds.
            """
            if not isinstance(leader_result, gl.vm.Return):
                return False
                
            leader_data = leader_result.calldata
            if not isinstance(leader_data, dict):
                return False
                
            required_keys = {"winner", "score_challenger", "score_opponent", "reasoning"}
            if not required_keys.issubset(leader_data.keys()):
                return False

            # Validator executes leader_fn to fetch their own independent non-deterministic result
            validator_data = leader_fn()

            # Equivalence Principle: Winner must match exactly, scores must be within +/- 2 points
            winner_matches = (leader_data["winner"] == validator_data["winner"])
            challenger_score_close = (abs(int(leader_data["score_challenger"]) - int(validator_data["score_challenger"])) <= 2)
            opponent_score_close = (abs(int(leader_data["score_opponent"]) - int(validator_data["score_opponent"])) <= 2)

            return winner_matches and challenger_score_close and opponent_score_close

        # Run non-deterministic consensus
        consensus_result = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)

        total_pot = duel.stake_challenger + duel.stake_opponent

        if consensus_result["winner"] == 1:
            duel.winner = duel.challenger
            self._transfer_funds(duel.challenger, total_pot)
        else:
            duel.winner = duel.opponent
            self._transfer_funds(duel.opponent, total_pot)

        duel.status = u256(3)  # Judged
        duel.verdict_reasoning = str(consensus_result.get("reasoning", ""))
        duel.score_challenger = u256(int(consensus_result.get("score_challenger", 0)))
        duel.score_opponent = u256(int(consensus_result.get("score_opponent", 0)))
        
        current_time = u256(int(datetime.now(timezone.utc).timestamp()))
        duel.last_action_at = current_time

        self.duels[duel_id] = duel
        return consensus_result

    @gl.public.write
    def claim_timeout_refund(self, duel_id: u256) -> None:
        """
        Deadlock Protection: If a matched duel remains idle for over 24 hours (e.g., a participant
        fails to submit their solution), either player can call this method to claim the stakes.
        - If Challenger submitted but Opponent did not: Challenger claims the entire pot (forfeit).
        - If Opponent submitted but Challenger did not: Opponent claims the entire pot (forfeit).
        - If neither submitted: Both receive refunds of their original stakes.
        """
        if duel_id not in self.duels:
            raise gl.advanced.user_error_immediate("Duel does not exist")
            
        duel = self.duels[duel_id]
        if duel.status != u256(1):
            raise gl.advanced.user_error_immediate("Can only claim timeout refund for matched active duels")

        current_time = u256(int(datetime.now(timezone.utc).timestamp()))
        # Timeout limit: 24 hours (86400 seconds)
        if int(current_time) <= int(duel.last_action_at) + 86400:
            raise gl.advanced.user_error_immediate("Timeout limit of 24 hours has not elapsed since last action")

        # Resolve stakes based on who was idle
        has_challenger_submitted = bool(duel.solution_challenger)
        has_opponent_submitted = bool(duel.solution_opponent)

        if has_challenger_submitted and not has_opponent_submitted:
            # Challenger wins by default
            total_pot = duel.stake_challenger + duel.stake_opponent
            duel.winner = duel.challenger
            self._transfer_funds(duel.challenger, total_pot)
            duel.verdict_reasoning = "Opponent forfeited by failing to submit a solution within the deadline."
        elif has_opponent_submitted and not has_challenger_submitted:
            # Opponent wins by default
            total_pot = duel.stake_challenger + duel.stake_opponent
            duel.winner = duel.opponent
            self._transfer_funds(duel.opponent, total_pot)
            duel.verdict_reasoning = "Challenger forfeited by failing to submit a solution within the deadline."
        else:
            # Neither submitted - refund stakes to respective owners
            self._transfer_funds(duel.challenger, duel.stake_challenger)
            self._transfer_funds(duel.opponent, duel.stake_opponent)
            duel.verdict_reasoning = "Duel canceled due to mutual inactivity."

        duel.status = u256(4)  # Canceled/Refunded
        duel.last_action_at = current_time
        self.duels[duel_id] = duel

    @gl.public.write
    def cancel_duel(self, duel_id: u256) -> None:
        """
        Allows the challenger to cancel an open duel before any opponent has matched and matched stakes.
        """
        if duel_id not in self.duels:
            raise gl.advanced.user_error_immediate("Duel does not exist")
            
        duel = self.duels[duel_id]
        if duel.status != u256(0):
            raise gl.advanced.user_error_immediate("Can only cancel open duels before matchmaking")
        if gl.message.sender_address != duel.challenger:
            raise gl.advanced.user_error_immediate("Only the challenger can cancel this duel")

        duel.status = u256(4)  # Canceled
        current_time = u256(int(datetime.now(timezone.utc).timestamp()))
        duel.last_action_at = current_time
        
        self.duels[duel_id] = duel
        
        # Refund full stake to challenger
        self._transfer_funds(duel.challenger, duel.stake_challenger)

    @gl.public.view
    def get_duel(self, duel_id: u256) -> dict:
        """
        Returns a dictionary summary of the duel state, convenient for frontend queries.
        """
        if duel_id not in self.duels:
            raise gl.advanced.user_error_immediate("Duel does not exist")
        duel = self.duels[duel_id]
        return {
            "id": int(duel.duel_id),
            "challenger": duel.challenger.as_hex,
            "opponent": duel.opponent.as_hex,
            "category": duel.category,
            "prompt": duel.prompt,
            "solution_challenger": duel.solution_challenger,
            "solution_opponent": duel.solution_opponent,
            "stake_challenger": str(duel.stake_challenger),
            "stake_opponent": str(duel.stake_opponent),
            "status": int(duel.status),
            "winner": duel.winner.as_hex,
            "verdict_reasoning": duel.verdict_reasoning,
            "score_challenger": int(duel.score_challenger),
            "score_opponent": int(duel.score_opponent),
            "created_at": int(duel.created_at),
            "last_action_at": int(duel.last_action_at),
        }

    @gl.public.view
    def get_duel_count(self) -> u256:
        """
        Returns the total number of duels created.
        """
        return self.duel_count

    @gl.public.view
    def get_duel_ids(self) -> list:
        """
        Returns all registered duel IDs.
        """
        out = []
        for i in range(len(self.duel_ids)):
            out.append(int(self.duel_ids[i]))
        return out

    def _transfer_funds(self, recipient: Address, amount: u256) -> None:
        """
        Emits an EVM-compliant transfer of GEN tokens to the recipient address.
        """
        @gl.evm.contract_interface
        class _RecipientContract:
            class View:
                pass
            class Write:
                pass
                
        _RecipientContract(recipient).emit_transfer(value=amount)
