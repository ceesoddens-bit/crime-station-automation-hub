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
    }));
  }, [videoSource, driveUrl, series, host1, host2, guest, episodeNumber, isStarted, currentStep, selectedStepIndex, stepData, isApproved, publishLinks, selectedPlatform]);

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
    { id: 2, title: 'Transcriptie', description: 'Audio extraheren en transcriberen via Gemini.', status: 'idle', icon: <FileText className="w-5 h-5" /> },
    { id: 3, title: 'Tekstgeneratie', description: 'SEO titels en beschrijvingen genereren.', status: 'idle', icon: <Play className="w-5 h-5" /> },
    { id: 4, title: 'Goedkeuring', description: 'Review de gegenereerde content.', status: 'idle', icon: <CheckCircle2 className="w-5 h-5" /> },
    { id: 5, title: 'Publiceren', description: 'Uploaden naar YouTube en Spotify.', status: 'idle', icon: <Youtube className="w-5 h-5" /> },
  ]);

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
          0: "Video is succesvol gedownload en gecomprimeerd naar 10MB (proxy voor verwerking).",
          1: data.data?.transcription || "Geen transcriptie beschikbaar.",
          2: data.data?.artifact
        });
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
      
      updateStepStatus(errorStep, 'error');
    }
  };

  const updateStepStatus = (index: number, status: StepStatus) => {
    setSteps(prev => prev.map((s, i) => i === index ? { ...s, status } : s));
    setCurrentStep(index);
  };

  const handleApprove = async () => {
    setIsApproved(true);
    setPublishLinks(null);
    updateStepStatus(3, 'completed');
    updateStepStatus(4, 'processing');
    
    try {
      const response = await axios.post('/api/approve', { approved: true });
      const data = response.data;
      
      if (data.status === 'completed') {
        updateStepStatus(4, 'completed');
        const links = (data?.links ?? {}) as PublishLinks;
        setPublishLinks({
          youtube: typeof links.youtube === 'string' ? links.youtube : undefined,
          spotify: typeof links.spotify === 'string' ? links.spotify : undefined,
        });
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

      // Handle unescaped newlines in JSON values (common LLM error)
      // This is a rough fix: replace raw newlines within string values with \n
      const cleanedJson = jsonStr.replace(/: "(.*?)",/gs, (match, p1) => {
        return `: "${p1.replace(/\n/g, '\\n')}",`;
      }).replace(/: "(.*?)"\n?}/gs, (match, p1) => {
        return `: "${p1.replace(/\n/g, '\\n')}"}`;
      });

      const data = JSON.parse(cleanedJson);
      
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
        </header>

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
                      onChange={(e) => setLocalFile(e.target.files?.[0] || null)}
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
                    type="text" 
                    placeholder="bijv. 6"
                    value={episodeNumber}
                    onChange={(e) => setEpisodeNumber(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-4 focus:outline-none focus:border-orange-600 transition-colors"
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <label className="text-xs font-mono uppercase tracking-widest opacity-50">Presentator 1</label>
                    <button
                      type="button"
                      onClick={() => setHost1('Mick van Wely')}
                      className="text-[10px] font-mono uppercase tracking-tighter px-2 py-1 rounded border border-white/10 text-white/40 hover:text-white transition-all"
                    >
                      ✓ Mick van Wely
                    </button>
                  </div>
                  <input 
                    type="text" 
                    placeholder="bijv. Mick van Wely"
                    value={host1}
                    onChange={(e) => setHost1(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-4 focus:outline-none focus:border-orange-600 transition-colors"
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <label className="text-xs font-mono uppercase tracking-widest opacity-50">Presentator 2</label>
                    <button
                      type="button"
                      onClick={() => setHost2('Amber Bordewijk')}
                      className="text-[10px] font-mono uppercase tracking-tighter px-2 py-1 rounded border border-white/10 text-white/40 hover:text-white transition-all"
                    >
                      ✓ Amber Bordewijk
                    </button>
                  </div>
                  <input 
                    type="text" 
                    placeholder="bijv. Amber Bordewijk"
                    value={host2}
                    onChange={(e) => setHost2(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-4 focus:outline-none focus:border-orange-600 transition-colors"
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <div className="flex items-center justify-between gap-3">
                    <label className="text-xs font-mono uppercase tracking-widest opacity-50">Naam Gast</label>
                    <div className="flex items-center gap-2">
                      {lastGuest && lastGuest !== guest ? (
                        <button
                          type="button"
                          onClick={() => setGuest(lastGuest)}
                          className="text-[10px] font-mono uppercase tracking-tighter px-2 py-1 rounded border border-white/10 text-white/40 hover:text-white transition-all"
                        >
                          ✓ Laatste gast
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => setGuest('')}
                        className="text-[10px] font-mono uppercase tracking-tighter px-2 py-1 rounded border border-white/10 text-white/40 hover:text-white transition-all"
                      >
                        ✓ Geen gast
                      </button>
                    </div>
                  </div>
                  <input 
                    type="text" 
                    placeholder="Naam van de gast"
                    value={guest}
                    onChange={(e) => setGuest(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-4 focus:outline-none focus:border-orange-600 transition-colors"
                  />
                </div>
              </div>

              <button 
                onClick={handleStart}
                disabled={(videoSource === 'drive' && !driveUrl) || (videoSource === 'local' && !localFile)}
                className="w-full bg-orange-600 hover:bg-orange-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-5 rounded-lg transition-all flex items-center justify-center gap-3 text-xl uppercase tracking-tighter"
              >
                Start Verwerking <Play className="w-6 h-6 fill-current" />
              </button>
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
                    <span>Transcriptie via Gemini API</span>
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
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
            {/* Progress Sidebar */}
            <div className="lg:col-span-1 space-y-4">
              <h3 className="text-xs font-mono uppercase tracking-widest opacity-50 mb-6">Voortgang</h3>
              {steps.map((step, idx) => (
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
                      "w-10 h-10 rounded-lg flex items-center justify-center",
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
                    <div>
                      <h4 className="font-bold text-sm">{step.title}</h4>
                      <p className="text-xs opacity-60">{step.description}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>

            {/* Main Content Area */}
            <div className="lg:col-span-2">
              <AnimatePresence mode="wait">
                {steps[currentStep].status === 'error' ? (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="flex flex-col items-center justify-center h-[400px] text-center bg-red-500/5 border border-red-500/10 rounded-2xl p-8"
                  >
                    <AlertCircle className="w-12 h-12 text-red-500 mb-6" />
                    <h3 className="text-2xl font-bold mb-2">Er is iets misgegaan!</h3>
                    <p className="text-gray-500 mb-8 max-w-md">De verwerking van de video is mislukt door een onbekende fout of ongeldige invoer.</p>
                    <button 
                      onClick={() => { localStorage.removeItem('crime-station-state'); setIsStarted(false); setSteps(prev => prev.map(s => ({ ...s, status: 'idle' }))); setStepData({}); setSelectedStepIndex(null); }}
                      className="bg-zinc-800 hover:bg-zinc-700 text-white px-8 py-3 rounded-lg font-bold transition-all"
                    >
                      Terug naar Instellingen
                    </button>
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
                        {selectedStepIndex !== null && (
                          <button 
                            onClick={() => {
                              if (isEditing) {
                                // Save changes
                                setStepData(prev => ({ ...prev, [selectedStepIndex]: editText }));
                                setIsEditing(false);
                              } else {
                                // Start editing
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
                        {selectedStepIndex === 2 && !isApproved && !isEditing && (
                          <button 
                            onClick={handleApprove}
                            className="bg-green-600 hover:bg-green-500 text-white px-6 py-2 rounded-lg font-bold transition-all flex items-center gap-2"
                          >
                            Goedgekeurd <Check className="w-4 h-4" />
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

                                return sections.map((section, idx) => (
                                  <div key={idx} className="bg-white/5 border border-white/10 rounded-xl p-4 relative group">
                                    <div className="flex items-center justify-between mb-4 pb-4 border-b border-white/5">
                                      <h4 className="font-bold text-lg text-orange-500">{section.title}</h4>
                                      <button
                                        type="button"
                                        onClick={() => handleCopy(`${selectedPlatform}-${idx}`, section.content)}
                                        className="px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 text-white/70 hover:text-white transition-all flex items-center gap-2 text-xs font-mono uppercase tracking-widest"
                                      >
                                        <Copy className="w-3 h-3" />
                                        {copiedPlatform === `${selectedPlatform}-${idx}` ? "Gekopieerd" : "Kopieer"}
                                      </button>
                                    </div>
                                    <div className="prose prose-invert max-w-none prose-orange prose-sm whitespace-pre-wrap">
                                      <ReactMarkdown>{section.content}</ReactMarkdown>
                                    </div>
                                  </div>
                                ));
                              })()}
                            </div>
                          </div>
                        );
                      })()
                    ) : selectedStepIndex === 4 ? (
                      <div className="bg-black/30 rounded-xl border border-white/5 overflow-hidden">
                        <div className="flex items-center justify-between gap-4 p-4 border-b border-white/5">
                          <div className="flex items-center gap-2">
                            <div className="px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-white/70 text-xs font-mono uppercase tracking-widest flex items-center gap-2">
                              <Share2 className="w-4 h-4" /> Links
                            </div>
                          </div>
                          {publishLinks?.youtube || publishLinks?.spotify ? (
                            <button
                              type="button"
                              onClick={() => handleCopy('publish-all', [publishLinks?.youtube, publishLinks?.spotify].filter(Boolean).join('\n'))}
                              className="px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-white/70 hover:text-white transition-all flex items-center gap-2 text-xs font-mono uppercase tracking-widest"
                            >
                              <Copy className="w-4 h-4" />
                              {copiedPlatform === 'publish-all' ? 'Gekopieerd' : 'Kopieer Alles'}
                            </button>
                          ) : null}
                        </div>
                        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                            <div className="flex items-center justify-between mb-4 pb-4 border-b border-white/5">
                              <h4 className="font-bold text-lg text-orange-500 flex items-center gap-2"><Youtube className="w-4 h-4" /> YouTube</h4>
                              {publishLinks?.youtube ? (
                                <div className="flex items-center gap-2">
                                  <a
                                    href={publishLinks.youtube}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 text-white/70 hover:text-white transition-all flex items-center gap-2 text-xs font-mono uppercase tracking-widest"
                                  >
                                    <ExternalLink className="w-3 h-3" /> Open
                                  </a>
                                  <button
                                    type="button"
                                    onClick={() => handleCopy('publish-youtube', publishLinks.youtube ?? '')}
                                    className="px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 text-white/70 hover:text-white transition-all flex items-center gap-2 text-xs font-mono uppercase tracking-widest"
                                  >
                                    <Copy className="w-3 h-3" />
                                    {copiedPlatform === 'publish-youtube' ? 'Gekopieerd' : 'Kopieer'}
                                  </button>
                                </div>
                              ) : null}
                            </div>
                            {publishLinks?.youtube ? (
                              <div className="text-sm text-gray-300 break-words font-mono">{publishLinks.youtube}</div>
                            ) : (
                              <div className="text-sm text-gray-500">Nog geen YouTube-link ontvangen.</div>
                            )}
                          </div>

                          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                            <div className="flex items-center justify-between mb-4 pb-4 border-b border-white/5">
                              <h4 className="font-bold text-lg text-green-400 flex items-center gap-2"><Music className="w-4 h-4" /> Spotify</h4>
                              {publishLinks?.spotify ? (
                                <div className="flex items-center gap-2">
                                  <a
                                    href={publishLinks.spotify}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 text-white/70 hover:text-white transition-all flex items-center gap-2 text-xs font-mono uppercase tracking-widest"
                                  >
                                    <ExternalLink className="w-3 h-3" /> Open
                                  </a>
                                  <button
                                    type="button"
                                    onClick={() => handleCopy('publish-spotify', publishLinks.spotify ?? '')}
                                    className="px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 text-white/70 hover:text-white transition-all flex items-center gap-2 text-xs font-mono uppercase tracking-widest"
                                  >
                                    <Copy className="w-3 h-3" />
                                    {copiedPlatform === 'publish-spotify' ? 'Gekopieerd' : 'Kopieer'}
                                  </button>
                                </div>
                              ) : null}
                            </div>
                            {publishLinks?.spotify ? (
                              <div className="text-sm text-gray-300 break-words font-mono">{publishLinks.spotify}</div>
                            ) : (
                              <div className="text-sm text-gray-500">Nog geen Spotify-link ontvangen.</div>
                            )}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="prose prose-invert max-w-none prose-orange bg-black/30 rounded-xl p-6 border border-white/5">
                        <ReactMarkdown>{stepData[selectedStepIndex]}</ReactMarkdown>
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
                    className="flex flex-col items-center justify-center h-[400px] text-center"
                  >
                    <Loader2 className="w-12 h-12 text-orange-600 animate-spin mb-6" />
                    <h3 className="text-2xl font-bold mb-2">Verwerking Bezig...</h3>
                    <p className="text-gray-500">De agent voert momenteel {steps[currentStep].title.toLowerCase()} uit.</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
