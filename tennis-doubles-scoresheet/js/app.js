/**
 * Tennis Doubles Scoresheet - Main Application
 * 
 * Contains:
 * - TennisScoringEngine: Pure scoring state machine (no DOM dependencies)
 * - TennisScoreSheet: Main app controller (DOM interactions)
 */

// ============================================================================
// TennisScoringEngine - Pure Tennis Scoring State Machine
// ============================================================================

class TennisScoringEngine {
    /**
     * @param {number} matchFormat - 2 or 3 (best of N sets)
     */
    constructor(matchFormat) {
        this.matchFormat = matchFormat || 3;
        this.currentSetIndex = 0;
        this.sets = [{
            gamesA: 0,
            gamesB: 0,
            pointsA: 0,
            pointsB: 0,
            isDeuce: false,
            advantageTeam: null,
            isTiebreak: false,
            tiebreakPointsA: 0,
            tiebreakPointsB: 0
        }];
        this.setsWon = { A: 0, B: 0 };
        this.isFinished = false;
        this.winner = null;

        // Service rotation: 0=A1, 1=B1, 2=A2, 3=B2
        this.serviceOrder = [0, 1, 2, 3];
        this.serviceIndex = 0;

        // Tiebreak service tracking
        this.tiebreakPointCount = 0;
        this.tiebreakFirstServerIndex = 0;
    }

    /**
     * Main scoring method. Handles both normal and tiebreak scoring.
     * @param {string} team - 'A' or 'B'
     * @returns {object} Transition info describing what happened
     */
    scorePoint(team) {
        if (this.isFinished) {
            return { transition: 'MATCH_OVER' };
        }

        const currentSet = this.sets[this.currentSetIndex];

        // Delegate to tiebreak scoring if in tiebreak mode
        if (currentSet.isTiebreak) {
            return this._scoreTiebreakPoint(team);
        }

        const opponent = team === 'A' ? 'B' : 'A';
        const teamPoints = currentSet[`points${team}`];
        const opponentPoints = currentSet[`points${opponent}`];

        // Case 1: Team has fewer than 3 points (below 40) - just increment
        if (teamPoints < 3) {
            currentSet[`points${team}`]++;

            // Check if both just reached 40 (3 points each) - first deuce
            if (currentSet[`points${team}`] === 3 && opponentPoints === 3) {
                currentSet.isDeuce = true;
                return { transition: 'DEUCE' };
            }

            return { transition: 'POINT' };
        }

        // Case 2: Team is at 40 (3 points) and opponent has fewer than 3 - game won
        if (teamPoints === 3 && opponentPoints < 3) {
            return this._winGame(team);
        }

        // Case 3: Both at 40+ (deuce/advantage territory)
        if (currentSet.isDeuce) {
            if (currentSet.advantageTeam === null) {
                // At deuce, team scores → gets advantage
                currentSet.advantageTeam = team;
                return { transition: 'ADVANTAGE', team };
            } else if (currentSet.advantageTeam === team) {
                // Team with advantage scores → wins game
                return this._winGame(team);
            } else {
                // Team without advantage scores → back to deuce
                currentSet.advantageTeam = null;
                return { transition: 'DEUCE' };
            }
        }

        // Case 4: Both just reached 40 for the first time
        if (teamPoints >= 3 && opponentPoints >= 3) {
            currentSet.isDeuce = true;
            currentSet.advantageTeam = team;
            return { transition: 'ADVANTAGE', team };
        }

        // Fallback: should not reach here in normal play
        return { transition: 'POINT' };
    }

    /**
     * Internal: Handle game win - increment games, reset points, check set win.
     */
    _winGame(team) {
        const currentSet = this.sets[this.currentSetIndex];
        const opponent = team === 'A' ? 'B' : 'A';

        currentSet[`games${team}`]++;
        currentSet.pointsA = 0;
        currentSet.pointsB = 0;
        currentSet.isDeuce = false;
        currentSet.advantageTeam = null;

        this.serviceIndex = (this.serviceIndex + 1) % 4;

        const gamesTeam = currentSet[`games${team}`];
        const gamesOpponent = currentSet[`games${opponent}`];

        if (gamesTeam >= 6 && gamesTeam - gamesOpponent >= 2) {
            return this._winSet(team);
        }

        if (gamesTeam === 6 && gamesOpponent === 6) {
            return this._startTiebreak();
        }

        return { transition: 'GAME_WON', team };
    }

    /**
     * Internal: Handle set win.
     */
    _winSet(team) {
        this.setsWon[team]++;
        const setsToWin = Math.ceil(this.matchFormat / 2);

        if (this.setsWon[team] >= setsToWin) {
            this.isFinished = true;
            this.winner = team;
            return { transition: 'MATCH_WON', winner: team };
        }

        this.currentSetIndex++;
        this.sets.push({
            gamesA: 0, gamesB: 0, pointsA: 0, pointsB: 0,
            isDeuce: false, advantageTeam: null, isTiebreak: false,
            tiebreakPointsA: 0, tiebreakPointsB: 0
        });

        return { transition: 'SET_WON', team };
    }

    /**
     * Internal: Start tiebreak mode.
     */
    _startTiebreak() {
        const currentSet = this.sets[this.currentSetIndex];
        currentSet.isTiebreak = true;
        currentSet.tiebreakPointsA = 0;
        currentSet.tiebreakPointsB = 0;
        this.tiebreakPointCount = 0;
        this.tiebreakFirstServerIndex = this.serviceIndex;
        return { transition: 'TIEBREAK_START' };
    }

    /**
     * Internal: Score a point during tiebreak.
     */
    _scoreTiebreakPoint(team) {
        const currentSet = this.sets[this.currentSetIndex];
        const opponent = team === 'A' ? 'B' : 'A';

        currentSet[`tiebreakPoints${team}`]++;
        this.tiebreakPointCount++;

        if (this.tiebreakPointCount === 1 || (this.tiebreakPointCount - 1) % 2 === 0) {
            this.serviceIndex = (this.serviceIndex + 1) % 4;
        }

        const pointsTeam = currentSet[`tiebreakPoints${team}`];
        const pointsOpponent = currentSet[`tiebreakPoints${opponent}`];

        if (pointsTeam >= 7 && pointsTeam - pointsOpponent >= 2) {
            currentSet[`games${team}`] = 7;
            return this._winSet(team);
        }

        return { transition: 'TIEBREAK_POINT' };
    }

    /**
     * Returns the current point score for display purposes.
     */
    getCurrentPointScore() {
        const currentSet = this.sets[this.currentSetIndex];
        const pointMap = ['0', '15', '30', '40'];

        if (currentSet.isTiebreak) {
            return { teamA: currentSet.tiebreakPointsA, teamB: currentSet.tiebreakPointsB, isTiebreak: true };
        }
        if (currentSet.isDeuce && currentSet.advantageTeam === null) {
            return { teamA: 'Deuce', teamB: 'Deuce', isDeuce: true };
        }
        if (currentSet.isDeuce && currentSet.advantageTeam !== null) {
            return {
                teamA: currentSet.advantageTeam === 'A' ? 'Ad' : '40',
                teamB: currentSet.advantageTeam === 'B' ? 'Ad' : '40',
                advantageTeam: currentSet.advantageTeam
            };
        }
        return { teamA: pointMap[currentSet.pointsA] || '0', teamB: pointMap[currentSet.pointsB] || '0' };
    }

    /**
     * Returns a deep clone of the entire engine state for undo/persistence.
     */
    getState() {
        return JSON.parse(JSON.stringify({
            matchFormat: this.matchFormat,
            currentSetIndex: this.currentSetIndex,
            sets: this.sets,
            setsWon: this.setsWon,
            isFinished: this.isFinished,
            winner: this.winner,
            serviceOrder: this.serviceOrder,
            serviceIndex: this.serviceIndex,
            tiebreakPointCount: this.tiebreakPointCount,
            tiebreakFirstServerIndex: this.tiebreakFirstServerIndex
        }));
    }

    /**
     * Restores all engine state from a snapshot.
     */
    restoreState(snapshot) {
        this.matchFormat = snapshot.matchFormat;
        this.currentSetIndex = snapshot.currentSetIndex;
        this.sets = JSON.parse(JSON.stringify(snapshot.sets));
        this.setsWon = { A: snapshot.setsWon.A, B: snapshot.setsWon.B };
        this.isFinished = snapshot.isFinished;
        this.winner = snapshot.winner;
        this.serviceOrder = [...snapshot.serviceOrder];
        this.serviceIndex = snapshot.serviceIndex;
        this.tiebreakPointCount = snapshot.tiebreakPointCount;
        this.tiebreakFirstServerIndex = snapshot.tiebreakFirstServerIndex;
    }

    /**
     * Returns info about the current server.
     */
    getServer() {
        const serverMapping = this.serviceOrder[this.serviceIndex];
        const team = serverMapping === 0 || serverMapping === 2 ? 'A' : 'B';
        const playerIndex = serverMapping === 0 || serverMapping === 1 ? 0 : 1;
        return { orderIndex: this.serviceIndex, team, playerIndex };
    }

    getCurrentSet() { return this.sets[this.currentSetIndex]; }
    setServiceOrder(order) { this.serviceOrder = [...order]; }
    isDeuce() { const s = this.sets[this.currentSetIndex]; return s.isDeuce && s.advantageTeam === null; }
    isTiebreak() { return this.sets[this.currentSetIndex].isTiebreak; }
    isAdvantage() {
        const s = this.sets[this.currentSetIndex];
        return (s.isDeuce && s.advantageTeam !== null) ? { team: s.advantageTeam } : null;
    }
}


// ============================================================================
// TennisScoreSheet - Main App Controller
// ============================================================================

class TennisScoreSheet {
    constructor() {
        this.engine = null;
        this.match = null;
        this.history = [];
        this.audioCtx = null;
        this.recognition = null;
        this.isListening = false;
        this.scoreVoiceEnabled = true;
        this.voiceOverEnabled = true;

        // Service tracking per team (alternates 0↔1 each time service returns)
        this.teamAServerIndex = 0;
        this.teamBServerIndex = 0;

        // Initialize managers
        this.eventManager = new EventManager(this);
        this.eventManager.init();
        this.memberManager = new MemberManager(this);
        this.memberManager.init();
        this.sync = new FirebaseSync(this);

        // Init features
        this.initTheme();
        this.initVoice();
        this.initEventListeners();
        this.initSounds();

        // Restore state
        this.restoreActiveMatch();
        this.renderEventSelectors();
        this.populateMemberPickers();
    }

    // ─── Theme (Task 13.1) ──────────────────────────────────────────────────

    initTheme() {
        const saved = localStorage.getItem('tennis-theme') || 'dark';
        document.documentElement.setAttribute('data-theme', saved);
        this.updateThemeIcon(saved);
    }

    toggleTheme() {
        const current = document.documentElement.getAttribute('data-theme');
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('tennis-theme', next);
        this.updateThemeIcon(next);
    }

    updateThemeIcon(theme) {
        const btn = document.getElementById('btn-theme-toggle');
        if (btn) btn.textContent = theme === 'dark' ? '🌙' : '☀️';
    }

    // ─── QR Code Sharing ────────────────────────────────────────────────────

    showQRCode() {
        const modal = document.getElementById('qr-modal');
        const container = document.getElementById('qr-code-container');
        if (!modal || !container) return;

        const appUrl = window.location.href || 'https://unionclub071.github.io/tennis-doubles-scoresheet/';

        // Generate QR code using qrcode-generator library
        if (typeof qrcode !== 'undefined') {
            container.innerHTML = '';
            const qr = qrcode(0, 'M');
            qr.addData(appUrl);
            qr.make();
            container.innerHTML = qr.createImgTag(5, 8);
        } else {
            // Fallback: show URL as text
            container.innerHTML = `<p style="font-size:0.8rem; color:var(--text-secondary);">QR library not loaded. Share this URL:<br><strong>${appUrl}</strong></p>`;
        }

        modal.classList.remove('hidden');
    }

    hideQRCode() {
        const modal = document.getElementById('qr-modal');
        if (modal) modal.classList.add('hidden');
    }

    // ─── QR Code ────────────────────────────────────────────────────────────

    showQrCode() {
        const modal = document.getElementById('qr-modal');
        const container = document.getElementById('qr-code-container');
        if (!modal || !container) return;

        const appUrl = 'https://unionclub071.github.io/tennis-doubles-scoresheet/';
        
        // Generate QR code using a free API (no library needed)
        container.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(appUrl)}" alt="QR Code" width="200" height="200">`;
        
        modal.classList.remove('hidden');
    }

    // ─── Sound Effects (Task 9.1) ───────────────────────────────────────────

    initSounds() {
        this.audioCtx = null;
    }

    getAudioCtx() {
        if (!this.audioCtx) {
            try { this.audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
            catch (e) { console.warn('Web Audio API not supported'); }
        }
        return this.audioCtx;
    }

    playScoreSound() {
        const ctx = this.getAudioCtx();
        if (!ctx) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.value = 800;
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.15);
    }

    playErrorSound() {
        const ctx = this.getAudioCtx();
        if (!ctx) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'square';
        osc.frequency.value = 300;
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.25);
    }

    playWinSound() {
        const ctx = this.getAudioCtx();
        if (!ctx) return;
        const notes = [523, 659, 784, 1047];
        notes.forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'sine';
            osc.frequency.value = freq;
            const start = ctx.currentTime + i * 0.15;
            gain.gain.setValueAtTime(0.3, start);
            gain.gain.exponentialRampToValueAtTime(0.01, start + 0.3);
            osc.start(start);
            osc.stop(start + 0.3);
        });
    }

    // ─── Voice Commands (Task 9.2) ──────────────────────────────────────────

    initVoice() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            const btn = document.getElementById('btn-voice-command');
            if (btn) btn.textContent = '🎤 Not Supported';
            return;
        }
        this.recognition = new SpeechRecognition();
        this.recognition.continuous = true;
        this.recognition.interimResults = false;
        this.recognition.lang = 'en-US';

        this.recognition.onresult = (event) => {
            const last = event.results[event.results.length - 1];
            if (last.isFinal) {
                const transcript = last[0].transcript.trim().toLowerCase();
                this.processVoiceCommand(transcript);
            }
        };
        this.recognition.onend = () => {
            if (this.isListening) {
                try { this.recognition.start(); } catch (e) {}
            }
        };
        this.recognition.onerror = (e) => {
            if (e.error !== 'no-speech') {
                this.setVoiceStatus('Error: ' + e.error, 'error');
            }
        };
    }

    toggleVoice() {
        if (!this.recognition) return;
        if (this.isListening) {
            this.isListening = false;
            this.recognition.stop();
            const btn = document.getElementById('btn-voice-command');
            if (btn) btn.textContent = '🎤 Voice Command';
            document.getElementById('voice-help')?.classList.add('hidden');
            this.setVoiceStatus('', '');
        } else {
            this.isListening = true;
            try { this.recognition.start(); } catch (e) {}
            const btn = document.getElementById('btn-voice-command');
            if (btn) btn.textContent = '🎤 Stop Listening';
            document.getElementById('voice-help')?.classList.remove('hidden');
            this.setVoiceStatus('Listening...', 'listening');
        }
    }

    processVoiceCommand(transcript) {
        if (!this.match || !this.engine) return;
        this.setVoiceStatus(`"${transcript}"`, 'recognized');

        // Point commands
        if (/point\s*(a|team\s*a)/i.test(transcript)) { this.addPoint('A'); return; }
        if (/point\s*(b|team\s*b)/i.test(transcript)) { this.addPoint('B'); return; }
        if (/score\s*(a|team\s*a)/i.test(transcript)) { this.addPoint('A'); return; }
        if (/score\s*(b|team\s*b)/i.test(transcript)) { this.addPoint('B'); return; }

        // Error commands: "[player] [error type]"
        const errorTypes = {
            'double fault': 'double-fault',
            'unforced error': 'unforced-error',
            'forced error': 'forced-error',
            'foot fault': 'foot-fault',
            'net fault': 'net-fault',
            'out': 'out',
            'let': 'let'
        };

        const playerShortcodes = {
            'a1': { team: 'A', playerIndex: 0 },
            'a2': { team: 'A', playerIndex: 1 },
            'b1': { team: 'B', playerIndex: 0 },
            'b2': { team: 'B', playerIndex: 1 }
        };

        for (const [errName, errKey] of Object.entries(errorTypes)) {
            if (transcript.includes(errName)) {
                // Try shortcodes first
                for (const [code, info] of Object.entries(playerShortcodes)) {
                    if (transcript.includes(code)) {
                        const label = errName.charAt(0).toUpperCase() + errName.slice(1);
                        this.recordErrorDirect(info.team, info.playerIndex, errKey, label);
                        return;
                    }
                }
                // Try player names
                const allPlayers = [
                    ...this.match.teamA.players.map((n, i) => ({ name: n, team: 'A', idx: i })),
                    ...this.match.teamB.players.map((n, i) => ({ name: n, team: 'B', idx: i }))
                ];
                for (const p of allPlayers) {
                    if (transcript.includes(p.name.toLowerCase())) {
                        const label = errName.charAt(0).toUpperCase() + errName.slice(1);
                        this.recordErrorDirect(p.team, p.idx, errKey, label);
                        return;
                    }
                }
            }
        }
        this.setVoiceStatus('Command not recognized', 'error');
    }

    setVoiceStatus(msg, type) {
        const el = document.getElementById('voice-status');
        if (el) {
            el.textContent = msg;
            el.className = 'voice-status' + (type ? ` voice-${type}` : '');
        }
    }

    // ─── Match Setup (Task 8.1) ─────────────────────────────────────────────

    startMatch() {
        const p1a = this.getPlayerName('teamA-player1');
        const p2a = this.getPlayerName('teamA-player2');
        const p1b = this.getPlayerName('teamB-player1');
        const p2b = this.getPlayerName('teamB-player2');

        const names = [p1a, p2a, p1b, p2b];

        // Validate non-empty
        if (names.some(n => !n || !n.trim())) {
            alert('All four player names must be filled in.');
            return;
        }

        // Validate unique (case-insensitive)
        const lower = names.map(n => n.trim().toLowerCase());
        if (new Set(lower).size !== 4) {
            alert('All player names must be unique.');
            return;
        }

        const format = parseInt(document.getElementById('match-format').value) || 3;

        this.match = {
            teamA: { players: [p1a.trim(), p2a.trim()], name: `${p1a.trim()} / ${p2a.trim()}` },
            teamB: { players: [p1b.trim(), p2b.trim()], name: `${p1b.trim()} / ${p2b.trim()}` },
            format: format,
            startTime: new Date().toISOString(),
            endTime: null,
            errors: [],
            history: []
        };

        this.engine = new TennisScoringEngine(format);
        this.history = [];

        // Set service order from config
        const orderVal = document.getElementById('service-order').value;
        const order = orderVal.split(',').map(Number);
        this.engine.setServiceOrder(order);

        // Auto-add members
        this.memberManager.autoAddMembers(names.map(n => n.trim()));

        // Show scoreboard
        this.showSection('scoreboard-section');
        this.updateDisplay();
        this.saveActiveMatch();
    }

    getPlayerName(selectId) {
        const select = document.getElementById(selectId);
        if (!select) return '';
        const val = select.value;
        if (val === '__new__' || val === '') {
            const input = document.getElementById(selectId + '-new');
            return input ? input.value.trim() : '';
        }
        return val;
    }

    // ─── Scoring Actions (Task 8.2) ─────────────────────────────────────────

    addPoint(team) {
        if (!this.engine || !this.match || this.engine.isFinished) return;

        // Push state snapshot BEFORE scoring
        const snapshot = this.engine.getState();
        this.history.push({
            type: 'point',
            team: team,
            description: `Point Team ${team}`,
            stateSnapshot: snapshot,
            timestamp: new Date().toISOString()
        });

        const result = this.engine.scorePoint(team);
        this.playScoreSound();

        // Handle transitions
        if (result.transition === 'GAME_WON') {
            this.checkSideChange();
        } else if (result.transition === 'SET_WON') {
            // New set started
        } else if (result.transition === 'MATCH_WON') {
            this.playWinSound();
            this.endMatch();
            return;
        } else if (result.transition === 'TIEBREAK_START') {
            const ti = document.getElementById('tiebreak-indicator');
            if (ti) ti.classList.remove('hidden');
        }

        // Animate score
        const scoreEl = document.getElementById(team === 'A' ? 'scoreA' : 'scoreB');
        if (scoreEl) {
            scoreEl.classList.add('score-flash');
            setTimeout(() => scoreEl.classList.remove('score-flash'), 300);
        }

        // Announce score for plain +Point (no player action to announce)
        this.announceScore(team);

        this.updateDisplay();
        this.saveActiveMatch();
    }

    updateDisplay() {
        if (!this.engine || !this.match) return;

        // Point scores
        const points = this.engine.getCurrentPointScore();
        const scoreA = document.getElementById('scoreA');
        const scoreB = document.getElementById('scoreB');
        if (scoreA) scoreA.textContent = points.teamA;
        if (scoreB) scoreB.textContent = points.teamB;

        // Game scores
        const currentSet = this.engine.getCurrentSet();
        const gamesEl = document.getElementById('games-current-set');
        if (gamesEl) gamesEl.textContent = `Games: ${currentSet.gamesA} - ${currentSet.gamesB}`;

        // Set scores
        const setsEl = document.getElementById('sets-won');
        if (setsEl) setsEl.textContent = `Sets: ${this.engine.setsWon.A} - ${this.engine.setsWon.B}`;

        // Set info
        const setInfo = document.getElementById('set-info');
        if (setInfo) setInfo.textContent = `Set ${this.engine.currentSetIndex + 1}`;

        // Game score in header
        const gameScore = document.getElementById('game-score');
        if (gameScore) gameScore.textContent = `${currentSet.gamesA}-${currentSet.gamesB}`;

        // Current point score in header
        const pointScoreDisplay = document.getElementById('point-score-display');
        if (pointScoreDisplay) pointScoreDisplay.textContent = `${points.teamA}-${points.teamB}`;

        // Tiebreak indicator
        const ti = document.getElementById('tiebreak-indicator');
        if (ti) {
            if (currentSet.isTiebreak) ti.classList.remove('hidden');
            else ti.classList.add('hidden');
        }

        // Service display
        this.updateServiceDisplay();

        // Team labels
        const labelA = document.getElementById('team-a-label');
        const labelB = document.getElementById('team-b-label');
        if (labelA) labelA.textContent = this.match.teamA.name;
        if (labelB) labelB.textContent = this.match.teamB.name;

        // Error player names
        const epA1 = document.getElementById('error-player-a1-name');
        const epA2 = document.getElementById('error-player-a2-name');
        const epB1 = document.getElementById('error-player-b1-name');
        const epB2 = document.getElementById('error-player-b2-name');
        if (epA1) epA1.textContent = this.match.teamA.players[0];
        if (epA2) epA2.textContent = this.match.teamA.players[1];
        if (epB1) epB1.textContent = this.match.teamB.players[0];
        if (epB2) epB2.textContent = this.match.teamB.players[1];

        // Undo button
        const undoBtn = document.getElementById('btn-undo');
        if (undoBtn) undoBtn.disabled = this.history.length === 0;

        // Point history display
        this.renderPointHistory();
    }

    renderPointHistory() {
        const container = document.getElementById('point-history');
        if (!container) return;
        const last10 = this.history.slice(-10).reverse();
        container.innerHTML = last10.map(h => {
            const time = new Date(h.timestamp).toLocaleTimeString();
            return `<div class="history-entry history-${h.type}"><span>${h.description}</span><span class="history-time">${time}</span></div>`;
        }).join('');
    }

    // ─── Error Recording (Task 8.3) ─────────────────────────────────────────

    recordError() {
        if (!this.match || !this.engine) return;
        const team = document.getElementById('error-team').value;
        const playerIndex = parseInt(document.getElementById('error-player').value);
        const errorType = document.getElementById('error-type').value;
        const errorLabels = {
            'double-fault': 'Double Fault', 'unforced-error': 'Unforced Error',
            'forced-error': 'Forced Error', 'foot-fault': 'Foot Fault',
            'net-fault': 'Net Fault', 'out': 'Out', 'let': 'Let', 'other': 'Other'
        };
        this.recordErrorDirect(team, playerIndex, errorType, errorLabels[errorType] || errorType);
    }

    recordErrorDirect(team, playerIndex, errorType, errorTypeLabel) {
        if (!this.match || !this.engine) return;

        const playerName = team === 'A' ? this.match.teamA.players[playerIndex] : this.match.teamB.players[playerIndex];
        const currentSet = this.engine.getCurrentSet();
        const pointScore = this.engine.getCurrentPointScore();

        const error = {
            id: `err_${Date.now()}`,
            team, playerIndex, playerName, errorType, errorTypeLabel,
            setIndex: this.engine.currentSetIndex,
            gameScore: `${currentSet.gamesA}-${currentSet.gamesB}`,
            pointScore: `${pointScore.teamA}-${pointScore.teamB}`,
            timestamp: new Date().toISOString()
        };

        this.match.errors.push(error);

        // Push state snapshot for undo
        const snapshot = this.engine.getState();
        this.history.push({
            type: 'error',
            team, description: `${playerName}: ${errorTypeLabel}`,
            stateSnapshot: snapshot,
            errorId: error.id,
            timestamp: new Date().toISOString()
        });

        if (errorType === 'double-fault') {
            // Double fault awards point to opposing team
            const opponent = team === 'A' ? 'B' : 'A';
            const result = this.engine.scorePoint(opponent);
            if (result.transition === 'GAME_WON') this.checkSideChange();
            else if (result.transition === 'MATCH_WON') { this.playWinSound(); this.endMatch(); return; }
            else if (result.transition === 'TIEBREAK_START') {
                const ti = document.getElementById('tiebreak-indicator');
                if (ti) ti.classList.remove('hidden');
            }
        } else if (errorType === 'let') {
            // Let: no score change, show indicator briefly
            const ti = document.getElementById('side-change-notification');
            if (ti) {
                ti.innerHTML = '<span>🔄 Let!</span>';
                ti.classList.remove('hidden');
                setTimeout(() => ti.classList.add('hidden'), 2000);
            }
        }
        // Other error types: recording only, no score change

        this.playErrorSound();
        this.announceFault(team, playerName, errorTypeLabel);
        this.updateDisplay();
        this.saveActiveMatch();
    }

    announceFault(team, playerName, errorTypeLabel) {
        if (!('speechSynthesis' in window)) return;
        window.speechSynthesis.cancel();
        const msg = new SpeechSynthesisUtterance(`${playerName}, ${errorTypeLabel}`);
        msg.rate = 1.0;
        msg.volume = 0.8;
        msg.lang = 'en-US';
        // After fault announcement, announce score if enabled
        msg.onend = () => {
            setTimeout(() => this.announceScore(null), 300);
        };
        window.speechSynthesis.speak(msg);
    }

    // ─── Voice-Over Toggle ──────────────────────────────────────────────────

    toggleVoiceOver() {
        this.scoreVoiceEnabled = !this.scoreVoiceEnabled;
        const btn = document.getElementById('btn-voice-toggle');
        if (btn) {
            btn.textContent = this.scoreVoiceEnabled ? '🔊' : '🔇';
            btn.title = this.scoreVoiceEnabled ? 'Score voice ON (tap to mute score)' : 'Score voice OFF (tap to enable)';
            btn.classList.toggle('voice-off', !this.scoreVoiceEnabled);
        }
    }

    announceScore(team) {
        if (!this.scoreVoiceEnabled) return;
        if (!('speechSynthesis' in window)) return;
        
        const points = this.engine.getCurrentPointScore();
        const server = this.engine.getServer();
        const serverTeam = server.team;
        
        // Server's score goes first, with a pause between
        let scoreText;
        if (points.isDeuce) {
            scoreText = 'Deuce';
        } else if (points.advantageTeam) {
            const advPlayerName = points.advantageTeam === 'A' 
                ? this.match.teamA.name : this.match.teamB.name;
            scoreText = `Advantage ${advPlayerName}`;
        } else if (points.isTiebreak) {
            const serverScore = serverTeam === 'A' ? points.teamA : points.teamB;
            const receiverScore = serverTeam === 'A' ? points.teamB : points.teamA;
            scoreText = `${serverScore} .... ${receiverScore}`;
        } else {
            const serverScore = serverTeam === 'A' ? points.teamA : points.teamB;
            const receiverScore = serverTeam === 'A' ? points.teamB : points.teamA;
            scoreText = `${serverScore} .... ${receiverScore}`;
        }
        
        const msg = new SpeechSynthesisUtterance(scoreText);
        msg.rate = 0.9;
        msg.volume = 0.8;
        msg.lang = 'en-US';
        window.speechSynthesis.speak(msg);
    }

    // Announce player action (always voiced, not controlled by toggle)
    announceAction(playerName, actionLabel) {
        if (!('speechSynthesis' in window)) return;
        window.speechSynthesis.cancel();
        const msg = new SpeechSynthesisUtterance(`${playerName}, ${actionLabel}`);
        msg.rate = 1.0;
        msg.volume = 0.8;
        msg.lang = 'en-US';
        // After action announcement, announce score if enabled
        msg.onend = () => {
            setTimeout(() => this.announceScore(null), 300);
        };
        window.speechSynthesis.speak(msg);
    }

    // ─── Record Action (new scoring logic) ──────────────────────────────────

    recordAction(team, playerIndex, actionType) {
        if (!this.match || !this.engine || this.engine.isFinished) return;

        const playerName = team === 'A'
            ? this.match.teamA.players[playerIndex]
            : this.match.teamB.players[playerIndex];

        const positiveActions = ['ace', 'net-winner', 'winner'];
        const negativeActions = ['double-fault', 'out', 'unforced-error'];
        const neutralActions = ['let'];

        const actionLabels = {
            'ace': 'Ace', 'net-winner': 'Net Winner', 'winner': 'Winner',
            'double-fault': 'Double Fault', 'out': 'Out',
            'unforced-error': 'Unforced Error', 'let': 'Let'
        };

        const label = actionLabels[actionType] || actionType;
        const oppositeTeam = team === 'A' ? 'B' : 'A';

        // Record in errors array for match summary
        const currentSet = this.engine.getCurrentSet();
        const pointScore = this.engine.getCurrentPointScore();
        const actionRecord = {
            id: `act_${Date.now()}`,
            team, playerIndex, playerName,
            errorType: actionType,
            errorTypeLabel: label,
            setIndex: this.engine.currentSetIndex,
            gameScore: `${currentSet.gamesA}-${currentSet.gamesB}`,
            pointScore: `${pointScore.teamA}-${pointScore.teamB}`,
            timestamp: new Date().toISOString()
        };
        this.match.errors.push(actionRecord);

        // Push state snapshot BEFORE scoring for undo
        const snapshot = this.engine.getState();

        if (positiveActions.includes(actionType)) {
            // Positive: award point to player's team
            this.history.push({
                type: 'action',
                team: team,
                description: `${playerName}: ${label} → +1 Team ${team}`,
                stateSnapshot: snapshot,
                errorId: actionRecord.id,
                timestamp: new Date().toISOString()
            });

            const result = this.engine.scorePoint(team);
            this.playScoreSound();
            this.announceAction(playerName, label);

            if (result.transition === 'GAME_WON') this.checkSideChange();
            else if (result.transition === 'MATCH_WON') { this.playWinSound(); this.endMatch(); return; }
            else if (result.transition === 'TIEBREAK_START') {
                const ti = document.getElementById('tiebreak-indicator');
                if (ti) ti.classList.remove('hidden');
            }

            // Animate score
            const scoreEl = document.getElementById(team === 'A' ? 'scoreA' : 'scoreB');
            if (scoreEl) {
                scoreEl.classList.add('score-flash');
                setTimeout(() => scoreEl.classList.remove('score-flash'), 300);
            }

        } else if (negativeActions.includes(actionType)) {
            // Negative: award point to OPPONENT team
            this.history.push({
                type: 'action',
                team: team,
                description: `${playerName}: ${label} → +1 Team ${oppositeTeam}`,
                stateSnapshot: snapshot,
                errorId: actionRecord.id,
                timestamp: new Date().toISOString()
            });

            const result = this.engine.scorePoint(oppositeTeam);
            this.playErrorSound();
            this.announceFault(team, playerName, label);

            if (result.transition === 'GAME_WON') this.checkSideChange();
            else if (result.transition === 'MATCH_WON') { this.playWinSound(); this.endMatch(); return; }
            else if (result.transition === 'TIEBREAK_START') {
                const ti = document.getElementById('tiebreak-indicator');
                if (ti) ti.classList.remove('hidden');
            }

            // Animate opponent score
            const scoreEl = document.getElementById(oppositeTeam === 'A' ? 'scoreA' : 'scoreB');
            if (scoreEl) {
                scoreEl.classList.add('score-flash');
                setTimeout(() => scoreEl.classList.remove('score-flash'), 300);
            }

        } else if (neutralActions.includes(actionType)) {
            // Neutral: just record, no score change
            this.history.push({
                type: 'action',
                team: team,
                description: `${playerName}: ${label} (no score change)`,
                stateSnapshot: snapshot,
                errorId: actionRecord.id,
                timestamp: new Date().toISOString()
            });

            // Show brief "Let!" notification
            const ti = document.getElementById('side-change-notification');
            if (ti) {
                ti.innerHTML = '<span>🔄 Let!</span>';
                ti.classList.remove('hidden');
                setTimeout(() => ti.classList.add('hidden'), 2000);
            }
        }

        this.updateDisplay();
        this.saveActiveMatch();
    }

    // ─── Service Switching ──────────────────────────────────────────────────

    showServiceSelector() {
        if (!this.match || !this.engine) return;

        // Create overlay
        const overlay = document.createElement('div');
        overlay.className = 'service-selector-overlay';
        overlay.id = 'service-selector-overlay';

        const content = document.createElement('div');
        content.className = 'service-selector-content';
        content.innerHTML = `<h3>🎾 Select Server</h3>`;

        const players = [
            { name: this.match.teamA.players[0], team: 'A', index: 0 },
            { name: this.match.teamA.players[1], team: 'A', index: 1 },
            { name: this.match.teamB.players[0], team: 'B', index: 0 },
            { name: this.match.teamB.players[1], team: 'B', index: 1 }
        ];

        players.forEach(p => {
            const btn = document.createElement('button');
            btn.className = 'player-option';
            btn.textContent = `${p.name} (Team ${p.team})`;
            btn.addEventListener('click', () => {
                this.switchServiceTo(p.team, p.index);
                overlay.remove();
            });
            content.appendChild(btn);
        });

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'btn-cancel-service';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.addEventListener('click', () => overlay.remove());
        content.appendChild(cancelBtn);

        overlay.appendChild(content);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });

        document.body.appendChild(overlay);
    }

    switchServiceTo(team, playerIndex) {
        if (!this.engine || !this.match) return;

        // Determine current server's team
        const currentServer = this.engine.getServer();
        const currentTeam = currentServer.team;

        // If switching to the other team, auto-alternate within that team
        if (team !== currentTeam) {
            if (team === 'A') {
                // Service going to Team A — use the alternating index
                playerIndex = this.teamAServerIndex;
                // Alternate for next time service returns to Team A
                this.teamAServerIndex = this.teamAServerIndex === 0 ? 1 : 0;
            } else {
                // Service going to Team B
                playerIndex = this.teamBServerIndex;
                this.teamBServerIndex = this.teamBServerIndex === 0 ? 1 : 0;
            }
        }

        // Map team+playerIndex to serviceOrder position
        // Service order mapping: 0=A[0], 1=B[0], 2=A[1], 3=B[1]
        let targetMapping;
        if (team === 'A' && playerIndex === 0) targetMapping = 0;
        else if (team === 'B' && playerIndex === 0) targetMapping = 1;
        else if (team === 'A' && playerIndex === 1) targetMapping = 2;
        else targetMapping = 3; // B, 1

        // Find the index in serviceOrder that matches this target
        const orderIdx = this.engine.serviceOrder.indexOf(targetMapping);
        if (orderIdx !== -1) {
            this.engine.serviceIndex = orderIdx;
        }

        this.updateServiceDisplay();
        this.saveActiveMatch();
    }

    // ─── Side Change (Task 8.6) ─────────────────────────────────────────────

    checkSideChange() {
        if (!this.engine) return;
        const currentSet = this.engine.getCurrentSet();
        const totalGames = currentSet.gamesA + currentSet.gamesB;
        if (totalGames % 2 === 1) {
            this.showSideChangeNotification();
        }
    }

    showSideChangeNotification() {
        const el = document.getElementById('side-change-notification');
        if (!el) return;
        el.innerHTML = '<span>🔄 Change Sides!</span>';
        el.classList.remove('hidden');
        setTimeout(() => el.classList.add('hidden'), 3000);
    }

    // ─── Undo (Task 8.8) ────────────────────────────────────────────────────

    undoLast() {
        if (this.history.length === 0 || !this.engine) return;

        const lastEntry = this.history.pop();
        this.engine.restoreState(lastEntry.stateSnapshot);

        // If last action was an error, remove from errors array
        if (lastEntry.type === 'error' && lastEntry.errorId && this.match) {
            const idx = this.match.errors.findIndex(e => e.id === lastEntry.errorId);
            if (idx !== -1) this.match.errors.splice(idx, 1);
        }

        // Visual feedback
        const scoreboard = document.getElementById('scoreboard-section');
        if (scoreboard) {
            scoreboard.classList.add('undo-flash');
            setTimeout(() => scoreboard.classList.remove('undo-flash'), 300);
        }

        this.updateDisplay();
        this.saveActiveMatch();
    }

    // ─── Service Display (Task 8.9) ─────────────────────────────────────────

    updateServiceDisplay() {
        if (!this.engine || !this.match) return;
        const server = this.engine.getServer();
        const name = server.team === 'A'
            ? this.match.teamA.players[server.playerIndex]
            : this.match.teamB.players[server.playerIndex];
        const el = document.getElementById('server-name');
        if (el) el.textContent = name;
    }

    switchService() {
        if (!this.engine) return;
        this.engine.serviceIndex = (this.engine.serviceIndex + 1) % 4;
        this.updateServiceDisplay();
        this.saveActiveMatch();
    }

    // ─── Match End & Summary (Task 11.1) ────────────────────────────────────

    endMatch() {
        if (!this.match) return;
        if (!this.engine.isFinished) {
            if (!confirm('End match early? The current state will be saved.')) return;
        }

        this.match.endTime = new Date().toISOString();
        const winner = this.engine.winner;
        this.match.winner = winner;
        this.match.setsWon = { ...this.engine.setsWon };
        this.match.sets = JSON.parse(JSON.stringify(this.engine.sets));

        this.saveMatchToHistory();
        this.clearActiveMatch();
        this.showSummary();
    }

    showSummary() {
        if (!this.match) return;
        this.showSection('summary-section');

        const winner = this.match.winner;
        const winnerName = winner === 'A' ? this.match.teamA.name : (winner === 'B' ? this.match.teamB.name : 'No winner');
        const resultEl = document.getElementById('match-result');
        if (resultEl) {
            resultEl.innerHTML = `<h3>🏆 Winner: ${winnerName}</h3>
                <p>${this.match.teamA.name} vs ${this.match.teamB.name}</p>
                <p>Sets: ${this.match.setsWon?.A || 0} - ${this.match.setsWon?.B || 0}</p>
                <p>Duration: ${this.getMatchDuration()}</p>`;
        }

        // Set results table
        const setResults = document.getElementById('set-results');
        if (setResults && this.match.sets) {
            let html = '<table class="summary-table"><tr><th>Set</th><th>Team A</th><th>Team B</th></tr>';
            this.match.sets.forEach((s, i) => {
                const tb = s.isTiebreak ? ` (TB: ${s.tiebreakPointsA}-${s.tiebreakPointsB})` : '';
                html += `<tr><td>${i + 1}</td><td>${s.gamesA}${s.isTiebreak && s.gamesA === 7 ? tb : ''}</td><td>${s.gamesB}${s.isTiebreak && s.gamesB === 7 ? tb : ''}</td></tr>`;
            });
            html += '</table>';
            setResults.innerHTML = html;
        }

        // Error summary
        const errorSummary = document.getElementById('error-summary');
        if (errorSummary && this.match.errors) {
            const errA = this.match.errors.filter(e => e.team === 'A').length;
            const errB = this.match.errors.filter(e => e.team === 'B').length;
            errorSummary.innerHTML = `<p>Team A: ${errA} errors | Team B: ${errB} errors</p>`;
        }

        // Player errors
        const playerErrors = document.getElementById('player-errors');
        if (playerErrors && this.match.errors) {
            const counts = {};
            this.match.errors.forEach(e => {
                counts[e.playerName] = (counts[e.playerName] || 0) + 1;
            });
            playerErrors.innerHTML = Object.entries(counts)
                .map(([name, count]) => `<p>${name}: ${count}</p>`).join('');
        }

        // Error types
        const errorTypes = document.getElementById('error-types-summary');
        if (errorTypes && this.match.errors) {
            const types = {};
            this.match.errors.forEach(e => {
                types[e.errorTypeLabel] = (types[e.errorTypeLabel] || 0) + 1;
            });
            errorTypes.innerHTML = Object.entries(types)
                .map(([type, count]) => `<p>${type}: ${count}</p>`).join('');
        }
    }

    getMatchDuration() {
        if (!this.match || !this.match.startTime) return 'N/A';
        const start = new Date(this.match.startTime);
        const end = this.match.endTime ? new Date(this.match.endTime) : new Date();
        const diff = Math.floor((end - start) / 1000);
        const h = Math.floor(diff / 3600);
        const m = Math.floor((diff % 3600) / 60);
        if (h > 0) return `${h}h ${m}m`;
        return `${m}m`;
    }

    saveMatchToHistory() {
        if (!this.match) return;
        const eventId = this.eventManager.getActiveEventId();
        const key = this.eventManager.getMatchHistoryKey(eventId);

        let records = [];
        try { records = JSON.parse(localStorage.getItem(key)) || []; } catch (e) { records = []; }

        const record = {
            id: Date.now(),
            date: this.match.startTime,
            eventId: eventId,
            teamA: this.match.teamA,
            teamB: this.match.teamB,
            sets: (this.match.sets || this.engine?.sets || []).map(s => ({
                gamesA: s.gamesA, gamesB: s.gamesB,
                isTiebreak: s.isTiebreak,
                tiebreakPointsA: s.tiebreakPointsA, tiebreakPointsB: s.tiebreakPointsB
            })),
            setsWon: this.match.setsWon || this.engine?.setsWon || { A: 0, B: 0 },
            winner: this.match.winner,
            errors: this.match.errors || [],
            duration: this.getMatchDuration()
        };

        records.unshift(record);
        if (records.length > 100) records = records.slice(0, 100);
        localStorage.setItem(key, JSON.stringify(records));

        // Sync to Firebase
        this.sync.saveMatch(record);
    }

    newMatch() {
        this.engine = null;
        this.match = null;
        this.history = [];
        this.showSection('setup-section');
        this.populateMemberPickers();
    }

    // ─── History Page (Task 11.3) ───────────────────────────────────────────

    showHistoryPage() {
        this.showSection('history-page');
        this.renderHistoryPage();
    }

    renderHistoryPage() {
        const key = this.eventManager.getMatchHistoryKey();
        let records = [];
        try { records = JSON.parse(localStorage.getItem(key)) || []; } catch (e) { records = []; }

        // Apply filters
        const searchVal = (document.getElementById('history-search')?.value || '').toLowerCase();
        const dateVal = document.getElementById('history-date')?.value || '';

        let filtered = records;
        if (searchVal) {
            filtered = filtered.filter(r => {
                const names = [...r.teamA.players, ...r.teamB.players].join(' ').toLowerCase();
                return names.includes(searchVal);
            });
        }
        if (dateVal) {
            filtered = filtered.filter(r => r.date && r.date.startsWith(dateVal));
        }

        const container = document.getElementById('history-list');
        if (!container) return;

        if (filtered.length === 0) {
            container.innerHTML = '<p style="text-align:center; color:var(--text-muted); padding:20px;">No matches found.</p>';
            return;
        }

        container.innerHTML = filtered.map(r => {
            const date = new Date(r.date).toLocaleDateString();
            const setsStr = (r.sets || []).map(s => `${s.gamesA}-${s.gamesB}`).join(', ');
            const winnerName = r.winner === 'A' ? r.teamA.name : (r.winner === 'B' ? r.teamB.name : 'N/A');
            return `<div class="history-item" data-id="${r.id}">
                <input type="checkbox" class="history-checkbox" data-id="${r.id}">
                <div class="history-item-content">
                    <span class="history-date">${date}</span>
                    <span class="history-teams">${r.teamA.name} vs ${r.teamB.name}</span>
                    <span class="history-score">Sets: ${setsStr}</span>
                    <span class="history-winner">Winner: ${winnerName}</span>
                </div>
            </div>`;
        }).join('');
    }

    toggleSelectAllHistory() {
        const checkboxes = document.querySelectorAll('.history-checkbox');
        const allChecked = Array.from(checkboxes).every(cb => cb.checked);
        checkboxes.forEach(cb => cb.checked = !allChecked);
    }

    exportSelectedHistory() {
        const key = this.eventManager.getMatchHistoryKey();
        let records = [];
        try { records = JSON.parse(localStorage.getItem(key)) || []; } catch (e) { records = []; }

        const selected = Array.from(document.querySelectorAll('.history-checkbox:checked')).map(cb => cb.dataset.id);
        if (selected.length === 0) { alert('No matches selected.'); return; }

        const exported = records.filter(r => selected.includes(String(r.id)));
        const blob = new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `tennis-history-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    importHistory(e) {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                const imported = JSON.parse(evt.target.result);
                if (!Array.isArray(imported)) { alert('Invalid format.'); return; }

                const key = this.eventManager.getMatchHistoryKey();
                let records = [];
                try { records = JSON.parse(localStorage.getItem(key)) || []; } catch (e) { records = []; }

                records = [...imported, ...records];
                if (records.length > 100) records = records.slice(0, 100);
                localStorage.setItem(key, JSON.stringify(records));
                // Sync imported matches to Firebase
                this.sync.saveMatchHistory(null, records);
                imported.forEach(r => this.sync.saveMatch(r));
                this.renderHistoryPage();
                alert(`Imported ${imported.length} matches.`);
            } catch (err) {
                alert('Failed to import: invalid JSON.');
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    }

    clearHistory() {
        if (!confirm('Clear all match history for this event?')) return;
        const key = this.eventManager.getMatchHistoryKey();
        localStorage.removeItem(key);
        // Sync clear to Firebase
        this.sync.clearMatchHistory(null);
        this.renderHistoryPage();
    }

    // ─── Leaderboard (Task 11.5) ────────────────────────────────────────────

    showLeaderboard() {
        this.showSection('leaderboard-page');
        this.renderLeaderboard();
    }

    renderLeaderboard() {
        const key = this.eventManager.getMatchHistoryKey();
        let records = [];
        try { records = JSON.parse(localStorage.getItem(key)) || []; } catch (e) { records = []; }

        // Date range filters
        const fromVal = document.getElementById('leaderboard-from')?.value || '';
        const toVal = document.getElementById('leaderboard-to')?.value || '';

        if (fromVal) {
            records = records.filter(r => r.date && r.date >= fromVal);
        }
        if (toVal) {
            const toDate = toVal + 'T23:59:59';
            records = records.filter(r => r.date && r.date <= toDate);
        }

        // Calculate player stats
        const stats = {};
        records.forEach(r => {
            if (!r.winner) return;
            const winTeam = r.winner;
            const loseTeam = winTeam === 'A' ? 'B' : 'A';

            const winners = r[`team${winTeam}`]?.players || [];
            const losers = r[`team${loseTeam}`]?.players || [];

            winners.forEach(name => {
                if (!stats[name]) stats[name] = { wins: 0, losses: 0 };
                stats[name].wins++;
            });
            losers.forEach(name => {
                if (!stats[name]) stats[name] = { wins: 0, losses: 0 };
                stats[name].losses++;
            });
        });

        // Sort by wins descending
        const ranked = Object.entries(stats)
            .map(([name, s]) => ({
                name, wins: s.wins, losses: s.losses,
                pct: s.wins + s.losses > 0 ? Math.round((s.wins / (s.wins + s.losses)) * 100) : 0
            }))
            .sort((a, b) => b.wins - a.wins || b.pct - a.pct);

        const container = document.getElementById('leaderboard-content');
        if (!container) return;

        if (ranked.length === 0) {
            container.innerHTML = '<p style="text-align:center; color:var(--text-muted); padding:20px;">No data available.</p>';
            return;
        }

        let html = '<table class="leaderboard-table"><tr><th>#</th><th>Player</th><th>W</th><th>L</th><th>Win%</th></tr>';
        ranked.forEach((p, i) => {
            html += `<tr><td>${i + 1}</td><td>${p.name}</td><td>${p.wins}</td><td>${p.losses}</td><td>${p.pct}%</td></tr>`;
        });
        html += '</table>';
        container.innerHTML = html;
    }

    // ─── Share/Export (Task 12.1) ───────────────────────────────────────────

    saveSummary() {
        if (!this.match) return;
        const winner = this.match.winner;
        const winnerName = winner === 'A' ? this.match.teamA.name : (winner === 'B' ? this.match.teamB.name : 'N/A');
        const sets = (this.match.sets || []).map((s, i) => `Set ${i + 1}: ${s.gamesA}-${s.gamesB}`).join('\n');

        const text = `Tennis Doubles Match Summary\n${'='.repeat(30)}\n` +
            `${this.match.teamA.name} vs ${this.match.teamB.name}\n` +
            `Winner: ${winnerName}\n` +
            `Sets: ${this.match.setsWon?.A || 0} - ${this.match.setsWon?.B || 0}\n` +
            `${sets}\nDuration: ${this.getMatchDuration()}\n` +
            `Date: ${new Date(this.match.startTime).toLocaleString()}`;

        if (navigator.clipboard) {
            navigator.clipboard.writeText(text).then(() => alert('Summary copied to clipboard!'));
        } else {
            const blob = new Blob([text], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'match-summary.txt';
            a.click();
            URL.revokeObjectURL(url);
        }
    }

    generateShareCard() {
        if (!this.match) return;
        const canvas = document.getElementById('share-canvas');
        if (!canvas) return;
        canvas.width = 600;
        canvas.height = 400;
        const ctx = canvas.getContext('2d');

        // Background
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, 600, 400);

        // Title
        ctx.fillStyle = '#4CAF50';
        ctx.font = 'bold 24px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('🎾 Tennis Doubles Match', 300, 40);

        // Teams
        ctx.fillStyle = '#ffffff';
        ctx.font = '18px sans-serif';
        ctx.fillText(`${this.match.teamA.name} vs ${this.match.teamB.name}`, 300, 80);

        // Winner
        const winnerName = this.match.winner === 'A' ? this.match.teamA.name : (this.match.winner === 'B' ? this.match.teamB.name : 'N/A');
        ctx.fillStyle = '#FFD700';
        ctx.font = 'bold 20px sans-serif';
        ctx.fillText(`🏆 ${winnerName}`, 300, 120);

        // Sets
        ctx.fillStyle = '#ffffff';
        ctx.font = '16px sans-serif';
        const sets = this.match.sets || [];
        sets.forEach((s, i) => {
            ctx.fillText(`Set ${i + 1}: ${s.gamesA} - ${s.gamesB}`, 300, 160 + i * 30);
        });

        // Duration
        ctx.fillStyle = '#aaaaaa';
        ctx.font = '14px sans-serif';
        ctx.fillText(`Duration: ${this.getMatchDuration()}`, 300, 350);
        ctx.fillText(new Date(this.match.startTime).toLocaleDateString(), 300, 375);

        // Download
        canvas.toBlob(blob => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'match-share-card.png';
            a.click();
            URL.revokeObjectURL(url);
        });
    }

    // ─── Active Match Persistence (Task 12.2) ───────────────────────────────

    saveActiveMatch() {
        if (!this.match || !this.engine) return;
        const key = this.eventManager.getActiveMatchKey();
        const state = {
            match: this.match,
            engineState: this.engine.getState(),
            history: this.history
        };
        localStorage.setItem(key, JSON.stringify(state));
        this.sync.saveActiveMatch(state);
    }

    restoreActiveMatch() {
        const key = this.eventManager.getActiveMatchKey();
        try {
            const stored = localStorage.getItem(key);
            if (!stored) return;
            const state = JSON.parse(stored);
            if (!state || !state.match || !state.engineState) return;

            this.match = state.match;
            this.engine = new TennisScoringEngine(state.engineState.matchFormat);
            this.engine.restoreState(state.engineState);
            this.history = state.history || [];

            this.showSection('scoreboard-section');
            this.updateDisplay();
        } catch (e) {
            console.warn('[TennisScoreSheet] Failed to restore active match:', e);
        }
    }

    clearActiveMatch() {
        const key = this.eventManager.getActiveMatchKey();
        localStorage.removeItem(key);
        this.sync.clearActiveMatch();
    }

    // ─── Events Page (Task 14.2) ────────────────────────────────────────────

    renderEventsPage() {
        const events = this.eventManager.getEvents();
        const container = document.getElementById('event-list');
        if (!container) return;

        container.innerHTML = events.map(evt => `
            <div class="event-item" data-id="${evt.id}">
                <span class="event-item-name">${evt.name}</span>
                <div class="event-item-actions">
                    <button class="btn-rename-event btn btn-secondary btn-sm" data-id="${evt.id}" title="Rename">✏️</button>
                    <button class="btn-members-event btn btn-secondary btn-sm" data-id="${evt.id}" data-name="${evt.name}" title="Members">👥</button>
                    <button class="btn-delete-event btn btn-error btn-sm" data-id="${evt.id}" title="Delete">🗑️</button>
                </div>
            </div>
        `).join('');

        // Attach handlers
        container.querySelectorAll('.btn-rename-event').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.currentTarget.dataset.id;
                const newName = prompt('New event name:');
                if (newName) {
                    try {
                        this.eventManager.renameEvent(id, newName);
                        this.renderEventsPage();
                        this.renderEventSelectors();
                    } catch (err) { alert(err.message); }
                }
            });
        });

        container.querySelectorAll('.btn-members-event').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.currentTarget.dataset.id;
                const name = e.currentTarget.dataset.name;
                this.showMembersSection(id, name);
            });
        });

        container.querySelectorAll('.btn-delete-event').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.currentTarget.dataset.id;
                if (!confirm('Delete this event and all its data?')) return;
                try {
                    this.eventManager.deleteEvent(id);
                    this.sync.deleteEventData(id);
                    this.renderEventsPage();
                    this.renderEventSelectors();
                } catch (err) { alert(err.message); }
            });
        });
    }

    showMembersSection(eventId, eventName) {
        // Temporarily switch to this event for member loading
        const prevId = this.eventManager.getActiveEventId();
        localStorage.setItem('tennis-selected-event', eventId);
        this.memberManager.onEventChanged();

        document.getElementById('members-event-title').textContent = `Members: ${eventName}`;
        document.getElementById('members-section')?.classList.remove('hidden');
        document.getElementById('event-list')?.classList.add('hidden');
        document.querySelector('.event-add-form')?.classList.add('hidden');

        this.memberManager.renderMembersPage();

        // Restore active event when done (handled by back button)
        this._memberEventId = eventId;
        this._prevEventId = prevId;
    }

    // ─── Event Management Integration ───────────────────────────────────────

    onEventChanged() {
        this.memberManager.onEventChanged();
        this.populateMemberPickers();
        this.renderEventSelectors();
        this.restoreActiveMatch();
    }

    onEventListChanged() {
        this.renderEventSelectors();
        this.populateMemberPickers();
        this.renderEventsPage();
    }

    renderEventSelectors() {
        this.eventManager.renderEventSelector('event-selector-setup');
        this.eventManager.renderEventSelector('event-selector-history');
        this.eventManager.renderEventSelector('event-selector-leaderboard');
    }

    populateMemberPickers() {
        const names = this.memberManager.getMemberNames();
        const pickerIds = ['teamA-player1', 'teamA-player2', 'teamB-player1', 'teamB-player2'];

        pickerIds.forEach(id => {
            const select = document.getElementById(id);
            if (!select) return;
            const currentVal = select.value;
            select.innerHTML = '<option value="">Select Player...</option>';
            names.forEach(name => {
                const opt = document.createElement('option');
                opt.value = name;
                opt.textContent = name;
                select.appendChild(opt);
            });
            const newOpt = document.createElement('option');
            newOpt.value = '__new__';
            newOpt.textContent = '+ Type new name';
            select.appendChild(newOpt);

            // Restore selection if still valid
            if (currentVal && names.includes(currentVal)) {
                select.value = currentVal;
            }
        });
    }

    // ─── Navigation ─────────────────────────────────────────────────────────

    showSection(sectionId) {
        document.querySelectorAll('.section').forEach(s => s.classList.add('hidden'));
        const target = document.getElementById(sectionId);
        if (target) target.classList.remove('hidden');

        // Update nav tabs
        document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
        const tab = document.querySelector(`.nav-tab[data-section="${sectionId}"]`);
        if (tab) tab.classList.add('active');
    }

    // ─── Event Listeners (initEventListeners) ───────────────────────────────

    initEventListeners() {
        // Start Match
        document.getElementById('start-match')?.addEventListener('click', () => this.startMatch());

        // Score buttons
        document.getElementById('btn-scoreA')?.addEventListener('click', () => this.addPoint('A'));
        document.getElementById('btn-scoreB')?.addEventListener('click', () => this.addPoint('B'));

        // Undo
        document.getElementById('btn-undo')?.addEventListener('click', () => this.undoLast());

        // End Match
        document.getElementById('btn-end-match')?.addEventListener('click', () => this.endMatch());

        // Record Error (manual)
        document.getElementById('btn-record-error')?.addEventListener('click', () => this.recordError());

        // Voice
        document.getElementById('btn-voice-command')?.addEventListener('click', () => this.toggleVoice());

        // Theme
        document.getElementById('btn-theme-toggle')?.addEventListener('click', () => this.toggleTheme());

        // QR Code
        document.getElementById('btn-show-qr')?.addEventListener('click', () => this.showQRCode());
        document.getElementById('btn-close-qr')?.addEventListener('click', () => this.hideQRCode());
        document.getElementById('qr-modal')?.addEventListener('click', (e) => {
            if (e.target.id === 'qr-modal') this.hideQRCode();
        });

        // Voice Over Toggle
        document.getElementById('btn-voice-toggle')?.addEventListener('click', () => this.toggleVoiceOver());

        // Service Switch
        document.getElementById('btn-service-switch')?.addEventListener('click', () => this.showServiceSelector());

        // +Point team buttons
        document.getElementById('btn-pointA')?.addEventListener('click', () => this.addPoint('A'));
        document.getElementById('btn-pointB')?.addEventListener('click', () => this.addPoint('B'));

        // Action buttons (positive/negative/neutral per player)
        document.querySelectorAll('.action-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const team = btn.dataset.team;
                const playerIndex = parseInt(btn.dataset.player);
                const actionType = btn.dataset.action;
                this.recordAction(team, playerIndex, actionType);
            });
        });

        // +Point buttons under each player
        document.querySelectorAll('.btn-point-player').forEach(btn => {
            btn.addEventListener('click', () => {
                const team = btn.dataset.team;
                this.addPoint(team);
            });
        });

        // Summary actions
        document.getElementById('btn-new-match')?.addEventListener('click', () => this.newMatch());
        document.getElementById('btn-save-summary')?.addEventListener('click', () => this.saveSummary());
        document.getElementById('btn-share-card')?.addEventListener('click', () => this.generateShareCard());
        document.getElementById('btn-print')?.addEventListener('click', () => window.print());

        // History header buttons
        document.getElementById('btn-show-history')?.addEventListener('click', () => this.showHistoryPage());
        document.getElementById('btn-show-leaderboard')?.addEventListener('click', () => this.showLeaderboard());

        // History page actions
        document.getElementById('btn-select-all-history')?.addEventListener('click', () => this.toggleSelectAllHistory());
        document.getElementById('btn-export-history')?.addEventListener('click', () => this.exportSelectedHistory());
        document.getElementById('btn-import-history')?.addEventListener('change', (e) => this.importHistory(e));
        document.getElementById('btn-clear-history')?.addEventListener('click', () => this.clearHistory());
        document.getElementById('btn-clear-filters')?.addEventListener('click', () => {
            const s = document.getElementById('history-search'); if (s) s.value = '';
            const d = document.getElementById('history-date'); if (d) d.value = '';
            this.renderHistoryPage();
        });

        // History filters
        document.getElementById('history-search')?.addEventListener('input', () => this.renderHistoryPage());
        document.getElementById('history-date')?.addEventListener('change', () => this.renderHistoryPage());

        // Leaderboard filters
        document.getElementById('btn-leaderboard-filter')?.addEventListener('click', () => this.renderLeaderboard());
        document.getElementById('btn-leaderboard-clear')?.addEventListener('click', () => {
            const f = document.getElementById('leaderboard-from'); if (f) f.value = '';
            const t = document.getElementById('leaderboard-to'); if (t) t.value = '';
            this.renderLeaderboard();
        });

        // Nav tabs
        document.querySelectorAll('.nav-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                const section = e.currentTarget.dataset.section;
                this.showSection(section);
                if (section === 'history-page') this.renderHistoryPage();
                if (section === 'leaderboard-page') this.renderLeaderboard();
                if (section === 'events-page') this.renderEventsPage();
            });
        });

        // Member picker change handlers (show/hide new-name inputs)
        const pickerIds = ['teamA-player1', 'teamA-player2', 'teamB-player1', 'teamB-player2'];
        pickerIds.forEach(id => {
            document.getElementById(id)?.addEventListener('change', (e) => {
                const newInput = document.getElementById(id + '-new');
                if (newInput) {
                    if (e.target.value === '__new__') newInput.classList.remove('hidden');
                    else newInput.classList.add('hidden');
                }
            });
        });

        // Error icon buttons (per-player one-tap fault recording)
        document.querySelectorAll('.error-icons-row').forEach(row => {
            const team = row.dataset.team;
            const playerIndex = parseInt(row.dataset.player);
            row.querySelectorAll('.error-icon-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const errorType = btn.dataset.error;
                    const errorLabels = {
                        'double-fault': 'Double Fault', 'unforced-error': 'Unforced Error',
                        'forced-error': 'Forced Error', 'foot-fault': 'Foot Fault',
                        'net-fault': 'Net Fault', 'out': 'Out', 'let': 'Let', 'other': 'Other'
                    };
                    this.recordErrorDirect(team, playerIndex, errorType, errorLabels[errorType] || errorType);
                });
            });
        });

        // Events page: Add event
        document.getElementById('btn-add-event')?.addEventListener('click', () => {
            const input = document.getElementById('event-name-input');
            const name = input?.value?.trim();
            if (!name) { alert('Enter an event name.'); return; }
            try {
                this.eventManager.createEvent(name);
                if (input) input.value = '';
                this.renderEventsPage();
                this.renderEventSelectors();
            } catch (err) { alert(err.message); }
        });

        // Events page: Back to events from members
        document.getElementById('btn-back-to-events')?.addEventListener('click', () => {
            document.getElementById('members-section')?.classList.add('hidden');
            document.getElementById('event-list')?.classList.remove('hidden');
            document.querySelector('.event-add-form')?.classList.remove('hidden');
            // Restore previous active event
            if (this._prevEventId) {
                localStorage.setItem('tennis-selected-event', this._prevEventId);
                this.memberManager.onEventChanged();
            }
        });

        // Events page: Add member
        document.getElementById('btn-add-member')?.addEventListener('click', () => {
            const input = document.getElementById('member-name-input');
            const name = input?.value?.trim();
            if (!name) { alert('Enter a member name.'); return; }
            try {
                this.memberManager.addMember(name);
                if (input) input.value = '';
                this.memberManager.renderMembersPage();
                this.populateMemberPickers();
            } catch (err) { alert(err.message); }
        });

        // QR Code modal
        document.getElementById('btn-show-qr')?.addEventListener('click', () => this.showQrCode());
        document.getElementById('btn-close-qr')?.addEventListener('click', () => {
            document.getElementById('qr-modal')?.classList.add('hidden');
        });
        document.getElementById('qr-modal')?.addEventListener('click', (e) => {
            if (e.target.id === 'qr-modal') document.getElementById('qr-modal')?.classList.add('hidden');
        });

        // Side change notification dismiss
        document.getElementById('side-change-notification')?.addEventListener('click', () => {
            document.getElementById('side-change-notification')?.classList.add('hidden');
        });
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new TennisScoreSheet();
});
