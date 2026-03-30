import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { cn } from './lib/utils';
import { 
  Play, 
  CheckCircle2, 
  Loader2, 
  Video, 
  FileText, 
  Youtube, 
  Podcast, 
  ExternalLink,
  AlertCircle,
  Check
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

export default function App() {
  const [driveUrl, setDriveUrl] = useState('');
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
  
  // Load state from localStorage on mount
  useEffect(() => {
    const savedState = localStorage.getItem('crime-station-state');
    if (savedState) {
      try {
        const parsed = JSON.parse(savedState);
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
      } catch (e) {
        console.error("Failed to load saved state", e);
      }
    }
  }, []);

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
    if (!driveUrl) return;
    setIsStarted(true);
    updateStepStatus(0, 'processing');
    
    try {
      const response = await axios.post('/api/process', { 
        driveUrl, series, host1, host2, guest, episodeNumber 
      });
      const data = response.data;
      
      if (data.status === 'waiting_approval') {
        updateStepStatus(0, 'completed');
        updateStepStatus(1, 'completed');
        updateStepStatus(2, 'completed');
        setStepData({
          0: "Video is succesvol gedownload en gecomprimeerd naar 10MB (proxy voor verwerking).",
          1: data.transcription || "Geen transcriptie beschikbaar.",
          2: data.artifact
        });
        setSelectedStepIndex(2); // Laat de gegenereerde tekst standaard zien
        updateStepStatus(3, 'waiting');
      }
    } catch (error) {
      console.error(error);
      updateStepStatus(currentStep, 'error');
    }
  };

  const updateStepStatus = (index: number, status: StepStatus) => {
    setSteps(prev => prev.map((s, i) => i === index ? { ...s, status } : s));
    setCurrentStep(index);
  };

  const handleApprove = async () => {
    setIsApproved(true);
    updateStepStatus(3, 'completed');
    updateStepStatus(4, 'processing');
    
    try {
      const response = await axios.post('/api/approve', { approved: true });
      const data = response.data;
      
      if (data.status === 'completed') {
        updateStepStatus(4, 'completed');
        // Optionally show links
      }
    } catch (error) {
      console.error(error);
      updateStepStatus(4, 'error');
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
              <div className="space-y-2">
                <label className="text-xs font-mono uppercase tracking-widest opacity-50">Google Drive Link</label>
                <input 
                  type="text" 
                  placeholder="https://drive.google.com/..."
                  value={driveUrl}
                  onChange={(e) => setDriveUrl(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-4 focus:outline-none focus:border-orange-600 transition-colors text-lg"
                />
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
                  <label className="text-xs font-mono uppercase tracking-widest opacity-50">Presentator 1</label>
                  <input 
                    type="text" 
                    placeholder="bijv. Mick van Wely"
                    value={host1}
                    onChange={(e) => setHost1(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-4 focus:outline-none focus:border-orange-600 transition-colors"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-mono uppercase tracking-widest opacity-50">Presentator 2</label>
                  <input 
                    type="text" 
                    placeholder="bijv. Amber Bordewijk"
                    value={host2}
                    onChange={(e) => setHost2(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-4 focus:outline-none focus:border-orange-600 transition-colors"
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <label className="text-xs font-mono uppercase tracking-widest opacity-50">Naam Gast</label>
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
                disabled={!driveUrl}
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
                      {selectedStepIndex === 2 && !isApproved && (
                        <button 
                          onClick={handleApprove}
                          className="bg-green-600 hover:bg-green-500 text-white px-6 py-2 rounded-lg font-bold transition-all flex items-center gap-2"
                        >
                          Goedgekeurd <Check className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                    
                    <div className="prose prose-invert max-w-none prose-orange bg-black/30 rounded-xl p-6 border border-white/5">
                      <ReactMarkdown>{stepData[selectedStepIndex]}</ReactMarkdown>
                    </div>

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
