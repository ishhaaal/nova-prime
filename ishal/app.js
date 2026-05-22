/* ==========================================================================
   MONOLITH // LIFT — REACTIVITY ENGINE + SUPABASE INTEGRATION
   ========================================================================== */

// ── 1. Static Metadata ──────────────────────────────────────────────────────
const EXERCISE_METADATA = {
    bench_press:       { name: 'Barbell Bench Press',          primary: 'Chest',      secondary: 'Triceps'   },
    incline_press:     { name: 'Incline Dumbbell Bench Press', primary: 'Chest',      secondary: 'Shoulders' },
    overhead_press:    { name: 'Overhead Barbell Press',       primary: 'Shoulders',  secondary: 'Triceps'   },
    barbell_row:       { name: 'Bent-Over Barbell Row',        primary: 'Back',       secondary: 'Biceps'    },
    pullups:           { name: 'Weighted Pull-Ups',            primary: 'Back',       secondary: 'Biceps'    },
    squat:             { name: 'Barbell Back Squat',           primary: 'Quads',      secondary: 'Glutes'    },
    romanian_deadlift: { name: 'Romanian Deadlift',            primary: 'Hamstrings', secondary: 'Back'      },
    leg_press:         { name: 'Linear Leg Press',             primary: 'Quads',      secondary: 'Glutes'    },
    lateral_raise:     { name: 'Dumbbell Lateral Raise',       primary: 'Shoulders',  secondary: 'Back'      },
    bicep_curl:        { name: 'Barbell Bicep Curl',           primary: 'Biceps',     secondary: 'Back'      },
    tricep_pushdown:   { name: 'Cable Tricep Pushdown',        primary: 'Triceps',    secondary: 'Chest'     }
};

const SPLIT_TEMPLATES = {
    push:     { name: 'Push Development Alpha',         notes: 'Targeting Chest, Shoulders, and Triceps. Push for 1-2 RIR.', exercises: ['bench_press','incline_press','overhead_press','tricep_pushdown','lateral_raise'] },
    pull:     { name: 'Pull Mechanics Beta',            notes: 'Targeting Back and Biceps. Focus on extreme contractions.',   exercises: ['barbell_row','pullups','bicep_curl','lateral_raise'] },
    legs:     { name: 'Leg Loading Gamma',              notes: 'Targeting Quads, Hamstrings, and Glutes. Heavy loading phase.', exercises: ['squat','romanian_deadlift','leg_press'] },
    fullbody: { name: 'Full Body Integration Sigma',    notes: 'Maximum compound recruitment. Optimize recovery windows.',    exercises: ['squat','bench_press','barbell_row','overhead_press','romanian_deadlift'] },
    custom:   { name: 'Custom Matrix Delta',            notes: 'Independently defined volumetric setup.',                     exercises: ['bench_press','barbell_row','squat'] }
};

const MAX_HYPERTROPHY_SETS = 15;

const RIR_CALIBRATION = {
    0: { label: '0 RIR (Absolute Muscle Failure)',  desc: 'Maximum muscular fatigue. Reserve for final sets only. Heavy CNS cost.' },
    1: { label: '1 RIR (Highly Stimulative)',        desc: 'Perfect hypertrophic zone. High-threshold motor unit recruitment. Safe yet maximal.' },
    2: { label: '2 RIR (Optimal Stimulus)',          desc: 'Excellent sweet spot for progressive overload. Low joint strain, full fiber stimulation.' },
    3: { label: '3 RIR (Moderate Stimulus)',         desc: 'Moderate overload. Suitable for auxiliaries or high-velocity phases.' },
    4: { label: '4 RIR (Low Stimulus)',              desc: 'Low fatigue threshold. Active recovery phase. Not optimal for hypertrophy.' },
    5: { label: '5+ RIR (Warm-up / Deload)',         desc: 'Sub-maximal loading. Useful to grease the groove or calibrate mechanics.' }
};

// ── 2. Supabase Layer ───────────────────────────────────────────────────────
const SUPABASE_URL = 'https://crxbdmroqzfsulinxtwd.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_xyKWTa-0TlLBdKzGydOhNg_USHlMbFh';

class SupabaseLayer {
    constructor() {
        this.client  = null;
        this.connected = false;
        this._loadCreds();
    }

    _loadCreds() {
        this.url = localStorage.getItem('sb_url') || SUPABASE_URL;
        this.key = localStorage.getItem('sb_key') || SUPABASE_ANON_KEY;
        // Persist defaults to localStorage if not already set
        if (!localStorage.getItem('sb_url')) localStorage.setItem('sb_url', this.url);
        if (!localStorage.getItem('sb_key')) localStorage.setItem('sb_key', this.key);
    }

    saveCreds(url, key) {
        this.url = url.trim();
        this.key = key.trim();
        localStorage.setItem('sb_url', this.url);
        localStorage.setItem('sb_key', this.key);
    }

    clearCreds() {
        this.url = ''; this.key = '';
        localStorage.removeItem('sb_url');
        localStorage.removeItem('sb_key');
        this.client = null;
        this.connected = false;
    }

    async connect() {
        if (!this.url || !this.key) throw new Error('Missing URL or API key.');
        // supabase is loaded globally from CDN as window.supabase
        const { createClient } = window.supabase;
        this.client = createClient(this.url, this.key);

        // Test connection: try a lightweight query on the workouts table
        const { error } = await this.client.from('workouts').select('id').limit(1);
        if (error) throw new Error(error.message);
        this.connected = true;
    }

    // Upsert full workout state ─────────────────────────────────────────────
    async saveWorkout(state) {
        if (!this.client || !this.connected) return;

        // 1. Upsert the workout record
        const { error: wErr } = await this.client
            .from('workouts')
            .upsert({ id: state.workoutId, name: state.workoutName, notes: state.workoutNotes },
                    { onConflict: 'id' });
        if (wErr) throw wErr;

        // 2. Delete old exercise_logs rows for this workout, then re-insert
        await this.client.from('exercise_logs').delete().eq('workout_id', state.workoutId);

        const rows = [];
        Object.entries(state.gridData).forEach(([exKey, sets]) => {
            sets.forEach((set, idx) => {
                rows.push({
                    workout_id:   state.workoutId,
                    exercise_key: exKey,
                    set_index:    idx,
                    weight:       Number(set.weight) || 0,
                    reps:         Number(set.reps)   || 0,
                    completed:    Boolean(set.completed)
                });
            });
        });

        if (rows.length > 0) {
            const { error: lErr } = await this.client.from('exercise_logs').insert(rows);
            if (lErr) throw lErr;
        }
    }

    // Load workout from Supabase by ID ─────────────────────────────────────
    async loadWorkout(workoutId) {
        if (!this.client || !this.connected) return null;

        const [{ data: wData, error: wErr }, { data: lData, error: lErr }] = await Promise.all([
            this.client.from('workouts').select('*').eq('id', workoutId).single(),
            this.client.from('exercise_logs').select('*').eq('workout_id', workoutId).order('set_index')
        ]);

        if (wErr || !wData) return null;
        if (lErr) return null;

        // Reconstruct gridData from flat rows
        const gridData = {};
        (lData || []).forEach(row => {
            if (!gridData[row.exercise_key]) gridData[row.exercise_key] = [];
            gridData[row.exercise_key][row.set_index] = {
                weight: row.weight, reps: row.reps, completed: row.completed
            };
        });

        return { workoutName: wData.name, workoutNotes: wData.notes, gridData };
    }

    // Delete workout from Supabase by ID ───────────────────────────────────
    async deleteWorkout(workoutId) {
        if (!this.client || !this.connected) return;
        const { error } = await this.client.from('workouts').delete().eq('id', workoutId);
        if (error) throw error;
    }
}

// ── 3. App State ────────────────────────────────────────────────────────────
class MonolithState {
    constructor() {
        this.workoutId   = this._uuid();
        this.workoutName = SPLIT_TEMPLATES.push.name;
        this.workoutNotes= SPLIT_TEMPLATES.push.notes;
        this.activeSplit = 'push';
        this.gridData    = {};
        this.overloadVectors = [
            { id: this._uuid(), title: '1. Load (Absolute Intensity)', desc: 'Add 2.5–5 kg (5–10 lbs) to your working barbell sets.', checked: false, color: 'var(--emerald)' },
            { id: this._uuid(), title: '2. Reps (Relative Intensity)', desc: 'Hit the top of your range (e.g. 12 reps instead of 10).', checked: false, color: 'var(--purple)' },
            { id: this._uuid(), title: '3. Density (Recovery Pace)', desc: 'Same sets/reps/weight, but cut rest time by 15 seconds.', checked: false, color: 'var(--gold)' }
        ];
        this.rirTarget   = 2;
        this.initDefaultGrid('push');
    }

    _uuid() {
        try { return crypto.randomUUID(); }
        catch {
            return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
                const r = Math.random() * 16 | 0;
                return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
            });
        }
    }

    initDefaultGrid(splitKey) {
        const tpl = SPLIT_TEMPLATES[splitKey];
        this.gridData = {};
        tpl.exercises.forEach(k => {
            this.gridData[k] = [
                { weight: 60, reps: 10, completed: true  },
                { weight: 60, reps: 8,  completed: true  },
                { weight: 65, reps: 8,  completed: false }
            ];
        });
    }

    seedDemoData() {
        this.workoutId    = this._uuid();
        this.workoutName  = 'Push Development Alpha (Target Hit)';
        this.workoutNotes = 'Preloaded intensive overload session.';
        this.activeSplit  = 'push';
        this.rirTarget    = 1;
        this.overloadVectors[0].checked = true;
        this.overloadVectors[1].checked = true;
        this.overloadVectors[2].checked = false;
        this.gridData = {
            bench_press:    [{ weight:80,reps:8,completed:true },{ weight:80,reps:8,completed:true },{ weight:85,reps:6,completed:true },{ weight:85,reps:5,completed:true }],
            incline_press:  [{ weight:32,reps:10,completed:true },{ weight:32,reps:8,completed:true },{ weight:32,reps:8,completed:false }],
            overhead_press: [{ weight:50,reps:8,completed:true },{ weight:50,reps:7,completed:true },{ weight:55,reps:5,completed:true }],
            tricep_pushdown:[{ weight:25,reps:12,completed:true },{ weight:25,reps:12,completed:true },{ weight:28,reps:10,completed:true }],
            lateral_raise:  [{ weight:14,reps:15,completed:true },{ weight:14,reps:15,completed:true },{ weight:16,reps:12,completed:true }]
        };
    }

    resetGrid() {
        this.workoutId   = this._uuid();
        this.workoutName = SPLIT_TEMPLATES[this.activeSplit].name;
        this.workoutNotes= SPLIT_TEMPLATES[this.activeSplit].notes;
        this.overloadVectors.forEach(v => v.checked = false);
        this.rirTarget = 2;
        Object.keys(this.gridData).forEach(k => {
            this.gridData[k] = [{ weight: 0, reps: 0, completed: false }];
        });
    }

    computeMetrics() {
        let totalTonnage = 0, totalReps = 0, activeLiftsCount = 0;
        const muscleVolume = { Chest:0, Back:0, Shoulders:0, Triceps:0, Biceps:0, Quads:0, Hamstrings:0, Glutes:0 };

        Object.entries(this.gridData).forEach(([exKey, sets]) => {
            const meta = EXERCISE_METADATA[exKey];
            if (!meta) return;
            let done = 0;
            sets.forEach(set => {
                if (set.completed) {
                    totalTonnage += (Number(set.weight) || 0) * (Number(set.reps) || 0);
                    totalReps    += Number(set.reps) || 0;
                    done++;
                }
            });
            if (sets.length > 0) activeLiftsCount++;
            if (done > 0) {
                if (muscleVolume[meta.primary]   !== undefined) muscleVolume[meta.primary]   += done;
                if (muscleVolume[meta.secondary] !== undefined) muscleVolume[meta.secondary] += done * 0.5;
            }
        });
        return { totalTonnage, totalReps, activeLiftsCount, muscleVolume };
    }
}

// ── 4. UI Controller ────────────────────────────────────────────────────────
class MonolithUI {
    constructor(state, db) {
        this.state = state;
        this.db    = db;
        this._saveTimer = null;

        // Element refs
        this.splitSelector    = document.getElementById('split-selector');
        this.workoutNameInput = document.getElementById('workout-name-input');
        this.workoutNotesInput= document.getElementById('workout-notes-input');
        this.metricTonnage    = document.getElementById('metric-tonnage');
        this.metricReps       = document.getElementById('metric-reps');
        this.metricLifts      = document.getElementById('metric-lifts');
        this.gridsContainer   = document.getElementById('exercise-grids-container');
        this.weeklySetMatrix  = document.getElementById('weekly-set-matrix');
        this.rirRange         = document.getElementById('rir-range');
        this.rirValueLabel    = document.getElementById('rir-value');
        this.rirFeedbackPanel = document.getElementById('rir-feedback');
        this.overloadListContainer = document.getElementById('overload-list-container');
        this.btnAddVector          = document.getElementById('btn-add-vector');

        // Custom Dropdown refs
        this.customDropdownTrigger = document.getElementById('custom-dropdown-trigger');
        this.customDropdownText    = document.getElementById('custom-dropdown-text');
        this.customDropdownList    = document.getElementById('custom-dropdown-list');
        this.customDropdownChevron = document.getElementById('custom-dropdown-chevron');
        this.customDropdownOptions = document.getElementById('custom-dropdown-options');

        // Modal / Settings
        this.settingsOverlay  = document.getElementById('settings-overlay');
        this.sbUrlInput       = document.getElementById('sb-url-input');
        this.sbKeyInput       = document.getElementById('sb-key-input');
        this.dbStatusPill     = document.getElementById('db-status-pill');
        this.dbStatusText     = document.getElementById('db-status-text');

        this._buildDbIndicator();
        
        this._setupEvents();
        
        // Assign to window immediately so partial renders don't break event handlers
        window.monolithUI = this;
        
        this._loadLocalState();
        this._initSessionManager();
        this._tryAutoConnect();
        this.renderAll();
    }

    // Inject a live DB status pill next to the logo subtitle
    _buildDbIndicator() {
        return; // Disabled per user request to hide the status indicator pill
    }

    _setDbIndicator(connected) {
        const ind = document.getElementById('db-indicator');
        const txt = document.getElementById('db-ind-text');
        if (!ind || !txt) return;
        if (connected) {
            ind.classList.add('connected');
            txt.textContent = 'Supabase Live';
        } else {
            ind.classList.remove('connected');
            txt.textContent = 'Offline';
        }
    }

    _setModalStatus(online, text) {
        const baseClasses = "inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-mono tracking-widest uppercase border";
        if (online) {
            this.dbStatusPill.className = `${baseClasses} bg-emerald-500/10 border-emerald-500/25 text-emerald-400`;
            const dot = this.dbStatusPill.querySelector('span');
            if (dot) dot.className = "w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse";
        } else {
            this.dbStatusPill.className = `${baseClasses} bg-rose-500/10 border-rose-500/25 text-rose-400`;
            const dot = this.dbStatusPill.querySelector('span');
            if (dot) dot.className = "w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse";
        }
        this.dbStatusText.textContent = text;
        this._setDbIndicator(online);
    }

    // Auto-connect if creds are saved
    async _tryAutoConnect() {
        if (!this.db.url || !this.db.key) return;
        try {
            await this.db.connect();
            this._setModalStatus(true, 'Connected to Supabase');
            // Try to pull latest data for this workout
            const remote = await this.db.loadWorkout(this.state.workoutId);
            if (remote) {
                this.state.workoutName  = remote.workoutName;
                this.state.workoutNotes = remote.workoutNotes;
                this.state.gridData     = remote.gridData;
                this.syncInputsWithState();
                this.renderAll();
            }
        } catch(e) {
            this._setModalStatus(false, 'Not Connected');
        }
    }

    _setupEvents() {
        // Custom Dropdown Trigger Toggle
        if (this.customDropdownTrigger) {
            this.customDropdownTrigger.addEventListener('click', e => {
                e.stopPropagation();
                this.toggleCustomDropdown();
            });
        }

        // Close dropdown on outside click
        document.addEventListener('click', e => {
            if (this.customDropdownList && 
                !this.customDropdownList.contains(e.target) && 
                e.target !== this.customDropdownTrigger) {
                this.closeCustomDropdown();
            }
        });

        // Split selector
        this.splitSelector.addEventListener('change', e => {
            const v = e.target.value;
            this.state.activeSplit  = v;
            this.state.workoutName  = SPLIT_TEMPLATES[v].name;
            this.state.workoutNotes = SPLIT_TEMPLATES[v].notes;
            this.state.initDefaultGrid(v);
            this.syncInputsWithState();
            this._persist();
            this.renderAll();
        });

        // Workout fields
        [this.workoutNameInput, this.workoutNotesInput].forEach(el => {
            el.addEventListener('blur', () => {
                this.state.workoutName  = this.workoutNameInput.value;
                this.state.workoutNotes = this.workoutNotesInput.value;
                this._persist();
            });
            el.addEventListener('keydown', e => { if (e.key === 'Enter') el.blur(); });
        });

        // Seed / Reset
        document.getElementById('btn-seed').addEventListener('click', () => {
            this.state.seedDemoData();
            this.syncInputsWithState();
            this._persist();
            this.renderAll();
            this.toast('success', 'Demo data seeded!');
        });

        document.getElementById('btn-reset').addEventListener('click', () => {
            if(!confirm('Reset grid? All data will be lost.')) return;
            this.state.resetGrid();
            this.syncInputsWithState();
            this._persist();
            this.renderAll();
        });

        // Overload Vector Add
        this.btnAddVector.addEventListener('click', () => {
            const title = prompt('Enter vector title:');
            if (!title) return;
            const desc = prompt('Enter description (optional):') || '';
            const colors = ['var(--emerald)', 'var(--purple)', 'var(--gold)', 'var(--danger)'];
            const color = colors[Math.floor(Math.random() * colors.length)];
            this.state.overloadVectors.push({
                id: this.state._uuid(),
                title: `${this.state.overloadVectors.length + 1}. ${title}`,
                desc,
                checked: false,
                color
            });
            this._persist();
            this.renderOverloadVectors();
        });

        // RIR slider
        this.rirRange.addEventListener('input', e => {
            this.state.rirTarget = Number(e.target.value);
            this.renderRIRFeedback(this.state.rirTarget);
            this._saveLocal();
        });



        // Settings modal open/close
        document.getElementById('btn-settings').addEventListener('click', () => this._openModal());
        document.getElementById('btn-close-modal').addEventListener('click', () => this._closeModal());
        this.settingsOverlay.addEventListener('click', e => { if (e.target === this.settingsOverlay) this._closeModal(); });
        document.addEventListener('keydown', e => { if (e.key === 'Escape') this._closeModal(); });

        // Connect button
        document.getElementById('btn-save-connection').addEventListener('click', async () => {
            const url = this.sbUrlInput.value.trim();
            const key = this.sbKeyInput.value.trim();
            if (!url || !key) { this.toast('error', 'Please enter both URL and API key.'); return; }

            const btn = document.getElementById('btn-save-connection');
            btn.disabled = true;
            btn.textContent = 'Connecting…';

            try {
                this.db.saveCreds(url, key);
                await this.db.connect();
                this._setModalStatus(true, 'Connected — tables verified ✓');
                this.toast('success', 'Connected to Supabase!');
                this._persist(); // push current data up
            } catch(err) {
                this._setModalStatus(false, 'Connection failed: ' + err.message);
                this.toast('error', 'Failed: ' + err.message);
            } finally {
                btn.disabled = false;
                btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Connect &amp; Test`;
            }
        });

        // Disconnect
        document.getElementById('btn-disconnect').addEventListener('click', () => {
            this.db.clearCreds();
            this.sbUrlInput.value = '';
            this.sbKeyInput.value = '';
            this._setModalStatus(false, 'Disconnected');
            this.toast('success', 'Disconnected from Supabase.');
        });


        // Show/hide API key
        document.getElementById('btn-toggle-key').addEventListener('click', () => {
            const inp = this.sbKeyInput;
            const btn = document.getElementById('btn-toggle-key');
            inp.type = inp.type === 'password' ? 'text' : 'password';
            btn.textContent = inp.type === 'password' ? 'Show' : 'Hide';
        });
    }

    _openModal() {
        this.sbUrlInput.value = this.db.url;
        this.sbKeyInput.value = this.db.key;
        this._setModalStatus(this.db.connected, this.db.connected ? 'Connected to Supabase' : 'Not Connected');
        this.settingsOverlay.classList.add('open');
        this.settingsOverlay.removeAttribute('aria-hidden');
    }
    _closeModal() {
        this.settingsOverlay.classList.remove('open');
        this.settingsOverlay.setAttribute('aria-hidden', 'true');
    }

    // Persistence: localStorage + Supabase (debounced 1.5s)
    _saveLocal() {
        const payload = {
            workoutId: this.state.workoutId, workoutName: this.state.workoutName,
            workoutNotes: this.state.workoutNotes, activeSplit: this.state.activeSplit,
            gridData: this.state.gridData, rirTarget: this.state.rirTarget,
            overloadVectors: this.state.overloadVectors
        };
        localStorage.setItem('monolith_lift_state', JSON.stringify(payload));
        localStorage.setItem(`monolith_workout_${this.state.workoutId}`, JSON.stringify(payload));
        if (this.sessionsIndex) {
            this.sessionsIndex[this.state.workoutId] = this.state.workoutName;
            this._saveSessionIndex();
            this._renderSessionSelector();
        }
    }

    _persist() {
        this._saveLocal();
        clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(async () => {
            if (!this.db.connected) return;
            try {
                await this.db.saveWorkout(this.state);
            } catch(e) {
                this.toast('error', 'Supabase sync failed: ' + e.message);
            }
        }, 1500);
    }

    _loadLocalState() {
        const raw = localStorage.getItem('monolith_lift_state');
        if (!raw) { this.syncInputsWithState(); return; }
        try {
            const p = JSON.parse(raw);
            this.state.workoutId          = p.workoutId   || this.state.workoutId;
            this.state.workoutName        = p.workoutName || this.state.workoutName;
            this.state.workoutNotes       = p.workoutNotes|| this.state.workoutNotes;
            this.state.activeSplit        = p.activeSplit || 'push';
            
            if (p.gridData && typeof p.gridData === 'object') {
                this.state.gridData = p.gridData;
                Object.keys(this.state.gridData).forEach(k => {
                    if (!Array.isArray(this.state.gridData[k])) {
                        this.state.gridData[k] = [];
                    }
                });
            }
            this.state.rirTarget          = p.rirTarget   !== undefined ? p.rirTarget : 2;
            if (p.overloadVectors) {
                this.state.overloadVectors = p.overloadVectors;
            } else if (p.overloadChecklist) {
                this.state.overloadVectors[0].checked = p.overloadChecklist.load || false;
                this.state.overloadVectors[1].checked = p.overloadChecklist.reps || false;
                this.state.overloadVectors[2].checked = p.overloadChecklist.density || false;
            }
            this.syncInputsWithState();
        } catch { this.syncInputsWithState(); }
    }

    syncInputsWithState() {
        this.workoutNameInput.value   = this.state.workoutName;
        this.workoutNotesInput.value  = this.state.workoutNotes;
        this.splitSelector.value      = this.state.activeSplit;
        this.rirRange.value           = this.state.rirTarget;
        this.renderOverloadVectors();
        this.renderRIRFeedback(this.state.rirTarget);

        // Sync Custom Dropdown Text and Options list
        if (this.customDropdownText) {
            const activeTpl = SPLIT_TEMPLATES[this.state.activeSplit];
            this.customDropdownText.textContent = activeTpl ? activeTpl.name : 'Custom Matrix Delta';
        }
        this.renderCustomDropdown();
    }

    toggleCustomDropdown() {
        if (!this.customDropdownList) return;
        const isOpen = this.customDropdownList.classList.contains('scale-100');
        if (isOpen) {
            this.closeCustomDropdown();
        } else {
            this.openCustomDropdown();
        }
    }

    openCustomDropdown() {
        if (!this.customDropdownList) return;
        this.customDropdownList.classList.remove('scale-95', 'opacity-0', 'pointer-events-none');
        this.customDropdownList.classList.add('scale-100', 'opacity-100', 'pointer-events-auto');
        if (this.customDropdownChevron) {
            this.customDropdownChevron.classList.add('rotate-180');
        }
    }

    closeCustomDropdown() {
        if (!this.customDropdownList) return;
        this.customDropdownList.classList.remove('scale-100', 'opacity-100', 'pointer-events-auto');
        this.customDropdownList.classList.add('scale-95', 'opacity-0', 'pointer-events-none');
        if (this.customDropdownChevron) {
            this.customDropdownChevron.classList.remove('rotate-180');
        }
    }

    renderCustomDropdown() {
        if (!this.customDropdownOptions) return;
        this.customDropdownOptions.innerHTML = '';
        
        Object.entries(SPLIT_TEMPLATES).forEach(([key, tpl]) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            // Blurred grey glassy styling for each option button
            btn.className = `w-full text-left px-3.5 py-2.5 text-xs sm:text-sm font-bold rounded-lg text-slate-300 hover:text-white hover:bg-white/10 active:bg-white/15 transition-all duration-150 flex items-center justify-between group`;
            
            // Mark selected option
            const isSelected = this.state.activeSplit === key;
            if (isSelected) {
                btn.className = `w-full text-left px-3.5 py-2.5 text-xs sm:text-sm font-bold rounded-lg text-white bg-white/10 transition-all duration-150 flex items-center justify-between group`;
            }
            
            btn.innerHTML = `
                <span>${tpl.name}</span>
                ${isSelected ? `
                <svg class="w-4 h-4 text-neon-cyan filter drop-shadow-[0_0_4px_rgba(6,182,212,0.4)]" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd" />
                </svg>` : ''}
            `;
            
            btn.addEventListener('click', () => {
                this.state.activeSplit = key;
                this.state.workoutName = tpl.name;
                this.state.workoutNotes = tpl.notes;
                
                // Initialize default sets for standard splits
                this.state.initDefaultGrid(key);
                
                this.syncInputsWithState();
                this._persist();
                this.renderAll();
                this.closeCustomDropdown();
            });
            
            this.customDropdownOptions.appendChild(btn);
        });
    }

    renderAll() {
        try {
            const metrics = this.state.computeMetrics();
            this.renderMetricsCards(metrics);
            this.renderExerciseGrids();
            this.renderWeeklyVolume(metrics.muscleVolume);
        } catch (e) {
            console.error(e);
            this.gridsContainer.innerHTML = `<div style="text-align:center;padding:48px 20px;color:var(--danger);font-family:'Share Tech Mono',monospace;font-size:0.9rem;">Error rendering grid: ${e.message}<br><br><button class="btn btn-danger" onclick="localStorage.removeItem('monolith_lift_state'); location.reload();">Factory Reset Data</button></div>`;
        }
    }

    animateCounter(el, target) {
        const start = Number(el.innerText.replace(/,/g,'')) || 0;
        if (start === target) { el.innerText = target.toLocaleString(); return; }
        const dur = 500, t0 = performance.now();
        const step = now => {
            const p = Math.min((now - t0) / dur, 1);
            el.innerText = Math.floor(p * (target - start) + start).toLocaleString();
            if (p < 1) requestAnimationFrame(step);
            else el.innerText = target.toLocaleString();
        };
        requestAnimationFrame(step);
    }

    renderMetricsCards(m) {
        this.animateCounter(this.metricTonnage, m.totalTonnage);
        this.animateCounter(this.metricReps,    m.totalReps);
        this.animateCounter(this.metricLifts,   m.activeLiftsCount);
    }

    renderExerciseGrids() {
        this.gridsContainer.innerHTML = '';
        if (Object.keys(this.state.gridData).length === 0) {
            this.gridsContainer.innerHTML = `
                <div class="bg-[#0b2c48]/90 backdrop-blur-xl border border-slate-700/60 rounded-2xl p-12 text-center text-slate-400 font-mono text-xs tracking-wider shadow-lg shadow-black/30 relative">
                    <div class="absolute inset-[1px] rounded-[15px] pointer-events-none border border-white/5 z-0"></div>
                    No active movements defined. Define custom exercises or seed demo data.
                </div>`;
            return;
        }
        
        Object.entries(this.state.gridData).forEach(([exKey, sets]) => {
            const meta = EXERCISE_METADATA[exKey] || { name: exKey, primary: 'Custom', secondary: 'None' };
            const card = document.createElement('div');
            card.className = 'bg-[#0b2c48]/90 backdrop-blur-xl border border-slate-700/60 rounded-2xl p-5 sm:p-6 shadow-lg shadow-black/30 text-slate-100 relative group transition-all duration-300';
            card.id = `exercise-card-${exKey}`;

            // Inner bevel highlight overlay
            const bevelOverlay = document.createElement('div');
            bevelOverlay.className = 'absolute inset-[1px] rounded-[15px] pointer-events-none border border-white/5 z-0';
            card.appendChild(bevelOverlay);

            const header = document.createElement('div');
            header.className = 'flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-slate-800/80 pb-4 mb-4 gap-4 relative z-10';
            header.innerHTML = `
                <div>
                    <h3 class="text-base sm:text-lg font-black tracking-wide text-white">${meta.name}</h3>
                    <div class="font-mono text-[11px] sm:text-xs font-extrabold tracking-widest text-slate-300 uppercase mt-1">
                        Primary: <span class="text-neon-cyan font-bold">${meta.primary}</span>
                        ${meta.secondary && meta.secondary !== 'None' ? `&nbsp;·&nbsp; Secondary: <span class="text-neon-purple font-bold">${meta.secondary}</span>` : ''}
                    </div>
                </div>
                <button type="button" onclick="window.monolithUI.addSet('${exKey}')" class="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 bg-cyan-500/10 hover:bg-cyan-500/20 active:scale-95 border border-cyan-500/30 text-neon-cyan px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all duration-200">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="w-3.5 h-3.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    <span>Add Set</span>
                </button>`;
            card.appendChild(header);

            const body = document.createElement('div');
            body.className = 'overflow-x-auto relative z-10';
            if (sets.length === 0) {
                body.innerHTML = `<div class="text-center font-mono text-[11px] text-slate-400 py-6">No sets logged for this movement.</div>`;
            } else {
                const table = document.createElement('table');
                table.className = 'w-full text-left border-collapse min-w-[420px]';
                table.innerHTML = `
                    <thead>
                        <tr>
                            <th class="font-mono text-[11px] sm:text-xs tracking-widest text-slate-300 uppercase pb-3 px-2 font-extrabold text-center w-[60px]">Set</th>
                            <th class="font-mono text-[11px] sm:text-xs tracking-widest text-slate-300 uppercase pb-3 px-2 font-extrabold text-center w-[150px]">Weight (kg)</th>
                            <th class="font-mono text-[11px] sm:text-xs tracking-widest text-slate-300 uppercase pb-3 px-2 font-extrabold text-center w-[120px]">Reps</th>
                            <th class="font-mono text-[11px] sm:text-xs tracking-widest text-slate-300 uppercase pb-3 px-2 font-extrabold text-center w-[80px]">Done</th>
                            <th class="pb-3 px-2 text-right w-[44px]"></th>
                        </tr>
                    </thead>
                    <tbody></tbody>`;
                const tbody = table.querySelector('tbody');
                
                sets.forEach((set, idx) => {
                    const row = document.createElement('tr');
                    row.className = `transition-all duration-200 border-b border-slate-800/40 hover:bg-white/5 ${set.completed ? 'bg-emerald-950/20 border-b border-emerald-800/40 text-emerald-400' : ''}`;
                    row.id = `row-${exKey}-${idx}`;
                    
                    row.innerHTML = `
                        <td class="py-2.5 px-2 text-center font-mono text-xs font-bold ${set.completed ? 'text-emerald-400' : 'text-slate-400'}">${idx + 1}</td>
                        <td class="py-2.5 px-2">
                            <input type="number" id="input-weight-${exKey}-${idx}" 
                                class="bg-white border border-slate-200 text-slate-950 rounded-lg shadow-[inset_1px_1px_3px_rgba(0,0,0,0.05)] text-center p-2 text-xs sm:text-sm font-mono w-full transition-all focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/20 outline-none ${set.completed ? 'text-emerald-800 font-bold border-emerald-200 bg-emerald-50 shadow-none' : ''}" 
                                value="${set.weight}" placeholder="0"
                                onblur="window.monolithUI.commitCell('${exKey}',${idx},'weight',this.value)"
                                onkeydown="if(event.key==='Enter')this.blur()">
                        </td>
                        <td class="py-2.5 px-2">
                            <input type="number" id="input-reps-${exKey}-${idx}" 
                                class="bg-white border border-slate-200 text-slate-950 rounded-lg shadow-[inset_1px_1px_3px_rgba(0,0,0,0.05)] text-center p-2 text-xs sm:text-sm font-mono w-full transition-all focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/20 outline-none ${set.completed ? 'text-emerald-800 font-bold border-emerald-200 bg-emerald-50 shadow-none' : ''}" 
                                value="${set.reps}" placeholder="0"
                                onblur="window.monolithUI.commitCell('${exKey}',${idx},'reps',this.value)"
                                onkeydown="if(event.key==='Enter')this.blur()">
                        </td>
                        <td class="py-2.5 px-2 text-center">
                            <button type="button" 
                                class="w-8 h-8 rounded-full border border-slate-700 bg-slate-900 flex items-center justify-center text-slate-500 hover:text-emerald-400 hover:border-emerald-500 hover:bg-emerald-950/30 transition-all duration-200 mx-auto ${set.completed ? 'bg-gradient-to-br from-emerald-500 to-emerald-600 border-emerald-500 text-white shadow-[0_4px_12px_rgba(16,185,129,0.3)]' : ''}"
                                onclick="window.monolithUI.toggleComplete('${exKey}',${idx})">
                                <svg class="w-3.5 h-3.5" style="pointer-events: none;" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                            </button>
                        </td>
                        <td class="py-2.5 px-2 text-right">
                            <button type="button" class="w-8 h-8 rounded-lg border border-transparent hover:border-rose-900 hover:bg-rose-950/40 text-slate-500 hover:text-rose-400 flex items-center justify-center transition-all duration-200 ml-auto opacity-0 group-hover:opacity-100 focus:opacity-100" 
                                onclick="window.monolithUI.deleteSet('${exKey}',${idx})">
                                <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
                            </button>
                        </td>`;
                    tbody.appendChild(row);
                });
                body.appendChild(table);
            }
            card.appendChild(body);
            this.gridsContainer.appendChild(card);
        });
    }

    commitCell(exKey, idx, field, value) {
        const num = Number(value) || 0;
        if (num !== this.state.gridData[exKey][idx][field]) {
            this.state.gridData[exKey][idx][field] = num;
            this._persist();
            const m = this.state.computeMetrics();
            this.renderMetricsCards(m);
            this.renderWeeklyVolume(m.muscleVolume);
        }
    }

    toggleComplete(exKey, idx) {
        const checked = !this.state.gridData[exKey][idx].completed;
        console.log(`Toggled ${exKey} set ${idx+1} to ${checked}`);
        this.state.gridData[exKey][idx].completed = checked;
        this._persist();
        this.renderAll();
    }

    addSet(exKey) {
        const cur = this.state.gridData[exKey] || [];
        const newSet = cur.length > 0 ? { ...cur[cur.length - 1], completed: false } : { weight: 40, reps: 8, completed: false };
        this.state.gridData[exKey].push(newSet);
        this._persist();
        this.renderAll();
        setTimeout(() => {
            const inp = document.getElementById(`input-weight-${exKey}-${this.state.gridData[exKey].length - 1}`);
            if (inp) { inp.focus(); inp.select(); }
        }, 50);
    }

    deleteSet(exKey, idx) {
        this.state.gridData[exKey].splice(idx, 1);
        this._persist();
        this.renderAll();
    }

    renderWeeklyVolume(muscleVolume) {
        if (!this.weeklySetMatrix) return;
        this.weeklySetMatrix.innerHTML = '';
        Object.entries(muscleVolume).forEach(([muscle, count]) => {
            const pct = Math.min((count / MAX_HYPERTROPHY_SETS) * 100, 100);
            
            let fillClass = 'bg-slate-800/60';
            let labelClass = 'text-slate-400 bg-slate-950/40 border border-slate-800/80';
            let statusText = 'Resting';
            
            if (count > 0) {
                if (count < 5) {
                    fillClass = 'bg-gradient-to-r from-cyan-500 to-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.5)]';
                    labelClass = 'text-cyan-400 bg-cyan-950/30 border border-cyan-800/40';
                    statusText = 'Active';
                } else if (count >= 5 && count < 10) {
                    fillClass = 'bg-gradient-to-r from-emerald-500 to-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.5)]';
                    labelClass = 'text-emerald-400 bg-emerald-950/30 border border-emerald-800/40';
                    statusText = 'Stimulated';
                } else if (count >= 10 && count <= 20) {
                    fillClass = 'bg-gradient-to-r from-orange-500 to-orange-400 shadow-[0_0_10px_rgba(249,115,22,0.6)]';
                    labelClass = 'text-orange-400 bg-orange-950/30 border border-orange-800/40';
                    statusText = 'Pumped';
                } else {
                    fillClass = 'bg-gradient-to-r from-red-500 to-rose-600 shadow-[0_0_12px_rgba(239,68,68,0.7)] animate-pulse';
                    labelClass = 'text-red-400 bg-red-950/30 border border-red-800/40 font-black animate-pulse shadow-[0_0_12px_rgba(239,68,68,0.2)]';
                    statusText = 'Overloaded';
                }
            }

            const item = document.createElement('div');
            item.className = 'flex flex-col gap-1.5';
            item.innerHTML = `
                <div class="flex justify-between items-center text-xs">
                    <span class="font-mono text-[11px] font-bold text-slate-300 tracking-wider uppercase">${muscle}</span>
                    <span class="font-mono text-slate-400 text-[10px]">
                        <strong class="text-white font-extrabold">${count % 1 === 0 ? count : count.toFixed(1)}</strong> / ${MAX_HYPERTROPHY_SETS}
                        <span class="ml-2 text-[9px] font-mono font-bold tracking-widest uppercase py-0.5 px-2 rounded-md ${labelClass}">${statusText}</span>
                    </span>
                </div>
                <div class="h-2 bg-slate-950/60 rounded-full border border-slate-800/80 p-[1px] relative shadow-[inset_0_1px_3px_rgba(0,0,0,0.5)]">
                    <div class="h-full rounded-full transition-all duration-700 ease-out ${fillClass}" style="width:${pct}%"></div>
                </div>`;
            this.weeklySetMatrix.appendChild(item);
        });
    }


    renderRIRFeedback(val) {
        // Deep accent color mapping for superior contrast on light panels
        const colors = { 
            0: '#e11d48', // rose-600
            1: '#059669', // emerald-600
            2: '#059669', // emerald-600
            3: '#7c3aed', // purple-600
            4: '#475569', // slate-600
            5: '#475569'  // slate-600
        };
        const bgTints = {
            0: 'bg-rose-50 border-rose-200 text-rose-800',
            1: 'bg-emerald-50 border-emerald-200 text-emerald-800',
            2: 'bg-emerald-50 border-emerald-200 text-emerald-800',
            3: 'bg-purple-50 border-purple-200 text-purple-800',
            4: 'bg-slate-50 border-slate-200 text-slate-700',
            5: 'bg-slate-50 border-slate-200 text-slate-700'
        };
        const rule  = RIR_CALIBRATION[val] || RIR_CALIBRATION[5];
        const color = colors[val] ?? '#475569';
        const tintClass = bgTints[val] ?? 'bg-slate-50 border-slate-200 text-slate-700';

        this.rirValueLabel.innerText = rule.label;
        this.rirValueLabel.style.color = color;
        
        // Remove existing theme classes first to prevent overlaps, then add matching tint
        this.rirFeedbackPanel.className = `p-4 border-l-2 rounded-r-xl shadow-sm transition-all duration-300 relative z-10 ${tintClass}`;
        this.rirFeedbackPanel.style.borderColor = color;
        this.rirFeedbackPanel.innerHTML = `
            <div class="flex gap-3 text-xs leading-relaxed font-sans font-bold">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5 flex-shrink-0 mt-0.5"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11"/></svg>
                <span>${rule.desc}</span>
            </div>`;
    }

    renderOverloadVectors() {
        this.overloadListContainer.innerHTML = '';
        this.state.overloadVectors.forEach(v => {
            const lbl = document.createElement('label');
            lbl.className = `flex items-start gap-3.5 p-3.5 border rounded-xl cursor-pointer transition-all duration-200 relative group ${v.checked ? 'border-emerald-200 shadow-[0_2px_8px_rgba(16,185,129,0.05)] bg-emerald-50/70 text-slate-800' : 'bg-white border-slate-200 hover:bg-slate-200/50 text-slate-800'}`;
            
            let colorHex = v.color;
            if (v.color === 'var(--emerald)') colorHex = '#059669';
            else if (v.color === 'var(--purple)') colorHex = '#7c3aed';
            else if (v.color === 'var(--gold)') colorHex = '#d97706';
            else if (v.color === 'var(--danger)') colorHex = '#e11d48';
            
            lbl.innerHTML = `
                <input type="checkbox" class="hidden" ${v.checked ? 'checked' : ''} onchange="window.monolithUI.toggleVector('${v.id}', this.checked)">
                <div class="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5 transition-all duration-200 ${v.checked ? 'bg-gradient-to-br from-emerald-500 to-emerald-600 border border-emerald-500 text-white shadow-[0_2px_6px_rgba(16,185,129,0.2)]' : 'bg-white border border-slate-300 text-transparent hover:border-cyan-500/40'}">
                    <svg class="w-3.5 h-3.5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
                <div class="flex-grow select-none">
                    <strong class="block text-xs font-bold leading-tight" style="color: ${colorHex}">${v.title}</strong>
                    <span class="font-sans text-[11px] text-slate-700 mt-1 block leading-normal font-extrabold">${v.desc}</span>
                </div>
                <button type="button" class="w-6 h-6 rounded-lg border border-transparent hover:border-rose-300 hover:bg-rose-50 text-slate-400 hover:text-rose-600 flex items-center justify-center transition-all duration-200 ml-auto opacity-0 group-hover:opacity-100 focus:opacity-100" title="Delete Vector" onclick="event.preventDefault(); window.monolithUI.deleteVector('${v.id}')">
                    <svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            `;
            this.overloadListContainer.appendChild(lbl);
        });
    }
 
    toggleVector(id, checked) {
        const v = this.state.overloadVectors.find(x => x.id === id);
        if (v) {
            v.checked = checked;
            this._persist();
            this.renderOverloadVectors();
        }
    }

    deleteVector(id) {
        if (!confirm('Delete this overload vector?')) return;
        this.state.overloadVectors = this.state.overloadVectors.filter(x => x.id !== id);
        this._persist();
        this.renderOverloadVectors();
    }

    _initSessionManager() {
        this.sessionSelector = document.getElementById('session-selector');
        this.btnAddSession = document.getElementById('btn-add-session');
        this.btnDeleteSession = document.getElementById('btn-delete-session');

        if (!this.sessionSelector) return;

        let idsRaw = localStorage.getItem('monolith_session_list');
        let indexRaw = localStorage.getItem('monolith_sessions_index');

        this.sessionList = idsRaw ? JSON.parse(idsRaw) : [];
        this.sessionsIndex = indexRaw ? JSON.parse(indexRaw) : {};

        if (!this.sessionList.includes(this.state.workoutId)) {
            this.sessionList.push(this.state.workoutId);
        }
        this.sessionsIndex[this.state.workoutId] = this.state.workoutName || 'Lifting Session';

        this._saveSessionIndex();
        this._renderSessionSelector();

        this.sessionSelector.addEventListener('change', e => this.switchSession(e.target.value));
        this.btnAddSession.addEventListener('click', () => this.addSession());
        this.btnDeleteSession.addEventListener('click', () => this.deleteSession(this.state.workoutId));
    }

    _saveSessionIndex() {
        localStorage.setItem('monolith_session_list', JSON.stringify(this.sessionList));
        localStorage.setItem('monolith_sessions_index', JSON.stringify(this.sessionsIndex));
    }

    _renderSessionSelector() {
        if (!this.sessionSelector) return;
        this.sessionSelector.innerHTML = '';
        this.sessionList.forEach(id => {
            const opt = document.createElement('option');
            opt.value = id;
            opt.textContent = this.sessionsIndex[id] || 'Lifting Session';
            if (id === this.state.workoutId) opt.selected = true;
            this.sessionSelector.appendChild(opt);
        });
    }

    async addSession() {
        this._saveLocal();
        this.sessionsIndex[this.state.workoutId] = this.state.workoutName;
        this._saveSessionIndex();

        const newId = this.state._uuid();

        const activeTpl = SPLIT_TEMPLATES[this.state.activeSplit] || SPLIT_TEMPLATES.push;
        const newName = `Session ${this.sessionList.length + 1} (${activeTpl.name})`;
        
        const newPayload = {
            workoutId: newId, workoutName: newName, workoutNotes: activeTpl.notes,
            activeSplit: this.state.activeSplit, gridData: {}, rirTarget: 2,
            overloadVectors: [
                { id: this.state._uuid(), title: '1. Load (Absolute Intensity)', desc: 'Add 2.5–5 kg (5–10 lbs) to your working barbell sets.', checked: false, color: 'var(--emerald)' },
                { id: this.state._uuid(), title: '2. Reps (Relative Intensity)', desc: 'Hit the top of your range (e.g. 12 reps instead of 10).', checked: false, color: 'var(--purple)' },
                { id: this.state._uuid(), title: '3. Density (Recovery Pace)', desc: 'Same sets/reps/weight, but cut rest time by 15 seconds.', checked: false, color: 'var(--gold)' }
            ]
        };

        activeTpl.exercises.forEach(k => {
            newPayload.gridData[k] = [
                { weight: 60, reps: 10, completed: false },
                { weight: 60, reps: 8,  completed: false },
                { weight: 65, reps: 8,  completed: false }
            ];
        });

        localStorage.setItem(`monolith_workout_${newId}`, JSON.stringify(newPayload));
        localStorage.setItem('monolith_lift_state', JSON.stringify(newPayload));

        this.state.workoutId = newId; this.state.workoutName = newName;
        this.state.workoutNotes = newPayload.workoutNotes; this.state.activeSplit = newPayload.activeSplit;
        this.state.gridData = newPayload.gridData; this.state.rirTarget = newPayload.rirTarget;
        this.state.overloadVectors = newPayload.overloadVectors;

        this.sessionList.push(newId);
        this.sessionsIndex[newId] = newName;
        this._saveSessionIndex();

        this.syncInputsWithState();
        this._persist();
        this.renderAll();
        this._renderSessionSelector();
        this.toast('success', `Created session "${newName}"!`);
    }

    async switchSession(targetId) {
        if (!targetId || targetId === this.state.workoutId) return;
        this._saveLocal();
        this.sessionsIndex[this.state.workoutId] = this.state.workoutName;
        this._saveSessionIndex();

        const raw = localStorage.getItem(`monolith_workout_${targetId}`);
        if (!raw) return;

        try {
            const p = JSON.parse(raw);
            this.state.workoutId = targetId;
            this.state.workoutName = p.workoutName;
            this.state.workoutNotes = p.workoutNotes;
            this.state.activeSplit = p.activeSplit;
            this.state.gridData = p.gridData;
            this.state.rirTarget = p.rirTarget;
            this.state.overloadVectors = p.overloadVectors;

            this._saveLocal();
            this.syncInputsWithState();
            this.renderAll();
            this._renderSessionSelector();

            if (this.db.connected) {
                const remote = await this.db.loadWorkout(targetId);
                if (remote) {
                    this.state.workoutName = remote.workoutName;
                    this.state.workoutNotes = remote.workoutNotes;
                    this.state.gridData = remote.gridData;
                    this.syncInputsWithState();
                    this.renderAll();
                } else {
                    await this.db.saveWorkout(this.state);
                }
            }
            this.toast('success', `Switched to "${this.state.workoutName}"`);
        } catch(e) { this.toast('error', 'Switch failed: ' + e.message); }
    }

    async deleteSession(targetId) {
        if (this.sessionList.length <= 1) {
            this.toast('error', 'Cannot delete the last remaining active session.');
            return;
        }
        const name = this.sessionsIndex[targetId];
        if (!confirm(`Delete session "${name}"?`)) return;

        try {
            if (this.db.connected) await this.db.deleteWorkout(targetId);

            this.sessionList = this.sessionList.filter(id => id !== targetId);
            delete this.sessionsIndex[targetId];
            this._saveSessionIndex();
            localStorage.removeItem(`monolith_workout_${targetId}`);

            const nextActiveId = this.sessionList[0];
            const raw = localStorage.getItem(`monolith_workout_${nextActiveId}`);
            if (raw) {
                const p = JSON.parse(raw);
                this.state.workoutId = nextActiveId;
                this.state.workoutName = p.workoutName;
                this.state.workoutNotes = p.workoutNotes;
                this.state.activeSplit = p.activeSplit;
                this.state.gridData = p.gridData;
                this.state.rirTarget = p.rirTarget;
                this.state.overloadVectors = p.overloadVectors;

                this._saveLocal();
                this.syncInputsWithState();
                this.renderAll();
            }
            this._renderSessionSelector();
            this.toast('success', `Deleted session "${name}"`);
        } catch(e) { this.toast('error', 'Delete failed: ' + e.message); }
    }

    toast(type, text) {
        const el = document.createElement('div');
        el.className = `toast ${type}`;
        const icon = type === 'success'
            ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`
            : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
        el.innerHTML = `${icon}<span>${text}</span>`;
        document.body.appendChild(el);
        requestAnimationFrame(() => el.classList.add('show'));
        setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 400); }, 3500);
    }
}


// ── 5. Bootstrap (Auth-Gated) ───────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    // ── Auth Guard: Check for active Supabase session ──────────────────
    const sbUrl = localStorage.getItem('sb_url') || SUPABASE_URL;
    const sbKey = localStorage.getItem('sb_key') || SUPABASE_ANON_KEY;

    if (typeof supabase !== 'undefined') {
        try {
            const client = supabase.createClient(sbUrl, sbKey);
            const { data: { session } } = await client.auth.getSession();

            if (!session) {
                // No active session → redirect to login
                window.location.href = 'login.html';
                return;
            }

            // Store the auth client globally for logout use
            window._novaAuthClient = client;

        } catch (e) {
            // Auth check failed → redirect to login as a safety measure
            console.warn('Auth check failed:', e.message);
            window.location.href = 'login.html';
            return;
        }
    } else {
        // Supabase SDK not loaded → redirect to login
        window.location.href = 'login.html';
        return;
    }

    // ── Initialize App ─────────────────────────────────────────────────
    try {
        const state = new MonolithState();
        const db    = new SupabaseLayer();
        // window.monolithUI is now assigned inside the MonolithUI constructor
        new MonolithUI(state, db);

        // Remove the anti-flash style block to reveal the fully rendered page
        const antiFlash = document.getElementById('anti-flash-style');
        if (antiFlash) antiFlash.remove();
    } catch (e) {
        // Ensure the page becomes visible so error messages can be read if initialization fails
        const antiFlash = document.getElementById('anti-flash-style');
        if (antiFlash) antiFlash.remove();
        alert('Critical Initialization Error: ' + e.message);
    }

    // ── Logout Handler ─────────────────────────────────────────────────
    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
        btnLogout.addEventListener('click', async () => {
            const confirmed = confirm('Sign out of NOVA // PRIME?');
            if (!confirmed) return;

            try {
                if (window._novaAuthClient) {
                    await window._novaAuthClient.auth.signOut();
                }
            } catch (e) {
                console.warn('Sign out error:', e.message);
            }

            // Redirect to login page
            window.location.href = 'login.html';
        });
    }
});
