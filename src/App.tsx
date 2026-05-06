import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { cn } from './lib/utils';
import { 
  Play, 
  RotateCcw, 
  CheckCircle2, 
  Clock, 
  AlertCircle, 
  ExternalLink,
  ChevronRight,
  FileText,
  Youtube,
  Music,
  Share2,
  Video,
  Loader2,
  Check,
  Copy,
  Pencil,
  Globe
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';

type StepStatus = 'idle' | 'processing' | 'completed' | 'error' | 'waiting';

interface Step {
  id: number;
  title: string;
  description: string;
  status: StepStatus;
  icon: React.ReactNode;
  errorMessage?: string;
}

type PublishLinks = {
  youtube?: string;
  spotify?: string;
};

export default function App() {
  const [videoSource, setVideoSource] = useState<'drive' | 'local'>('drive');
  const [driveUrl, setDriveUrl] = useState('');
  const [localFile, setLocalFile] = useState<File | null>(null);
  const [series, setSeries] = useState('Crime Insight');
  const [host1, setHost1] = useState('');
  const [host2, setHost2] = useState('');
  const [guest, setGuest] = useState('');
  const [episodeNumber, setEpisodeNumber] = useState('');
  const [isStarted, setIsStarted] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedStepIndex, setSelectedStepIndex] = useState<number | null>(null);
  const [stepData, setStepData] = useState<Record<number, string>>({});
  const [isApproved, setIsApproved] = useState(false);
  const [publishLinks, setPublishLinks] = useState<PublishLinks | null>(null);
  const [lastGuest, setLastGuest] = useState('');
  const [selectedPlatform, setSelectedPlatform] = useState<'youtube' | 'spotify' | 'website'>('youtube');
  const [copiedPlatform, setCopiedPlatform] = useState<null | string>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const [showPublishConfirm, setShowPublishConfirm] = useState(false);
  const [currentRequestId, setCurrentRequestId] = useState('');
  const [isYoutubeLinked, setIsYoutubeLinked] = useState(false);
  const [hasSrt, setHasSrt] = useState(false);
  const [spotifyShowUrl, setSpotifyShowUrl] = useState('');
  const [showSpotifyModal, setShowSpotifyModal] = useState(false);
  const [spotifyInput, setSpotifyInput] = useState('');
  const [stepStartTimes, setStepStartTimes] = useState<Record<number, number>>({});
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [fileSizeMb, setFileSizeMb] = useState<number | null>(null);

  // Load state from localStorage on mount
  useEffect(() => {
    const savedState = localStorage.getItem('crime-station-state');
    if (savedState) {
      try {
        const parsed = JSON.parse(savedState);
        setVideoSource(parsed.videoSource === 'local' ? 'local' : 'drive');
        setDriveUrl(parsed.driveUrl || '');
        setSeries(parsed.series || 'Crime Insight');
        setHost1(parsed.host1 || '');
        setHost2(parsed.host2 || '');
        setGuest(parsed.guest || '');
        setEpisodeNumber(parsed.episodeNumber || '');
        setIsStarted(parsed.isStarted || false);
        setCurrentStep(parsed.currentStep || 0);
        setSelectedStepIndex(parsed.selectedStepIndex !== undefined ? parsed.selectedStepIndex : null);
        setStepData(parsed.stepData || {});
        setIsApproved(parsed.isApproved || false);
        setPublishLinks(parsed.publishLinks || null);
        setSelectedPlatform(parsed.selectedPlatform === 'spotify' ? 'spotify' : 'youtube');
        setCurrentRequestId(parsed.currentRequestId || '');
      } catch (e) {
        console.error("Failed to load saved state", e);
      }
    }
  }, []);

  useEffect(() => {
    const savedLastGuest = localStorage.getItem('crime-station-last-guest');
    if (savedLastGuest) setLastGuest(savedLastGuest);
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem('crime-station-spotify-url');
    if (saved) setSpotifyShowUrl(saved);
  }, []);

  useEffect(() => {
    const checkAuthStatus = () => {
      axios.get('/api/auth/youtube/status')
        .then(res => setIsYoutubeLinked(!!res.data?.linked))
        .catch(e => console.error("Could not check youtube auth status", e));
    };
    checkAuthStatus();
    window.addEventListener('focus', checkAuthStatus);
    return () => window.removeEventListener('focus', checkAuthStatus);
  }, []);

  useEffect(() => {
    if (guest.trim()) {
      setLastGuest(guest);
      localStorage.setItem('crime-station-last-guest', guest);
    }
  }, [guest]);

  useEffect(() => {
    localStorage.setItem('crime-station-state', JSON.stringify({
      videoSource,
      driveUrl,
      series,
      host1,
      host2,
      guest,
      episodeNumber,
      isStarted,
      currentStep,
      selectedStepIndex,
      stepData,
      isApproved,
      publishLinks,
      selectedPlatform,
      currentRequestId,
    }));
  }, [videoSource, driveUrl, series, host1, host2, guest, episodeNumber, isStarted, currentStep, selectedStepIndex, stepData, isApproved, publishLinks, selectedPlatform, currentRequestId]);

  // Sync steps statuses with current progress when restoring or updating
  useEffect(() => {
    if (isStarted) {
      setSteps(prev => prev.map((s, idx) => {
        if (idx < currentStep) return { ...s, status: 'completed' };
        if (idx === currentStep) return { ...s, status: steps[currentStep].status || 'processing' };
        return { ...s, status: 'idle' };
      }));
    }
  }, [currentStep, isStarted]);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const seriesOptions = [
    'Crime Insight',
    'Crime Report',
    'Cold Cases: Never Give Up',
    'Schoffies',
    'Crime Business',
    'Daily Wely',
    'Online Security'
  ];

  const [steps, setSteps] = useState<Step[]>([
    { id: 1, title: 'Video Compressie', description: 'Downloaden en comprimeren naar proxy (10MB).', status: 'idle', icon: <Video className="w-5 h-5" /> },
    { id: 2, title: 'Transcriptie', description: 'Audio extraheren en transcriberen via Whisper.', status: 'idle', icon: <FileText className="w-5 h-5" /> },
    { id: 3, title: 'Tekstgeneratie', description: 'SEO titels en beschrijvingen genereren.', status: 'idle', icon: <Play className="w-5 h-5" /> },
    { id: 4, title: 'Goedkeuring', description: 'Review de gegenereerde content.', status: 'idle', icon: <CheckCircle2 className="w-5 h-5" /> },
    { id: 5, title: 'Publiceren', description: 'Uploaden naar YouTube en Spotify.', status: 'idle', icon: <Youtube className="w-5 h-5" /> },
  ]);

  // Lopende timer voor actieve stap
  useEffect(() => {
    const processingIdx = steps.findIndex(s => s.status === 'processing');
    if (processingIdx === -1) return;
    const interval = setInterval(() => {
      const start = stepStartTimes[processingIdx];
      if (start) setElapsedSeconds(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [steps, stepStartTimes]);

  // Geschatte duur per stap in seconden
  const getEstimatedSeconds = (stepIdx: number) => {
    const title = steps[stepIdx]?.title;
    if (title === 'Transcriptie') return fileSizeMb ? Math.max(120, Math.round(fileSizeMb * 5)) : 420;
    if (title === 'Tekstgeneratie') return 90;
    if (title === 'Video Compressie') return 45;
    if (title === 'Publiceren') return 120;
    return 120;
  };

  const handleStart = async () => {
    if (videoSource === 'drive' && !driveUrl) return;
    if (videoSource === 'local' && !localFile) return;
    setIsStarted(true);
    updateStepStatus(0, 'processing');
    
    try {
      const formData = new FormData();
      if (videoSource === 'local' && localFile) {
        formData.append('videoFile', localFile);
      } else if (videoSource === 'drive') {
        formData.append('driveUrl', driveUrl);
      }
      formData.append('series', series);
      formData.append('host1', host1);
      formData.append('host2', host2);
      formData.append('guest', guest);
      formData.append('episodeNumber', episodeNumber);

      const response = await axios.post('/api/process', formData);
      const data = response.data;
      
      if (data.status === 'waiting_approval') {
        updateStepStatus(0, 'completed');
        updateStepStatus(1, 'completed');
        updateStepStatus(2, 'completed');
        setStepData({
          0: "Video succesvol geüpload.",
          1: data.data?.transcription || "Geen transcriptie beschikbaar.",
          2: data.data?.artifact
        });
        setCurrentRequestId(data.data?.requestId || '');
        setHasSrt(!!data.data?.hasSrt);
        setSelectedStepIndex(2); // Laat de gegenereerde tekst standaard zien
        setSelectedPlatform('youtube');
        updateStepStatus(3, 'waiting');
      }
    } catch (error: any) {
      console.error(error);
      const errorMessage = error.response?.data?.error || '';
      const step = error.response?.data?.step;
      
      let errorStep = 0;
      if (typeof step === 'number' && step >= 0) {
        errorStep = step;
      } else if (errorMessage.includes('Step 2')) {
        errorStep = 1;
      } else if (errorMessage.includes('Step 3')) {
        errorStep = 2;
      }
      
      updateStepStatus(errorStep, 'error', errorMessage || error.message || 'Onbekende fout');
    }
  };

  const updateStepStatus = (index: number, status: StepStatus, errorMessage?: string) => {
    setSteps(prev => prev.map((s, i) => i === index ? { ...s, status, errorMessage } : s));
    setCurrentStep(index);
    if (status === 'processing') {
      setStepStartTimes(prev => ({ ...prev, [index]: Date.now() }));
      setElapsedSeconds(0);
    }
  };

  const handleApprove = async () => {
    setIsApproved(true);
    setPublishLinks(null);
    updateStepStatus(3, 'completed');
    updateStepStatus(4, 'processing');
    
    try {
      let payload: any = { requestId: currentRequestId };
      try {
        const content = stepData[2] || '';
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.youtube) payload.youtubeOverride = parsed.youtube;
        }
      } catch (e) {
        console.warn("Kon bewerkte tekst niet parsen, server gebruikt opgeslagen versie");
      }

      const response = await axios.post('/api/publish/youtube', payload);
      const data = response.data;
      
      if (data.status === 'completed') {
        updateStepStatus(4, 'completed');
        const links = (data?.links ?? {}) as PublishLinks;
        const youtubeUrl = typeof links.youtube === 'string' ? links.youtube : undefined;
        const spotifyUrl = typeof links.spotify === 'string' ? links.spotify : undefined;
        setPublishLinks({ youtube: youtubeUrl, spotify: spotifyUrl });

        // Vul [link] in de YouTube beschrijving met de Spotify URL (per-aflevering of show-URL als fallback)
        const resolvedSpotifyUrl = spotifyUrl || spotifyShowUrl || null;
        if (youtubeUrl && resolvedSpotifyUrl) {
          axios.post('/api/publish/update-spotify-link', { requestId: currentRequestId, spotifyUrl: resolvedSpotifyUrl })
            .catch(e => console.warn("Spotify link update mislukt:", e));
        }
        setStepData(prev => ({
          ...prev,
          4: 'Publicatie afgerond.'
        }));
        setSelectedStepIndex(4);
      }
    } catch (error) {
      console.error(error);
      updateStepStatus(4, 'error');
    }
  };

  const splitGeneratedContent = (content: string) => {
    if (!content) return null;

    try {
      // 1. Try to extract and clean JSON
      let jsonStr = content;
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      }

      let data;
      try {
        // LLMs generally output valid JSON now, we attempt to parse it directly.
        data = JSON.parse(jsonStr);
      } catch (err) {
        // Fallback for unescaped newlines if the strict parse fails
        const cleanedJson = jsonStr.replace(/[\u0000-\u0019]+/g, ""); 
        data = JSON.parse(cleanedJson);
      }
      
      if (data.youtube || data.spotify || data.website) {
        const formatSections = (platformData: any) => {
          if (!platformData) return "";
          let md = "";
          if (platformData.titel) md += `### 📝 Titel\n${platformData.titel}\n\n`;
          if (platformData.beschrijving) md += `### 📄 Beschrijving\n${platformData.beschrijving}\n\n`;
          if (platformData.hashtags) {
            const tags = Array.isArray(platformData.hashtags) ? platformData.hashtags.join(' ') : platformData.hashtags;
            md += `### 🏷️ Hashtags\n${tags}\n\n`;
          }
          if (platformData.seo_titel) md += `### 🔍 SEO Titel\n${platformData.seo_titel}\n\n`;
          if (platformData.url_slug) md += `### 🔗 URL Slug\n${platformData.url_slug}\n\n`;
          if (platformData.meta_description) md += `### 📋 Meta Description\n${platformData.meta_description}\n\n`;
          return md.trim();
        };

        return {
          youtube: formatSections(data.youtube),
          spotify: formatSections(data.spotify),
          website: formatSections(data.website)
        };
      }
    } catch (e) {
      console.warn("JSON parse fallback failed, trying Markdown markers", e);
    }

    // 2. Fallback to Markdown markers (including those with **YOUTUBE** bolding)
    const findSection = (platform: string) => {
      const regex = new RegExp(`(?:#{1,6}|\\*\\*)\\s*(?:[\\u2700-\\u2b55]\\s*)?${platform}\\b`, 'i');
      const start = content.search(regex);
      if (start === -1) return null;
      
      const rest = content.slice(start);
      // Find the next platform marker
      const nextMarkers = ['YouTube', 'Spotify', 'Website'].filter(p => p.toLowerCase() !== platform.toLowerCase());
      let end = rest.length;
      nextMarkers.forEach(p => {
        const nextRegex = new RegExp(`(?:#{1,6}|\\*\\*)\\s*(?:[\\u2700-\\u2b55]\\s*)?${p}\\b`, 'i');
        const nextMatch = rest.slice(1).search(nextRegex);
        if (nextMatch !== -1 && nextMatch + 1 < end) {
          end = nextMatch + 1;
        }
      });
      
      return rest.slice(0, end).trim();
    };

    const youtube = findSection('YouTube');
    const spotify = findSection('Spotify');
    const website = findSection('Website');

    if (!youtube && !spotify && !website) return null;

    return {
      youtube: youtube || '',
      spotify: spotify || '',
      website: website || ''
    };
  };



  const handleCopy = async (platform: string, text: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'absolute';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopiedPlatform(platform);
      window.setTimeout(() => setCopiedPlatform(null), 1200);
    } catch {
      setCopiedPlatform(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans selection:bg-orange-500/30">
      {/* Background Atmosphere */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-orange-900/10 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-orange-900/10 blur-[120px] rounded-full" />
      </div>

      <main className="relative z-10 max-w-5xl mx-auto px-6 py-12">
        {/* Header */}
        <header className="mb-16">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-orange-600 rounded flex items-center justify-center font-bold text-xl">CS</div>
            <h1 className="text-sm font-mono tracking-widest uppercase opacity-50">Crime Station Automation</h1>
          </div>
          <h2 className="text-5xl md:text-7xl font-bold tracking-tighter leading-none mb-6">
            CONTENT <span className="text-orange-600">HUB</span>
          </h2>
          <p className="text-gray-400 max-w-xl text-lg">
            Autonome verwerking van video naar podcast en SEO-geoptimaliseerde content.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            {/* YouTube */}
            {isYoutubeLinked ? (
              <div className="text-xs font-mono uppercase bg-green-600/20 text-green-500 border border-green-500/30 px-3 py-1.5 rounded flex items-center gap-2">
                <Check className="w-3 h-3" /> YouTube Gekoppeld
              </div>
            ) : (
              <a href="/api/auth/youtube" target="_blank" rel="noopener noreferrer" className="text-xs font-mono uppercase bg-red-600/20 text-red-500 border border-red-500/30 px-3 py-1.5 rounded flex items-center gap-2 hover:bg-red-600/40 transition-colors">
                <Youtube className="w-3 h-3" /> Koppel YouTube Account (Eenmalig)
              </a>
            )}

            {/* Spotify */}
            {spotifyShowUrl ? (
              <button
                onClick={() => { setSpotifyInput(spotifyShowUrl); setShowSpotifyModal(true); }}
                className="text-xs font-mono uppercase bg-green-600/20 text-green-500 border border-green-500/30 px-3 py-1.5 rounded flex items-center gap-2 hover:bg-green-600/30 transition-colors"
              >
                <Check className="w-3 h-3" /> Spotify Gekoppeld
              </button>
            ) : (
              <button
                onClick={() => { setSpotifyInput(''); setShowSpotifyModal(true); }}
                className="text-xs font-mono uppercase bg-red-600/20 text-red-500 border border-red-500/30 px-3 py-1.5 rounded flex items-center gap-2 hover:bg-red-600/40 transition-colors"
              >
                <Music className="w-3 h-3" /> Koppel Spotify Podcast (Eenmalig)
              </button>
            )}
          </div>
        </header>

        {/* Spotify modal */}
        <AnimatePresence>
          {showSpotifyModal && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
              onClick={() => setShowSpotifyModal(false)}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-full max-w-md"
                onClick={e => e.stopPropagation()}
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 bg-green-600 rounded flex items-center justify-center">
                    <Music className="w-4 h-4 text-white" />
                  </div>
                  <h3 className="text-lg font-bold">Spotify Podcast Koppelen</h3>
                </div>
                <p className="text-sm text-gray-400 mb-4">
                  Voer de URL in van je Spotify podcast show. Deze wordt automatisch gebruikt in beschrijvingen en links.
                </p>
                <input
                  type="url"
                  value={spotifyInput}
                  onChange={e => setSpotifyInput(e.target.value)}
                  placeholder="https://open.spotify.com/show/..."
                  className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-green-500 mb-4"
                  autoFocus
                />
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowSpotifyModal(false)}
                    className="flex-1 px-4 py-2.5 text-sm text-gray-400 border border-zinc-700 rounded-lg hover:bg-zinc-800 transition-colors"
                  >
                    Annuleren
                  </button>
                  <button
                    onClick={() => {
                      const url = spotifyInput.trim();
                      if (url) {
                        setSpotifyShowUrl(url);
                        localStorage.setItem('crime-station-spotify-url', url);
                      } else {
                        setSpotifyShowUrl('');
                        localStorage.removeItem('crime-station-spotify-url');
                      }
                      setShowSpotifyModal(false);
                    }}
                    className="flex-1 px-4 py-2.5 text-sm font-semibold bg-green-600 hover:bg-green-500 text-white rounded-lg transition-colors"
                  >
                    {spotifyInput.trim() ? 'Opslaan' : 'Ontkoppelen'}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {!isStarted ? (
          <motion.section 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="grid grid-cols-1 md:grid-cols-2 gap-12"
          >
            <div className="space-y-8">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-mono uppercase tracking-widest opacity-50">Bron Video</label>
                  <div className="flex gap-4">
                    <button 
                      onClick={() => { setVideoSource('drive'); }}
                      className={cn("text-[10px] font-mono uppercase tracking-tighter px-2 py-1 rounded border transition-all", videoSource === 'drive' ? "bg-orange-600 border-orange-600 text-white" : "border-white/10 text-white/40 hover:text-white")}
                    >Google Drive</button>
                    <button 
                      onClick={() => { setVideoSource('local'); }}
                      className={cn("text-[10px] font-mono uppercase tracking-tighter px-2 py-1 rounded border transition-all", videoSource === 'local' ? "bg-orange-600 border-orange-600 text-white" : "border-white/10 text-white/40 hover:text-white")}
                    >Lokaal Bestand</button>
                  </div>
                </div>
                
                {videoSource === 'drive' ? (
                  <input 
                    type="text" 
                    placeholder="https://drive.google.com/..."
                    value={driveUrl}
                    onChange={(e) => setDriveUrl(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-4 focus:outline-none focus:border-orange-600 transition-colors text-lg"
                  />
                ) : (
                  <div className="relative group overflow-hidden bg-white/5 border border-white/10 rounded-lg p-4 cursor-pointer hover:border-orange-600 transition-all">
                    <input 
                      type="file" 
                      accept="video/*,audio/*"
                      onChange={(e) => { const f = e.target.files?.[0] || null; setLocalFile(f); if (f) setFileSizeMb(f.size / 1024 / 1024); }}
                      className="absolute inset-0 opacity-0 cursor-pointer z-10"
                    />
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-orange-600/20 rounded flex items-center justify-center text-orange-600">
                        <Video className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="text-sm font-bold truncate max-w-[200px]">
                          {localFile ? localFile.name : "Kies een bestand..."}
                        </p>
                        <p className="text-[10px] opacity-40 uppercase tracking-widest">
                          {localFile ? `${(localFile.size / 1024 / 1024).toFixed(1)} MB` : "Klik of sleep hier"}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-xs font-mono uppercase tracking-widest opacity-50">Serie</label>
                  <select 
                    value={series}
                    onChange={(e) => setSeries(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-4 focus:outline-none focus:border-orange-600 transition-colors appearance-none"
                  >
                    {seriesOptions.map(opt => <option key={opt} value={opt} className="bg-zinc-900">{opt}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-mono uppercase tracking-widest opacity-50">Aflevering #</label>
                  <input
                    type="number"
                    min="1"
                    placeholder="bijv. 6"
                    value={episodeNumber}
                    onChange={(e) => setEpisodeNumber(e.target.value.replace(/\D/g, ''))}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-4 focus:outline-none focus:border-orange-600 transition-colors"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-mono uppercase tracking-widest opacity-50">Presentator 1</label>
                  <select
                    value={host1}
                    onChange={(e) => setHost1(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-4 focus:outline-none focus:border-orange-600 transition-colors appearance-none"
                  >
                    <option value="" className="bg-zinc-900">— Solo / geen presentator —</option>
                    {['Mick van Wely', 'Nancy Dekens', 'Aziz Akhath', 'Wickey van der Meijden', 'Arthur Brand', 'Lena Olivier', 'Roy Regterschot'].map(opt => <option key={opt} value={opt} className="bg-zinc-900">{opt}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-mono uppercase tracking-widest opacity-50">Presentator 2</label>
                  <select 
                    value={host2}
                    onChange={(e) => setHost2(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-4 focus:outline-none focus:border-orange-600 transition-colors appearance-none"
                  >
                    <option value="" className="bg-zinc-900">Geen / Leeg laten</option>
                    {['Mick van Wely', 'Nancy Dekens', 'Aziz Akhath', 'Wickey van der Meijden', 'Arthur Brand', 'Lena Olivier', 'Roy Regterschot'].map(opt => <option key={opt} value={opt} className="bg-zinc-900">{opt}</option>)}
                  </select>
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <div className="flex items-center justify-between gap-3">
                    <label className="text-xs font-mono uppercase tracking-widest opacity-50">Naam Gast</label>
                    <button
                      type="button"
                      onClick={() => setGuest(guest === 'Geen gast' ? '' : 'Geen gast')}
                      className={`text-[10px] font-mono uppercase tracking-tighter px-2 py-1 rounded border transition-all ${guest === 'Geen gast' ? 'bg-orange-600 border-orange-600 text-white' : 'border-white/10 text-white/40 hover:text-white'}`}
                    >
                      ✓ Geen gast
                    </button>
                  </div>
                  <input
                    type="text"
                    placeholder="Naam van de gast"
                    value={guest}
                    onChange={(e) => setGuest(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-4 focus:outline-none focus:border-orange-600 transition-colors"
                  />
                  {lastGuest && guest !== lastGuest && guest !== 'Geen gast' && (
                    <button
                      type="button"
                      onClick={() => setGuest(lastGuest)}
                      className="text-xs text-orange-400 hover:text-orange-300 transition-colors"
                    >
                      ↩ Vorige gast: {lastGuest}
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <button
                  onClick={handleStart}
                  disabled={(videoSource === 'drive' && !driveUrl) || (videoSource === 'local' && !localFile) || !isYoutubeLinked}
                  className="w-full bg-orange-600 hover:bg-orange-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-5 rounded-lg transition-all flex items-center justify-center gap-3 text-xl uppercase tracking-tighter"
                >
                  Start Verwerking <Play className="w-6 h-6 fill-current" />
                </button>
                {!isYoutubeLinked && (
                  <p className="text-xs text-red-400 text-center flex items-center justify-center gap-1">
                    <AlertCircle className="w-3 h-3" /> Koppel eerst je YouTube account via de knop bovenaan
                  </p>
                )}
              </div>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-2xl p-8 flex flex-col justify-between">
              <div>
                <h3 className="text-xl font-bold mb-4">Agent Mission</h3>
                <ul className="space-y-4 text-gray-400">
                  <li className="flex gap-3">
                    <CheckCircle2 className="w-5 h-5 text-orange-600 shrink-0" />
                    <span>Download & Compressie (FFmpeg)</span>
                  </li>
                  <li className="flex gap-3">
                    <CheckCircle2 className="w-5 h-5 text-orange-600 shrink-0" />
                    <span>Transcriptie via Whisper</span>
                  </li>
                  <li className="flex gap-3">
                    <CheckCircle2 className="w-5 h-5 text-orange-600 shrink-0" />
                    <span>SEO Tekstgeneratie (YouTube/Spotify)</span>
                  </li>
                  <li className="flex gap-3">
                    <CheckCircle2 className="w-5 h-5 text-orange-600 shrink-0" />
                    <span>Publicatie naar YouTube & Spotify</span>
                  </li>
                </ul>
              </div>
              <div className="mt-8 pt-8 border-t border-white/10">
                <p className="text-sm text-gray-500 italic">
                  "Jij bent een autonome video- en podcast-automatisering agent voor het merk Crime Station."
                </p>
              </div>
            </div>
          </motion.section>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
            {/* Progress Sidebar */}
            <div className="lg:col-span-1 space-y-4">
              <h3 className="text-xs font-mono uppercase tracking-widest opacity-50 mb-6">Voortgang</h3>
              {steps.filter(step => step.title !== 'Goedkeuring').map((step) => {
                const idx = steps.indexOf(step);
                return (
                <button
                  key={step.id}
                  onClick={() => {
                    if (step.status === 'completed' || step.status === 'waiting' || step.status === 'processing') {
                      setSelectedStepIndex(idx);
                    }
                  }}
                  disabled={step.status === 'idle'}
                  className={cn(
                    "w-full text-left relative p-4 rounded-xl border transition-all duration-500",
                    selectedStepIndex === idx ? "ring-2 ring-orange-600 ring-offset-2 ring-offset-black" : "",
                    step.status === 'processing' ? "bg-orange-600/10 border-orange-600/50" : 
                    step.status === 'completed' ? "bg-green-500/5 border-green-500/20 opacity-80" :
                    step.status === 'waiting' ? "bg-blue-500/10 border-blue-500/50 animate-pulse" :
                    step.status === 'error' ? "bg-red-500/10 border-red-500/50" :
                    "bg-white/5 border-white/10 opacity-40 cursor-not-allowed"
                  )}
                >
                  <div className="flex items-center gap-4">
                    <div className={cn(
                      "w-10 h-10 rounded-lg flex items-center justify-center shrink-0",
                      step.status === 'processing' ? "bg-orange-600 text-white" :
                      step.status === 'completed' ? "bg-green-500 text-white" :
                      step.status === 'waiting' ? "bg-blue-500 text-white" :
                      step.status === 'error' ? "bg-red-500 text-white" :
                      "bg-white/10 text-gray-400"
                    )}>
                      {step.status === 'processing' ? <Loader2 className="w-5 h-5 animate-spin" /> :
                       step.status === 'completed' ? <Check className="w-5 h-5" /> :
                       step.status === 'error' ? <AlertCircle className="w-5 h-5" /> :
                       step.icon}
                    </div>
                    <div className="min-w-0">
                      <h4 className="font-bold text-sm">{step.title}</h4>
                      {step.status === 'processing' && (step.title === 'Transcriptie' || step.title === 'Tekstgeneratie') && (
                        <p className="text-xs text-orange-400 font-mono mt-0.5">{formatTime(elapsedSeconds)}</p>
                      )}
                    </div>
                  </div>
                </button>
                );
              })}
            </div>

            {/* Main Content Area */}
            <div className="lg:col-span-3">
              <AnimatePresence mode="wait">
                {steps[currentStep].status === 'error' ? (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="flex flex-col items-center justify-center h-[400px] text-center bg-red-500/5 border border-red-500/10 rounded-2xl p-8"
                  >
                    <AlertCircle className="w-12 h-12 text-red-500 mb-6" />
                    <h3 className="text-2xl font-bold mb-2">Er is iets misgegaan!</h3>
                    <p className="text-gray-500 mb-4 max-w-md">Stap: <strong>{steps[currentStep]?.title}</strong></p>
                    {steps[currentStep]?.errorMessage && (
                      <pre className="text-left text-xs text-red-300 bg-red-950/50 border border-red-500/20 rounded-lg p-4 mb-4 max-w-lg w-full overflow-auto max-h-48 whitespace-pre-wrap break-words">
                        {steps[currentStep].errorMessage}
                      </pre>
                    )}
                    <div className="flex gap-3">
                      <button
                        onClick={() => { updateStepStatus(currentStep, 'processing'); handleStart(); }}
                        className="bg-orange-600 hover:bg-orange-500 text-white px-6 py-3 rounded-lg font-bold transition-all flex items-center gap-2"
                      >
                        <RotateCcw className="w-4 h-4" /> Opnieuw proberen
                      </button>
                      <button
                        onClick={() => { localStorage.removeItem('crime-station-state'); setIsStarted(false); setSteps(prev => prev.map(s => ({ ...s, status: 'idle' }))); setStepData({}); setSelectedStepIndex(null); }}
                        className="bg-zinc-800 hover:bg-zinc-700 text-white px-6 py-3 rounded-lg font-bold transition-all"
                      >
                        Terug naar Instellingen
                      </button>
                    </div>
                  </motion.div>
                ) : selectedStepIndex !== null && stepData[selectedStepIndex] ? (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="bg-zinc-900/50 border border-white/10 rounded-2xl p-8"
                  >
                    <div className="flex items-center justify-between mb-8">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-orange-600/20 rounded-xl flex items-center justify-center text-orange-600">
                          {steps[selectedStepIndex].icon}
                        </div>
                        <div>
                          <h3 className="text-2xl font-bold">{steps[selectedStepIndex].title}</h3>
                          <p className="text-sm text-gray-500">{steps[selectedStepIndex].description}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {selectedStepIndex === 2 && !isApproved && steps[selectedStepIndex]?.title === 'Tekstgeneratie' && (
                          isEditing ? (
                            <button
                              onClick={() => {
                                setStepData(prev => ({ ...prev, [selectedStepIndex]: editText }));
                                setIsEditing(false);
                              }}
                              className="bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded-lg font-bold transition-all flex items-center gap-2"
                            >
                              <Check className="w-4 h-4" /> Opslaan
                            </button>
                          ) : (
                            <>
                              <button
                                onClick={() => {
                                  setEditText(stepData[selectedStepIndex] || '');
                                  setIsEditing(true);
                                }}
                                className="border border-white/20 bg-white/5 hover:bg-white/10 text-white px-4 py-2 rounded-lg font-bold transition-all flex items-center gap-2 whitespace-nowrap"
                              >
                                <Pencil className="w-4 h-4" /> Tekst bewerken
                              </button>
                              <button
                                onClick={() => setShowPublishConfirm(true)}
                                className="bg-orange-600 hover:bg-orange-500 text-white px-5 py-2 rounded-lg font-bold transition-all flex items-center gap-2"
                              >
                                <Youtube className="w-4 h-4" /> Publiceren <ChevronRight className="w-4 h-4" />
                              </button>
                            </>
                          )
                        )}
                        {selectedStepIndex !== null && selectedStepIndex !== 0 && selectedStepIndex !== 2 && (
                          <button
                            onClick={() => {
                              if (isEditing) {
                                setStepData(prev => ({ ...prev, [selectedStepIndex]: editText }));
                                setIsEditing(false);
                              } else {
                                setEditText(stepData[selectedStepIndex] || '');
                                setIsEditing(true);
                              }
                            }}
                            className={cn(
                              "p-2 rounded-lg transition-all flex items-center gap-2 font-bold",
                              isEditing
                                ? "bg-green-600 text-white hover:bg-green-500"
                                : "bg-white/5 text-gray-400 hover:text-white hover:bg-white/10"
                            )}
                            title={isEditing ? "Opslaan" : "Bewerken"}
                          >
                            {isEditing ? <><Check className="w-4 h-4" /> Opslaan</> : <Pencil className="w-4 h-4" />}
                          </button>
                        )}
                      </div>
                    </div>
                    
                    {isEditing ? (
                      <textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        className="w-full h-[500px] bg-black/40 border border-white/10 rounded-xl p-6 text-gray-200 font-mono text-sm focus:outline-none focus:border-orange-500/50 resize-none"
                        placeholder="Bewerk de tekst hier..."
                      />
                    ) : selectedStepIndex === 2 ? (
                      (() => {
                        const content = stepData[selectedStepIndex];
                        const sections = splitGeneratedContent(content);
                        if (!sections) {
                          return (
                            <div className="prose prose-invert max-w-none prose-orange bg-black/30 rounded-xl p-6 border border-white/5 whitespace-pre-wrap">
                              <ReactMarkdown>{content}</ReactMarkdown>
                            </div>
                          );
                        }

                        const activeText = selectedPlatform === 'youtube' 
                          ? sections.youtube 
                          : selectedPlatform === 'spotify' 
                            ? sections.spotify 
                            : sections.website;

                        return (
                          <div className="bg-black/30 rounded-xl border border-white/5 overflow-hidden">
                            <div className="flex items-center justify-between gap-4 p-4 border-b border-white/5">
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => setSelectedPlatform('youtube')}
                                  className={cn(
                                    "px-3 py-2 rounded-lg border text-xs font-mono uppercase tracking-widest transition-all flex items-center gap-2",
                                    selectedPlatform === 'youtube'
                                      ? "bg-orange-600 border-orange-600 text-white"
                                      : "bg-white/5 border-white/10 text-white/50 hover:text-white"
                                  )}
                                >
                                  <Youtube className="w-4 h-4" /> YouTube
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setSelectedPlatform('spotify')}
                                  className={cn(
                                    "px-3 py-2 rounded-lg border text-xs font-mono uppercase tracking-widest transition-all flex items-center gap-2",
                                    selectedPlatform === 'spotify'
                                      ? "bg-orange-600 border-orange-600 text-white"
                                      : "bg-white/5 border-white/10 text-white/50 hover:text-white"
                                  )}
                                >
                                  <Music className="w-4 h-4" /> Spotify
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setSelectedPlatform('website')}
                                  className={cn(
                                    "px-3 py-2 rounded-lg border text-xs font-mono uppercase tracking-widest transition-all flex items-center gap-2",
                                    selectedPlatform === 'website'
                                      ? "bg-orange-600 border-orange-600 text-white"
                                      : "bg-white/5 border-white/10 text-white/50 hover:text-white"
                                  )}
                                >
                                  <Globe className="w-4 h-4" /> Website
                                </button>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleCopy(`${selectedPlatform}-all`, activeText)}
                                className="px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-white/70 hover:text-white transition-all flex items-center gap-2 text-xs font-mono uppercase tracking-widest"
                              >
                                <Copy className="w-4 h-4" />
                                {copiedPlatform === `${selectedPlatform}-all` ? "Gekopieerd" : "Kopieer Alles"}
                              </button>
                            </div>
                            <div className="p-6 space-y-6">
                              {(() => {
                                const parts = activeText.split(/###\s+(.*)/g);
                                if (parts.length <= 1) {
                                  return (
                                    <div className="prose prose-invert max-w-none prose-orange whitespace-pre-wrap">
                                      <ReactMarkdown>{activeText}</ReactMarkdown>
                                    </div>
                                  );
                                }
                                
                                const sections = [];
                                for (let i = 1; i < parts.length; i += 2) {
                                  sections.push({
                                    title: parts[i],
                                    content: (parts[i + 1] ?? '').replace(/^\s*---\s*$/gm, '').trim()
                                  });
                                }

                                return sections.map((section, idx) => {
                                  const isTitel = section.title.includes('Titel') || section.title.includes('titel');
                                  const charCount = section.content.length;
                                  const isOverLimit = selectedPlatform === 'youtube' && isTitel && charCount > 100;
                                  return (
                                  <div key={idx} className="bg-white/5 border border-white/10 rounded-xl p-4 relative group">
                                    <div className="flex items-center justify-between mb-4 pb-4 border-b border-white/5">
                                      <div className="flex items-center gap-2">
                                        <h4 className="font-bold text-lg text-orange-500">{section.title}</h4>
                                        {selectedPlatform === 'youtube' && isTitel && (
                                          <span className={cn("text-xs font-mono px-2 py-0.5 rounded", isOverLimit ? "bg-red-500/20 text-red-400" : "bg-white/10 text-white/40")}>
                                            {charCount}/100
                                          </span>
                                        )}
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => handleCopy(`${selectedPlatform}-${idx}`, section.content)}
                                        className="px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 text-white/70 hover:text-white transition-all flex items-center gap-2 text-xs font-mono uppercase tracking-widest"
                                      >
                                        <Copy className="w-3 h-3" />
                                        {copiedPlatform === `${selectedPlatform}-${idx}` ? "Gekopieerd" : "Kopieer"}
                                      </button>
                                    </div>
                                    <div className="prose prose-invert max-w-none prose-orange prose-sm whitespace-pre-wrap [&_p]:my-1 [&_p]:leading-relaxed">
                                      <ReactMarkdown>{section.content}</ReactMarkdown>
                                    </div>
                                  </div>
                                  );
                                })}
                              )()}
                            </div>
                          </div>
                        );
                      })()
                    ) : selectedStepIndex === 4 ? (
                      <div className="bg-black/30 rounded-xl border border-white/5 overflow-hidden">
                        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                          {/* YouTube */}
                          <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex flex-col gap-3">
                            <h4 className="font-bold text-lg text-orange-500 flex items-center gap-2">
                              <Youtube className="w-4 h-4" /> YouTube
                            </h4>
                            {publishLinks?.youtube ? (
                              <>
                                <div className="flex items-center gap-2 bg-black/20 rounded-lg px-3 py-2">
                                  <span className="text-sm text-gray-300 break-all font-mono flex-1">{publishLinks.youtube}</span>
                                  <button
                                    type="button"
                                    onClick={() => handleCopy('publish-youtube', publishLinks.youtube ?? '')}
                                    className="shrink-0 text-white/40 hover:text-white transition-colors"
                                    title="Kopieer link"
                                  >
                                    {copiedPlatform === 'publish-youtube' ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                                  </button>
                                </div>
                                <a
                                  href={publishLinks.youtube}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-orange-600 hover:bg-orange-500 text-white font-bold text-sm transition-all"
                                >
                                  <ExternalLink className="w-4 h-4" /> Bekijk op YouTube
                                </a>
                              </>
                            ) : (
                              <div className="text-sm text-gray-500">Nog geen YouTube-link ontvangen.</div>
                            )}
                          </div>

                          {/* Spotify */}
                          <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex flex-col gap-3">
                            <h4 className="font-bold text-lg text-green-400 flex items-center gap-2">
                              <Music className="w-4 h-4" /> Spotify
                            </h4>
                            {publishLinks?.spotify ? (
                              <>
                                <div className="flex items-center gap-2 bg-black/20 rounded-lg px-3 py-2">
                                  <span className="text-sm text-gray-300 break-all font-mono flex-1">{publishLinks.spotify}</span>
                                  <button
                                    type="button"
                                    onClick={() => handleCopy('publish-spotify', publishLinks.spotify ?? '')}
                                    className="shrink-0 text-white/40 hover:text-white transition-colors"
                                    title="Kopieer link"
                                  >
                                    {copiedPlatform === 'publish-spotify' ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                                  </button>
                                </div>
                                <a
                                  href={publishLinks.spotify}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-green-600 hover:bg-green-500 text-white font-bold text-sm transition-all"
                                >
                                  <ExternalLink className="w-4 h-4" /> Bekijk op Spotify
                                </a>
                              </>
                            ) : (
                              <div className="text-sm text-gray-500 italic">Spotify-publicatie binnenkort beschikbaar.</div>
                            )}
                          </div>
                        </div>

                        {/* Nieuwe aflevering starten */}
                        {publishLinks?.youtube && (
                          <div className="mt-6 pt-6 border-t border-white/10 flex justify-center">
                            <button
                              onClick={() => {
                                setIsStarted(false);
                                setSteps(prev => prev.map(s => ({ ...s, status: 'idle' })));
                                setStepData({});
                                setSelectedStepIndex(null);
                                setIsApproved(false);
                                setPublishLinks(null);
                                setDriveUrl('');
                                setLocalFile(null);
                                setGuest('');
                                setEpisodeNumber('');
                                localStorage.removeItem('crime-station-state');
                              }}
                              className="flex items-center gap-2 px-6 py-3 rounded-lg border border-orange-600/40 bg-orange-600/10 text-orange-500 hover:bg-orange-600/20 font-bold transition-all"
                            >
                              <RotateCcw className="w-4 h-4" /> Nieuwe aflevering starten
                            </button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div>
                        {selectedStepIndex === 1 && hasSrt && currentRequestId && (
                          <div className="mb-4">
                            <a
                              href={`/api/download/srt/${currentRequestId}`}
                              download
                              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-orange-600/50 bg-orange-600/10 text-orange-500 hover:bg-orange-600/20 transition-all text-xs font-mono uppercase tracking-widest"
                            >
                              <ExternalLink className="w-3 h-3" /> Download SRT bestand
                            </a>
                          </div>
                        )}
                        <div className="prose prose-invert max-w-none prose-orange bg-black/30 rounded-xl p-6 border border-white/5">
                          <ReactMarkdown>{stepData[selectedStepIndex]}</ReactMarkdown>
                        </div>
                      </div>
                    )}

                    {selectedStepIndex === 2 && isApproved && (
                      <motion.div 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="mt-8 p-6 bg-green-500/10 border border-green-500/20 rounded-xl flex items-center gap-4"
                      >
                        <div className="w-12 h-12 bg-green-500 rounded-full flex items-center justify-center">
                          <CheckCircle2 className="w-6 h-6 text-white" />
                        </div>
                        <div>
                          <h4 className="font-bold text-green-500">Goedgekeurd!</h4>
                          <p className="text-sm text-gray-400">De agent is nu bezig met het uploaden naar YouTube en Spotify.</p>
                        </div>
                      </motion.div>
                    )}
                  </motion.div>
                ) : (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex flex-col items-center justify-center h-[400px] text-center px-8"
                  >
                    <Loader2 className="w-12 h-12 text-orange-600 animate-spin mb-6" />
                    {steps[currentStep].title === 'Publiceren' ? (
                      <>
                        <h3 className="text-2xl font-bold mb-2">Uploaden naar YouTube...</h3>
                        <p className="text-gray-500 max-w-sm mb-8">De video wordt nu geüpload. Dit kan enkele minuten duren.</p>
                      </>
                    ) : steps[currentStep].title === 'Video Compressie' ? (
                      <>
                        <h3 className="text-2xl font-bold mb-2">Video Compressie Bezig...</h3>
                        <p className="text-gray-500 max-w-sm mb-8">De video wordt gedownload en gecomprimeerd via FFmpeg.</p>
                      </>
                    ) : steps[currentStep].title === 'Transcriptie' ? (
                      <>
                        <h3 className="text-2xl font-bold mb-2">Transcriptie Bezig...</h3>
                        <p className="text-gray-500 max-w-sm mb-8">Whisper transcribeert de audio. Voor een aflevering van ~1 uur duurt dit gemiddeld 5–10 minuten.</p>
                      </>
                    ) : steps[currentStep].title === 'Tekstgeneratie' ? (
                      <>
                        <h3 className="text-2xl font-bold mb-2">Teksten Genereren...</h3>
                        <p className="text-gray-500 max-w-sm mb-8">Gemini analyseert het transcript en schrijft SEO-teksten voor YouTube en Spotify.</p>
                      </>
                    ) : (
                      <>
                        <h3 className="text-2xl font-bold mb-2">Verwerking Bezig...</h3>
                        <p className="text-gray-500 mb-8">De agent voert momenteel {steps[currentStep].title.toLowerCase()} uit.</p>
                      </>
                    )}
                    {/* Timer + voortgangsbalk */}
                    {(steps[currentStep].title === 'Video Compressie' || steps[currentStep].title === 'Transcriptie' || steps[currentStep].title === 'Tekstgeneratie' || steps[currentStep].title === 'Publiceren') && (() => {
                      const estimated = getEstimatedSeconds(currentStep);
                      const progress = Math.min(elapsedSeconds / estimated, 0.97);
                      const remaining = Math.max(estimated - elapsedSeconds, 0);
                      return (
                        <div className="w-full max-w-sm space-y-3">
                          <div className="w-full bg-white/10 rounded-full h-2 overflow-hidden">
                            <motion.div
                              className="h-full bg-orange-600 rounded-full"
                              initial={{ width: 0 }}
                              animate={{ width: `${progress * 100}%` }}
                              transition={{ duration: 0.8, ease: 'easeOut' }}
                            />
                          </div>
                          <div className="flex justify-between text-xs font-mono text-gray-500">
                            <span>⏱ Verstreken: <span className="text-white">{formatTime(elapsedSeconds)}</span></span>
                            {elapsedSeconds < estimated ? (
                              <span>Nog ~<span className="text-white">{formatTime(remaining)}</span></span>
                            ) : (
                              <span className="text-orange-400">Bijna klaar...</span>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </motion.div>
                )}

                {/* Bevestigingsdialog publiceren */}
                {showPublishConfirm && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="bg-zinc-900 border border-white/10 rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl"
                    >
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 bg-orange-600/20 rounded-xl flex items-center justify-center">
                          <Youtube className="w-5 h-5 text-orange-500" />
                        </div>
                        <h3 className="text-xl font-bold">Publiceren naar YouTube</h3>
                      </div>
                      <p className="text-gray-400 mb-2 text-sm">De video wordt gepubliceerd met de gegenereerde titel, beschrijving en tags. De video verschijnt als <strong className="text-white">privé</strong> op YouTube.</p>
                      <p className="text-gray-500 text-sm mb-6">Wil je de tekst eerst aanpassen? Klik op <span className="text-white font-medium">← Terug, tekst bewerken</span>.</p>
                      <div className="flex gap-3">
                        <button
                          onClick={() => setShowPublishConfirm(false)}
                          className="flex-1 border border-white/10 bg-white/5 hover:bg-white/10 text-white px-4 py-2.5 rounded-lg font-bold transition-all flex items-center justify-center gap-2"
                        >
                          ← Terug, tekst bewerken
                        </button>
                        <button
                          onClick={() => { setShowPublishConfirm(false); handleApprove(); }}
                          className="flex-1 bg-orange-600 hover:bg-orange-500 text-white px-4 py-2.5 rounded-lg font-bold transition-all flex items-center justify-center gap-2"
                        >
                          <Youtube className="w-4 h-4" /> Ja, publiceren
                        </button>
                      </div>
                    </motion.div>
                  </div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
