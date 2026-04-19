document.addEventListener('DOMContentLoaded', () => {
    // --- PWA Registration ---
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js')
                .then(reg => console.log('[PWA] Service Worker registered'))
                .catch(err => console.log('[PWA] Registration failed', err));
        });
    }

    // --- Configuration & API ---
    const SUPABASE_URL = 'https://tlrrehfcbwdllmiovhuk.supabase.co';
    const SUPABASE_KEY = 'sb_publishable_LTqDJeafR38vHytBgxp01g_xTUnQFzX'; 
    const supabase = (typeof window.supabase !== 'undefined') ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;

    // State & Storage
    let diveLogs = JSON.parse(localStorage.getItem('diveLogs')) || [];
    let gearInventory = JSON.parse(localStorage.getItem('gearInventory')) || [];
    let buddyInventory = JSON.parse(localStorage.getItem('buddyInventory')) || [];
    let diverProfile = JSON.parse(localStorage.getItem('diverProfile')) || { name: 'Diver 01', cert: 'Advanced Open Water', association: 'PADI', insurance: '', photo: '', certPhoto: '', specialCerts: [] };
    let appSettings = JSON.parse(localStorage.getItem('appSettings')) || { activeModules: ['mindful', 'species', 'geo', 'gear', 'buddy', 'planning', 'system'], fieldVisibility: {} };
    let customFields = JSON.parse(localStorage.getItem('customFields')) || [];
    let selectedDiveId = null;
    let map = null;
    let marker = null;

    // Core Logic: Cloud Sync & Auth
    let currentUser = null;

    async function initSupabaseAuth() {
        if (!supabase) return;

        // Check current session
        const { data: { session } } = await supabase.auth.getSession();
        updateAuthState(session?.user || null);

        // Listen for changes
        supabase.auth.onAuthStateChange((_event, session) => {
            updateAuthState(session?.user || null);
        });

        // Auth Buttons
        const btnLogin = document.getElementById('btn-login');
        const btnLogout = document.getElementById('btn-logout');

        if (btnLogin) btnLogin.onclick = () => loginWithEmail();
        if (btnLogout) btnLogout.onclick = () => supabase.auth.signOut();
    }

    function updateAuthState(user) {
        currentUser = user;
        const authSection = document.getElementById('auth-section');
        const btnLogin = document.getElementById('btn-login');
        const userDisplay = document.getElementById('user-display');
        const userEmail = document.getElementById('user-email');
        const syncStatus = document.getElementById('sync-status');

        if (user) {
            btnLogin.style.display = 'none';
            userDisplay.style.display = 'block';
            userEmail.innerText = user.email;
            
            const statusText = '☁️ Synchronisiert';
            syncStatus.innerText = statusText;
            syncStatus.style.color = 'var(--clr-accent)';
            
            const syncMobile = document.getElementById('sync-status-mobile');
            if (syncMobile) {
                syncMobile.innerText = statusText;
                syncMobile.style.color = 'var(--clr-accent)';
            }
            // Start background sync
            syncCloudToLocal();
        } else {
            btnLogin.style.display = 'block';
            userDisplay.style.display = 'none';
            
            const statusText = '☁️ Offline-Modus';
            syncStatus.innerText = statusText;
            syncStatus.style.color = 'var(--clr-text-muted)';
            
            const syncMobile = document.getElementById('sync-status-mobile');
            if (syncMobile) {
                syncMobile.innerText = statusText;
                syncMobile.style.color = 'var(--clr-text-muted)';
            }
        }
    }

    async function loginWithEmail() {
        const email = prompt('E-Mail:');
        if (!email) return;
        const password = prompt('Passwort:');
        if (!password) return;

        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
            if (error.message.includes('Invalid login credentials')) {
                // Attempt signup for testing
                if (confirm('Account nicht gefunden. Neu registrieren?')) {
                    const { error: signUpError } = await supabase.auth.signUp({ email, password });
                    if (signUpError) alert(signUpError.message);
                    else alert('Bestätigungs-Mail gesendet!');
                }
            } else {
                alert(error.message);
            }
        }
    }

    async function syncCloudToLocal() {
        if (!currentUser || !supabase) return;
        console.log('[Sync] Lade Daten aus der Cloud...');

        // Parallel fetch for all modules
        const [divesRes, gearRes, buddiesRes, profileRes] = await Promise.all([
            supabase.from('dives').select('*').order('date', { ascending: false }),
            supabase.from('gear').select('*'),
            supabase.from('buddies').select('*'),
            supabase.from('profiles').select('*').single()
        ]);

        if (divesRes.data && divesRes.data.length > 0) {
            diveLogs = divesRes.data.map(d => ({
                id: d.id, date: d.date, location: d.location, depth: d.depth,
                duration: d.duration, temp: d.temp, lat: d.lat, lng: d.lng, 
                gas: d.gas, pressureStart: d.pressure_start, pressureEnd: d.pressure_end,
                mood: d.mood, stressPre: d.stress_pre, stressPost: d.stress_post,
                flow: d.flow, visibility: d.visibility, hasCurrent: d.has_current,
                species: d.species, customData: d.custom_data
            }));
            saveAppData('diveLogs', diveLogs, false);
            renderDiveList();
        }

        if (gearRes.data) {
            gearInventory = gearRes.data;
            saveAppData('gearInventory', gearInventory, false);
            renderGearList();
        }

        if (profileRes.data) {
            diverProfile = { 
                ...diverProfile, 
                ...profileRes.data,
                photo: profileRes.data.photo,
                certPhoto: profileRes.data.cert_photo,
                specialCerts: profileRes.data.special_certs 
            };
            saveAppData('diverProfile', diverProfile, false);
            syncProfileToUI();
        }
    }

    async function saveAppData(key, data, syncToCloud = true) {
        localStorage.setItem(key, JSON.stringify(data));
        
        if (syncToCloud && currentUser && supabase && navigator.onLine) {
            try {
                // Mapping Local Key to Supabase Action
                if (key === 'diveLogs') {
                    // MVP Sync: Push only the newest one or all?
                    // For now, push the first item (usually the newest)
                    const log = data[0]; 
                    if (log) {
                        const { error } = await supabase.from('dives').insert({
                            user_id: currentUser.id,
                            date: log.date,
                            location: log.location,
                            depth: log.depth,
                            duration: log.duration,
                            temp: log.temp,
                            lat: log.lat,
                            lng: log.lng,
                            gas: log.gas,
                            pressure_start: log.pressureStart,
                            pressure_end: log.pressureEnd,
                            mood: log.mood,
                            stress_pre: log.stressPre,
                            stress_post: log.stressPost,
                            flow: log.flow,
                            visibility: log.visibility,
                            has_current: log.hasCurrent,
                            species: log.species || [],
                            custom_data: log.customData || {}
                        });
                        console.log('[Sync] Dive saved to cloud', error || 'Success');
                    }
                } else if (key === 'diverProfile') {
                    const { error } = await supabase.from('profiles').upsert({
                        user_id: currentUser.id,
                        name: data.name,
                        cert: data.cert,
                        association: data.association,
                        insurance: data.insurance,
                        photo: data.photo,
                        cert_photo: data.certPhoto,
                        special_certs: data.specialCerts || []
                    });
                     console.log('[Sync] Profile saved to cloud', error || 'Success');
                }
            } catch (err) { console.warn('[Sync] Sync Error:', err); }
        }
    }

    async function initialLoadSync() {
        console.log('[Storage] Initializing data...');
        initSupabaseAuth();
        syncProfileToUI();
    }

    function syncProfileToUI() {
        if (document.getElementById('prof-name')) {
            document.getElementById('prof-name').value = diverProfile.name || '';
            document.getElementById('prof-cert').value = diverProfile.cert || '';
            document.getElementById('prof-association').value = diverProfile.association || '';
            document.getElementById('prof-insurance').value = diverProfile.insurance || '';
            
            document.getElementById('sidebar-user-name').innerText = diverProfile.name || 'Diver';
            document.getElementById('sidebar-user-title').innerText = diverProfile.cert || '';

            if (diverProfile.photo) {
                document.getElementById('sidebar-avatar').style.backgroundImage = `url(${diverProfile.photo})`;
                document.getElementById('profile-preview').style.backgroundImage = `url(${diverProfile.photo})`;
            }
            if (diverProfile.certPhoto) {
                document.getElementById('cert-photo-preview').style.backgroundImage = `url(${diverProfile.certPhoto})`;
            }
            renderSpecialCerts();
        }
    }

    // --- Profile Management ---
    const profileUpload = document.getElementById('profile-upload');
    if (profileUpload) {
        profileUpload.onchange = (e) => {
            const file = e.target.files[0];
            const reader = new FileReader();
            reader.onload = (ev) => {
                diverProfile.photo = ev.target.result;
                syncProfileToUI();
                saveAppData('diverProfile', diverProfile);
            }
            reader.readAsDataURL(file);
        };
    }

    const certUpload = document.getElementById('cert-upload');
    if (certUpload) {
        certUpload.onchange = (e) => {
            const file = e.target.files[0];
            const reader = new FileReader();
            reader.onload = (ev) => {
                diverProfile.certPhoto = ev.target.result;
                syncProfileToUI();
                saveAppData('diverProfile', diverProfile);
            }
            reader.readAsDataURL(file);
        };
    }

    window.addSpecialCert = function() {
        const input = document.getElementById('new-special-cert');
        const val = input.value.trim();
        if (val) {
            if (!diverProfile.specialCerts) diverProfile.specialCerts = [];
            diverProfile.specialCerts.push(val);
            input.value = '';
            renderSpecialCerts();
            saveAppData('diverProfile', diverProfile);
        }
    }

    window.removeSpecialCert = function(index) {
        diverProfile.specialCerts.splice(index, 1);
        renderSpecialCerts();
        saveAppData('diverProfile', diverProfile);
    }

    function renderSpecialCerts() {
        const list = document.getElementById('special-certs-list');
        if (!list) return;
        list.innerHTML = '';
        (diverProfile.specialCerts || []).forEach((cert, idx) => {
            const div = document.createElement('div');
            div.className = 'special-cert-item';
            div.innerHTML = `<span>📜 ${cert}</span> <span class="remove-btn" onclick="removeSpecialCert(${idx})">&times;</span>`;
            list.appendChild(div);
        });
    }

    const profileForm = document.getElementById('profile-form');
    if (profileForm) {
        profileForm.onsubmit = (e) => {
            e.preventDefault();
            diverProfile.name = document.getElementById('prof-name').value;
            diverProfile.cert = document.getElementById('prof-cert').value;
            diverProfile.association = document.getElementById('prof-association').value;
            diverProfile.insurance = document.getElementById('prof-insurance').value;
            saveAppData('diverProfile', diverProfile);
            syncProfileToUI();
            alert('Profil erfolgreich gespeichert!');
        };
    }

    // --- Module Navigation ---
    const navLinks = document.querySelectorAll('.nav-links li');
    const sections = document.querySelectorAll('.module-section');

    function updateNavigation() {
        navLinks.forEach(link => {
            const mod = link.getAttribute('data-target').replace('module-', '');
            // Profile, Core, and System are always active
            if (mod === 'core' || mod === 'system' || mod === 'profile') {
                link.style.display = 'flex';
            } else {
                link.style.display = appSettings.activeModules.includes(mod) ? 'flex' : 'none';
            }
        });
    }

    navLinks.forEach(link => {
        link.addEventListener('click', () => {
            const target = link.getAttribute('data-target');
            navLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');
            sections.forEach(s => s.classList.remove('active'));
            document.getElementById(target).classList.add('active');
            
            if (target === 'module-geo') {
                initMap();
                if (map) {
                    setTimeout(() => {
                        map.invalidateSize();
                        // Re-center if a dive is selected
                        if (selectedDiveId) {
                            const currentLog = diveLogs.find(l => l.id === selectedDiveId);
                            if (currentLog) updateMap(currentLog.lat, currentLog.lng, currentLog.location);
                        }
                    }, 400);
                }
            }
            if (target === 'module-buddy') initSignaturePad();
        });
    });

    // --- System & Settings ---
    const moduleToggles = document.querySelectorAll('#module-toggles input[data-mod]');
    moduleToggles.forEach(chk => {
        const mod = chk.getAttribute('data-mod');
        chk.checked = appSettings.activeModules.includes(mod);
        chk.onchange = () => {
            if (chk.checked) appSettings.activeModules.push(mod);
            else appSettings.activeModules = appSettings.activeModules.filter(m => m !== mod);
            saveAppData('appSettings', appSettings);
            updateNavigation();
        };
    });

    // --- Custom Fields Logic ---
    window.addNewCustomField = function () {
        const nameInput = document.getElementById('new-custom-field-name');
        const sizeSelect = document.getElementById('new-custom-field-size');
        const name = nameInput.value.trim();
        const size = sizeSelect.value;
        if (name) {
            customFields.push({ id: Date.now(), name, size, active: true });
            nameInput.value = '';
            saveAndRefreshFields();
        }
    }

    window.toggleCustomField = function (id) {
        const field = customFields.find(f => f.id === id);
        if (field) {
            field.active = !field.active;
            saveAndRefreshFields();
        }
    }

    window.deleteCustomField = function (id) {
        if (confirm('Dieses Feld endgültig löschen?')) {
            customFields = customFields.filter(f => f.id !== id);
            saveAndRefreshFields();
        }
    }

    function saveAndRefreshFields() {
        saveAppData('customFields', customFields);
        renderCustomFieldManagement();
    }

    function renderCustomFieldManagement() {
        const mgmtList = document.getElementById('custom-fields-management');
        if (!mgmtList) return;
        mgmtList.innerHTML = '';
        customFields.forEach(field => {
            const div = document.createElement('div');
            div.className = 'field-mgmt-item';
            div.innerHTML = `
                <span>${field.name} (${field.size === 'form-field-full' ? 'Ganz' : 'Halb'})</span>
                <div class="field-mgmt-actions">
                    <button class="btn-primary form-control-sm" onclick="toggleCustomField(${field.id})">${field.active ? 'Deaktivieren' : 'Aktivieren'}</button>
                    <button class="btn-primary form-control-sm" style="border-color: var(--clr-warning); color: var(--clr-warning);" onclick="deleteCustomField(${field.id})">Löschen</button>
                </div>
            `;
            mgmtList.appendChild(div);
        });
    }

    function renderFieldToggles() {
        const container = document.getElementById('log-field-toggles');
        if (!container) return;
        const standardFields = [
            { id: 'date', name: '📅 Datum' },
            { id: 'location', name: '📍 Ort' },
            { id: 'geo', name: '🗺️ Geo-Position' },
            { id: 'stats', name: '📏 Tiefe/Zeit' },
            { id: 'gas', name: '💨 Gasmix' },
            { id: 'pressure', name: '💿 Druck/Verbrauch' },
            { id: 'equipment', name: '🤿 Ausrüstung' },
            { id: 'visibility', name: '🌫️ Sicht/Bedingung' }
        ];

        container.innerHTML = standardFields.map(f => `
            <label class="custom-checkbox">
                <input type="checkbox" data-field="${f.id}" ${appSettings.fieldVisibility[f.id] !== false ? 'checked' : ''}>
                <span class="checkmark"></span>${f.name}
            </label>
        `).join('');

        container.querySelectorAll('input').forEach(input => {
            input.onchange = (e) => {
                appSettings.fieldVisibility[e.target.dataset.field] = e.target.checked;
                saveAppData('appSettings', appSettings);
                applyFieldVisibility();
            };
        });
    }

    function applyFieldVisibility() {
        document.querySelectorAll('.log-field-group').forEach(group => {
            const fieldId = group.dataset.field;
            if (appSettings.fieldVisibility[fieldId] === false) {
                group.style.display = 'none';
            } else {
                group.style.display = (group.tagName === 'H3' ? 'block' : 'flex');
            }
        });
    }

    // --- Dive Logging ---
    window.openNewLogModal = function() {
        document.getElementById('log-modal').classList.add('active');
        renderCustomFieldsInForm();
        applyFieldVisibility();
    }

    function renderCustomFieldsInForm() {
        const container = document.getElementById('custom-fields-container');
        if (!container) return;
        container.innerHTML = '';
        customFields.filter(f => f.active).forEach(field => {
            const div = document.createElement('div');
            div.className = `form-group ${field.size}`;
            div.innerHTML = `<label>${field.name}</label><input type="text" class="form-control custom-input" data-id="${field.id}">`;
            container.appendChild(div);
        });
    }

    const logForm = document.getElementById('basic-log-form');
    if (logForm) {
        logForm.onsubmit = (e) => {
            e.preventDefault();
            const newLog = {
                id: Date.now(),
                date: document.getElementById('log-date').value,
                location: document.getElementById('log-location').value,
                depth: parseFloat(document.getElementById('log-depth').value),
                duration: parseInt(document.getElementById('log-duration').value),
                temp: parseFloat(document.getElementById('log-temp').value),
                lat: parseFloat(document.getElementById('log-lat').value || 0),
                lng: parseFloat(document.getElementById('log-lng').value || 0),
                gas: document.getElementById('log-gas').value,
                pressureStart: parseInt(document.getElementById('log-pressure-start').value),
                pressureEnd: parseInt(document.getElementById('log-pressure-end').value),
                mood: document.querySelector('input[name="log-mood"]:checked').value,
                stressPre: parseInt(document.getElementById('log-stress-pre').value),
                stressPost: parseInt(document.getElementById('log-stress-post').value),
                flow: parseInt(document.getElementById('log-flow').value),
                visibility: document.querySelector('input[name="log-visibility"]:checked').value,
                hasCurrent: document.getElementById('log-current').checked,
                customData: {}
            };
            
            document.querySelectorAll('.custom-input').forEach(input => {
                newLog.customData[input.dataset.id] = input.value;
            });

            diveLogs.unshift(newLog);
            saveAppData('diveLogs', diveLogs);
            renderDiveList();
            updateDashboard();
            document.getElementById('log-modal').classList.remove('active');
            logForm.reset();
        };
    }

    function renderDiveList() {
        const container = document.getElementById('dive-list-sidebar');
        if (!container) return;
        
        container.innerHTML = '';
        
        if (diveLogs.length === 0) {
            container.innerHTML = '<p style="font-size:0.8rem; color:var(--clr-text-muted); text-align:center;">Keine Tauchgänge gefunden.</p>';
            return;
        }

        diveLogs.sort((a, b) => new Date(b.date) - new Date(a.date)).forEach(log => {
            const item = document.createElement('div');
            item.className = `sidebar-dive-item ${selectedDiveId === log.id ? 'selected' : ''}`;
            
            const dateStr = new Date(log.date).toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' });
            
            item.innerHTML = `
                <div class="date">${dateStr}</div>
                <div class="loc">${log.location}</div>
                <div style="font-size: 0.7rem; margin-top: 4px; opacity: 0.8;">
                    ${log.depth}m | ${log.duration}min | ${getMoodEmoji(log.mood)}
                </div>
            `;
            
            item.onclick = () => selectDive(log.id);
            container.appendChild(item);
        });
    }

    const btnAddSidebar = document.getElementById('btn-add-dive-sidebar');
    if (btnAddSidebar) {
        btnAddSidebar.onclick = () => {
            selectedDiveId = null;
            document.getElementById('log-modal').classList.add('active');
            document.getElementById('basic-log-form').reset();
            switchModule('module-core');
            renderDiveList();
        };
    }

    function selectDive(id) {
        selectedDiveId = id;
        renderDiveList(); // Refresh list to show highlight

        const log = diveLogs.find(l => l.id === id);
        document.getElementById('active-dive-banner').style.display = 'block';
        document.getElementById('selected-dive-name').innerText = log.location;

        // Highlight Sidebar Modules that depend on a selected dive
        const diveModules = ['mindful', 'species', 'geo', 'buddy'];
        document.querySelectorAll('.nav-links li').forEach(link => {
            const mod = link.dataset.target.replace('module-', '');
            if (diveModules.includes(mod)) {
                link.classList.add('active-dive-highlight');
            } else {
                link.classList.remove('active-dive-highlight');
            }
        });
        
        // Update Mindful Module
        document.getElementById('mindful-no-selection').style.display = 'none';
        document.getElementById('mindful-content').style.display = 'block';
        document.getElementById('mind-dive-title').innerText = log.location;
        document.getElementById('mind-mood-display').innerText = getMoodEmoji(log.mood);
        document.getElementById('mind-val-stress-pre').innerText = log.stressPre;
        document.getElementById('mind-val-stress-post').innerText = log.stressPost;
        document.getElementById('mind-val-flow').innerText = log.flow;

        // Calculate Zen Score (0-100)
        // High Flow (10) + Low Post-Stress (1) = High Zen
        // Formula: ((Flow / 10) * 50) + (((11 - StressPost) / 10) * 50)
        const flowPart = (log.flow / 10) * 50;
        const stressPart = ((11 - log.stressPost) / 10) * 50;
        const zenScore = Math.round(flowPart + stressPart);
        
        updateZenMeter(zenScore);
        updateFlowBar(log.stressPre, log.stressPost, log.flow);

        const effect = log.stressPre - log.stressPost;
        let summary = "";
        if (effect > 3) summary = "Dieser Dive hat dich massiv entspannt. Ein echtes Zen-Erlebnis!";
        else if (effect > 0) summary = "Gute Entspannung. Der Wasserdruck hat den Stress weggespült.";
        else summary = "Ein fokussierter Dive. Dein Geist war wach und präsent.";
        
        document.getElementById('mind-summary-text').innerText = summary;

        // Update Pokedex Section
        document.getElementById('pokedex-no-selection').style.display = 'none';
        document.getElementById('pokedex-content').style.display = 'block';
        renderSpeciesList(log);

        // Update Geo Section
        document.getElementById('geo-no-selection').style.display = 'none';
        document.getElementById('geo-content').style.display = 'block';
        document.getElementById('geo-coords-display').innerText = `${log.lat.toFixed(4)}, ${log.lng.toFixed(4)}`;
        updateMap(log.lat, log.lng, log.location);
    }

    function getMoodEmoji(val) {
        const m = { '1': '😫', '2': '😕', '3': '😊', '4': '🤩', '5': '🧘' };
        return m[val] || '😊';
    }

    function updateDashboard() {
        const flowPreEl = document.getElementById('stat-avg-flow-pre');
        const flowPostEl = document.getElementById('stat-avg-flow-post');
        const flowIndexEl = document.getElementById('stat-avg-flow-index');

        if (diveLogs.length > 0) {
            document.querySelectorAll('.stat-card .value')[0].innerText = diveLogs.length;
            const maxD = Math.max(...diveLogs.map(l => l.depth));
            document.querySelectorAll('.stat-card .value')[1].innerText = `${maxD}m`;

            const avgPre = (diveLogs.reduce((a, b) => a + (parseInt(b.stressPre) || 0), 0) / diveLogs.length).toFixed(1);
            const avgPost = (diveLogs.reduce((a, b) => a + (parseInt(b.stressPost) || 0), 0) / diveLogs.length).toFixed(1);
            const avgFlow = (diveLogs.reduce((a, b) => a + (parseInt(b.flow) || 0), 0) / diveLogs.length).toFixed(1);

            if (flowPreEl) flowPreEl.innerText = avgPre;
            if (flowPostEl) {
                flowPostEl.innerText = avgPost;
                renderSymbolicDots('stat-sym-relaxation', 11 - avgPost);
            }
            if (flowIndexEl) {
                flowIndexEl.innerText = avgFlow;
                renderSymbolicDots('stat-sym-flow', avgFlow);
            }
        }
    }

    function updateZenMeter(score) {
        const circle = document.getElementById('zen-circle');
        const label = document.getElementById('zen-score-label');
        const icon = document.getElementById('zen-icon');
        if (!circle) return;

        const radius = 90;
        const circumference = 2 * Math.PI * radius;
        const offset = circumference - (score / 100) * circumference;
        
        circle.style.strokeDashoffset = offset;
        label.innerText = `Zen Score: ${score}%`;

        if (score > 85) icon.innerText = '🧘';
        else if (score > 65) icon.innerText = '💎';
        else if (score > 45) icon.innerText = '🌊';
        else icon.innerText = '🐚';
    }

    function updateFlowBar(stressPre, stressPost, flow) {
        const bar = document.getElementById('flow-bar-fill');
        if (!bar) return;
        
        // Flow state is maximized when stress is low and flow is high
        const intensity = ((flow / 10) * 70) + (((11 - stressPost) / 10) * 30);
        bar.style.width = `${intensity}%`;
    }

    function renderSymbolicDots(containerId, value) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '';
        const maxDots = 10;
        const activeDots = Math.round(value);
        for (let i = 1; i <= maxDots; i++) {
            const dot = document.createElement('div');
            dot.className = `dot ${i > activeDots ? 'off' : ''}`;
            container.appendChild(dot);
        }
    }

    // --- Geo & Maps ---
    function initMap() {
        if (map) return;
        const mapEl = document.getElementById('map-detail');
        if (!mapEl) return;
        
        // Center on last dive or global
        const lastDive = diveLogs[0];
        const centerPos = (lastDive && lastDive.lat) ? [lastDive.lat, lastDive.lng] : [27.257, 33.812];
        
        map = L.map('map-detail').setView(centerPos, (lastDive ? 8 : 2));
        // Using openstreetmap.de for German labels
        L.tileLayer('https://{s}.tile.openstreetmap.de/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap-Mitwirkende'
        }).addTo(map);

        renderAllDivePins();
    }

    function updateMap(lat, lng, label) {
        initMap();
        if (!map) return;
        
        map.setView([lat, lng], 13);
        if (marker) {
            marker.setLatLng([lat, lng]).setPopupContent(label).openPopup();
        } else {
            marker = L.marker([lat, lng]).addTo(map).bindPopup(label).openPopup();
        }
        
        // Ensure map resizes correctly
        setTimeout(() => map.invalidateSize(), 400);
    }

    function renderAllDivePins() {
        if (!map) return;
        diveLogs.forEach(log => {
            if (log.lat && log.lng) {
                L.marker([log.lat, log.lng])
                 .addTo(map)
                 .bindPopup(`<strong>${log.location}</strong><br>${log.depth}m / ${log.duration}min`)
                 .on('click', () => {
                     selectDive(log.id);
                 });
            }
        });
    }

    window.getCurrentPosition = function() {
        const btn = document.querySelector('button[onclick="getCurrentPosition()"]');
        if (!btn) return;
        const originalText = btn.innerText;
        btn.innerText = '🌀 Ortung...';
        btn.disabled = true;

        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    document.getElementById('log-lat').value = pos.coords.latitude.toFixed(6);
                    document.getElementById('log-lng').value = pos.coords.longitude.toFixed(6);
                    btn.innerText = '✅ OK';
                    btn.disabled = false;
                    setTimeout(() => btn.innerText = originalText, 2000);
                },
                (err) => {
                    alert('Standortfehler: ' + err.message);
                    btn.innerText = originalText;
                    btn.disabled = false;
                },
                { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
            );
        } else {
            alert('Browser unterstützt kein GPS.');
            btn.innerText = originalText;
            btn.disabled = false;
        }
    };

    window.mockSpotLookup = function() {
        const spotInfo = document.getElementById('spot-info');
        if (!spotInfo) return;
        
        const log = diveLogs.find(l => l.id === selectedDiveId);
        const locationName = log ? log.location : 'Unbekannter Spot';
        
        spotInfo.style.display = 'block';
        spotInfo.innerHTML = `
            <h4 style="color: var(--clr-accent); margin-bottom: 12px; font-size: 1.1rem;">📍 Spot-Details: ${locationName}</h4>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; font-size: 0.85rem;">
                <div class="glass-panel" style="padding: 12px; border: 1px solid var(--clr-accent-dim); background: rgba(100,255,218,0.05);">
                    <strong style="color: var(--clr-accent);">💡 Highlights:</strong><br>
                    Schildkröten, Fledermausfische, Weichkorallen-Gärten.
                </div>
                <div class="glass-panel" style="padding: 12px; border: 1px solid var(--clr-warning); background: rgba(255,127,80,0.05);">
                    <strong style="color: var(--clr-warning);">⚠️ Gefahr:</strong><br>
                    Starke Strömung am Außenriff möglich.
                </div>
            </div>
            <p style="font-size: 0.8rem; color: var(--clr-text-muted); margin-top: 12px; font-style: italic; line-height: 1.4;">
                "Einer der besten Plätze für Makro-Fotografie und Sichtweiten bis zu 30m. Perfekt für den frühen Morgen."
            </p>
        `;
    };

    // --- AI Pokedex ---
    const pokedexFile = document.getElementById('pokedex-file');
    const pokedexUpload = document.getElementById('pokedex-upload-container');
    if (pokedexUpload) pokedexUpload.onclick = () => pokedexFile.click();

    async function resizeImage(file, max_width = 1000) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const scale = (img.width > max_width) ? max_width / img.width : 1;
                    canvas.width = img.width * scale;
                    canvas.height = img.height * scale;
                    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                    resolve(canvas.toDataURL('image/jpeg', 0.8));
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        });
    }

    if (pokedexFile) {
        pokedexFile.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const resDiv = document.getElementById('pokedex-result');
            resDiv.style.display = 'block';
            resDiv.innerHTML = '<p style="color: var(--clr-accent);">🌀 KI-Analyse läuft...</p>';
            try {
                const b64 = await resizeImage(file);
                const resp = await fetch('/api/scan', { method: 'POST', body: JSON.stringify({ image: b64 }), headers: { 'Content-Type': 'application/json' } });
                const data = await resp.json();
                renderPokedexResult(data, resDiv);
            } catch (err) { resDiv.innerHTML = `<p style="color: var(--clr-warning);">⚠️ Fehler: ${err.message}</p>`; }
        };
    }

    let activeIdentifyContext = [];

    window.mockPokedexSearch = async function() {
        const queryInput = document.getElementById('pokedex-search');
        const query = queryInput.value.trim();
        if (!query) return;
        
        activeIdentifyContext = [{ role: 'user', content: query }];
        queryInput.value = ''; // Clear input for next step
        
        const resDiv = document.getElementById('pokedex-result');
        resDiv.style.display = 'block';
        resDiv.innerHTML = '<p style="color: var(--clr-accent);">🌀 Marine-Biologe analysiert deine Beschreibung...</p>';
        
        performIdentifyStep();
    }

    async function performIdentifyStep() {
        const resDiv = document.getElementById('pokedex-result');
        try {
            // We use the /api/scan endpoint as a general purpose AI for marine biology
            const prompt = `Du bist ein Experte für Meeresbiologie. 
            Identifiziere das Lebewesen basierend auf dieser Beschreibung: "${activeIdentifyContext[activeIdentifyContext.length-1].content}".
            Bisheriger Verlauf: ${JSON.stringify(activeIdentifyContext)}
            
            WICHTIG: 
            1. Wenn du dir NICHT 100% sicher bist, stelle 2-3 gezielte Ja/Nein Fragen oder biete Merkmale zur Auswahl an.
            2. Nenne bis zu 3 mögliche Spezies (Name in Deutsch und Latein).
            3. Gib deine Antwort als JSON zurück: { 
                "identified": boolean, 
                "name": "Deutscher Name (Lateinischer Name)", 
                "questions": ["Frage 1?", "Frage 2?"], 
                "suggestions": [{"name": "Spezies A", "reason": "..."}, {"name": "Spezies B", "reason": "..."}],
                "message": "Deine Nachricht an den Taucher (in Deutsch)" 
            }`;

            const resp = await fetch('/api/scan', { 
                method: 'POST', 
                body: JSON.stringify({ query: prompt }), 
                headers: { 'Content-Type': 'application/json' } 
            });
            const data = await resp.json();
            renderIdentifyDialogue(data);
        } catch (err) { 
            resDiv.innerHTML = `<p style="color: var(--clr-warning);">⚠️ Fehler bei der Identifizierung: ${err.message}</p>`; 
        }
    }

    function renderIdentifyDialogue(data) {
        const resDiv = document.getElementById('pokedex-result');
        resDiv.innerHTML = '';
        
        const container = document.createElement('div');
        container.className = 'identify-dialogue';
        
        // Message from AI
        const msg = document.createElement('div');
        msg.className = 'identify-msg ai';
        msg.innerText = data.message || "Ich brauche noch ein paar Details...";
        container.appendChild(msg);

        if (!data.identified && data.questions && data.questions.length > 0) {
            // Render Questions as buttons
            const qBox = document.createElement('div');
            qBox.className = 'identify-questions';
            data.questions.forEach(q => {
                const btn = document.createElement('button');
                btn.className = 'identify-btn';
                btn.innerText = q;
                btn.onclick = () => {
                    activeIdentifyContext.push({ role: 'assistant', content: data.message });
                    activeIdentifyContext.push({ role: 'user', content: `Meine Antwort auf "${q}": Ja / Zutreffend.` });
                    resDiv.innerHTML = '<p style="color: var(--clr-accent);">🌀 Analysiere Details...</p>';
                    performIdentifyStep();
                };
                qBox.appendChild(btn);
            });
            container.appendChild(qBox);
        }

        // Suggestions with Images
        if (data.suggestions && data.suggestions.length > 0) {
            const sTitle = document.createElement('h5');
            sTitle.style.marginTop = '24px';
            sTitle.style.marginBottom = '12px';
            sTitle.innerText = data.identified ? "Identifizierte Spezies:" : "Mögliche Kandidaten:";
            container.appendChild(sTitle);

            const grid = document.createElement('div');
            grid.className = 'suggestion-grid';
            data.suggestions.forEach(s => {
                const card = document.createElement('div');
                card.className = `suggestion-card ${data.identified && s.name.includes(data.name) ? 'active' : ''}`;
                
                const imgUrl = `https://loremflickr.com/400/300/underwater,${encodeURIComponent(s.name.split('(')[0].trim())}`;
                card.innerHTML = `
                    <img src="${imgUrl}" alt="${s.name}" onerror="this.src='https://images.unsplash.com/photo-1544551763-46a013bb70d5?q=80&w=200&auto=format&fit=crop'">
                    <div class="suggestion-name">${s.name}</div>
                `;
                
                card.onclick = () => {
                    finalizeIdentification(s.name);
                };
                grid.appendChild(card);
            });
            container.appendChild(grid);
        }

        // Response Input Field
        if (!data.identified) {
            const inputGroup = document.createElement('div');
            inputGroup.style.marginTop = '24px';
            inputGroup.style.display = 'flex';
            inputGroup.style.gap = '10px';
            
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'form-control';
            input.placeholder = 'Deine Antwort oder weitere Details...';
            input.style.flex = '1';
            
            const sendBtn = document.createElement('button');
            sendBtn.className = 'btn-primary';
            sendBtn.innerText = 'Senden';
            sendBtn.style.padding = '8px 20px';
            
            const submitResponse = () => {
                const val = input.value.trim();
                if (val) {
                    activeIdentifyContext.push({ role: 'assistant', content: data.message });
                    activeIdentifyContext.push({ role: 'user', content: val });
                    resDiv.innerHTML = '<p style="color: var(--clr-accent);">🌀 Analysiere deine Antwort...</p>';
                    performIdentifyStep();
                }
            };

            sendBtn.onclick = submitResponse;
            input.onkeypress = (e) => { if(e.key === 'Enter') submitResponse(); };
            
            inputGroup.appendChild(input);
            inputGroup.appendChild(sendBtn);
            container.appendChild(inputGroup);
        }

        resDiv.appendChild(container);
    }

    async function finalizeIdentification(speciesName) {
        const resDiv = document.getElementById('pokedex-result');
        resDiv.innerHTML = '<p style="color: var(--clr-accent);">✅ Identifiziert! Lade Bilder und deutsche Details...</p>';
        
        const pureName = speciesName.split('(')[0].trim();
        const data = { name: speciesName, description: '', advice: '', images: [] };
        
        try {
            // Fetch German Details from AI
            const aiPrompt = `Beschreibe das Meereslebewesen "${speciesName}" ausführlich auf DEUTSCH. 
            Gib zusätzlich einen kurzen Tipp/Hinweis für Taucher.
            Antworte als JSON: { "description": "...", "advice": "..." }`;
            
            const aiResp = await fetch('/api/scan', { 
                method: 'POST', 
                body: JSON.stringify({ query: aiPrompt }),
                headers: { 'Content-Type': 'application/json' }
            });
            const aiData = await aiResp.json();
            
            // Try Wikipedia for official description
            const wikiResp = await fetch(`https://de.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pureName)}`);
            const wikiData = await wikiResp.json();
            
            data.description = wikiData.extract || aiData.description || "Keine Beschreibung verfügbar.";
            data.advice = aiData.advice || "Keine besonderen Hinweise.";
            if (wikiData.content_urls) data.wikiUrl = wikiData.content_urls.desktop.page;
            
            // Prepare multiple images from internet
            // Using different search terms or just different random seeds to simulate "results"
            data.images = [
                `https://loremflickr.com/800/600/underwater,${encodeURIComponent(pureName)}?lock=1`,
                `https://loremflickr.com/800/600/underwater,${encodeURIComponent(pureName)}?lock=2`,
                `https://loremflickr.com/800/600/underwater,${encodeURIComponent(pureName)}?lock=3`,
                `https://loremflickr.com/800/600/ocean,${encodeURIComponent(pureName)}?lock=4`,
                `https://loremflickr.com/800/600/sea,${encodeURIComponent(pureName)}?lock=5`,
                `https://loremflickr.com/800/600/fish,${encodeURIComponent(pureName)}?lock=6`
            ];
            data.selectedImage = data.images[0]; // Default selection
            
        } catch (err) {
            data.description = "Details konnten nicht geladen werden.";
            data.advice = "Keine Hinweise verfügbar.";
        }

        renderPokedexResult(data, resDiv);
    }

    async function renderPokedexResult(data, container) {
        const fallbackImg = `https://images.unsplash.com/photo-1544551763-46a013bb70d5?q=80&w=600&auto=format&fit=crop`;

        container.innerHTML = `
            <div class="pokedex-final-result" style="animation: fadeIn 0.6s ease;">
                <div class="result-image-container" id="main-image-display" style="position: relative; border-radius: 16px; overflow: hidden; margin-bottom: 24px; border: 1px solid var(--clr-accent-dim); height: 300px;">
                    <img src="${data.selectedImage}" style="width: 100%; height: 100%; object-fit: cover;" alt="${data.name}" onerror="this.src='${fallbackImg}'">
                    <div style="position: absolute; bottom: 0; left: 0; right: 0; background: linear-gradient(transparent, rgba(10,25,47,0.9)); padding: 20px;">
                        <h3 style="color: var(--clr-accent); font-size: 1.8rem; text-shadow: 0 2px 10px rgba(0,0,0,0.5);">${data.name}</h3>
                    </div>
                </div>

                <div style="margin-bottom: 32px;">
                    <h5 style="color: var(--clr-text-main); margin-bottom: 12px;">📸 Wähle das beste Foto aus dem Internet:</h5>
                    <div class="pokedex-gallery">
                        ${data.images.map((img, idx) => `
                            <div class="gallery-item ${img === data.selectedImage ? 'selected' : ''}" onclick="window.selectPokedexImage('${img}', this)">
                                <img src="${img}" onerror="this.src='${fallbackImg}'">
                            </div>
                        `).join('')}
                    </div>
                </div>

                <div class="result-details" style="padding: 0 10px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                        <h4 style="color: var(--clr-text-main); font-size: 1.1rem;">📝 Beschreibung (Wikipedia)</h4>
                        ${data.wikiUrl ? `<a href="${data.wikiUrl}" target="_blank" class="identify-btn" style="text-decoration: none;">🌐 Wikipedia</a>` : ''}
                    </div>
                    <p style="line-height: 1.6; color: var(--clr-text-muted); font-size: 0.95rem; margin-bottom: 24px;">${data.description}</p>
                    
                    <div style="background: rgba(100, 255, 218, 0.05); padding: 20px; border-radius: 12px; border: 1px solid var(--clr-accent-dim);">
                        <strong style="color: var(--clr-accent); display: block; margin-bottom: 8px;">💡 Hinweise für Taucher:</strong>
                        <p style="font-size: 0.9rem; font-style: italic;">${data.advice}</p>
                    </div>

                    <button class="btn-primary" style="width: 100%; margin-top: 24px; padding: 14px;" id="btn-save-species">
                        ✅ Gewähltes Foto & Infos im Logbuch speichern
                    </button>
                </div>
            </div>
        `;

        // Global function to handle image selection
        window.selectPokedexImage = (url, el) => {
            data.selectedImage = url;
            // Update UI
            document.querySelectorAll('.gallery-item').forEach(item => item.classList.remove('selected'));
            el.classList.add('selected');
            const mainImg = document.querySelector('#main-image-display img');
            if (mainImg) mainImg.src = url;
        };

        document.getElementById('btn-save-species').onclick = () => saveSpeciesToDive(data);
    }

    function saveSpeciesToDive(data) {
        const log = diveLogs.find(l => l.id === selectedDiveId);
        if (log) {
            if (!log.species) log.species = [];
            log.species.push(data);
            saveAppData('diveLogs', diveLogs);
            renderSpeciesList(log);
            alert(`${data.name} wurde zum Tauchgang gespeichert!`);
        }
    }

    function renderSpeciesList(log) {
        const listDiv = document.getElementById('pokedex-saved-species');
        if (!listDiv) return;
        listDiv.innerHTML = '<h4>Gesehene Tiere:</h4>';
        if (!log.species || log.species.length === 0) {
            listDiv.innerHTML += '<p style="font-size: 0.8rem; color: var(--clr-text-muted);">Noch keine Tiere gespeichert.</p>';
            return;
        }
        
        const galleryGrid = document.createElement('div');
        galleryGrid.style.display = 'grid';
        galleryGrid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(100px, 1fr))';
        galleryGrid.style.gap = '12px';
        galleryGrid.style.marginTop = '12px';
        
        log.species.forEach(s => {
            const item = document.createElement('div');
            item.style.textAlign = 'center';
            item.innerHTML = `
                <div style="width: 100%; aspect-ratio: 1; border-radius: 8px; overflow: hidden; border: 1px solid var(--clr-accent-dim); margin-bottom: 4px;">
                    <img src="${s.selectedImage}" style="width: 100%; height: 100%; object-fit: cover;">
                </div>
                <div style="font-size: 0.7rem; font-weight: 600; color: var(--clr-accent); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${s.name}</div>
            `;
            galleryGrid.appendChild(item);
        });
        listDiv.appendChild(galleryGrid);
    }

    // --- Gear & Buddies ---
    function renderGearList() {
        const grid = document.getElementById('gear-inventory-grid');
        if (!grid) return;
        grid.innerHTML = '';
        gearInventory.forEach(item => {
            const card = document.createElement('div');
            card.className = 'gear-card glass-panel';
            card.innerHTML = `<h4>${item.name}</h4><p style="font-size: 0.8rem;">${item.type}</p>`;
            grid.appendChild(card);
        });
    }

    function renderBuddyList() {
        const list = document.getElementById('buddy-list-grid');
        if (!list) return;
        list.innerHTML = '';
        buddyInventory.forEach(b => {
            const div = document.createElement('div');
            div.innerHTML = `🧑‍🤝‍🧑 <strong>${b.name}</strong> (${b.cert})`;
            list.appendChild(div);
        });
    }

    // --- Dive Planning Logic ---
    function initPlanningModule() {
        // MOD Calculator
        const btnMOD = document.getElementById('btn-calc-mod');
        if (btnMOD) {
            btnMOD.onclick = () => {
                const o2 = parseFloat(document.getElementById('plan-o2').value);
                const po2 = parseFloat(document.getElementById('plan-po2').value);
                const mod = ((po2 / (o2 / 100)) - 1) * 10;
                const res = document.getElementById('plan-result');
                res.style.display = 'block';
                res.innerHTML = `MOD: <span style="font-size: 1.5rem;">${mod.toFixed(1)}m</span>`;
            };
        }

        // SAC / Gas Calculator
        const btnGas = document.getElementById('btn-calc-gas');
        if (btnGas) {
            btnGas.onclick = () => {
                const depth = parseFloat(document.getElementById('plan-sac-depth').value);
                const time = parseFloat(document.getElementById('plan-sac-time').value);
                
                // Try to calculate user's real SAC from logs
                const userSAC = calculateUserSAC();
                const usedSAC = userSAC || 20; // Default 20 L/min
                
                const avgPressure = (depth / 10) + 1;
                const totalLitres = usedSAC * time * avgPressure;
                const bar12L = (totalLitres / 12).toFixed(0);
                
                const res = document.getElementById('sac-result');
                res.style.display = 'block';
                res.innerHTML = `Bedarf: <span style="font-size: 1.5rem;">${totalLitres.toFixed(0)} L</span> (~${bar12L} bar / 12L)`;
                
                const info = document.getElementById('sac-info-text');
                info.innerText = userSAC 
                    ? `📉 Basierend auf deinen letzten Dives (SAC: ${userSAC.toFixed(1)} L/min)` 
                    : `ℹ️ Standardwert (20 L/min) verwendet. Logge mehr Dives für genauere Werte.`;
            };
        }

        // Ballast Calculator
        const btnWeight = document.getElementById('btn-calc-weight');
        if (btnWeight) {
            btnWeight.onclick = () => {
                const suit = parseInt(document.getElementById('plan-suit').value);
                const water = document.getElementById('plan-water').value;
                
                let weight = 4; // Base for average person
                weight += (suit === 10) ? 6 : (suit === 7 ? 4 : (suit === 5 ? 2 : 0));
                if (water === 'salt') weight += 2;
                
                const res = document.getElementById('weight-result');
                res.style.display = 'block';
                res.innerHTML = `Vorschlag: <span style="font-size: 1.5rem;">~${weight} kg</span>`;
            };
        }

        // NDL Calculator (Simplified Table)
        const btnNDL = document.getElementById('btn-calc-ndl');
        if (btnNDL) {
            btnNDL.onclick = () => {
                const depth = parseFloat(document.getElementById('plan-ndl-depth').value);
                const ndlTable = { 10: 219, 12: 147, 15: 92, 18: 56, 21: 45, 25: 29, 30: 20, 35: 14, 40: 9 };
                
                // Simple interpolation
                let ndl = 0;
                const keys = Object.keys(ndlTable).map(Number).sort((a,b) => a-b);
                if (depth <= keys[0]) ndl = ndlTable[keys[0]];
                else if (depth >= keys[keys.length-1]) ndl = ndlTable[keys[keys.length-1]];
                else {
                    for(let i=0; i<keys.length-1; i++) {
                        if (depth >= keys[i] && depth <= keys[i+1]) {
                            ndl = ndlTable[keys[i+1]]; // Conservative approach
                            break;
                        }
                    }
                }

                const res = document.getElementById('ndl-result');
                res.style.display = 'block';
                res.innerHTML = `Nullzeit: <span style="font-size: 1.5rem;">${ndl} min</span>`;
            };
        }
    }

    function calculateUserSAC() {
        if (diveLogs.length === 0) return null;
        
        const validLogs = diveLogs.filter(l => l.pressureStart && l.pressureEnd && l.duration && l.depth);
        if (validLogs.length === 0) return null;
        
        let totalSAC = 0;
        validLogs.forEach(l => {
            const tankSize = 12; // Standard fallback
            const gasUsed = (l.pressureStart - l.pressureEnd) * tankSize;
            const avgPressure = ( (l.depth * 0.6) / 10) + 1; // Simplified avg depth = 60% of max
            const sac = (gasUsed / l.duration) / avgPressure;
            totalSAC += sac;
        });
        
        return totalSAC / validLogs.length;
    }

    // --- Signature ---
    let isDrawing = false;
    let sigCtx = null;
    function initSignaturePad() {
        const canvas = document.getElementById('signature-pad');
        if (!canvas) return;
        sigCtx = canvas.getContext('2d');
        canvas.width = canvas.offsetWidth;
        canvas.height = canvas.offsetHeight;
        sigCtx.strokeStyle = '#0a192f';
        sigCtx.lineWidth = 3;
        canvas.onmousedown = (e) => { isDrawing = true; sigCtx.beginPath(); sigCtx.moveTo(e.offsetX, e.offsetY); };
        canvas.onmousemove = (e) => { if (isDrawing) { sigCtx.lineTo(e.offsetX, e.offsetY); sigCtx.stroke(); } };
        canvas.onmouseup = () => isDrawing = false;
        
        // Touch support
        canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            const touch = e.touches[0];
            const rect = canvas.getBoundingClientRect();
            isDrawing = true; sigCtx.beginPath();
            sigCtx.moveTo(touch.clientX - rect.left, touch.clientY - rect.top);
        }, { passive: false });
        
        canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            if (!isDrawing) return;
            const touch = e.touches[0];
            const rect = canvas.getBoundingClientRect();
            sigCtx.lineTo(touch.clientX - rect.left, touch.clientY - rect.top);
            sigCtx.stroke();
        }, { passive: false });
        
        canvas.addEventListener('touchend', () => isDrawing = false);
    }

    window.saveSignature = () => { alert('Signiert! ✅'); clearSignature(); };
    window.clearSignature = () => { if (sigCtx) sigCtx.clearRect(0,0,999,999); };

    // --- Initialization ---
    async function startApp() {
        if (diveLogs.length === 0) {
            console.log('[Init] Erstelle Test-Daten...');
            diveLogs = [
                { id: 1, location: 'Blue Hole, Dahab', date: '2024-03-20T10:00', depth: 28.5, duration: 45, temp: 24, mood: '5', stressPre: 6, stressPost: 1, flow: 9, visibility: 'crystal', hasCurrent: false, lat: 28.5107, lng: 34.5369, pressureStart: 200, pressureEnd: 60 },
                { id: 2, location: 'Ras Mohammed, Shark Reef', date: '2024-03-21T09:30', depth: 32.2, duration: 48, temp: 23, mood: '4', stressPre: 4, stressPost: 2, flow: 8, visibility: 'good', hasCurrent: true, lat: 27.7344, lng: 34.2542, pressureStart: 210, pressureEnd: 50 },
                { id: 3, location: 'SS Thistlegorm', date: '2024-03-22T14:15', depth: 26.0, duration: 40, temp: 22, mood: '5', stressPre: 5, stressPost: 2, flow: 10, visibility: 'ok', hasCurrent: true, lat: 27.8143, lng: 33.9218, pressureStart: 190, pressureEnd: 70 }
            ];
            saveAppData('diveLogs', diveLogs);
        }

        updateNavigation();
        initialLoadSync();
        renderFieldToggles();
        renderCustomFieldManagement();
        renderDiveList();
        renderGearList();
        renderBuddyList();
        initPlanningModule();
        updateDashboard();
    }
    
    startApp();
});
