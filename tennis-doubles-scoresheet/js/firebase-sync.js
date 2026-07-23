/**
 * FirebaseSync - Cloud synchronization layer for Tennis Doubles Scoresheet
 * 
 * Integrates with Firebase Firestore for real-time data synchronization.
 * All methods gracefully handle Firebase unavailability — the app continues
 * to function using localStorage only when Firebase is not configured or
 * the network is offline.
 * 
 * Firestore path structure:
 *   events/{eventId}/matches/{matchId}        - Completed match records
 *   events/{eventId}/members/{memberId}       - Individual member documents
 *   events/{eventId}/appData/activeMatch      - Active match state for sharing
 *   appConfig/events                          - Shared events list across devices
 * 
 * Requirements: 19.1, 19.2, 19.3, 19.4, 19.6, 19.7
 */

class FirebaseSync {
    constructor(app) {
        this.app = app;
        this.db = null;
        this.isOnline = false;
        this._activeWriteTimer = null;
        this._pendingActiveState = null;

        this._initFirebase();
    }

    // ─── Firebase Initialization ──────────────────────────────────────────────

    /**
     * Initialize Firebase with placeholder config.
     * Users should replace the config values with their own Firebase project credentials.
     * If Firebase SDK is not loaded or config is not set, the app runs in localStorage-only mode.
     */
    _initFirebase() {
        // Firebase project configuration
        const firebaseConfig = {
            apiKey: "AIzaSyAiHYFcERToHbXoRyxqKhrZOvnKlMq5-gE",
            authDomain: "tennis-doubles-scoresheet.firebaseapp.com",
            projectId: "tennis-doubles-scoresheet",
            storageBucket: "tennis-doubles-scoresheet.firebasestorage.app",
            messagingSenderId: "996533289928",
            appId: "1:996533289928:web:5bf390ac2788963512f6fd"
        };

        try {
            // Only initialize if Firebase SDK is available
            if (typeof firebase !== 'undefined' && firebaseConfig.apiKey) {
                console.log('[FirebaseSync] 🟢 Firebase SDK detected, initializing...');
                if (!firebase.apps.length) {
                    firebase.initializeApp(firebaseConfig);
                }
                this.db = firebase.firestore();
                this.isOnline = true;
                console.log('[FirebaseSync] 🟢 Firestore connected. Project:', firebaseConfig.projectId);
                this._updateSyncStatus(true);
                this._startConnectivityMonitor();
                // Load data from Firebase on init
                this._loadFromFirebase();
            } else {
                console.warn('[FirebaseSync] 🔴 Firebase SDK not loaded or config missing. Running offline only.');
                this._updateSyncStatus(false);
            }
        } catch (e) {
            console.warn('[FirebaseSync] Init failed:', e);
            this._updateSyncStatus(false);
        }
    }

    // ─── Load Data from Firebase (sync down on startup) ───────────────────────

    /**
     * On startup, download events, members and match history from Firebase
     * and merge into localStorage so other sessions see shared data.
     */
    async _loadFromFirebase() {
        if (!this.db) { console.warn('[FirebaseSync] 🔴 _loadFromFirebase: no db'); return; }

        try {
            // 1. First sync events list so all devices share the same event IDs
            console.log('[FirebaseSync] 📥 Syncing with Firebase...');
            await this._syncEventsFromFirebase();

            const eventId = this._getEventId();
            if (!eventId) { console.warn('[FirebaseSync] 🔴 No active event ID found'); return; }
            console.log('[FirebaseSync] 📋 Active event ID:', eventId);

            // ═══════════════════════════════════════════════════════════════
            // OPTION 1: Upload local additions first, then Firebase = source of truth
            // ═══════════════════════════════════════════════════════════════

            // STEP A: Upload any local members that Firebase doesn't have yet
            console.log('[FirebaseSync] 📤 Uploading local additions to Firebase...');
            const localMembers = this.app?.memberManager?.getMembers() || [];
            const membersSnapshot = await this.db.collection('events').doc(eventId)
                .collection('members').get();
            const firebaseIds = new Set(membersSnapshot.docs.map(doc => doc.id));
            
            let uploadedMembers = 0;
            for (const lm of localMembers) {
                if (!firebaseIds.has(lm.id)) {
                    await this.db.collection('events').doc(eventId)
                        .collection('members').doc(lm.id).set({
                            ...lm,
                            lastModified: Date.now()
                        });
                    uploadedMembers++;
                }
            }
            if (uploadedMembers > 0) {
                console.log(`[FirebaseSync] 📤 Uploaded ${uploadedMembers} new local members to Firebase`);
            }

            // Upload any local matches that Firebase doesn't have yet
            const historyKey = `tennis-match-history-${eventId}`;
            let localMatches = [];
            try { localMatches = JSON.parse(localStorage.getItem(historyKey)) || []; } catch (e) { localMatches = []; }
            
            const matchesSnapshot = await this.db.collection('events').doc(eventId)
                .collection('matches').get();
            const firebaseMatchIds = new Set(matchesSnapshot.docs.map(doc => doc.id));
            
            let uploadedMatches = 0;
            for (const lm of localMatches) {
                if (lm.id && !firebaseMatchIds.has(String(lm.id))) {
                    await this.db.collection('events').doc(eventId)
                        .collection('matches').doc(String(lm.id)).set({
                            ...lm,
                            lastModified: Date.now()
                        });
                    uploadedMatches++;
                }
            }
            if (uploadedMatches > 0) {
                console.log(`[FirebaseSync] 📤 Uploaded ${uploadedMatches} new local matches to Firebase`);
            }

            // STEP B: Now download everything from Firebase and REPLACE local data
            console.log('[FirebaseSync] 📥 Downloading Firebase data (source of truth)...');
            
            // Re-fetch members (now includes newly uploaded ones)
            const freshMembersSnapshot = await this.db.collection('events').doc(eventId)
                .collection('members').get();
            
            const firebaseMembers = freshMembersSnapshot.docs
                .map(doc => doc.data())
                .filter(m => m.name && !m.deletedAt); // Exclude any corrupted/deleted docs
            
            console.log(`[FirebaseSync] 📋 Firebase members (source of truth): ${firebaseMembers.length} -`, firebaseMembers.map(m => m.name));
            
            // REPLACE local members with Firebase data
            const membersKey = `tennis-members-${eventId}`;
            const cleanMembers = firebaseMembers.map(m => ({
                id: m.id || `mbr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                name: m.name,
                createdDate: m.createdDate || new Date().toISOString()
            }));
            localStorage.setItem(membersKey, JSON.stringify(cleanMembers));
            this.app?.memberManager?.onEventChanged();
            this.app?.populateMemberPickers?.();

            // Re-fetch matches and REPLACE local history
            const freshMatchesSnapshot = await this.db.collection('events').doc(eventId)
                .collection('matches').get();
            
            let firebaseMatches = freshMatchesSnapshot.docs.map(doc => doc.data());
            firebaseMatches.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
            if (firebaseMatches.length > 100) firebaseMatches = firebaseMatches.slice(0, 100);
            
            console.log(`[FirebaseSync] 📋 Firebase matches (source of truth): ${firebaseMatches.length}`);
            localStorage.setItem(historyKey, JSON.stringify(firebaseMatches));

            console.log('[FirebaseSync] ✅ Sync complete. Firebase is source of truth.');
            this._updateSyncStatus(true);
        } catch (e) {
            console.warn('[FirebaseSync] ❌ Sync failed:', e);
        }
    }

    /**
     * Sync events list from Firebase. This ensures all devices share the same event IDs.
     * If Firebase has events that local doesn't, import them.
     * Also uploads local events to Firebase if they don't exist there.
     */
    async _syncEventsFromFirebase() {
        if (!this.db) return;

        try {
            // Download events from Firebase
            console.log('[FirebaseSync] 📥 Fetching events from: appConfig/events');
            const eventsDoc = await this.db.collection('appConfig').doc('events').get();
            
            if (eventsDoc.exists) {
                const firebaseEvents = eventsDoc.data().list || [];
                console.log('[FirebaseSync] 📋 Firebase events:', firebaseEvents.map(e => `${e.name} (${e.id})`));
                const localEvents = this.app?.eventManager?.getEvents() || [];
                console.log('[FirebaseSync] 📋 Local events:', localEvents.map(e => `${e.name} (${e.id})`));
                
                if (firebaseEvents.length > 0) {
                    // Check if local has any of the Firebase event IDs
                    const localIds = new Set(localEvents.map(e => e.id));
                    const firebaseIds = new Set(firebaseEvents.map(e => e.id));
                    const hasOverlap = localEvents.some(e => firebaseIds.has(e.id));
                    
                    if (!hasOverlap) {
                        // No overlap — this is a fresh device. Replace local events with Firebase events.
                        console.log('[FirebaseSync] 🔄 Fresh device detected. Replacing local events with Firebase events.');
                        localStorage.setItem('tennis-events', JSON.stringify(firebaseEvents));
                        // Set active event to the first Firebase event (or default)
                        const defaultFb = firebaseEvents.find(e => e.isDefault) || firebaseEvents[0];
                        localStorage.setItem('tennis-selected-event', defaultFb.id);
                        // Remove the orphan local default event's data
                        for (const le of localEvents) {
                            if (!firebaseIds.has(le.id)) {
                                localStorage.removeItem(`tennis-members-${le.id}`);
                                localStorage.removeItem(`tennis-match-history-${le.id}`);
                                localStorage.removeItem(`tennis-active-match-${le.id}`);
                            }
                        }
                        // Reinitialize EventManager with Firebase events
                        this.app?.eventManager?.init();
                        this.app?.renderEventSelectors?.();
                        console.log('[FirebaseSync] ✅ Switched to Firebase events. Active:', defaultFb.name);
                    } else {
                        // Has overlap — merge any missing Firebase events into local
                        let changed = false;
                        for (const fbEvent of firebaseEvents) {
                            if (!localIds.has(fbEvent.id)) {
                                localEvents.push(fbEvent);
                                changed = true;
                            }
                        }
                        if (changed) {
                            localStorage.setItem('tennis-events', JSON.stringify(localEvents));
                            this.app?.eventManager?.init();
                            this.app?.renderEventSelectors?.();
                            console.log('[FirebaseSync] ✅ Merged new events from Firebase');
                        } else {
                            console.log('[FirebaseSync] ℹ️ Events already in sync');
                        }
                    }
                }
            } else {
                console.log('[FirebaseSync] ⚠️ No events doc in Firebase. Uploading local events...');
            }
            
            // Always upload current local events to Firebase (deduplicated)
            const currentLocalEvents = this._deduplicateEvents(this.app?.eventManager?.getEvents() || []);
            if (currentLocalEvents.length > 0) {
                await this.db.collection('appConfig').doc('events').set({
                    list: currentLocalEvents,
                    lastModified: Date.now()
                });
                console.log('[FirebaseSync] 📤 Uploaded events to Firebase (deduped):', currentLocalEvents.length);
            }
        } catch (e) {
            console.warn('[FirebaseSync] ❌ Events sync failed:', e);
        }
    }

    /**
     * Remove duplicate events by ID. Keeps the first occurrence of each ID.
     * @param {Array} events 
     * @returns {Array} Deduplicated events
     */
    _deduplicateEvents(events) {
        const seen = new Set();
        return events.filter(e => {
            if (seen.has(e.id)) return false;
            seen.add(e.id);
            return true;
        });
    }

    /**
     * Save/upload events list to Firebase (call after event create/rename/delete)
     */
    async saveEvents() {
        if (!this.db) return;
        try {
            const localEvents = this._deduplicateEvents(this.app?.eventManager?.getEvents() || []);
            // Also save deduped list to localStorage
            localStorage.setItem('tennis-events', JSON.stringify(localEvents));
            await this.db.collection('appConfig').doc('events').set({
                list: localEvents,
                lastModified: Date.now()
            });
            console.log('[FirebaseSync] 📤 Events saved to Firebase (deduped):', localEvents.length);
        } catch (e) {
            console.warn('[FirebaseSync] Failed to save events to Firebase:', e);
        }
    }

    // ─── Connectivity Monitoring ──────────────────────────────────────────────

    /**
     * Listen for online/offline events to update sync status indicator.
     */
    _startConnectivityMonitor() {
        window.addEventListener('online', () => {
            this.isOnline = true;
            this._updateSyncStatus(true);
        });

        window.addEventListener('offline', () => {
            this.isOnline = false;
            this._updateSyncStatus(false);
        });

        // Set initial status
        if (!navigator.onLine) {
            this.isOnline = false;
            this._updateSyncStatus(false);
        }
    }

    // ─── Save Match (Requirement 19.2) ────────────────────────────────────────

    /**
     * Save a completed match record to Firestore under the active event.
     * Path: events/{eventId}/matches/{matchId}
     * @param {object} record - The match history record with an `id` field
     */
    async saveMatch(record) {
        if (!this.db) return;
        const eventId = this._getEventId();
        if (!eventId) return;

        try {
            this._updateSyncStatus(true, 'syncing');
            const data = { ...record, lastModified: Date.now() };
            await this.db.collection('events').doc(eventId)
                .collection('matches').doc(String(record.id)).set(data);
            this._updateSyncStatus(true);
        } catch (e) {
            console.error('[FirebaseSync] Failed to save match:', e);
            this._updateSyncStatus(false);
        }
    }

    // ─── Save Individual Member ───────────────────────────────────────────────

    /**
     * Sync an individual member document to Firebase.
     * Path: events/{eventId}/members/{memberId}
     * @param {string} eventId - The event ID
     * @param {object} member - Member object with id and name
     */
    async saveMember(eventId, member) {
        if (!this.db) { console.warn('[FirebaseSync] 🔴 saveMember: no db connection'); return; }
        if (!eventId || !member) { console.warn('[FirebaseSync] 🔴 saveMember: missing eventId or member'); return; }

        try {
            console.log(`[FirebaseSync] 📤 Saving member "${member.name}" to events/${eventId}/members/${member.id}`);
            await this.db.collection('events').doc(eventId)
                .collection('members').doc(member.id).set({
                    ...member,
                    lastModified: Date.now()
                });
            console.log(`[FirebaseSync] ✅ Member "${member.name}" saved to Firebase`);
        } catch (e) {
            console.error('[FirebaseSync] ❌ Failed to save member:', e);
        }
    }

    // ─── Delete Member Document ───────────────────────────────────────────────

    /**
     * Delete a member document from Firebase.
     * Path: events/{eventId}/members/{memberId}
     * @param {string} eventId - The event ID
     * @param {string} memberId - The member ID to delete
     */
    async deleteMemberDoc(eventId, memberId) {
        if (!this.db) return;
        if (!eventId || !memberId) return;

        try {
            await this.db.collection('events').doc(eventId)
                .collection('members').doc(memberId).delete();
        } catch (e) {
            console.error('[FirebaseSync] Failed to delete member:', e);
        }
    }

    // ─── Save Active Match (Requirement 19.4) ─────────────────────────────────

    /**
     * Sync the active match state to Firebase for real-time sharing.
     * Uses a debounce (2 second delay) to avoid excessive writes during rapid scoring.
     * Path: events/{eventId}/appData/activeMatch
     * @param {object} state - The full active match state object
     */
    saveActiveMatch(state) {
        if (!this.db) return;
        this._debouncedActiveMatchWrite(state);
    }

    /**
     * Debounce mechanism for active match writes.
     * Queues writes and flushes after 2 seconds of inactivity.
     */
    _debouncedActiveMatchWrite(state) {
        this._pendingActiveState = state;
        if (this._activeWriteTimer) return; // Already scheduled

        this._activeWriteTimer = setTimeout(async () => {
            this._activeWriteTimer = null;
            if (this._pendingActiveState) {
                await this._writeActiveMatch(this._pendingActiveState);
                this._pendingActiveState = null;
            }
        }, 2000);
    }

    /**
     * Internal: perform the actual Firestore write for active match state.
     */
    async _writeActiveMatch(state) {
        const eventId = this._getEventId();
        if (!eventId) return;

        try {
            this._updateSyncStatus(true, 'syncing');
            await this.db.collection('events').doc(eventId)
                .collection('appData').doc('activeMatch').set({
                    ...state,
                    lastModified: Date.now()
                });
            this._updateSyncStatus(true);
        } catch (e) {
            console.error('[FirebaseSync] Failed to save active match:', e);
            this._updateSyncStatus(false);
        }
    }

    // ─── Clear Active Match ───────────────────────────────────────────────────

    /**
     * Remove the active match document from Firebase when a match ends.
     * Path: events/{eventId}/appData/activeMatch
     */
    async clearActiveMatch() {
        if (!this.db) return;
        const eventId = this._getEventId();
        if (!eventId) return;

        try {
            await this.db.collection('events').doc(eventId)
                .collection('appData').doc('activeMatch').delete();
            this._updateSyncStatus(true);
        } catch (e) {
            console.error('[FirebaseSync] Failed to clear active match:', e);
        }
    }

    // ─── Delete Event Data (Requirement 19.7) ─────────────────────────────────

    /**
     * Remove all Firebase data associated with a deleted event.
     * Deletes the event document and attempts to clean up subcollections
     * (matches, playerRegistry, members, appData).
     * @param {string} eventId - The event ID to remove
     */
    async deleteEventData(eventId) {
        if (!this.db) return;
        if (!eventId) return;

        try {
            this._updateSyncStatus(true, 'syncing');

            // Delete subcollection documents (Firestore doesn't cascade-delete)
            const subcollections = ['matches', 'members', 'appData'];
            for (const sub of subcollections) {
                const snapshot = await this.db.collection('events').doc(eventId)
                    .collection(sub).get();
                const batch = this.db.batch();
                snapshot.forEach(doc => {
                    batch.delete(doc.ref);
                });
                if (!snapshot.empty) {
                    await batch.commit();
                }
            }

            // Delete the event document itself
            await this.db.collection('events').doc(eventId).delete();
            this._updateSyncStatus(true);
        } catch (e) {
            console.error('[FirebaseSync] Failed to delete event data:', e);
            this._updateSyncStatus(false);
        }
    }

    // ─── Sync Status UI (Requirement 19.5, 19.6) ─────────────────────────────

    /**
     * Update the sync status indicator in the app header.
     * Shows online/offline/syncing state.
     * @param {boolean} online - Whether Firebase is connected
     * @param {string} [status] - Override status: 'syncing', 'synced', 'offline'
     */
    _updateSyncStatus(online, status) {
        const el = document.getElementById('sync-status');
        if (!el) return;

        let displayStatus;
        if (status === 'syncing') {
            displayStatus = 'syncing';
        } else if (online) {
            displayStatus = 'synced';
        } else {
            displayStatus = 'offline';
        }

        el.className = `sync-indicator sync-${displayStatus}`;

        const labelEl = el.querySelector('.sync-label');
        if (labelEl) {
            const labels = {
                synced: 'Synced',
                syncing: 'Syncing…',
                offline: 'Offline'
            };
            labelEl.textContent = labels[displayStatus] || 'Offline';
        }

        const titles = {
            synced: 'All data synced to cloud',
            syncing: 'Syncing data…',
            offline: 'Working offline (localStorage only)'
        };
        el.title = titles[displayStatus] || 'Sync Status';
    }

    // ─── Helper: Get Active Event ID ──────────────────────────────────────────

    /**
     * Get the currently active event ID from the EventManager.
     * @returns {string|null} The active event ID or null
     */
    _getEventId() {
        return this.app?.eventManager?.getActiveEventId() || null;
    }

    // ─── Save Events List ─────────────────────────────────────────────────────

    /**
     * Sync the full events list to Firebase.
     * Path: appData/events
     */
    async saveEventsList(events) {
        if (!this.db) return;
        try {
            await this.db.collection('appData').doc('events').set({
                events: events,
                lastModified: Date.now()
            });
        } catch (e) {
            console.error('[FirebaseSync] Failed to save events list:', e);
        }
    }

    // ─── Save Match History (full array sync) ─────────────────────────────────

    /**
     * Sync the entire match history array to Firebase for an event.
     * Used after import or clear operations.
     * Path: events/{eventId}/appData/matchHistory
     */
    async saveMatchHistory(eventId, records) {
        if (!this.db) return;
        if (!eventId) eventId = this._getEventId();
        if (!eventId) return;

        try {
            this._updateSyncStatus(true, 'syncing');
            await this.db.collection('events').doc(eventId)
                .collection('appData').doc('matchHistory').set({
                    records: records,
                    lastModified: Date.now()
                });
            this._updateSyncStatus(true);
        } catch (e) {
            console.error('[FirebaseSync] Failed to save match history:', e);
            this._updateSyncStatus(false);
        }
    }

    // ─── Clear Match History from Firebase ────────────────────────────────────

    /**
     * Remove all match data from Firebase for an event.
     * Path: events/{eventId}/matches/* and events/{eventId}/appData/matchHistory
     */
    async clearMatchHistory(eventId) {
        if (!this.db) return;
        if (!eventId) eventId = this._getEventId();
        if (!eventId) return;

        try {
            this._updateSyncStatus(true, 'syncing');

            // Delete individual match documents
            const snapshot = await this.db.collection('events').doc(eventId)
                .collection('matches').get();
            if (!snapshot.empty) {
                const batch = this.db.batch();
                snapshot.forEach(doc => batch.delete(doc.ref));
                await batch.commit();
            }

            // Delete the matchHistory aggregate doc
            await this.db.collection('events').doc(eventId)
                .collection('appData').doc('matchHistory').delete();

            this._updateSyncStatus(true);
        } catch (e) {
            console.error('[FirebaseSync] Failed to clear match history:', e);
            this._updateSyncStatus(false);
        }
    }
}
