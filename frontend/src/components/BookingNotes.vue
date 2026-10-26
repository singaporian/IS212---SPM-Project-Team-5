<template>
  <section v-if="canView" class="mt-3 border-top pt-3" aria-label="Internal Venue Staff notes" @click.stop>
    <h3 class="h6">Internal Venue Staff notes</h3>
    <p class="small text-muted">Visible only to Venue Staff.</p>
    <p v-if="loading" role="status">Loading notes…</p>
    <p v-if="error" class="alert alert-danger" role="alert">{{ error }} <button type="button" class="btn btn-link btn-sm" :disabled="saving || loading" @click="load">Retry loading</button></p>
    <p v-if="success" class="alert alert-success" role="status">{{ success }}</p>
    <ol v-if="notes.length" class="list-unstyled">
      <li v-for="note in notes" :key="note.id" class="border-bottom py-2">
        <p class="small text-muted mb-1">{{ note.author_name || 'Venue Staff' }} · {{ formatDate(note.created_at) }}</p>
        <form v-if="editingId === note.id" @submit.prevent="saveEdit">
          <label :for="'edit-note-' + note.id" class="form-label">Edit your note</label>
          <textarea :id="'edit-note-' + note.id" v-model="editText" class="form-control" rows="3" maxlength="10000" required :disabled="saving"></textarea>
          <button class="btn btn-primary btn-sm mt-2" :disabled="saving">Save changes</button>
          <button type="button" class="btn btn-link btn-sm mt-2" :disabled="saving" @click="editingId = ''">Cancel</button>
        </form>
        <template v-else>
          <p class="note-text mb-2">{{ note.note_text }}</p>
          <div v-if="isOwn(note)" class="d-flex gap-2">
            <button type="button" class="btn btn-outline-primary btn-sm" :disabled="saving" @click="startEdit(note)">Edit</button>
            <button type="button" class="btn btn-outline-danger btn-sm" :disabled="saving" @click="deletingId = note.id">Delete</button>
          </div>
        </template>
        <div v-if="deletingId === note.id" class="alert alert-warning mt-2" role="group" aria-label="Confirm note deletion">
          <p>Delete this note?</p>
          <button type="button" class="btn btn-danger btn-sm" :disabled="saving" @click="remove(note)">Delete note</button>
          <button type="button" class="btn btn-link btn-sm" :disabled="saving" @click="deletingId = ''">Cancel</button>
        </div>
      </li>
    </ol>
    <p v-else-if="!loading && !error" class="text-muted">No internal notes yet.</p>
    <form @submit.prevent="add">
      <label :for="'new-note-' + bookingId" class="form-label">Add an internal note</label>
      <textarea :id="'new-note-' + bookingId" v-model="newText" class="form-control" rows="3" maxlength="10000" required :disabled="saving"></textarea>
      <button class="btn btn-primary btn-sm mt-2" :disabled="saving || loading">{{ saving ? 'Saving…' : 'Add note' }}</button>
    </form>
  </section>
</template>
<script>
import { getUser } from '../services/auth'
import { bookingNotesRequest } from '../services/bookingNotes'

export default {
  props: { bookingId: { type: String, required: true } },
  data() { return { notes: [], newText: '', editText: '', editingId: '', deletingId: '', loading: false, saving: false, error: '', success: '' } },
  computed: { canView() { return getUser()?.role === 'venue_staff' } },
  methods: {
    isOwn(note) { return note.created_by === getUser()?.id },
    formatDate(value) { return new Date(value).toLocaleString('en-SG', { timeZone: 'Asia/Singapore', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).replace(/am|pm/gi, text => text.toUpperCase()) },
    async load() {
      if (!this.canView) return
      this.loading = true; this.error = ''
      try { this.notes = await bookingNotesRequest(this.bookingId) }
      catch (error) { this.error = error.message }
      finally { this.loading = false }
    },
    startEdit(note) { this.editingId = note.id; this.editText = note.note_text; this.error = ''; this.success = ''; this.deletingId = '' },
    async mutate(options, message, apply) {
      if (!this.canView || this.saving) return
      this.saving = true; this.error = ''; this.success = ''
      try {
        const note = await bookingNotesRequest(this.bookingId, options)
        apply(note); this.success = message
      } catch (error) { this.error = error.message }
      finally { this.saving = false }
    },
    async add() {
      if (!this.newText.trim()) { this.error = 'Enter a note.'; return }
      await this.mutate({ method: 'POST', noteText: this.newText }, 'Note added.', note => {
        // Preserve server-generated attribution/time without depending on a follow-up GET.
        this.notes.push({ ...note, author_name: getUser()?.name }); this.newText = ''
      })
    },
    async saveEdit() {
      if (!this.editText.trim()) { this.error = 'Enter a note.'; return }
      const id = this.editingId
      await this.mutate({ method: 'PATCH', noteId: id, noteText: this.editText }, 'Note updated.', note => {
        this.notes = this.notes.map(existing => existing.id === id ? { ...existing, ...note } : existing); this.editingId = ''
      })
    },
    async remove(note) {
      await this.mutate({ method: 'DELETE', noteId: note.id }, 'Note deleted.', () => {
        this.notes = this.notes.filter(existing => existing.id !== note.id); this.deletingId = ''
      })
    }
  },
  mounted() { this.load() }
}
</script>
<style scoped>
.note-text { white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
