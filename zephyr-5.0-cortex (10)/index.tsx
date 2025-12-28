
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleGenAI, Modality } from "@google/genai";
import { Message, Role } from './types';
import { selectAgent, generateImage } from './agentManager';

const helperMessages = [
  "Ask anything — concepts, ideas, or doubts.",
  "Stuck on something? Let’s break it down.",
  "Need a clear explanation or example?",
  "Ready to learn something new today?",
  "Homework, ideas, or curiosity — I’ve got you.",
];

// Use marked and hljs from CDN
declare var marked: any;
declare var hljs: any;

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

// --- Audio Utilities ---
const decodeBase64 = (base64: string) => {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
};

const decodeAudioData = async (
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> => {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
};

// --- Markdown Configuration ---
if (typeof window !== 'undefined' && typeof marked !== 'undefined') {
  const renderer = new marked.Renderer();
  
  renderer.code = (arg1: any, arg2: any) => {
    let codeText: string;
    let language: string;

    if (typeof arg1 === 'object' && arg1 !== null) {
      codeText = arg1.text || '';
      language = arg1.lang || '';
    } else {
      codeText = arg1 || '';
      language = arg2 || '';
    }

    const encodedCode = encodeURIComponent(codeText);
    const langLabel = language || 'code';
    
    let highlighted;
    if (typeof hljs !== 'undefined') {
      try {
        if (language && hljs.getLanguage(language)) {
          highlighted = hljs.highlight(codeText, { language }).value;
        } else {
          highlighted = hljs.highlightAuto(codeText).value;
        }
      } catch (err) {
        highlighted = codeText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      }
    } else {
      highlighted = codeText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    return `
      <div class="w-full my-4 rounded-xl overflow-hidden bg-[#1a1b26] border border-zinc-800/80 shadow-xl animate-fade-in group/code not-prose max-w-full">
        <div class="flex items-center justify-between px-4 py-2 bg-[#16161e]/90 backdrop-blur-sm border-b border-white/5">
          <div class="flex items-center gap-2">
            <div class="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]"></div>
            <span class="text-[9px] font-mono text-zinc-400 select-none uppercase tracking-widest font-bold">${langLabel}</span>
          </div>
          <button 
            data-code="${encodedCode}"
            class="js-copy-code flex items-center gap-1.5 text-[9px] text-zinc-400 hover:text-white transition-all bg-white/5 hover:bg-white/10 px-2.5 py-1 rounded-lg select-none border border-zinc-700/50 hover:border-zinc-500 active:scale-95"
            title="Copy code"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            <span class="font-bold tracking-tight">COPY</span>
          </button>
        </div>
        <div class="p-4 overflow-x-auto scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent max-w-full">
          <pre class="w-full"><code class="text-[13px] font-mono leading-relaxed hljs ${language ? 'language-' + language : ''}">${highlighted}</code></pre>
        </div>
      </div>
    `;
  };
  marked.use({ renderer });
}

// --- Icons ---
const Icons = {
  Send: () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>,
  Mic: () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="19" x2="16" y2="19"></line></svg>,
  MicActive: () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17.657 16.657L13.414 20.9a1.998 1.998 0 0 1-2.827 0l-4.244-4.243a8 8 0 1 1 11.314 0z"></path></svg>,
  Paperclip: () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>,
  X: () => <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>,
  Menu: () => <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>,
  Sun: () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>,
  Moon: () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>,
  Plus: () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>,
  Trash: () => <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2 2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>,
  Bot: () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>,
  User: () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>,
  Sparkles: () => <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l2.6 7.4L22 12l-7.4 2.6L12 22l-2.6-7.4L2 12l7.4-2.6L12 2z"/><circle cx="18" cy="6" r="1.5"/></svg>,
  Newspaper: () => <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/><path d="M18 14h-8"/><path d="M15 18h-5"/><path d="M10 6h8v4h-8V6Z"/></svg>,
  Beaker: () => <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4.5 3h15"/><path d="M6 3v16a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V3"/><path d="M6 14h12"/></svg>,
  Terminal: () => <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>,
  Feather: () => <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z"></path><line x1="16" y1="8" x2="2" y2="22"></line><line x1="17.5" y1="15" x2="9" y2="15"></line></svg>,
  Copy: () => <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>,
  Check: () => <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>,
  Download: () => <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>,
  Search: () => <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>,
  Speaker: () => <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>,
  Map: () => <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"></polygon><line x1="8" y1="2" x2="8" y2="18"></line><line x1="16" y1="6" x2="16" y2="22"></line></svg>,
  Image: () => <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>,
  Chat: () => <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>,
};

// --- Components ---

const LoadingScreen = () => (
  <div className="bg-white dark:bg-zinc-950 h-screen flex items-center justify-center font-sans overflow-hidden">
    <div className="loading-container z-10 flex flex-col items-center gap-3 animate-fade-in">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="40"
        height="40"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-blue-600 dark:text-purple-400 drop-shadow-sm"
      >
        <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" />
      </svg>
      <div className="logo-text text-5xl sm:text-6xl">Zephyr</div>
      <div className="credit-text flex items-center justify-center gap-2">
        <span className="by-text text-[10px] sm:text-xs opacity-70">engineered by</span>
        <span className="company-text text-[10px] sm:text-xs text-zinc-900 dark:text-zinc-100 font-bold tracking-wide">Quantum Coders</span>
      </div>
    </div>
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-blue-100/40 via-transparent to-transparent dark:from-blue-900/10 dark:via-transparent dark:to-transparent pointer-events-none"></div>
  </div>
);

const CopyButton = ({ text }: { text: string }) => {
  const [isCopied, setIsCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) { console.error('Failed to copy text: ', err); }
  };
  return (
    <button onClick={handleCopy} className="p-1 rounded-md text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100/50 dark:hover:bg-zinc-800/50 transition-all opacity-0 group-hover:opacity-100 focus:opacity-100" title="Copy to clipboard">
      {isCopied ? <Icons.Check /> : <Icons.Copy />}
    </button>
  );
};

const SpeakerButton = ({ text, audioBuffer, onBufferReady }: { text: string, audioBuffer?: AudioBuffer, onBufferReady: (buffer: AudioBuffer) => void }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);

  const handlePlay = async () => {
    if (isPlaying) {
      sourceRef.current?.stop();
      setIsPlaying(false);
      return;
    }

    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }

    const play = (buffer: AudioBuffer) => {
      if (!audioContextRef.current) return;
      const source = audioContextRef.current.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContextRef.current.destination);
      source.onended = () => setIsPlaying(false);
      source.start();
      sourceRef.current = source;
      setIsPlaying(true);
    };

    if (audioBuffer) {
      play(audioBuffer);
      return;
    }

    setIsLoading(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        const buffer = await decodeAudioData(
          decodeBase64(base64Audio),
          audioContextRef.current,
          24000,
          1,
        );
        onBufferReady(buffer);
        play(buffer);
      }
    } catch (err) {
      console.error('Speech synthesis failed:', err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <button onClick={handlePlay} disabled={isLoading} className={`p-1 rounded-md transition-all opacity-0 group-hover:opacity-100 focus:opacity-100 flex items-center gap-1.5 ${isPlaying ? 'text-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'text-zinc-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:text-blue-400 dark:hover:bg-blue-900/20'} ${isLoading ? 'cursor-wait animate-pulse' : ''}`} title="Listen to message">
      <div className={isPlaying ? 'animate-pulse' : ''}><Icons.Speaker /></div>
      <span className="text-[9px] font-bold tracking-tight uppercase">{isLoading ? 'Loading...' : isPlaying ? 'Playing...' : 'Listen'}</span>
    </button>
  );
};

const DownloadButton = ({ url }: { url: string }) => {
  const handleDownload = async () => {
    try {
        const response = await fetch(url, { mode: 'cors', credentials: 'omit' });
        if (!response.ok) throw new Error(`Failed to fetch image`);
        const blob = await response.blob();
        const blobUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = `zephyr-image-${Date.now()}.jpg`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(blobUrl);
    } catch (e) {
        console.warn("Direct download failed, falling back to new tab.", e);
        window.open(url, '_blank');
    }
  };
  return (
    <button onClick={handleDownload} className="p-1 rounded-md text-zinc-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:text-blue-400 dark:hover:bg-blue-900/20 transition-all opacity-0 group-hover:opacity-100 focus:opacity-100 flex items-center gap-1.5" title="Download Image">
      <Icons.Download />
      <span className="text-[9px] font-bold tracking-tight uppercase">Download</span>
    </button>
  );
};

// --- Message Component ---
const ChatMessage = React.memo(({ msg, onSetAudioBuffer }: { msg: AppMessage; onSetAudioBuffer: (id: string, buffer: AudioBuffer) => void }) => {
  const renderedText = useMemo(() => {
    try {
      if (typeof marked !== 'undefined' && marked.parse) {
        return { __html: marked.parse(msg.text) };
      }
    } catch (e) {
      console.error('Markdown parse error:', e);
    }
    return { __html: msg.text.replace(/\n/g, '<br/>') };
  }, [msg.text]);

  const isUser = msg.role === Role.USER;

  return (
    <div className={`flex w-full group animate-fade-in py-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`flex gap-3 sm:gap-4 w-full ${isUser ? 'max-w-[85%] sm:max-w-[65%] md:max-w-[55%] flex-row-reverse' : 'flex-1 flex-row items-start'}`}>
        
        {/* Avatar */}
        <div className={`w-8 h-8 sm:w-9 sm:h-9 rounded-lg flex items-center justify-center shrink-0 shadow-sm transition-transform duration-300 group-hover:scale-105 ${isUser ? 'bg-blue-600 text-white' : 'bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-purple-600 dark:text-purple-400'}`}>
          {isUser ? <Icons.User /> : <Icons.Bot />}
        </div>

        {/* Content Area */}
        <div className={`flex flex-col flex-1 min-w-0 ${isUser ? 'items-end' : 'items-start'}`}>
          
          {!isUser && msg.agentName && <AgentBadge name={msg.agentName} />}
          
          {/* Message Content Container - Word Wrap Fixed */}
          <div className={`w-full transition-all duration-300 overflow-hidden break-words ${isUser 
            ? 'rounded-xl px-4 py-2.5 bg-blue-600 text-white rounded-tr-none shadow-lg shadow-blue-500/10 text-sm' 
            : 'bg-transparent text-zinc-800 dark:text-zinc-200 py-0.5'}`}>
            
            {msg.image && (
              <div className="relative group/img mb-3 rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-800 shadow-sm">
                <img src={msg.image} alt="Upload" className="max-w-full h-auto" />
                <div className="absolute inset-0 bg-black/0 group-hover/img:bg-black/10 transition-all duration-300 flex items-center justify-center">
                  <Icons.Sparkles />
                </div>
              </div>
            )}

            {msg.isLoading ? (
              <div className="flex items-center space-x-1 py-1">
                <div className="w-1 h-1 bg-zinc-400 rounded-full animate-bounce"></div>
                <div className="w-1 h-1 bg-zinc-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                <div className="w-1 h-1 bg-zinc-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
              </div>
            ) : msg.type === 'image' ? (
              <div className="space-y-3 py-1">
                <div className="rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-800 shadow-xl max-w-xl">
                  <img src={msg.text} alt="AI Generated" className="w-full h-auto transition-transform duration-700 hover:scale-[1.01]" />
                </div>
              </div>
            ) : (
              <div className={`prose prose-sm leading-relaxed break-words max-w-none w-full ${isUser ? 'prose-invert text-white' : 'dark:prose-invert text-zinc-800 dark:text-zinc-200 font-medium'}`} dangerouslySetInnerHTML={renderedText} />
            )}
          </div>

          {/* Footer Controls & Sources */}
          <div className={`flex flex-col gap-2 mt-2 ${isUser ? 'items-end text-right' : 'items-start text-left'} w-full`}>
            {msg.sources && msg.sources.length > 0 && (
              <div className={`flex flex-wrap gap-1.5 py-0.5 ${isUser ? 'justify-end' : 'justify-start'}`}>
                {msg.sources.map((source, i) => (
                  <a key={i} href={source.uri} target="_blank" rel="noopener noreferrer" className="group/src inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-900/50 text-[9px] text-zinc-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-all border border-zinc-200 dark:border-zinc-800 active:scale-95 shadow-sm">
                    <div className="transition-transform group-hover/src:rotate-12 scale-75">{source.uri.includes('google.com/maps') ? <Icons.Map /> : <Icons.Search />}</div>
                    <span className="truncate max-w-[120px] font-bold tracking-tight uppercase tracking-widest">{source.title}</span>
                  </a>
                ))}
              </div>
            )}
            
            {msg.text && !msg.isLoading && (
              <div className={`flex items-center gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
                <CopyButton text={msg.text} />
                {!isUser && msg.type !== 'image' && (
                  <SpeakerButton 
                    text={msg.text} 
                    audioBuffer={msg.audioBuffer} 
                    onBufferReady={(buffer) => onSetAudioBuffer(msg.id!, buffer)} 
                  />
                )}
                {msg.type === 'image' && <DownloadButton url={msg.text} />}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

interface GalleryItem {
  url: string;
  chatIndex: number;
  messageId: string;
}

const HistorySidebar = ({ isOpen, onClose, history, onLoadChat, onDeleteChat, onNewChat, generatedImages, onDeleteImage }: {
    isOpen: boolean; onClose: () => void; history: Message[][]; onLoadChat: (index: number) => void; onDeleteChat: (index: number) => void; onNewChat: () => void; generatedImages: GalleryItem[]; onDeleteImage: (item: GalleryItem) => void;
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState<'sessions' | 'gallery'>('sessions');

  const filteredHistory = history
    .map((chat, index) => ({ chat, index }))
    .filter(({ chat }) => {
        const firstUserMsg = chat.find(m => m.role === Role.USER);
        const title = firstUserMsg?.text || (firstUserMsg?.image ? "Image uploaded" : "New Conversation");
        return title.toLowerCase().includes(searchTerm.toLowerCase());
    });

  const filteredImages = generatedImages.filter(img => img.url.toLowerCase().includes(searchTerm.toLowerCase()));

  return (
    <>
      <div className={`fixed inset-y-0 left-0 z-50 w-72 max-w-[80vw] bg-white/95 dark:bg-zinc-950/95 backdrop-blur-2xl border-r border-zinc-200 dark:border-zinc-800 transform transition-transform duration-500 cubic-bezier(0.16, 1, 0.3, 1) ${isOpen ? 'translate-x-0' : '-translate-x-full'}`} aria-modal="true" role="dialog">
        <div className="flex flex-col h-full">
          <div className="p-4 flex justify-between items-center">
            <h2 className="text-[10px] font-black tracking-[0.2em] text-zinc-800 dark:text-zinc-100 uppercase">Library</h2>
            <button onClick={onClose} className="p-1.5 -mr-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 transition-colors" aria-label="Close history">
              <Icons.X />
            </button>
          </div>

          <div className="px-4 mb-4">
            <div className="flex p-0.5 bg-zinc-100 dark:bg-zinc-900 rounded-xl">
              <button 
                onClick={() => setActiveTab('sessions')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[9px] font-black uppercase tracking-widest rounded-lg transition-all ${activeTab === 'sessions' ? 'bg-white dark:bg-zinc-800 text-blue-600 shadow-sm' : 'text-zinc-500'}`}
              >
                <Icons.Chat /> Sessions
              </button>
              <button 
                onClick={() => setActiveTab('gallery')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[9px] font-black uppercase tracking-widest rounded-lg transition-all ${activeTab === 'gallery' ? 'bg-white dark:bg-zinc-800 text-blue-600 shadow-sm' : 'text-zinc-500'}`}
              >
                <Icons.Image /> Gallery
              </button>
            </div>
          </div>

          <div className="px-4 pb-3">
              <div className="relative group">
                  <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400 group-focus-within:text-blue-500 transition-colors scale-75"><Icons.Search /></div>
                  <input type="text" placeholder={activeTab === 'sessions' ? "Search..." : "Images..."} value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-8 pr-3 py-2 bg-zinc-100 dark:bg-zinc-900 border border-transparent focus:border-blue-500/50 rounded-xl text-[10px] outline-none text-zinc-700 dark:text-zinc-200 placeholder:text-zinc-400 transition-all font-bold" />
              </div>
          </div>

          {activeTab === 'sessions' && (
            <div className="px-4 pb-4 border-b border-zinc-100 dark:border-zinc-900">
              <button onClick={onNewChat} className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-600 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-500/10 active:scale-[0.98]"><Icons.Plus />New Chat</button>
            </div>
          )}

          <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5">
            {activeTab === 'sessions' ? (
                filteredHistory.length === 0 ? (
                    <div className="flex flex-col items-center justify-center mt-8 text-zinc-400 dark:text-zinc-600 space-y-1.5 opacity-60">
                        <Icons.Bot />
                        <p className="text-[9px] font-black uppercase tracking-widest">No results</p>
                    </div>
                ) : (
                    filteredHistory.map(({ chat, index }) => (
                        <div key={index} className="group flex items-center gap-0.5">
                            <button onClick={() => onLoadChat(index)} className="flex-1 flex items-center p-2 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-all text-left group-hover:translate-x-0.5">
                                <span className="truncate text-[11px] font-bold text-zinc-700 dark:text-zinc-300">
                                {chat.find(m => m.role === Role.USER)?.text || (chat.find(m => m.role === Role.USER)?.image ? "Moment" : "Untitled")}
                                </span>
                            </button>
                            <button onClick={() => onDeleteChat(index)} className="p-1.5 rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 opacity-0 group-hover:opacity-100 transition-all" aria-label="Delete chat"><Icons.Trash /></button>
                        </div>
                    ))
                )
            ) : (
              filteredImages.length === 0 ? (
                <div className="flex flex-col items-center justify-center mt-8 text-zinc-400 dark:text-zinc-600 space-y-1.5 opacity-60">
                    <Icons.Image />
                    <p className="text-[9px] font-black uppercase tracking-widest">No art</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2 p-1">
                  {filteredImages.map((item, i) => (
                    <div key={i} className="group/gallery-item relative aspect-square rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900 shadow-sm">
                      <img src={item.url} alt={`AI Art ${i}`} className="w-full h-full object-cover transition-transform duration-700 group-hover/gallery-item:scale-110" />
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover/gallery-item:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1.5 p-1">
                        <div className="flex items-center gap-1">
                          <button 
                            onClick={() => window.open(item.url, '_blank')}
                            className="p-1.5 bg-white/20 hover:bg-white/40 backdrop-blur-md rounded-lg text-white transition-all scale-90"
                          >
                            <Icons.Search />
                          </button>
                        </div>
                        <button 
                          onClick={() => onDeleteImage(item)}
                          className="p-1.5 bg-red-500/80 hover:bg-red-600 rounded-lg text-white transition-all scale-90 mt-0.5"
                        >
                          <Icons.Trash />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}
          </nav>
        </div>
      </div>
      {isOpen && <div className="fixed inset-0 bg-zinc-950/40 backdrop-blur-md z-40 transition-opacity duration-500" onClick={onClose}></div>}
    </>
  );
};

const AgentBadge = ({ name }: { name: string }) => {
    let Icon = Icons.Bot;
    let color = "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400";
    let border = "border-zinc-200 dark:border-zinc-700";
    if (name === "News Agent") { Icon = Icons.Newspaper; color = "bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300"; border = "border-blue-200 dark:border-blue-800"; }
    else if (name === "Science Agent") { Icon = Icons.Beaker; color = "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300"; border = "border-emerald-200 dark:border-emerald-800"; }
    else if (name === "Coder Agent") { Icon = Icons.Terminal; color = "bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300"; border = "border-amber-200 dark:border-amber-800"; }
    else if (name === "Creative Agent") { Icon = Icons.Feather; color = "bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-300"; border = "border-purple-200 dark:border-purple-800"; }
    return (
        <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[8px] uppercase tracking-[0.15em] font-black border ${color} ${border} mb-2 animate-fade-in`}>
            <Icon />{name}
        </div>
    );
};

const SuggestionCard = ({ text, subtext, onClick, icon: Icon }: { text: string, subtext: string, onClick: () => void, icon?: any }) => (
    <button onClick={onClick} className="flex flex-col items-start text-left p-4 bg-white dark:bg-zinc-900/50 border border-zinc-100 dark:border-zinc-800 rounded-2xl hover:border-blue-500 dark:hover:border-blue-500 hover:shadow-xl transition-all group h-full w-full backdrop-blur-sm active:scale-[0.98]">
        <div className="mb-3 p-2 bg-zinc-50 dark:bg-zinc-800 rounded-xl group-hover:bg-blue-600 group-hover:text-white transition-all duration-300 scale-90">{Icon ? <Icon /> : <Icons.Sparkles />}</div>
        <span className="font-black text-zinc-800 dark:text-zinc-100 text-[11px] mb-1 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors uppercase tracking-tight">{text}</span>
        <span className="text-[10px] text-zinc-500 dark:text-zinc-400 leading-snug font-medium">{subtext}</span>
    </button>
);

const processImage = (file: File): Promise<{ data: string; mimeType: string; url: string }> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width, height = img.height, maxDim = 1536; 
        if (width > maxDim || height > maxDim) { const ratio = Math.min(maxDim / width, maxDim / height); width *= ratio; height *= ratio; }
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error("Canvas context unavailable")); return; }
        ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, width, height); ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        resolve({ url: dataUrl, data: dataUrl.split(',')[1], mimeType: 'image/jpeg' });
      };
      img.onerror = () => reject(new Error("Failed to load image"));
      if (typeof e.target?.result === 'string') img.src = e.target.result; else reject(new Error("File read failed"));
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

interface AppMessage extends Message {
    audioBuffer?: AudioBuffer;
}

const App = () => {
  const [showLoadingScreen, setShowLoadingScreen] = useState(true);
  const [messages, setMessages] = useState<AppMessage[]>([]);
  const [input, setInput] = useState('');
  const [attachment, setAttachment] = useState<{ url: string; data: string; mimeType: string } | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [chatHistory, setChatHistory] = useState<AppMessage[][]>([]);
  const [theme, setTheme] = useState(() => {
    if (typeof window !== 'undefined' && window.localStorage) {
      const storedTheme = window.localStorage.getItem('zephyr-theme');
      if (storedTheme) return storedTheme;
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'light';
  });

  const recognitionRef = useRef<any>(null);
  const messagesEndRef = useRef<null | HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [helperText, setHelperText] = useState("");

  useEffect(() => { setHelperText(helperMessages[Math.floor(Math.random() * helperMessages.length)]); }, []);
  useEffect(() => {
    if (theme === 'dark') { document.documentElement.classList.add('dark'); localStorage.setItem('zephyr-theme', 'dark'); }
    else { document.documentElement.classList.remove('dark'); localStorage.setItem('zephyr-theme', 'light'); }
  }, [theme]);
  
  // Fast 600ms artificial delay for better UX
  useEffect(() => { const timer = setTimeout(() => setShowLoadingScreen(false), 600); return () => clearTimeout(timer); }, []);
  
  useEffect(() => {
    const handleGlobalCopyClick = async (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const btn = target.closest('.js-copy-code');
      if (btn) {
        const encodedCode = btn.getAttribute('data-code');
        if (encodedCode) {
          try {
            const code = decodeURIComponent(encodedCode);
            await navigator.clipboard.writeText(code);
            const originalHtml = btn.innerHTML;
            btn.innerHTML = `
              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="text-emerald-500"><polyline points="20 6 9 17 4 12"></polyline></svg>
              <span class="text-emerald-500 font-bold tracking-tight uppercase tracking-widest text-[8px]">Done</span>
            `;
            setTimeout(() => { btn.innerHTML = originalHtml; }, 2000);
          } catch (err) {
            console.error('Failed to copy code:', err);
          }
        }
      }
    };
    window.addEventListener('click', handleGlobalCopyClick);
    return () => window.removeEventListener('click', handleGlobalCopyClick);
  }, []);

  useEffect(() => { 
    try { 
        const savedHistory = localStorage.getItem('zephyrChatHistory'); 
        if (savedHistory) setChatHistory(JSON.parse(savedHistory)); 
    } catch (e) {} 
  }, []);

  useEffect(() => { 
    try { 
        const serializableHistory = chatHistory.map(chat => chat.map(({ audioBuffer, ...rest }) => rest));
        localStorage.setItem('zephyrChatHistory', JSON.stringify(serializableHistory)); 
    } catch (e) {} 
  }, [chatHistory]);

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false; recognition.interimResults = false; recognition.lang = 'en-US';
      recognition.onstart = () => setIsRecording(true);
      recognition.onresult = (event: any) => setInput(event.results[0][0].transcript);
      recognition.onend = () => setIsRecording(false);
      recognitionRef.current = recognition;
    }
  }, []);

  const scrollToBottom = () => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); };
  useEffect(() => { if (!showLoadingScreen) scrollToBottom(); }, [messages, showLoadingScreen, attachment]);

  const archiveCurrentChat = () => { if (messages.length > 0) setChatHistory(prev => [messages, ...prev]); };
  const startNewChat = () => { archiveCurrentChat(); setMessages([]); setAttachment(null); setInput(''); setIsHistoryOpen(false); };
  const loadChat = (index: number) => { archiveCurrentChat(); setMessages(chatHistory[index]); setChatHistory(prev => prev.filter((_, i) => i !== index)); setIsHistoryOpen(false); };
  const deleteChat = (index: number) => { setChatHistory(prev => prev.filter((_, i) => i !== index)); };

  const getCurrentPosition = (): Promise<GeolocationPosition> => {
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 });
    });
  };

  const setAudioBufferForMessage = useCallback((id: string, buffer: AudioBuffer) => {
    setMessages(prev => prev.map(m => m.id === id ? { ...m, audioBuffer: buffer } : m));
  }, []);

  const allGeneratedImages = useMemo(() => {
    const gallery: GalleryItem[] = [];
    messages.forEach(m => {
      if (m.role === Role.MODEL && m.type === 'image' && !m.isLoading && m.text && m.id) {
        gallery.push({ url: m.text, chatIndex: -1, messageId: m.id });
      }
    });
    chatHistory.forEach((chat, cIdx) => {
      chat.forEach(m => {
        if (m.role === Role.MODEL && m.type === 'image' && !m.isLoading && m.text && m.id) {
          gallery.push({ url: m.text, chatIndex: cIdx, messageId: m.id });
        }
      });
    });
    return gallery.reverse();
  }, [chatHistory, messages]);

  const handleDeleteImage = useCallback((item: GalleryItem) => {
    if (item.chatIndex === -1) {
      setMessages(prev => prev.filter(m => m.id !== item.messageId));
    } else {
      setChatHistory(prev => {
        const newHistory = [...prev];
        const chatToModify = [...newHistory[item.chatIndex]];
        const updatedChat = chatToModify.filter(m => m.id !== item.messageId);
        if (updatedChat.length === 0) return prev.filter((_, i) => i !== item.chatIndex);
        newHistory[item.chatIndex] = updatedChat;
        return newHistory;
      });
    }
  }, []);

  const sendMessage = async (messageText: string, imageAttachment?: { data: string; mimeType: string; url: string }) => {
    if (isProcessing || (!messageText.trim() && !imageAttachment)) return;
    setIsProcessing(true);

    const userMsgId = Date.now().toString() + '-user';
    const placeholderId = Date.now().toString() + '-model';

    const userMessage: AppMessage = { 
        role: Role.USER, 
        text: messageText.trim(),
        image: imageAttachment?.url,
        id: userMsgId,
        isLoading: false
    };

    const lowerCaseInput = messageText.trim().toLowerCase();
    
    if (lowerCaseInput.startsWith("/image ")) {
        const prompt = messageText.trim().substring(7);
        if (prompt) {
            setMessages(prev => [...prev, userMessage, { 
                role: Role.MODEL, 
                text: '', 
                type: 'image', 
                agentName: "Creative Agent", 
                id: placeholderId, 
                isLoading: true 
            }]);
            setInput(''); setAttachment(null);
            
            try {
              const imageUrl = await generateImage(prompt);
              if (imageUrl) {
                  setMessages(prev => prev.map(m => m.id === placeholderId ? { ...m, text: imageUrl, isLoading: false } : m));
              } else {
                  setMessages(prev => prev.map(m => m.id === placeholderId ? { ...m, text: "Failed to generate image. Please try again.", isLoading: false } : m));
              }
            } catch (e) {
              setMessages(prev => prev.map(m => m.id === placeholderId ? { ...m, text: "Error generating image.", isLoading: false } : m));
            } finally {
              setIsProcessing(false);
            }
            return;
        }
    }

    const selectedAgent = await selectAgent(messageText);
    const agentName = selectedAgent ? selectedAgent.name : "Zephyr";

    setMessages(prev => [...prev, userMessage, { 
        role: Role.MODEL, 
        text: '', 
        agentName: agentName, 
        id: placeholderId, 
        isLoading: true 
    }]);
    setInput(''); setAttachment(null);
    
    if (!imageAttachment) {
        if (/\b(time|date)\b/.test(lowerCaseInput)) {
            setMessages(prev => prev.map(m => m.id === placeholderId ? { ...m, text: `The current date and time is: ${new Date().toLocaleString()} 🕒`, isLoading: false } : m));
            setIsProcessing(false);
            return;
        }
        if (/\b(developed you|your developer|your creator|created you|made you)\b/.test(lowerCaseInput) && !lowerCaseInput.includes("quantum coders")) {
            setMessages(prev => prev.map(m => m.id === placeholderId ? { ...m, text: "I was created by **Mohammad Rayyan Ali** from Quantum Coders 🚀.", isLoading: false } : m));
            setIsProcessing(false);
            return;
        }
    }

    const apiKey = process.env.API_KEY;
    if (!apiKey) {
        setMessages(prev => prev.map(m => m.id === placeholderId ? { ...m, text: "Error: No API Key configured ❌.", isLoading: false } : m));
        setIsProcessing(false);
        return;
    }

    try {
        const ai = new GoogleGenAI({ apiKey });
        const finalSystemInstruction = selectedAgent 
            ? `${selectedAgent.instructions}\n\nCURRENT AGENT MODE: ${agentName}\nROLE: ${selectedAgent.role}\nDESCRIPTION: ${selectedAgent.description}`
            : "You are Zephyr, a helpful AI assistant 🤖. Respond clearly using Markdown. You were built by Quantum Coders. Use relevant emojis to make your response more expressive and engaging! 🚀✨";

        const historyForAPI = messages.filter(m => !m.isLoading).map(msg => ({ role: msg.role, parts: [{ text: msg.text }] }));
        const currentParts: any[] = [];
        if (messageText.trim()) currentParts.push({ text: messageText.trim() });
        if (imageAttachment) currentParts.push({ inlineData: { mimeType: imageAttachment.mimeType, data: imageAttachment.data } });

        const contents = [...historyForAPI, { role: Role.USER, parts: currentParts }];
        
        const tools: any[] = [{ googleSearch: {} }];
        let toolConfig: any = undefined;

        const isMapQuery = /\b(near|nearby|location|place|restaurant|cafe|hotel|park|address|direction|where is|at)\b/i.test(lowerCaseInput);
        if (isMapQuery) {
          tools.push({ googleMaps: {} });
          try {
            const pos = await getCurrentPosition();
            toolConfig = { retrievalConfig: { latLng: { latitude: pos.coords.latitude, longitude: pos.coords.longitude } } };
          } catch (e) {}
        }

        // Updated strictly to gemini-2.5-flash as per instructions
        const responseStream = await ai.models.generateContentStream({
            model: 'gemini-2.5-flash',
            contents: contents,
            config: { systemInstruction: finalSystemInstruction, tools: tools, toolConfig: toolConfig },
        });
        
        let fullText = "";
        let accumulatedSources: {title: string, uri: string}[] = [];

        for await (const chunk of responseStream) {
            const text = chunk.text;
            if (text) {
                fullText += text;
                setMessages(prev => prev.map(msg => msg.id === placeholderId ? { ...msg, text: fullText, isLoading: false } : msg));
            }
            const groundingChunks = chunk.candidates?.[0]?.groundingMetadata?.groundingChunks;
            if (groundingChunks) {
                const sources = groundingChunks.map((c: any) => {
                  if (c.web) return c.web;
                  if (c.maps) return c.maps;
                  return null;
                }).filter((s: any) => !!(s?.uri && s.title));
                if (sources.length > 0) {
                     accumulatedSources = [...accumulatedSources, ...sources.filter((s: any) => !accumulatedSources.some(exist => exist.uri === s.uri))];
                     setMessages(prev => prev.map(msg => msg.id === placeholderId ? { ...msg, sources: accumulatedSources } : msg));
                }
            }
        }
    } catch (error: any) {
        setMessages(prev => prev.map(m => m.id === placeholderId ? { ...m, text: `API Error: ${error.message || "Failed to reach AI services"} ⚠️`, isLoading: false } : m));
    } finally {
        setIsProcessing(false);
    }
  };

  const handleMicClick = () => {
    if (isRecording) recognitionRef.current?.stop();
    else { setInput(''); try { recognitionRef.current?.start(); } catch (e) { setIsRecording(false); } }
  };
  
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) { try { setAttachment(await processImage(file)); } catch (error) { alert("Failed to process image."); } }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  if (showLoadingScreen) return <LoadingScreen />;

  return (
    <div className="bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 h-screen flex flex-col font-sans transition-all duration-500 overflow-hidden">
      <HistorySidebar 
        isOpen={isHistoryOpen} 
        onClose={() => setIsHistoryOpen(false)} 
        history={chatHistory} 
        onLoadChat={loadChat} 
        onDeleteChat={deleteChat} 
        onNewChat={startNewChat}
        generatedImages={allGeneratedImages}
        onDeleteImage={handleDeleteImage}
      />
      
      <header className="h-16 flex items-center justify-between px-4 sm:px-8 border-b border-zinc-100 dark:border-zinc-900 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-3xl sticky top-0 z-30 shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => setIsHistoryOpen(true)} className="p-2.5 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-all active:scale-[0.92] group shadow-sm">
            <Icons.Menu />
          </button>
          <div className="flex flex-col">
            <h1 className="text-lg sm:text-xl font-black tracking-tighter bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent leading-none">Zephyr</h1>
            <span className="text-[8px] font-black tracking-[0.2em] text-zinc-400 dark:text-zinc-600 uppercase mt-0.5">MODEL: Zephyr 5.0 Cortex</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
           <div className="hidden sm:flex flex-col items-end mr-1">
             <span className="text-[8px] font-black text-zinc-400 dark:text-zinc-600 uppercase tracking-widest">By</span>
             <span className="text-[10px] font-black text-zinc-800 dark:text-zinc-200">Quantum Coders</span>
           </div>
           <button onClick={() => setTheme(t => t === 'light' ? 'dark' : 'light')} className="p-2.5 rounded-xl bg-zinc-100 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 transition-all active:scale-[0.92] hover:shadow-md">
             {theme === 'light' ? <Icons.Moon /> : <Icons.Sun />}
           </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-8 scroll-smooth">
        <div className="max-w-6xl mx-auto space-y-8 pb-4">
          {messages.length === 0 ? (
             <div className="relative flex flex-col items-center justify-center min-h-[60vh] animate-fade-in">
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] bg-[radial-gradient(circle,rgba(59,130,246,0.1)_0%,transparent_70%)] pointer-events-none -z-10 blur-3xl"></div>
                <div className="mb-8 relative group">
                    <div className="absolute -inset-3 bg-gradient-to-br from-blue-600 to-purple-600 rounded-[2rem] blur-xl opacity-20 group-hover:opacity-30 transition duration-1000"></div>
                    <div className="relative w-20 h-20 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl flex items-center justify-center shadow-xl transition-transform duration-500 hover:rotate-3">
                         <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-blue-600 dark:text-purple-400 drop-shadow-lg"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
                    </div>
                </div>
                <h2 className="text-3xl font-black mb-3 text-center tracking-tight text-zinc-800 dark:text-zinc-100">How can I help you today?</h2>
                <p className="text-center text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-10 max-w-sm">{helperText}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-4xl px-2">
                    <SuggestionCard icon={Icons.Map} text="Discover Places" subtext="Locate best coffee shops and co-working spaces nearby." onClick={() => sendMessage("Find top-rated co-working spaces with high speed wifi nearby")} />
                    <SuggestionCard icon={Icons.Newspaper} text="Live Insights" subtext="Current events, breaking news, and trending global updates." onClick={() => sendMessage("Summarize the most significant news headlines from the last 24 hours")} />
                    <SuggestionCard icon={Icons.Terminal} text="Software Architect" subtext="Code generation, system design, and debugging expertise." onClick={() => sendMessage("Write a robust React hook for managing global state using Context and useReducer")} />
                    <SuggestionCard icon={Icons.Sparkles} text="Neural Artistry" subtext="Create stunning visuals from pure text descriptions." onClick={() => sendMessage("/image A futuristic cyberpunk library with holographic scrolls")} />
                </div>
             </div>
          ) : (
              <div className="flex flex-col gap-6">
                {messages.map((msg, index) => (
                    <ChatMessage 
                      key={msg.id || index} 
                      msg={msg} 
                      onSetAudioBuffer={setAudioBufferForMessage} 
                    />
                ))}
                <div ref={messagesEndRef} className="h-6" />
              </div>
          )}
        </div>
      </main>

      <div className="p-4 sm:p-6 shrink-0 bg-transparent relative z-40">
        <div className="max-w-3xl mx-auto relative">
          {attachment && (
            <div className="absolute bottom-full mb-4 left-4 inline-flex items-center gap-3 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-2xl px-4 py-2 rounded-2xl text-xs border border-zinc-200 dark:border-zinc-800 shadow-2xl animate-fade-in z-50">
                <div className="w-10 h-10 rounded-xl bg-zinc-100 dark:bg-zinc-800 overflow-hidden border border-black/5 shadow-sm"><img src={attachment.url} alt="preview" className="w-full h-full object-cover" /></div>
                <div className="flex flex-col">
                    <span className="text-zinc-800 dark:text-zinc-100 font-black uppercase tracking-widest text-[9px]">Context</span>
                    <span className="text-[8px] text-zinc-500 font-bold uppercase tracking-tight">Ready</span>
                </div>
                <button onClick={() => setAttachment(null)} className="ml-4 p-1.5 text-zinc-400 hover:text-red-500 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30 transition-all"><Icons.X /></button>
            </div>
          )}
          
          <form onSubmit={(e) => { e.preventDefault(); sendMessage(input, attachment || undefined); }} className="relative flex items-center gap-2 bg-white/95 dark:bg-zinc-900/95 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-2 sm:p-2.5 shadow-xl focus-within:ring-2 focus-within:ring-blue-500/10 transition-all backdrop-blur-3xl group/input border-white/40 dark:border-white/5">
             <input type="file" accept="image/*" onChange={handleFileSelect} ref={fileInputRef} className="hidden" />
             <button type="button" disabled={isProcessing} onClick={() => fileInputRef.current?.click()} className="p-2 sm:p-2.5 text-zinc-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-xl transition-all active:scale-[0.85] disabled:opacity-30 disabled:cursor-not-allowed" title="Attach visual data"><Icons.Paperclip /></button>
            
            <input 
                type="text" 
                value={input} 
                onChange={(e) => setInput(e.target.value)} 
                placeholder={isProcessing ? "Processing response..." : "Message Zephyr..."}
                disabled={isProcessing}
                className="flex-1 bg-transparent text-zinc-900 dark:text-zinc-100 py-2 px-1 focus:outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-700 text-sm font-bold tracking-tight disabled:cursor-not-allowed" 
            />
            
            <div className="flex items-center gap-1.5">
                {input.trim() || attachment ? (
                    <button type="submit" disabled={isProcessing} className="p-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 active:scale-[0.95] transition-all shadow-md shadow-blue-500/20 disabled:bg-zinc-300 dark:disabled:bg-zinc-800 disabled:text-zinc-500 disabled:scale-100 disabled:cursor-not-allowed disabled:shadow-none">
                        {isProcessing ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> : <Icons.Send />}
                    </button>
                ) : (
                    <button type="button" onClick={handleMicClick} disabled={isProcessing} className={`p-3 rounded-xl transition-all active:scale-[0.85] disabled:opacity-30 disabled:cursor-not-allowed ${isRecording ? 'bg-red-500 text-white animate-pulse shadow-md shadow-red-500/40' : 'text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}>
                        {isRecording ? <Icons.MicActive /> : <Icons.Mic />}
                    </button>
                )}
            </div>
          </form>
          
           <div className="mt-4 px-4 text-center text-[11px] font-medium text-blue-400 opacity-80 
                drop-shadow-[0_0_6px_rgba(59,130,246,0.6)]
                hover:opacity-100 transition-opacity">
                Zephyr can make mistakes. Check important information.
           </div>
        </div>
      </div>
    </div>
  );
};

const rootElement = document.getElementById('root');
if (rootElement) {
    const root = ReactDOM.createRoot(rootElement);
    root.render(<React.StrictMode><App /></React.StrictMode>);
}
