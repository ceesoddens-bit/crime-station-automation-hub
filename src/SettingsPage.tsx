import React, { useState } from 'react';
import axios from 'axios';
import { cn } from './lib/utils';
import {
  Plus, Pencil, Trash2, Check, Youtube, Music, X, ChevronLeft, ExternalLink, Globe
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export interface Profile {
  id: string;
  name: string;
  spotifyUrl: string;
  publishYoutube: boolean;
  publishSpotify: boolean;
  youtubeLinked?: boolean;
}

interface Props {
  profiles: Profile[];
  onClose: () => void;
  onProfilesChange: (profiles: Profile[]) => void;
}

const emptyForm = { name: '', spotifyUrl: '', publishYoutube: true, publishSpotify: false };

export default function SettingsPage({ profiles, onClose, onProfilesChange }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const refreshProfiles = async () => {
    const res = await axios.get('/api/profiles');
    onProfilesChange(res.data);
  };

  const openAdd = () => {
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(true);
  };

  const openEdit = (p: Profile) => {
    setForm({ name: p.name, spotifyUrl: p.spotifyUrl, publishYoutube: p.publishYoutube, publishSpotify: p.publishSpotify });
    setEditingId(p.id);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (editingId) {
        await axios.put(`/api/profiles/${editingId}`, form);
      } else {
        await axios.post('/api/profiles', form);
      }
      await refreshProfiles();
      setShowForm(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    await axios.delete(`/api/profiles/${id}`);
    await refreshProfiles();
    setDeleteConfirm(null);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-orange-900/10 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-orange-900/10 blur-[120px] rounded-full" />
      </div>

      <div className="relative z-10 max-w-3xl mx-auto px-6 py-12">
        {/* Header */}
        <div className="flex items-center gap-4 mb-10">
          <button
            onClick={onClose}
            className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-sm"
          >
            <ChevronLeft className="w-4 h-4" /> Terug
          </button>
          <div className="w-px h-5 bg-white/10" />
          <h1 className="text-2xl font-bold tracking-tighter">Instellingen</h1>
        </div>

        {/* Profielen sectie */}
        <section>
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-bold">Kanaalprofielen</h2>
              <p className="text-sm text-gray-500 mt-1">Elk profiel heeft zijn eigen YouTube-account en Spotify-link.</p>
            </div>
            <button
              onClick={openAdd}
              className="flex items-center gap-2 bg-orange-600 hover:bg-orange-500 text-white px-4 py-2 rounded-lg font-bold text-sm transition-all"
            >
              <Plus className="w-4 h-4" /> Nieuw profiel
            </button>
          </div>

          {profiles.length === 0 ? (
            <div className="text-center py-16 border border-white/10 rounded-2xl bg-white/5">
              <Globe className="w-10 h-10 text-gray-600 mx-auto mb-3" />
              <p className="text-gray-400 font-medium">Nog geen profielen aangemaakt</p>
              <p className="text-gray-600 text-sm mt-1">Maak een profiel aan voor elk YouTube-kanaal of podcast.</p>
              <button
                onClick={openAdd}
                className="mt-4 text-orange-500 hover:text-orange-400 text-sm font-bold transition-colors"
              >
                + Eerste profiel aanmaken
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {profiles.map(p => (
                <div key={p.id} className="bg-zinc-900/60 border border-white/10 rounded-xl p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold text-lg">{p.name}</h3>
                      <div className="flex flex-wrap items-center gap-3 mt-2">
                        {/* YouTube status */}
                        {p.youtubeLinked ? (
                          <span className="flex items-center gap-1.5 text-xs font-mono uppercase bg-green-600/20 text-green-500 border border-green-500/30 px-2.5 py-1 rounded">
                            <Check className="w-3 h-3" /> YouTube Gekoppeld
                          </span>
                        ) : (
                          <a
                            href={`/api/auth/youtube?profileId=${p.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 text-xs font-mono uppercase bg-red-600/20 text-red-400 border border-red-500/30 px-2.5 py-1 rounded hover:bg-red-600/30 transition-colors"
                            onClick={() => setTimeout(refreshProfiles, 3000)}
                          >
                            <Youtube className="w-3 h-3" /> Koppel YouTube
                          </a>
                        )}
                        {/* Spotify status */}
                        {p.spotifyUrl ? (
                          <span className="flex items-center gap-1.5 text-xs font-mono uppercase bg-green-600/20 text-green-500 border border-green-500/30 px-2.5 py-1 rounded">
                            <Check className="w-3 h-3" /> Spotify ingesteld
                          </span>
                        ) : (
                          <span className="flex items-center gap-1.5 text-xs font-mono uppercase bg-white/5 text-gray-500 border border-white/10 px-2.5 py-1 rounded">
                            <Music className="w-3 h-3" /> Geen Spotify-link
                          </span>
                        )}
                        {/* Platform badges */}
                        <span className={cn("text-xs font-mono uppercase px-2 py-0.5 rounded border", p.publishYoutube ? "bg-orange-600/20 text-orange-400 border-orange-500/30" : "bg-white/5 text-gray-600 border-white/10 line-through")}>
                          YouTube
                        </span>
                        <span className={cn("text-xs font-mono uppercase px-2 py-0.5 rounded border", p.publishSpotify ? "bg-green-600/20 text-green-400 border-green-500/30" : "bg-white/5 text-gray-600 border-white/10 line-through")}>
                          Spotify
                        </span>
                      </div>
                      {p.spotifyUrl && (
                        <p className="text-xs text-gray-600 mt-2 truncate">{p.spotifyUrl}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => openEdit(p)}
                        className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-all"
                        title="Bewerken"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(p.id)}
                        className="p-2 rounded-lg bg-white/5 hover:bg-red-500/20 text-gray-400 hover:text-red-400 transition-all"
                        title="Verwijderen"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Profiel form modal */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
            onClick={() => setShowForm(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-full max-w-md"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold">{editingId ? 'Profiel bewerken' : 'Nieuw profiel'}</h3>
                <button onClick={() => setShowForm(false)} className="text-gray-500 hover:text-white transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-mono uppercase tracking-widest opacity-50">Naam *</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="bijv. Crime Insight"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 focus:outline-none focus:border-orange-600 transition-colors"
                    autoFocus
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-mono uppercase tracking-widest opacity-50">Spotify Show URL</label>
                  <input
                    type="url"
                    value={form.spotifyUrl}
                    onChange={e => setForm(f => ({ ...f, spotifyUrl: e.target.value }))}
                    placeholder="https://open.spotify.com/show/..."
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 focus:outline-none focus:border-orange-600 transition-colors text-sm"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-mono uppercase tracking-widest opacity-50">Standaard publiceren naar</label>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => setForm(f => ({ ...f, publishYoutube: !f.publishYoutube }))}
                      className={cn(
                        "flex-1 flex items-center justify-center gap-2 py-3 rounded-lg border font-bold text-sm transition-all",
                        form.publishYoutube
                          ? "bg-orange-600/20 border-orange-600/50 text-orange-400"
                          : "bg-white/5 border-white/10 text-gray-500"
                      )}
                    >
                      <Youtube className="w-4 h-4" /> YouTube
                      {form.publishYoutube && <Check className="w-3 h-3" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => setForm(f => ({ ...f, publishSpotify: !f.publishSpotify }))}
                      className={cn(
                        "flex-1 flex items-center justify-center gap-2 py-3 rounded-lg border font-bold text-sm transition-all",
                        form.publishSpotify
                          ? "bg-green-600/20 border-green-600/50 text-green-400"
                          : "bg-white/5 border-white/10 text-gray-500"
                      )}
                    >
                      <Music className="w-4 h-4" /> Spotify
                      {form.publishSpotify && <Check className="w-3 h-3" />}
                    </button>
                  </div>
                  <p className="text-xs text-gray-600">Dit zijn de standaardinstellingen. Je kan dit per aflevering aanpassen.</p>
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setShowForm(false)}
                  className="flex-1 px-4 py-2.5 text-sm text-gray-400 border border-zinc-700 rounded-lg hover:bg-zinc-800 transition-colors"
                >
                  Annuleren
                </button>
                <button
                  onClick={handleSave}
                  disabled={!form.name.trim() || saving}
                  className="flex-1 px-4 py-2.5 text-sm font-bold bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  {saving ? 'Opslaan...' : <><Check className="w-4 h-4" /> Opslaan</>}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete bevestiging */}
      <AnimatePresence>
        {deleteConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-full max-w-sm"
            >
              <h3 className="text-lg font-bold mb-2">Profiel verwijderen?</h3>
              <p className="text-sm text-gray-400 mb-6">De YouTube-koppeling voor dit profiel wordt ook verwijderd. Dit kan niet ongedaan worden gemaakt.</p>
              <div className="flex gap-3">
                <button
                  onClick={() => setDeleteConfirm(null)}
                  className="flex-1 px-4 py-2.5 text-sm text-gray-400 border border-zinc-700 rounded-lg hover:bg-zinc-800 transition-colors"
                >
                  Annuleren
                </button>
                <button
                  onClick={() => handleDelete(deleteConfirm)}
                  className="flex-1 px-4 py-2.5 text-sm font-bold bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors"
                >
                  Verwijderen
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
