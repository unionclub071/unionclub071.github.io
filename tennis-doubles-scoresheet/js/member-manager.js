/**
 * MemberManager - Member entity management for Tennis Doubles Scoresheet
 * 
 * Manages Member CRUD operations within Events. Each Event maintains its own
 * Members_Collection - a set of { id, name, createdDate } objects - persisted
 * in localStorage and optionally synced to Firebase.
 * 
 * Storage key: tennis-members-{eventId}
 * Legacy key (migrated): tennis-player-names-{eventId}
 */

class MemberManager {
    constructor(app) {
        this.app = app;
        this.members = [];
    }

    // ─── Initialization & Migration ─────────────────────────────────────────

    /**
     * Initialize: load members for active event and run migration if needed.
     */
    init() {
        const eventId = this.app?.eventManager?.getActiveEventId();
        this._migrate(eventId);
        this.members = this.getMembers(eventId);
    }

    /**
     * Migrate legacy player-names to member entities (one-time per event).
     * Only runs if old key exists AND new key does NOT.
     */
    _migrate(eventId) {
        const eid = eventId || this.app?.eventManager?.getActiveEventId();
        if (!eid) return;

        const oldKey = `tennis-player-names-${eid}`;
        const newKey = this._getStorageKey(eid);

        // Only migrate if old key exists AND new key does NOT
        if (!localStorage.getItem(oldKey) || localStorage.getItem(newKey)) return;

        try {
            const oldNames = JSON.parse(localStorage.getItem(oldKey));
            if (!Array.isArray(oldNames)) return;

            const seen = new Map(); // lowercase -> true
            const members = [];
            const now = new Date().toISOString();

            for (const name of oldNames) {
                if (typeof name !== 'string' || !name.trim()) continue;
                const lower = name.trim().toLowerCase();
                if (seen.has(lower)) continue;
                seen.set(lower, true);

                members.push({
                    id: this._generateId(),
                    name: name.trim(),
                    createdDate: now
                });
            }

            // Save to new key
            localStorage.setItem(newKey, JSON.stringify(members));
            // Remove old key
            localStorage.removeItem(oldKey);

            console.log(`[MemberManager] Migrated ${members.length} members for event ${eid}`);
        } catch (e) {
            console.warn('[MemberManager] Migration failed:', e);
        }
    }

    // ─── CRUD Operations ────────────────────────────────────────────────────

    /**
     * Returns sorted Members_Collection array from localStorage.
     */
    getMembers(eventId) {
        const key = this._getStorageKey(eventId);
        try {
            const data = localStorage.getItem(key);
            const members = data ? JSON.parse(data) : [];
            members.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
            return members;
        } catch (e) {
            console.warn('[MemberManager] Failed to parse members:', e);
            return [];
        }
    }

    /**
     * Find a member by ID.
     */
    getMemberById(memberId) {
        return this.members.find(m => m.id === memberId) || null;
    }

    /**
     * Returns sorted array of member name strings.
     */
    getMemberNames() {
        return this.getMembers().map(m => m.name).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    }

    /**
     * Add a new member. Validates name, creates entity, persists, syncs.
     * @returns {object} The created member
     * @throws {Error} If name is invalid or duplicate
     */
    addMember(name) {
        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            throw new Error('Member name cannot be empty.');
        }

        const trimmed = name.trim();

        if (this._nameExists(trimmed)) {
            throw new Error('Member already exists.');
        }

        const member = {
            id: this._generateId(),
            name: trimmed,
            createdDate: new Date().toISOString()
        };

        this.members.push(member);
        this._save();
        this._syncToFirebase(member, 'save');
        return member;
    }

    /**
     * Edit a member's name. Validates, updates name only (keeps id/createdDate).
     * @throws {Error} If name is invalid, duplicate, or member not found
     */
    editMember(memberId, newName) {
        if (!newName || typeof newName !== 'string' || newName.trim().length === 0) {
            throw new Error('Member name cannot be empty.');
        }

        const trimmed = newName.trim();
        const member = this.members.find(m => m.id === memberId);
        if (!member) {
            throw new Error('Member not found.');
        }

        // Check duplicate (exclude self)
        const duplicate = this.members.find(m =>
            m.id !== memberId && m.name.toLowerCase() === trimmed.toLowerCase()
        );
        if (duplicate) {
            throw new Error('Member already exists.');
        }

        member.name = trimmed;
        this._save();
        this._syncToFirebase(member, 'save');
    }

    /**
     * Delete a member from the collection.
     */
    deleteMember(memberId) {
        const index = this.members.findIndex(m => m.id === memberId);
        if (index === -1) return; // Silently no-op for non-existent

        const member = this.members[index];
        this.members.splice(index, 1);
        this._save();
        this._syncToFirebase(member, 'delete');
    }

    /**
     * Auto-add members from an array of names (used on match start).
     * Adds only names that don't already exist (case-insensitive).
     */
    autoAddMembers(names) {
        if (!Array.isArray(names)) return;

        for (const name of names) {
            if (!name || typeof name !== 'string' || !name.trim()) continue;
            if (!this._nameExists(name.trim())) {
                try {
                    this.addMember(name.trim());
                } catch (e) {
                    // Skip if validation fails (e.g. duplicate added between iterations)
                }
            }
        }
    }

    // ─── Event Lifecycle ────────────────────────────────────────────────────

    /**
     * Reload members for the new active event.
     */
    onEventChanged() {
        const eventId = this.app?.eventManager?.getActiveEventId();
        this._migrate(eventId);
        this.members = this.getMembers(eventId);
    }

    /**
     * Remove localStorage key for a deleted event.
     */
    onEventDeleted(eventId) {
        if (!eventId) return;
        localStorage.removeItem(this._getStorageKey(eventId));
    }

    // ─── UI Rendering ───────────────────────────────────────────────────────

    /**
     * Renders the member list in #members-list with add/edit/delete UI.
     */
    renderMembersPage() {
        const container = document.getElementById('members-list');
        if (!container) return;

        const members = this.getMembers();
        this.members = members;

        if (members.length === 0) {
            container.innerHTML = '<p style="text-align:center; color:var(--text-muted); padding:20px;">No members yet. Add your first member above.</p>';
            return;
        }

        container.innerHTML = members.map(m => `
            <div class="member-item" data-id="${m.id}">
                <span class="member-item-name">${m.name}</span>
                <div class="member-item-actions">
                    <button class="btn-edit-member" data-id="${m.id}" title="Edit">✏️</button>
                    <button class="btn-delete-member" data-id="${m.id}" title="Delete">🗑️</button>
                </div>
            </div>
        `).join('');

        // Attach edit handlers
        container.querySelectorAll('.btn-edit-member').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.currentTarget.dataset.id;
                const member = this.getMemberById(id);
                if (!member) return;
                const newName = prompt('Edit member name:', member.name);
                if (newName !== null && newName.trim()) {
                    try {
                        this.editMember(id, newName);
                        this.renderMembersPage();
                        this.app?.populateMemberPickers();
                    } catch (err) {
                        alert(err.message);
                    }
                }
            });
        });

        // Attach delete handlers
        container.querySelectorAll('.btn-delete-member').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.currentTarget.dataset.id;
                const member = this.getMemberById(id);
                if (!member) return;
                if (confirm(`Delete member "${member.name}"?`)) {
                    this.deleteMember(id);
                    this.renderMembersPage();
                    this.app?.populateMemberPickers();
                }
            });
        });
    }

    // ─── Internal Helpers ───────────────────────────────────────────────────

    /**
     * Generate a unique member ID.
     */
    _generateId() {
        return `mbr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Get localStorage key for members collection.
     */
    _getStorageKey(eventId) {
        const eid = eventId || this.app?.eventManager?.getActiveEventId();
        return `tennis-members-${eid}`;
    }

    /**
     * Persist members array to localStorage.
     */
    _save(eventId) {
        const key = this._getStorageKey(eventId);
        localStorage.setItem(key, JSON.stringify(this.members));
    }

    /**
     * Case-insensitive check if name already exists in members.
     */
    _nameExists(name) {
        const lower = name.toLowerCase();
        return this.members.some(m => m.name.toLowerCase() === lower);
    }

    /**
     * Sync member to Firebase (save or delete).
     */
    _syncToFirebase(member, action) {
        const eventId = this.app?.eventManager?.getActiveEventId();
        if (!eventId) return;

        if (action === 'save') {
            this.app?.sync?.saveMember(eventId, member);
        } else if (action === 'delete') {
            this.app?.sync?.deleteMemberDoc(eventId, member.id);
        }
    }
}
