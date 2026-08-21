"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { CONTRACT_ADDRESS, connectWallet, disconnectWallet, readClient, shortAddr, type WalletState } from "@/lib/genlayer";
import { TransactionStatus } from "genlayer-js/types";

type Duel = {
  id: number;
  challenger: string;
  opponent: string;
  category: string;
  prompt: string;
  solution_challenger: string;
  solution_opponent: string;
  stake_challenger: string;
  stake_opponent: string;
  status: number; // 0 = Open, 1 = Matched, 2 = SolutionsSubmitted, 3 = Judged, 4 = Canceled/Refunded
  winner: string;
  verdict_reasoning: string;
  score_challenger: number;
  score_opponent: number;
  created_at: number;
  last_action_at: number;
};

const CATEGORIES = ["Coding", "Writing", "Design", "Math", "Trivia"] as const;
const STATUS_LABELS = ["Recruiting", "Active Duel", "AI Arbitration", "Settled", "Canceled"];
const STATUS_COLORS = ["#f43f5e", "#f59e0b", "#3b82f6", "#10b981", "#6b7280"];

const CAT_DETAILS: Record<string, { icon: string; title: string; bg: string; text: string }> = {
  Coding: { icon: "⚔️", title: "Iron Codex", bg: "#f43f5e12", text: "#fb7185" },
  Writing: { icon: "📜", title: "Scribe Guild", bg: "#ec489912", text: "#f472b6" },
  Design: { icon: "🛡️", title: "Artisan Shield", bg: "#8b5cf612", text: "#a78bfa" },
  Math: { icon: "📐", title: "Abacus Forge", bg: "#10b98112", text: "#34d399" },
  Trivia: { icon: "🔮", title: "Oracle Scroll", bg: "#f59e0b12", text: "#fbbf24" },
};

export default function ArenaHome() {
  const [wallet, setWallet] = useState<WalletState>({ address: null, client: null });
  const [duels, setDuels] = useState<Duel[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>("All");
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Duel | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ category: "Coding", prompt: "", stake: "" });
  const [solutionInput, setSolutionInput] = useState("");
  const [toastMsg, setToastMsg] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState<number>(Math.floor(Date.now() / 1000));
  
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Sync client time for timeout calculations
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Close dropdown on outside clicks
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const loadDuels = useCallback(async () => {
    try {
      const client = readClient();
      const count = Number(
        await client.readContract({
          address: CONTRACT_ADDRESS,
          functionName: "get_duel_count",
          args: [],
        })
      );
      
      // Fetch all duels in parallel to prevent sequential RPC blocking and speed up loading
      const promises = [];
      for (let i = 1; i <= count; i++) {
        promises.push(
          client.readContract({
            address: CONTRACT_ADDRESS,
            functionName: "get_duel",
            args: [BigInt(i)],
          })
        );
      }
      
      const rawResults = await Promise.all(promises);
      const list = rawResults.map(raw => raw as unknown as Duel);
      setDuels(list.reverse());
    } catch (e) {
      console.error("Failed to load duels from contract:", e);
    }
  }, []);

  useEffect(() => {
    loadDuels();
  }, [loadDuels]);

  async function handleConnect() {
    setToastMsg("Establishing wallet secure connection…");
    try {
      const w = await connectWallet();
      setWallet(w);
      setToastMsg("");
      setDropdownOpen(false);
    } catch (e: any) {
      setToastMsg(e.message || "Failed to connect wallet");
      setTimeout(() => setToastMsg(""), 3500);
    }
  }

  function handleDisconnect() {
    setWallet(disconnectWallet());
    setDropdownOpen(false);
    setToastMsg("Wallet connection terminated");
    setTimeout(() => setToastMsg(""), 2000);
  }

  async function executeWrite(functionName: string, args: any[], value?: bigint) {
    if (!wallet.client) {
      setToastMsg("⚠️ Wallet connection required to issue transactions.");
      setTimeout(() => setToastMsg(""), 3000);
      return;
    }
    setLoading(true);
    setToastMsg("Awaiting secure wallet signature…");
    try {
      const hash = await wallet.client.writeContract({
        address: CONTRACT_ADDRESS,
        functionName,
        args,
        value: value ?? BigInt(0),
      });
      
      setToastMsg("Reaching decentralized AI consensus on-chain…");
      const receipt = await wallet.client.waitForTransactionReceipt({
        hash,
        status: TransactionStatus.ACCEPTED,
      });

      if (receipt && (receipt as any).status === TransactionStatus.CANCELED) {
        setToastMsg("⚠️ Consensus Fail: AI referees disagreed on the grading bounds. Pot remains locked.");
        setLoading(false);
        return;
      }

      setToastMsg("✓ Transaction verified on-chain!");
      await loadDuels();
      
      // Sync selected duel modal state if currently viewed
      if (selected) {
        const updatedRaw = await readClient().readContract({
          address: CONTRACT_ADDRESS,
          functionName: "get_duel",
          args: [BigInt(selected.id)],
        });
        setSelected(updatedRaw as unknown as Duel);
      }
      
      setTimeout(() => setToastMsg(""), 3000);
      setShowCreate(false);
    } catch (e: any) {
      const msg = e?.message || String(e);
      
      try {
        await loadDuels();
        if (selected) {
          const updatedRaw = await readClient().readContract({
            address: CONTRACT_ADDRESS,
            functionName: "get_duel",
            args: [BigInt(selected.id)],
          });
          setSelected(updatedRaw as unknown as Duel);
        }
      } catch (loadErr) {
        console.error("Error updating details:", loadErr);
      }

      if (/timeout/i.test(msg)) {
        setToastMsg("⌛ Transaction pending. Reloading state from network…");
        setTimeout(() => setToastMsg(""), 3500);
      } else if (/consensus|abort|canceled/i.test(msg)) {
        setToastMsg("⚠️ Adjudication Aborted: LLM grading scores diverged. Retrigger evaluation.");
        setTimeout(() => setToastMsg(""), 4500);
      } else if (/insufficient funds/i.test(msg)) {
        setToastMsg("⚠️ Error: Insufficient GEN balance to fund stakes.");
        setTimeout(() => setToastMsg(""), 4500);
      } else if (/user rejected|rejected/i.test(msg)) {
        setToastMsg("Transaction cancelled by user.");
        setTimeout(() => setToastMsg(""), 2500);
      } else {
        setToastMsg(`Error: ${msg.slice(0, 80)}…`);
        setTimeout(() => setToastMsg(""), 4500);
      }
    }
    setLoading(false);
  }

  const formatGEN = (wei: string) => {
    return (Number(BigInt(wei || "0")) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 4 });
  };

  const getAvatarColor = (address: string) => {
    if (!address || address.length < 8 || address.startsWith("0x0000")) return "hsl(0, 0%, 20%)";
    const intVal = parseInt(address.slice(2, 10), 16);
    return `hsl(${intVal % 360}, 65%, 40%)`;
  };

  const filteredDuels = activeCategory === "All"
    ? duels
    : duels.filter(d => d.category === activeCategory);

  const getTimeoutTimeLeft = (duel: Duel) => {
    // 24 hours = 86400 seconds
    const targetTime = Number(duel.last_action_at) + 86400;
    const diff = targetTime - currentTime;
    if (diff <= 0) return 0;
    return diff;
  };

  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours}h ${minutes}m ${secs}s`;
  };

  return (
    <div className="arena-wrapper">
      {/* Top Banner Navigation */}
      <nav className="header-nav">
        <div className="header-content">
          <div className="logo-section" onClick={() => setSelected(null)}>
            <span className="logo-spark">⚔️</span>
            <span className="logo-text">Gladius</span>
            <span className="logo-subtext">Arena</span>
          </div>

          <div className="nav-controls" ref={dropdownRef}>
            {wallet.address ? (
              <div className="account-container">
                <button className="account-btn" onClick={() => setDropdownOpen(!dropdownOpen)}>
                  <span className="active-dot" />
                  {shortAddr(wallet.address)}
                  <span className="chevron-icon">▾</span>
                </button>
                {dropdownOpen && (
                  <div className="account-dropdown">
                    <div className="drop-section-lbl">Authenticated User</div>
                    <div className="drop-addr-box">{wallet.address}</div>
                    <div className="drop-net-info">Network: GenLayer Studio RPC</div>
                    <button className="btn-disconnect" onClick={handleDisconnect}>
                      Disconnect Wallet
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <button className="btn-connect-wallet" onClick={handleConnect}>
                Connect Wallet
              </button>
            )}
          </div>
        </div>
      </nav>

      {/* Action Toast Alerts */}
      {toastMsg && <div className="action-toast">{toastMsg}</div>}

      {/* Main layout wrapper */}
      {!selected ? (
        <>
          {/* Gladiatorial Hero Banner */}
          <header className="hero-banner">
            <div className="hero-details">
              <span className="hero-tag">Decentralized Subjective Duel Ground</span>
              <h1 className="hero-title">
                Ironclad Skills.<br />
                Neutral AI Consensus.<br />
                Trustless Settlement.
              </h1>
              <p className="hero-subtitle">
                Gladius is a high-stakes peer adjudication court. Pit your answers against opponents in coding, artisan design, scribe writing, logic, and trivia. Stakes are secured in escrow, evaluated by a consensus of AI validators under the Equivalence Principle, and automatically distributed.
              </p>
              <div className="hero-buttons">
                <button className="btn-action-primary" onClick={() => setShowCreate(true)}>
                  Declare Challenge
                </button>
              </div>
            </div>

            {/* Metro stats block */}
            <div className="stats-box">
              <div className="stats-grid">
                <div className="stats-card">
                  <div className="stats-num">{duels.length}</div>
                  <div className="stats-lbl">Total Arenas</div>
                </div>
                <div className="stats-card">
                  <div className="stats-num">{duels.filter(d => d.status === 0).length}</div>
                  <div className="stats-lbl">Recruiting</div>
                </div>
                <div className="stats-card">
                  <div className="stats-num">{duels.filter(d => d.status === 3).length}</div>
                  <div className="stats-lbl">Settled</div>
                </div>
              </div>
              <div className="stats-footer">
                <span>Studionet Gateway Protocol</span>
              </div>
            </div>
          </header>

          {/* Arena selection grid */}
          <main className="grid-section">
            <div className="grid-filter-bar">
              <h2 className="grid-title">Duels Recruiting</h2>
              <div className="grid-filters">
                <button
                  className={`filter-option ${activeCategory === "All" ? "active" : ""}`}
                  onClick={() => setActiveCategory("All")}
                >
                  All
                </button>
                {CATEGORIES.map(cat => (
                  <button
                    key={cat}
                    className={`filter-option ${activeCategory === cat ? "active" : ""}`}
                    onClick={() => setActiveCategory(cat)}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {filteredDuels.length === 0 ? (
              <div className="arena-empty-state">
                <div className="empty-spark">🛡️</div>
                <p>The arena is empty. Propose a new challenge to recruit opponents.</p>
              </div>
            ) : (
              <div className="duels-grid">
                {filteredDuels.map(d => {
                  const catTheme = CAT_DETAILS[d.category] || { icon: "⚔️", title: d.category, bg: "#1f2937", text: "#9ca3af" };
                  const isCanceled = d.status === 4;
                  return (
                    <div key={d.id} className={`duel-card ${isCanceled ? "canceled" : ""}`} onClick={() => setSelected(d)}>
                      <div className="card-top">
                        <span className="card-cat-badge" style={{ background: catTheme.bg, color: catTheme.text }}>
                          <span className="cat-icon-span">{catTheme.icon}</span> {catTheme.title}
                        </span>
                        <span
                          className="card-status-badge"
                          style={{
                            color: STATUS_COLORS[d.status],
                            border: `1px solid ${STATUS_COLORS[d.status]}30`,
                            background: `${STATUS_COLORS[d.status]}10`,
                          }}
                        >
                          {STATUS_LABELS[d.status]}
                        </span>
                      </div>

                      <div className="card-vs-stack">
                        <div className="avatar-shield" style={{ background: getAvatarColor(d.challenger) }} title="Challenger">
                          C
                        </div>
                        <span className="vs-spark">vs</span>
                        {d.opponent && !d.opponent.startsWith("0x0000") ? (
                          <div className="avatar-shield" style={{ background: getAvatarColor(d.opponent) }} title="Opponent">
                            O
                          </div>
                        ) : (
                          <div className="avatar-shield idle" title="Awaiting Match">
                            ?
                          </div>
                        )}
                      </div>

                      <p className="card-prompt-desc">{d.prompt}</p>

                      <div className="card-pot-display">
                        <span className="pot-title-lbl">Bounty Pool</span>
                        <span className="pot-val-lbl">
                          {formatGEN(String(BigInt(d.stake_challenger) + BigInt(d.stake_opponent)))} GEN
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </main>
        </>
      ) : (
        /* Match matchup detailed battle view */
        <main className="duel-detail-panel">
          <button className="btn-nav-back" onClick={() => { setSelected(null); setSolutionInput(""); }}>
            ← Escape to Arena
          </button>

          <div className="detail-panel-card">
            <div className="panel-header-row">
              <span className="panel-cat-badge" style={{ background: CAT_DETAILS[selected.category]?.bg, color: CAT_DETAILS[selected.category]?.text }}>
                {CAT_DETAILS[selected.category]?.icon} {CAT_DETAILS[selected.category]?.title}
              </span>
              <span
                className="panel-status-badge"
                style={{
                  color: STATUS_COLORS[selected.status],
                  border: `1px solid ${STATUS_COLORS[selected.status]}30`,
                  background: `${STATUS_COLORS[selected.status]}10`,
                }}
              >
                {STATUS_LABELS[selected.status]}
              </span>
            </div>

            <div className="battle-vs-grid">
              <div className={`gladiator-card ${selected.winner.toLowerCase() === selected.challenger.toLowerCase() ? "victory" : ""}`}>
                <div className="gladiator-avatar" style={{ background: getAvatarColor(selected.challenger) }}>
                  {selected.winner.toLowerCase() === selected.challenger.toLowerCase() && <span className="victory-crown">👑</span>}
                  I
                </div>
                <div className="gladiator-title">Challenger</div>
                <div className="gladiator-address">{shortAddr(selected.challenger)}</div>
                <div className="gladiator-stake">Stake: {formatGEN(selected.stake_challenger)} GEN</div>
              </div>

              <div className="battle-vs-giant">VS</div>

              <div className={`gladiator-card ${selected.opponent.startsWith("0x0000") ? "recruiting" : ""} ${selected.winner.toLowerCase() === selected.opponent.toLowerCase() ? "victory" : ""}`}>
                <div className="gladiator-avatar" style={{ background: selected.opponent.startsWith("0x0000") ? "#111827" : getAvatarColor(selected.opponent), border: selected.opponent.startsWith("0x0000") ? "1px dashed #374151" : "none" }}>
                  {selected.winner.toLowerCase() === selected.opponent.toLowerCase() && <span className="victory-crown">👑</span>}
                  {selected.opponent.startsWith("0x0000") ? "?" : "II"}
                </div>
                <div className="gladiator-title">Opponent</div>
                <div className="gladiator-address">{selected.opponent.startsWith("0x0000") ? "Slot Unlocked" : shortAddr(selected.opponent)}</div>
                <div className="gladiator-stake">Stake: {selected.opponent.startsWith("0x0000") ? "0" : formatGEN(selected.stake_opponent)} GEN</div>
              </div>
            </div>

            <div className="battle-prompt-box">
              <div className="prompt-label-txt">Combat Instruction</div>
              <div className="prompt-content-txt">{selected.prompt}</div>
              <div className="pot-pool-banner">
                Pot Escrow: {formatGEN(String(BigInt(selected.stake_challenger) + BigInt(selected.stake_opponent)))} GEN
              </div>
            </div>
          </div>

          {/* Submissions Display */}
          {(selected.solution_challenger || selected.solution_opponent) && (
            <div className="submissions-grid">
              <div className="sub-card-col">
                <div className="sub-header challenger">Challenger Solution</div>
                <pre className="sub-body">{selected.solution_challenger || "Solutions pending..."}</pre>
              </div>
              <div className="sub-card-col">
                <div className="sub-header opponent">Opponent Solution</div>
                <pre className="sub-body">{selected.solution_opponent || "Solutions pending..."}</pre>
              </div>
            </div>
          )}

          {/* AI Referee Verdict Display */}
          {selected.status === 3 && (
            <div className="referee-judgment-card">
              <div className="referee-title-row">⚖️ AI Referee Verdict</div>
              
              {/* Score progress meters */}
              <div className="referee-score-meters">
                <div className="referee-score-row">
                  <div className="meter-label">Challenger Rating: {selected.score_challenger}/10</div>
                  <div className="meter-bar-bg">
                    <div
                      className="meter-bar-fill challenger"
                      style={{ width: `${(selected.score_challenger || 0) * 10}%` }}
                    />
                  </div>
                </div>
                
                <div className="referee-score-row">
                  <div className="meter-label">Opponent Rating: {selected.score_opponent}/10</div>
                  <div className="meter-bar-bg">
                    <div
                      className="meter-bar-fill opponent"
                      style={{ width: `${(selected.score_opponent || 0) * 10}%` }}
                    />
                  </div>
                </div>
              </div>

              <p className="judgment-reasoning">
                <strong>Referee Statement:</strong> {selected.verdict_reasoning}
              </p>
            </div>
          )}

          {/* Timeout cancellation info display */}
          {selected.status === 4 && selected.verdict_reasoning && (
            <div className="cancellation-reason-card">
              <div className="cancellation-title">🚫 Duel Canceled</div>
              <p className="cancellation-desc">{selected.verdict_reasoning}</p>
            </div>
          )}

          {/* Action button grouping */}
          <div className="control-button-group">
            {/* Match duel */}
            {selected.status === 0 && (
              <button
                className="btn-control-action-primary"
                disabled={loading}
                onClick={() => executeWrite("match_duel", [BigInt(selected.id)], BigInt(selected.stake_challenger))}
              >
                Match Duel & Stake {formatGEN(selected.stake_challenger)} GEN
              </button>
            )}

            {/* Cancel open duel */}
            {selected.status === 0 && wallet.address && wallet.address.toLowerCase() === selected.challenger.toLowerCase() && (
              <button
                className="btn-control-action-danger"
                disabled={loading}
                onClick={() => executeWrite("cancel_duel", [BigInt(selected.id)])}
              >
                Withdraw Challenge & Refund
              </button>
            )}

            {/* Solution upload panel */}
            {selected.status === 1 && (
              <div className="submission-composer">
                <textarea
                  className="submission-composer-textarea"
                  placeholder="Draft your solution code or content details..."
                  rows={8}
                  value={solutionInput}
                  onChange={e => setSolutionInput(e.target.value)}
                />
                <button
                  className="btn-control-action-primary"
                  disabled={loading || !solutionInput.trim()}
                  onClick={() => {
                    executeWrite("submit_solution", [BigInt(selected.id), solutionInput]);
                    setSolutionInput("");
                  }}
                >
                  Submit Solution Draft
                </button>
              </div>
            )}

            {/* Referee Evaluate consensus */}
            {selected.status === 2 && (
              <button
                className="btn-control-action-evaluate"
                disabled={loading}
                onClick={() => executeWrite("evaluate_duel", [BigInt(selected.id)])}
              >
                Trigger Adjudication Consensus
              </button>
            )}

            {/* Timeout refund button */}
            {selected.status === 1 && (
              <div className="timeout-control-box">
                {getTimeoutTimeLeft(selected) > 0 ? (
                  <div className="timeout-timer-lbl">
                    Inactivity Refund available in: {formatDuration(getTimeoutTimeLeft(selected))}
                  </div>
                ) : (
                  <button
                    className="btn-control-action-warning"
                    disabled={loading}
                    onClick={() => executeWrite("claim_timeout_refund", [BigInt(selected.id)])}
                  >
                    Claim Inactivity Timeout Refund
                  </button>
                )}
              </div>
            )}
          </div>
        </main>
      )}

      {/* Duel declaration Modal */}
      {showCreate && (
        <div className="modal-backdrop-div" onClick={() => setShowCreate(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <div className="modal-card-header">
              <h3>Declare Skill Duel</h3>
              <button className="modal-btn-close" onClick={() => setShowCreate(false)}>✕</button>
            </div>
            
            <form
              onSubmit={e => {
                e.preventDefault();
                executeWrite(
                  "open_duel",
                  [form.category, form.prompt],
                  BigInt(form.stake || "0") * BigInt(10 ** 18)
                );
              }}
            >
              <div className="modal-input-field">
                <label>Target Category</label>
                <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                  {CATEGORIES.map(cat => (
                    <option key={cat} value={cat}>{CAT_DETAILS[cat]?.title || cat}</option>
                  ))}
                </select>
              </div>

              <div className="modal-input-field">
                <label>Duel Combat Instructions</label>
                <textarea
                  required
                  placeholder="Specify the challenge terms (e.g., Write a javascript function to bubble-sort an array)"
                  rows={4}
                  value={form.prompt}
                  onChange={e => setForm({ ...form, prompt: e.target.value })}
                />
              </div>

              <div className="modal-input-field">
                <label>Staked Bounty Amount (GEN)</label>
                <input
                  type="number"
                  min="1"
                  required
                  placeholder="10"
                  value={form.stake}
                  onChange={e => setForm({ ...form, stake: e.target.value })}
                />
              </div>

              <button type="submit" className="btn-modal-submit" disabled={loading}>
                {loading ? "Transmitting…" : "Transmit to Arena"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Premium Gladius CSS Styling */}
      <style>{`
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        body {
          background-color: #050508;
          color: #e5e7eb;
          font-family: 'Lora', Georgia, serif;
          min-height: 100vh;
        }

        .arena-wrapper {
          display: flex;
          flex-direction: column;
          min-height: 100vh;
          padding-bottom: 80px;
          background: radial-gradient(circle at 50% 0%, #1c0a0c 0%, #050508 60%);
        }

        /* Header Navigation Styles */
        .header-nav {
          background: rgba(5, 5, 8, 0.8);
          backdrop-filter: blur(16px);
          border-bottom: 1px solid rgba(225, 29, 72, 0.15);
          position: sticky;
          top: 0;
          z-index: 100;
          height: 80px;
        }

        .header-content {
          max-width: 1200px;
          margin: 0 auto;
          padding: 0 24px;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .logo-section {
          display: flex;
          align-items: center;
          gap: 12px;
          cursor: pointer;
        }

        .logo-spark {
          font-size: 24px;
          filter: drop-shadow(0 0 8px #e11d48);
        }

        .logo-text {
          font-family: 'Cinzel', serif;
          font-size: 24px;
          font-weight: 800;
          letter-spacing: 1px;
          color: #f9fafb;
        }

        .logo-subtext {
          font-family: 'Cinzel', serif;
          font-size: 12px;
          font-weight: 600;
          background: rgba(225, 29, 72, 0.1);
          color: #e11d48;
          padding: 3px 8px;
          border-radius: 4px;
          border: 1px solid rgba(225, 29, 72, 0.3);
          text-transform: uppercase;
          letter-spacing: 2px;
          margin-left: 4px;
        }

        /* Connect Button & Dropdown Styles */
        .account-container {
          position: relative;
        }

        .btn-connect-wallet {
          background: linear-gradient(135deg, #be123c, #991b1b);
          color: #ffffff;
          border: 1px solid rgba(225, 29, 72, 0.3);
          padding: 12px 24px;
          border-radius: 6px;
          font-family: 'Cinzel', serif;
          font-weight: 700;
          font-size: 13px;
          letter-spacing: 1.5px;
          cursor: pointer;
          transition: all 0.25s;
        }

        .btn-connect-wallet:hover {
          background: linear-gradient(135deg, #e11d48, #be123c);
          box-shadow: 0 0 15px rgba(225, 29, 72, 0.35);
          transform: translateY(-1px);
        }

        .account-btn {
          background: #11131b;
          border: 1px solid rgba(156, 163, 175, 0.2);
          color: #d1d5db;
          padding: 10px 20px;
          border-radius: 6px;
          font-family: 'Lora', serif;
          font-weight: 600;
          font-size: 13px;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .account-btn:hover {
          border-color: rgba(225, 29, 72, 0.4);
          background: #181b26;
        }

        .active-dot {
          width: 8px;
          height: 8px;
          background: #10b981;
          border-radius: 50%;
          box-shadow: 0 0 8px #10b981;
        }

        .chevron-icon {
          font-size: 10px;
          color: #6b7280;
        }

        .account-dropdown {
          position: absolute;
          top: calc(100% + 10px);
          right: 0;
          background: #0f111a;
          border: 1px solid rgba(225, 29, 72, 0.25);
          border-radius: 8px;
          padding: 20px;
          width: 300px;
          box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6);
          animation: fade-in-slide 0.2s ease-out;
        }

        @keyframes fade-in-slide {
          from { opacity: 0; transform: translateY(-5px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .drop-section-lbl {
          font-family: 'Cinzel', serif;
          font-size: 10px;
          letter-spacing: 1.5px;
          color: #6b7280;
          text-transform: uppercase;
          margin-bottom: 8px;
        }

        .drop-addr-box {
          font-family: monospace;
          font-size: 11px;
          color: #9ca3af;
          background: #05060b;
          padding: 10px;
          border-radius: 4px;
          border: 1px solid rgba(225, 29, 72, 0.1);
          word-break: break-all;
          margin-bottom: 16px;
        }

        .drop-net-info {
          font-size: 12px;
          color: #e11d48;
          font-style: italic;
          margin-bottom: 16px;
        }

        .btn-disconnect {
          width: 100%;
          background: rgba(220, 38, 38, 0.1);
          color: #f87171;
          border: 1px solid rgba(220, 38, 38, 0.3);
          padding: 10px;
          border-radius: 4px;
          font-family: 'Cinzel', serif;
          font-weight: 700;
          font-size: 11px;
          letter-spacing: 1px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .btn-disconnect:hover {
          background: rgba(220, 38, 38, 0.25);
          border-color: #ef4444;
        }

        /* Action Toast Style */
        .action-toast {
          position: fixed;
          top: 95px;
          left: 50%;
          transform: translateX(-50%);
          background: #1c080b;
          border: 1px solid rgba(225, 29, 72, 0.4);
          color: #fbbf24;
          padding: 16px 28px;
          border-radius: 6px;
          z-index: 1000;
          font-size: 14px;
          font-weight: 500;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6);
          text-align: center;
          max-width: 600px;
          animation: slide-in-down 0.25s ease-out;
        }

        @keyframes slide-in-down {
          from { top: 75px; opacity: 0; }
          to { top: 95px; opacity: 1; }
        }

        /* Hero Banner Styles */
        .hero-banner {
          max-width: 1200px;
          margin: 60px auto 40px;
          padding: 0 24px;
          display: grid;
          grid-template-columns: 1.2fr 0.8fr;
          gap: 60px;
          align-items: center;
        }

        .hero-details {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
        }

        .hero-tag {
          font-family: 'Cinzel', serif;
          background: rgba(225, 29, 72, 0.08);
          color: #e11d48;
          border: 1px solid rgba(225, 29, 72, 0.25);
          padding: 6px 16px;
          border-radius: 4px;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 1.5px;
          text-transform: uppercase;
          margin-bottom: 24px;
        }

        .hero-title {
          font-family: 'Cinzel', serif;
          font-size: 48px;
          font-weight: 900;
          line-height: 1.15;
          letter-spacing: 0.5px;
          background: linear-gradient(135deg, #ffffff, #d1d5db);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          margin-bottom: 24px;
        }

        .hero-subtitle {
          color: #9ca3af;
          font-size: 16px;
          line-height: 1.7;
          margin-bottom: 36px;
        }

        .hero-buttons {
          display: flex;
        }

        .btn-action-primary {
          background: linear-gradient(135deg, #be123c, #991b1b);
          color: white;
          border: 1px solid rgba(225, 29, 72, 0.3);
          padding: 16px 36px;
          border-radius: 6px;
          font-family: 'Cinzel', serif;
          font-weight: 700;
          font-size: 14px;
          letter-spacing: 1.5px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .btn-action-primary:hover {
          background: linear-gradient(135deg, #e11d48, #be123c);
          box-shadow: 0 0 20px rgba(225, 29, 72, 0.4);
          transform: translateY(-1px);
        }

        /* Stats Box Styles */
        .stats-box {
          background: #0d0f17;
          border: 1px solid rgba(225, 29, 72, 0.15);
          border-radius: 12px;
          padding: 32px;
          box-shadow: 0 15px 35px rgba(0, 0, 0, 0.5);
        }

        .stats-grid {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 20px;
          text-align: center;
          margin-bottom: 28px;
        }

        .stats-card {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .stats-num {
          font-family: 'Cinzel', serif;
          font-size: 38px;
          font-weight: 900;
          color: #f3f4f6;
          text-shadow: 0 0 12px rgba(225, 29, 72, 0.2);
        }

        .stats-lbl {
          font-family: 'Cinzel', serif;
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 1.5px;
          text-transform: uppercase;
          color: #6b7280;
        }

        .stats-footer {
          border-top: 1px solid rgba(156, 163, 175, 0.1);
          padding-top: 18px;
          font-family: 'Cinzel', serif;
          font-size: 11px;
          letter-spacing: 2px;
          color: #4b5563;
          text-align: center;
          text-transform: uppercase;
        }

        /* Grid Section Styles */
        .grid-section {
          max-width: 1200px;
          margin: 0 auto;
          padding: 0 24px 80px;
          width: 100%;
        }

        .grid-filter-bar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 36px;
          border-bottom: 1px solid rgba(225, 29, 72, 0.15);
          padding-bottom: 16px;
        }

        .grid-title {
          font-family: 'Cinzel', serif;
          font-size: 22px;
          font-weight: 700;
          letter-spacing: 1px;
          color: #f3f4f6;
        }

        .grid-filters {
          display: flex;
          gap: 10px;
        }

        .filter-option {
          background: #0a0c12;
          border: 1px solid rgba(156, 163, 175, 0.15);
          color: #9ca3af;
          padding: 10px 20px;
          border-radius: 6px;
          font-family: 'Cinzel', serif;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 1px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .filter-option:hover {
          border-color: rgba(225, 29, 72, 0.35);
          color: #e5e7eb;
        }

        .filter-option.active {
          background: #be123c;
          border-color: #be123c;
          color: white;
          box-shadow: 0 0 10px rgba(190, 18, 60, 0.3);
        }

        .arena-empty-state {
          text-align: center;
          padding: 80px 20px;
          background: #0d0f17;
          border: 1px dashed rgba(225, 29, 72, 0.2);
          border-radius: 12px;
          color: #6b7280;
        }

        .empty-spark {
          font-size: 44px;
          margin-bottom: 20px;
          filter: grayscale(0.5);
        }

        /* Duels Grid Styles */
        .duels-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
          gap: 24px;
        }

        .duel-card {
          background: #0d0f17;
          border: 1px solid rgba(156, 163, 175, 0.1);
          border-radius: 12px;
          padding: 28px;
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          min-height: 270px;
          position: relative;
        }

        .duel-card:hover {
          border-color: rgba(225, 29, 72, 0.4);
          transform: translateY(-3px);
          box-shadow: 0 15px 35px rgba(0, 0, 0, 0.4), 0 0 15px rgba(225, 29, 72, 0.15);
        }

        .duel-card.canceled {
          opacity: 0.55;
        }

        .card-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
        }

        .card-cat-badge {
          font-family: 'Cinzel', serif;
          font-size: 10px;
          font-weight: 700;
          padding: 5px 10px;
          border-radius: 4px;
          display: flex;
          align-items: center;
          gap: 6px;
          text-transform: uppercase;
          letter-spacing: 1px;
        }

        .cat-icon-span {
          font-size: 12px;
        }

        .card-status-badge {
          font-family: 'Cinzel', serif;
          font-size: 10px;
          font-weight: 700;
          padding: 5px 10px;
          border-radius: 4px;
          text-transform: uppercase;
          letter-spacing: 1.5px;
        }

        .card-vs-stack {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 20px;
          margin: 16px 0;
        }

        .avatar-shield {
          width: 48px;
          height: 48px;
          border-radius: 8px;
          display: grid;
          place-items: center;
          font-family: 'Cinzel', serif;
          font-weight: 900;
          font-size: 18px;
          color: white;
          box-shadow: inset 0 0 10px rgba(0,0,0,0.5), 0 4px 10px rgba(0,0,0,0.3);
        }

        .avatar-shield.idle {
          background: #05060b;
          color: #4b5563;
          border: 1px dashed rgba(156, 163, 175, 0.2);
        }

        .vs-spark {
          font-family: 'Cinzel', serif;
          font-size: 13px;
          font-weight: 900;
          font-style: italic;
          color: #e11d48;
          text-transform: uppercase;
          letter-spacing: 1px;
        }

        .card-prompt-desc {
          font-size: 14px;
          line-height: 1.6;
          color: #9ca3af;
          text-align: center;
          margin-bottom: 24px;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .card-pot-display {
          border-top: 1px solid rgba(156, 163, 175, 0.1);
          padding-top: 16px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .pot-title-lbl {
          font-family: 'Cinzel', serif;
          font-size: 10px;
          text-transform: uppercase;
          color: #6b7280;
          font-weight: 700;
          letter-spacing: 1px;
        }

        .pot-val-lbl {
          font-family: 'Cinzel', serif;
          font-size: 16px;
          font-weight: 800;
          color: #fbbf24;
        }

        /* Match Matchup Panel Styles */
        .duel-detail-panel {
          max-width: 800px;
          margin: 40px auto 80px;
          padding: 0 24px;
          width: 100%;
        }

        .btn-nav-back {
          background: none;
          border: none;
          color: #e11d48;
          font-family: 'Cinzel', serif;
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 1.5px;
          cursor: pointer;
          margin-bottom: 24px;
          transition: all 0.2s;
        }

        .btn-nav-back:hover {
          color: #fb7185;
          text-decoration: underline;
        }

        .detail-panel-card {
          background: #0d0f17;
          border: 1px solid rgba(225, 29, 72, 0.15);
          border-radius: 12px;
          padding: 36px;
          margin-bottom: 32px;
          box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6);
        }

        .panel-header-row {
          display: flex;
          justify-content: space-between;
          margin-bottom: 32px;
        }

        .panel-cat-badge {
          font-family: 'Cinzel', serif;
          font-size: 11px;
          font-weight: 700;
          padding: 6px 12px;
          border-radius: 4px;
          text-transform: uppercase;
          letter-spacing: 1.5px;
        }

        .panel-status-badge {
          font-family: 'Cinzel', serif;
          font-size: 11px;
          font-weight: 700;
          padding: 6px 12px;
          border-radius: 4px;
          text-transform: uppercase;
          letter-spacing: 1.5px;
        }

        .battle-vs-grid {
          display: grid;
          grid-template-columns: 1fr auto 1fr;
          align-items: center;
          gap: 20px;
          margin-bottom: 40px;
        }

        .gladiator-card {
          background: #05060b;
          border: 1px solid rgba(156, 163, 175, 0.1);
          border-radius: 8px;
          padding: 24px;
          text-align: center;
          position: relative;
          transition: all 0.25s;
        }

        .gladiator-card.victory {
          border-color: rgba(16, 185, 129, 0.4);
          background: rgba(16, 185, 129, 0.03);
          box-shadow: 0 0 20px rgba(16, 185, 129, 0.15);
        }

        .gladiator-card.recruiting {
          opacity: 0.6;
        }

        .gladiator-avatar {
          width: 80px;
          height: 80px;
          border-radius: 12px;
          display: grid;
          place-items: center;
          margin: 0 auto 16px;
          font-family: 'Cinzel', serif;
          font-weight: 900;
          font-size: 26px;
          position: relative;
          color: white;
          box-shadow: inset 0 0 15px rgba(0,0,0,0.6), 0 5px 15px rgba(0,0,0,0.4);
        }

        .victory-crown {
          position: absolute;
          top: -18px;
          font-size: 22px;
          filter: drop-shadow(0 0 5px #fbbf24);
        }

        .gladiator-title {
          font-family: 'Cinzel', serif;
          font-size: 14px;
          font-weight: 700;
          letter-spacing: 1px;
          color: #f3f4f6;
        }

        .gladiator-address {
          font-family: monospace;
          font-size: 11px;
          color: #6b7280;
          margin-top: 6px;
        }

        .gladiator-stake {
          margin-top: 12px;
          font-family: 'Cinzel', serif;
          font-size: 13px;
          font-weight: 800;
          color: #fbbf24;
        }

        .battle-vs-giant {
          font-family: 'Cinzel', serif;
          font-size: 40px;
          font-weight: 900;
          font-style: italic;
          color: #e11d48;
          text-shadow: 0 0 10px rgba(225, 29, 72, 0.4);
        }

        .battle-prompt-box {
          background: #05060b;
          border: 1px solid rgba(225, 29, 72, 0.15);
          border-radius: 8px;
          padding: 24px;
          text-align: center;
        }

        .prompt-label-txt {
          font-family: 'Cinzel', serif;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 2px;
          color: #6b7280;
          font-weight: 700;
          margin-bottom: 12px;
        }

        .prompt-content-txt {
          font-size: 15px;
          line-height: 1.7;
          color: #d1d5db;
          margin-bottom: 20px;
        }

        .pot-pool-banner {
          display: inline-block;
          background: rgba(251, 191, 36, 0.08);
          color: #fbbf24;
          border: 1px solid rgba(251, 191, 36, 0.25);
          padding: 8px 18px;
          border-radius: 4px;
          font-family: 'Cinzel', serif;
          font-size: 13px;
          font-weight: 800;
          letter-spacing: 1px;
        }

        /* Submissions Display Grid */
        .submissions-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 20px;
          margin-bottom: 32px;
        }

        .sub-card-col {
          background: #0d0f17;
          border: 1px solid rgba(156, 163, 175, 0.1);
          border-radius: 12px;
          overflow: hidden;
        }

        .sub-header {
          padding: 14px 20px;
          font-family: 'Cinzel', serif;
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 1.5px;
        }

        .sub-header.challenger {
          color: #fb7185;
          background: rgba(244, 63, 94, 0.08);
          border-bottom: 1px solid rgba(244, 63, 94, 0.15);
        }

        .sub-header.opponent {
          color: #f472b6;
          background: rgba(236, 72, 153, 0.08);
          border-bottom: 1px solid rgba(236, 72, 153, 0.15);
        }

        .sub-body {
          padding: 24px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          line-height: 1.7;
          color: #d1d5db;
          white-space: pre-wrap;
          max-height: 280px;
          overflow-y: auto;
          background: #05060b;
        }

        /* Referee Judgment Styles */
        .referee-judgment-card {
          background: rgba(16, 185, 129, 0.04);
          border: 1px solid rgba(16, 185, 129, 0.25);
          border-radius: 12px;
          padding: 32px;
          margin-bottom: 32px;
        }

        .referee-title-row {
          font-family: 'Cinzel', serif;
          font-size: 14px;
          font-weight: 700;
          color: #10b981;
          text-transform: uppercase;
          margin-bottom: 24px;
          text-align: center;
          letter-spacing: 2px;
        }

        .referee-score-meters {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 40px;
          margin-bottom: 24px;
        }

        .referee-score-row {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .meter-label {
          font-family: 'Cinzel', serif;
          font-size: 13px;
          font-weight: 700;
          color: #d1d5db;
          letter-spacing: 0.5px;
        }

        .meter-bar-bg {
          height: 10px;
          background: #05060b;
          border-radius: 5px;
          overflow: hidden;
          width: 100%;
          border: 1px solid rgba(156, 163, 175, 0.05);
        }

        .meter-bar-fill {
          height: 100%;
          border-radius: 5px;
        }

        .meter-bar-fill.challenger {
          background: linear-gradient(90deg, #be123c, #fb7185);
        }

        .meter-bar-fill.opponent {
          background: linear-gradient(90deg, #ec4899, #f472b6);
        }

        .judgment-reasoning {
          color: #9ca3af;
          font-size: 15px;
          line-height: 1.7;
          border-top: 1px solid rgba(16, 185, 129, 0.15);
          padding-top: 20px;
        }

        /* Cancellation card styles */
        .cancellation-reason-card {
          background: rgba(107, 114, 128, 0.08);
          border: 1px solid rgba(156, 163, 175, 0.2);
          border-radius: 12px;
          padding: 24px;
          margin-bottom: 32px;
          text-align: center;
        }

        .cancellation-title {
          font-family: 'Cinzel', serif;
          font-size: 13px;
          font-weight: 700;
          color: #9ca3af;
          text-transform: uppercase;
          margin-bottom: 12px;
          letter-spacing: 1.5px;
        }

        .cancellation-desc {
          color: #9ca3af;
          font-size: 14px;
          line-height: 1.6;
        }

        /* Match Panel User Actions Control Styles */
        .control-button-group {
          max-width: 520px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .btn-control-action-primary {
          background: linear-gradient(135deg, #be123c, #991b1b);
          color: white;
          border: 1px solid rgba(225, 29, 72, 0.3);
          padding: 16px 28px;
          border-radius: 6px;
          font-family: 'Cinzel', serif;
          font-weight: 700;
          font-size: 13px;
          letter-spacing: 1.5px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .btn-control-action-primary:hover {
          background: linear-gradient(135deg, #e11d48, #be123c);
          box-shadow: 0 0 15px rgba(225, 29, 72, 0.35);
          transform: translateY(-1px);
        }

        .btn-control-action-primary:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          transform: none;
          box-shadow: none;
        }

        .btn-control-action-danger {
          background: transparent;
          color: #f87171;
          border: 1px solid rgba(239, 68, 68, 0.3);
          padding: 16px 28px;
          border-radius: 6px;
          font-family: 'Cinzel', serif;
          font-weight: 700;
          font-size: 13px;
          letter-spacing: 1.5px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .btn-control-action-danger:hover {
          background: rgba(239, 68, 68, 0.1);
          border-color: #ef4444;
        }

        .btn-control-action-evaluate {
          background: linear-gradient(135deg, #2563eb, #1d4ed8);
          color: white;
          border: 1px solid rgba(37, 99, 235, 0.3);
          padding: 16px 28px;
          border-radius: 6px;
          font-family: 'Cinzel', serif;
          font-weight: 700;
          font-size: 13px;
          letter-spacing: 1.5px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .btn-control-action-evaluate:hover {
          background: linear-gradient(135deg, #3b82f6, #2563eb);
          box-shadow: 0 0 15px rgba(37, 99, 235, 0.35);
          transform: translateY(-1px);
        }

        .submission-composer {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        .submission-composer-textarea {
          background: #05060b;
          border: 1px solid rgba(156, 163, 175, 0.15);
          border-radius: 6px;
          padding: 16px;
          color: #e5e7eb;
          font-family: 'JetBrains Mono', monospace;
          font-size: 13px;
          line-height: 1.6;
          resize: vertical;
          width: 100%;
        }

        .submission-composer-textarea:focus {
          border-color: rgba(225, 29, 72, 0.4);
          outline: none;
        }

        .timeout-control-box {
          display: flex;
          flex-direction: column;
          align-items: center;
          margin-top: 10px;
        }

        .timeout-timer-lbl {
          font-family: 'Cinzel', serif;
          font-size: 11px;
          color: #9ca3af;
          letter-spacing: 1px;
          font-style: italic;
          background: rgba(156, 163, 175, 0.05);
          padding: 6px 14px;
          border-radius: 20px;
          border: 1px solid rgba(156, 163, 175, 0.1);
        }

        .btn-control-action-warning {
          background: linear-gradient(135deg, #d97706, #b45309);
          color: white;
          border: 1px solid rgba(217, 119, 6, 0.3);
          padding: 14px 28px;
          border-radius: 6px;
          font-family: 'Cinzel', serif;
          font-weight: 700;
          font-size: 12px;
          letter-spacing: 1.5px;
          cursor: pointer;
          transition: all 0.2s;
          width: 100%;
        }

        .btn-control-action-warning:hover {
          background: linear-gradient(135deg, #f59e0b, #d97706);
          box-shadow: 0 0 15px rgba(217, 119, 6, 0.4);
        }

        /* Duel Declaration Modal Styles */
        .modal-backdrop-div {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(5, 5, 8, 0.85);
          backdrop-filter: blur(8px);
          display: grid;
          place-items: center;
          z-index: 1000;
        }

        .modal-card {
          background: #0d0f17;
          border: 1px solid rgba(225, 29, 72, 0.3);
          border-radius: 12px;
          width: 100%;
          max-width: 520px;
          padding: 36px;
          box-shadow: 0 25px 60px rgba(0, 0, 0, 0.8);
          animation: scale-up 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        }

        @keyframes scale-up {
          from { opacity: 0; transform: scale(0.96); }
          to { opacity: 1; transform: scale(1); }
        }

        .modal-card-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 28px;
        }

        .modal-card-header h3 {
          font-family: 'Cinzel', serif;
          font-size: 20px;
          font-weight: 800;
          letter-spacing: 1.5px;
          color: #f3f4f6;
        }

        .modal-btn-close {
          background: none;
          border: none;
          color: #9ca3af;
          font-size: 18px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .modal-btn-close:hover {
          color: #e11d48;
        }

        .modal-input-field {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-bottom: 24px;
        }

        .modal-input-field label {
          font-family: 'Cinzel', serif;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 1.5px;
          text-transform: uppercase;
          color: #9ca3af;
        }

        .modal-input-field select,
        .modal-input-field input,
        .modal-input-field textarea {
          background: #05060b;
          border: 1px solid rgba(156, 163, 175, 0.15);
          border-radius: 6px;
          padding: 12px 16px;
          color: #e5e7eb;
          font-family: 'Lora', serif;
          font-size: 14px;
        }

        .modal-input-field select:focus,
        .modal-input-field input:focus,
        .modal-input-field textarea:focus {
          border-color: rgba(225, 29, 72, 0.4);
          outline: none;
        }

        .modal-input-field textarea {
          resize: vertical;
        }

        .btn-modal-submit {
          width: 100%;
          background: linear-gradient(135deg, #be123c, #991b1b);
          color: white;
          border: 1px solid rgba(225, 29, 72, 0.3);
          padding: 14px 28px;
          border-radius: 6px;
          font-family: 'Cinzel', serif;
          font-weight: 700;
          font-size: 13px;
          letter-spacing: 1.5px;
          cursor: pointer;
          transition: all 0.2s;
          margin-top: 10px;
        }

        .btn-modal-submit:hover {
          background: linear-gradient(135deg, #e11d48, #be123c);
          box-shadow: 0 0 15px rgba(225, 29, 72, 0.35);
        }
      `}</style>
    </div>
  );
}
