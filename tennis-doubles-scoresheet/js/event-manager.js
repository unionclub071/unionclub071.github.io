/**
 * EventManager - Event entity management for Tennis Doubles Score Sheet
 * 
 * Manages Event CRUD operations, active event selection, storage key generation,
 * and cascade delete. Events are the top-level organizational container for all
 * match, player, and score data.
 * 
 * Storage keys:
 *   - tennis-events: JSON array of Event objects
 *   - tennis-selected-event: Active event ID string
 *   - tennis-match-history-{eventId}: Match records per event
 *   - tennis-player-names-{eventId}: Player names per event
 *   - tennis-active-match-{eventId}: Active match state per event
 *   - tennis-members-{eventId}: Members per event
 */

// ─── ID Generation ───────────────────────────────────────────────────────────

function generateEventId() {
    return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// ─── EventManager Class ──────────────────────────────────────────────────────

class EventManager {
    constructor(app) {
        this.app = app;
        this.events = [];
    }

    // ─── Initialization ──────────────────────────────────────────────────────

    /**
     * Initialize the EventManager: load events from localStorage,
     * ensure a default event exists, and set the active event.
     */
    init() {
        this._migrateFromFlatKeys();

        try {
            const stored = localStorage.getItem('tennis-events');
            this.events = stored ? JSON.parse(stored) : [];
        } catch (e) {
            console.warn('[EventManager] Failed to parse stored events, reinitializing.', e);
            this.events = [];
        }

        this.ensureDefaultEvent();
        this._initActiveEvent();
    }

    /**
     * Creates a default "Morning Batch" event if no events exist.
     */
    ensureDefaultEvent() {
        if (this.events.length === 0) {
            const defaultEvent = {
                id: generateEventId(),
                name: 'Morning Batch',
                createdDate: new Date().toISOString(),
                isDefault: true
            };
            this.events.push(defaultEvent);
            this._saveEvents();
        }
    }

    // ─── CRUD Operations ─────────────────────────────────────────────────────

    /**
     * Returns all events from localStorage.
     * @returns {Array} Array of event objects
     */
    getEvents() {
        try {
            const stored = localStorage.getItem('tennis-events');
            return stored ? JSON.parse(stored) : [];
        } catch (e) {
            console.warn('[EventManager] Failed to parse events from localStorage.', e);
            return [];
        }
    }

    /**
     * Returns the event matching the given ID, or null if not found.
     * @param {string} eventId 
     * @returns {object|null}
     */
    getEventById(eventId) {
        const events = this.getEvents();
        return events.find(e => e.id === eventId) || null;
    }

    /**
     * Creates a new event with the given name.
     * Validates that the name is non-empty and not whitespace-only.
     * @param {string} name 
     * @returns {object} The created event object
     * @throws {Error} If name is invalid
     */
    createEvent(name) {
        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            throw new Error('Event name cannot be empty or whitespace-only.');
        }

        const event = {
            id: generateEventId(),
            name: name.trim(),
            createdDate: new Date().toISOString(),
            isDefault: false
        };

        this.events.push(event);
        this._saveEvents();
        this._notifyApp();
        return event;
    }

    /**
     * Renames an existing event.
     * @param {string} eventId 
     * @param {string} newName 
     * @throws {Error} If name is invalid or event not found
     */
    renameEvent(eventId, newName) {
        if (!newName || typeof newName !== 'string' || newName.trim().length === 0) {
            throw new Error('Event name cannot be empty or whitespace-only.');
        }

        const event = this.events.find(e => e.id === eventId);
        if (!event) {
            throw new Error(`Event not found: ${eventId}`);
        }

        event.name = newName.trim();
        this._saveEvents();
        this._notifyApp();
    }

    // ─── Active Event Selection ──────────────────────────────────────────────

    /**
     * Returns the currently active event ID from localStorage.
     * @returns {string|null}
     */
    getActiveEventId() {
        return localStorage.getItem('tennis-selected-event');
    }

    /**
     * Returns the full event object for the currently active event.
     * @returns {object|null}
     */
    getActiveEvent() {
        const activeId = this.getActiveEventId();
        if (!activeId) return null;
        return this.getEventById(activeId);
    }

    /**
     * Sets the active event and persists the selection.
     * Triggers app data reload if app reference is available.
     * @param {string} eventId 
     */
    setActiveEvent(eventId) {
        localStorage.setItem('tennis-selected-event', eventId);
        if (this.app && typeof this.app.onEventChanged === 'function') {
            this.app.onEventChanged();
        }
    }

    /**
     * Initializes the active event on startup.
     * Uses stored selection if valid, otherwise falls back to default/first event.
     */
    _initActiveEvent() {
        const storedId = this.getActiveEventId();
        const events = this.events;

        // Check if stored ID still references a valid event
        if (storedId && events.find(e => e.id === storedId)) {
            return; // Stored selection is valid
        }

        // Fall back to default event or first available
        const defaultEvent = events.find(e => e.isDefault);
        const fallback = defaultEvent || events[0];
        if (fallback) {
            localStorage.setItem('tennis-selected-event', fallback.id);
        }
    }

    // ─── Storage Key Helpers ─────────────────────────────────────────────────

    /**
     * Returns the localStorage key for match history of the given or active event.
     * @param {string} [eventId] - Optional event ID; defaults to active event
     * @returns {string}
     */
    getMatchHistoryKey(eventId) {
        const id = eventId || this.getActiveEventId();
        return `tennis-match-history-${id}`;
    }

    /**
     * Returns the localStorage key for player names of the given or active event.
     * @param {string} [eventId] - Optional event ID; defaults to active event
     * @returns {string}
     */
    getPlayerNamesKey(eventId) {
        const id = eventId || this.getActiveEventId();
        return `tennis-player-names-${id}`;
    }

    /**
     * Returns the localStorage key for active match state of the given or active event.
     * @param {string} [eventId] - Optional event ID; defaults to active event
     * @returns {string}
     */
    getActiveMatchKey(eventId) {
        const id = eventId || this.getActiveEventId();
        return `tennis-active-match-${id}`;
    }

    // ─── Cascade Delete ──────────────────────────────────────────────────────

    /**
     * Deletes an event and all its associated data from localStorage.
     * Rejects deletion if it's the last remaining event.
     * Switches active event if the deleted event was active.
     * @param {string} eventId 
     * @throws {Error} If trying to delete the last event
     */
    deleteEvent(eventId) {
        if (this.events.length <= 1) {
            throw new Error('Cannot delete the last event.');
        }

        const eventIndex = this.events.findIndex(e => e.id === eventId);
        if (eventIndex === -1) {
            throw new Error(`Event not found: ${eventId}`);
        }

        // Remove the event from the list
        this.events.splice(eventIndex, 1);
        this._saveEvents();

        // Remove all scoped localStorage keys for this event
        localStorage.removeItem(this.getMatchHistoryKey(eventId));
        localStorage.removeItem(this.getPlayerNamesKey(eventId));
        localStorage.removeItem(this.getActiveMatchKey(eventId));
        localStorage.removeItem(`tennis-members-${eventId}`);

        // If the deleted event was active, switch to default or first available
        const activeId = this.getActiveEventId();
        if (activeId === eventId) {
            const defaultEvent = this.events.find(e => e.isDefault);
            const fallback = defaultEvent || this.events[0];
            if (fallback) {
                this.setActiveEvent(fallback.id);
            }
        }

        this._notifyApp();
    }

    /**
     * Deletes event data from Firebase (event document + subcollections).
     * Wrapped in try/catch — returns success boolean.
     * @param {string} eventId 
     * @returns {Promise<boolean>} true if successful, false on failure
     */
    async deleteEventFromFirebase(eventId) {
        try {
            const db = this.app?.sync?.db;
            if (!db) {
                console.warn('[EventManager] Firebase DB not available for delete.');
                return false;
            }

            const eventRef = db.collection('events').doc(eventId);

            // Delete subcollections: matches
            const matchesSnapshot = await eventRef.collection('matches').get();
            const matchDeletePromises = matchesSnapshot.docs.map(doc => doc.ref.delete());
            await Promise.all(matchDeletePromises);

            // Delete subcollections: playerRegistry
            const playerSnapshot = await eventRef.collection('playerRegistry').get();
            const playerDeletePromises = playerSnapshot.docs.map(doc => doc.ref.delete());
            await Promise.all(playerDeletePromises);

            // Delete subcollections: appData
            const appDataSnapshot = await eventRef.collection('appData').get();
            const appDataDeletePromises = appDataSnapshot.docs.map(doc => doc.ref.delete());
            await Promise.all(appDataDeletePromises);

            // Delete the event document itself
            await eventRef.delete();

            return true;
        } catch (error) {
            console.error('[EventManager] Firebase delete failed:', error);
            return false;
        }
    }

    // ─── Internal Helpers ────────────────────────────────────────────────────

    /**
     * Migrates data from old flat localStorage keys to event-scoped keys.
     * Runs only once: when flat keys exist but `tennis-events` does not.
     * After migration, removes old flat keys.
     */
    _migrateFromFlatKeys() {
        // Guard: only migrate if events list doesn't exist yet
        const existingEvents = localStorage.getItem('tennis-events');
        if (existingEvents) return;

        const oldHistory = localStorage.getItem('tennis-match-history');
        const oldPlayers = localStorage.getItem('tennis-player-names');
        const oldActive = localStorage.getItem('tennis-active-match');

        // Only migrate if at least one old key exists
        if (!oldHistory && !oldPlayers && !oldActive) return;

        console.log('[EventManager] Migrating from flat localStorage keys to event-scoped keys...');

        // Create default event for migration
        const defaultEvent = {
            id: generateEventId(),
            name: 'Morning Batch',
            createdDate: new Date().toISOString(),
            isDefault: true
        };

        // Save event list
        this.events = [defaultEvent];
        this._saveEvents();

        // Set as active event
        localStorage.setItem('tennis-selected-event', defaultEvent.id);

        // Copy data to event-scoped keys
        if (oldHistory) {
            localStorage.setItem(`tennis-match-history-${defaultEvent.id}`, oldHistory);
        }
        if (oldPlayers) {
            localStorage.setItem(`tennis-player-names-${defaultEvent.id}`, oldPlayers);
        }
        if (oldActive) {
            localStorage.setItem(`tennis-active-match-${defaultEvent.id}`, oldActive);
        }

        // Remove old flat keys after successful copy
        localStorage.removeItem('tennis-match-history');
        localStorage.removeItem('tennis-player-names');
        localStorage.removeItem('tennis-active-match');

        console.log('[EventManager] Migration complete. Data moved to event:', defaultEvent.name, defaultEvent.id);
    }

    /**
     * Persists the current events array to localStorage.
     */
    _saveEvents() {
        localStorage.setItem('tennis-events', JSON.stringify(this.events));
    }

    /**
     * Notifies the app to refresh UI after event changes.
     */
    _notifyApp() {
        if (this.app && typeof this.app.onEventListChanged === 'function') {
            this.app.onEventListChanged();
        }
    }

    // ─── Event Selector UI ───────────────────────────────────────────────────

    /**
     * Renders an event selector <select> element inside the given container.
     * @param {string} containerId - ID of the container element
     */
    renderEventSelector(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        const events = this.getEvents();
        const activeId = this.getActiveEventId();

        // Create or update the select element
        let select = container.querySelector('select.event-selector');
        if (!select) {
            select = document.createElement('select');
            select.className = 'event-selector';
            select.addEventListener('change', (e) => {
                this.onEventSelectorChange(e.target.value);
            });
            container.appendChild(select);
        }

        // Populate options
        select.innerHTML = '';
        events.forEach(event => {
            const option = document.createElement('option');
            option.value = event.id;
            option.textContent = event.name;
            if (event.id === activeId) {
                option.selected = true;
            }
            select.appendChild(option);
        });
    }

    /**
     * Handles event selector change — sets active event and triggers reload.
     * @param {string} eventId 
     */
    onEventSelectorChange(eventId) {
        this.setActiveEvent(eventId);

        // Update all event selectors on the page to reflect the new selection
        const selectors = document.querySelectorAll('select.event-selector');
        selectors.forEach(select => {
            select.value = eventId;
        });
    }
}
