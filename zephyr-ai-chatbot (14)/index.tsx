import React, { useState, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleGenAI } from "@google/genai";
import { Message, Role } from './types';
import { selectAgent, generateImageUrl } from './agentManager';

// Use marked from CDN
declare var marked: any;

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

const LoadingScreen = () => (
  <div className="bg-white dark:bg-black h-screen flex items-center justify-center font-sans">
    <div className="loading-container">
      <div className="logo-text">Zephyr</div>
      <div className="credit-text">
        <span className="by-text">by</span> <span className="company-text">Quantum coders</span>
      </div>
    </div>
  </div>
);

const HistorySidebar = ({ isOpen, onClose, history, onLoadChat, onDeleteChat, onNewChat }: {
    isOpen: boolean;
    onClose: () => void;
    history: Message[][];
    onLoadChat: (index: number) => void;
    onDeleteChat: (index: number) => void;
    onNewChat: () => void;
}) => {
  return (
    <>
      <div 
        className={`fixed inset-y-0 right-0 z-50 w-72 bg-gray-900 text-white transform transition-transform duration-300 ease-in-out ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
        aria-modal="true"
        role="dialog"
      >
        <div className="flex flex-col h-full">
          <div className="p-4 flex justify-between items-center border-b border-gray-700">
            <h2 className="text-lg font-semibold">Chat History</h2>
            <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-700" aria-label="Close history">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          </div>
          <div className="p-4 border-b border-gray-700">
             <button onClick={onNewChat} className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-gray-700 rounded-md hover:bg-gray-600 transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                New Chat
             </button>
          </div>
          <nav className="flex-1 overflow-y-auto">
            <ul className="p-2 space-y-1">
              {history.map((chat, index) => (
                <li key={index}>
                  <a href="#" onClick={(e) => { e.preventDefault(); onLoadChat(index); }} className="flex items-center justify-between p-2 rounded-md hover:bg-gray-700 group">
                    <span className="truncate flex-1 pr-2 text-sm">
                      {chat.find(m => m.role === Role.USER)?.text || (chat.find(m => m.role === Role.USER)?.image ? "Image" : "Chat")}
                    </span>
                    <button 
                      onClick={(e) => { e.stopPropagation(); onDeleteChat(index); }} 
                      className="p-1 rounded-full text-gray-500 hover:text-white hover:bg-gray-600 opacity-0 group-hover:opacity-100 transition-opacity"
                      aria-label="Delete chat"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2 2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                    </button>
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </div>
      {isOpen && <div className="fixed inset-0 bg-black bg-opacity-50 z-40" onClick={onClose}></div>}
    </>
  );
};

const processImage = (file: File): Promise<{ data: string; mimeType: string; url: string }> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        const maxDim = 1536; 
        
        if (width > maxDim || height > maxDim) {
           const ratio = Math.min(maxDim / width, maxDim / height);
           width *= ratio;
           height *= ratio;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error("Canvas context unavailable"));
          return;
        }
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        
        const mimeType = 'image/jpeg';
        const quality = 0.8;
        const dataUrl = canvas.toDataURL(mimeType, quality);
        const base64Data = dataUrl.split(',')[1];
        
        resolve({
          url: dataUrl,
          data: base64Data,
          mimeType: mimeType
        });
      };
      img.onerror = (err) => {
         console.error("Image load error", err);
         reject(new Error("Failed to load image"));
      };
      
      if (typeof e.target?.result === 'string') {
          img.src = e.target.result;
      } else {
          reject(new Error("File read failed"));
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

const App = () => {
  const [showLoadingScreen, setShowLoadingScreen] = useState(true);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [attachment, setAttachment] = useState<{ url: string; data: string; mimeType: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [processingAgent, setProcessingAgent] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [chatHistory, setChatHistory] = useState<Message[][]>([]);
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

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
      localStorage.setItem('zephyr-theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('zephyr-theme', 'light');
    }
  }, [theme]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowLoadingScreen(false);
    }, 3000); 

    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    try {
      const savedHistory = localStorage.getItem('zephyrChatHistory');
      if (savedHistory) {
        setChatHistory(JSON.parse(savedHistory));
      }
    } catch (error) {
      console.error("Failed to load chat history from localStorage", error);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('zephyrChatHistory', JSON.stringify(chatHistory));
    } catch (error) {
      console.error("Failed to save chat history to localStorage", error);
    }
  }, [chatHistory]);

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = 'en-US';

      recognition.onstart = () => setIsRecording(true);
      recognition.onresult = (event: any) => setInput(event.results[0][0].transcript);
      recognition.onend = () => setIsRecording(false);
      recognition.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        setIsRecording(false);
      };
      recognitionRef.current = recognition;
    } else {
      console.warn('Speech Recognition not available');
    }
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };
  useEffect(() => {
    if (!showLoadingScreen) {
      scrollToBottom();
    }
  }, [messages, showLoadingScreen, attachment, loading]);

  const archiveCurrentChat = () => {
    if (messages.length > 0) { 
      setChatHistory(prev => [messages, ...prev]);
    }
  };

  const startNewChat = () => {
    archiveCurrentChat();
    setMessages([]);
    setAttachment(null);
    setInput('');
    setIsHistoryOpen(false);
  };

  const loadChat = (index: number) => {
    archiveCurrentChat();
    const chatToLoad = chatHistory[index];
    setMessages(chatToLoad);
    setChatHistory(prev => prev.filter((_, i) => i !== index));
    setIsHistoryOpen(false);
  };

  const deleteChat = (index: number) => {
    setChatHistory(prev => prev.filter((_, i) => i !== index));
  };


  const sendMessage = async (messageText: string, imageAttachment?: { data: string; mimeType: string; url: string }) => {
    if ((!messageText.trim() && !imageAttachment) || loading) return;

    const userMessage: Message = { 
        role: Role.USER, 
        text: messageText.trim(),
        image: imageAttachment?.url 
    };

    const newMessages = [...messages, userMessage];
    
    setMessages(newMessages);
    setInput('');
    setAttachment(null);
    setLoading(true);
    // Initially set generic processing, specific agent set after selection
    setProcessingAgent("Zephyr"); 

    const lowerCaseInput = messageText.trim().toLowerCase();

    // Check for image generation command
    if (lowerCaseInput.startsWith("/image ")) {
        const prompt = messageText.trim().substring(7); // remove "/image "
        if (prompt) {
            const imageUrl = generateImageUrl(prompt);
            setProcessingAgent("Creative Agent");
            
            setTimeout(() => {
                const modelMessage: Message = { 
                    role: Role.MODEL, 
                    text: imageUrl,
                    type: 'image',
                    agentName: "Creative Agent"
                };
                setMessages([...newMessages, modelMessage]);
                setLoading(false);
                setProcessingAgent(null);
            }, 1000);
            return;
        }
    }
    
    if (!imageAttachment) {
        if (/\b(time now|date today)\b/.test(lowerCaseInput)) {
            const responseText = `The current date and time is: ${new Date().toLocaleString()}`;
            setMessages([...newMessages, { role: Role.MODEL, text: responseText }]);
            setLoading(false);
            setProcessingAgent(null);
            return;
        }
        if (/\b(developed you|your developer|your creator|created you|made you)\b/.test(lowerCaseInput) && !lowerCaseInput.includes("quantum coders")) {
            const responseText = "I was created by Mohammad Rayyan Ali.";
            setMessages([...newMessages, { role: Role.MODEL, text: responseText }]);
            setLoading(false);
            setProcessingAgent(null);
            return;
        }
        if (/\b(quantum coders)\b/.test(lowerCaseInput)) {
            const responseText = "Quantum Coders is a group for a science exhibition. They created me as their project. The members are:\n1. Rayyan\n2. Amit\n3. Yatin";
            setMessages([...newMessages, { role: Role.MODEL, text: responseText }]);
            setLoading(false);
            setProcessingAgent(null);
            return;
        }
    }

    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

        const historyForAPI = messages.map(msg => {
            const parts: any[] = [{ text: msg.text }];
            if (msg.image) {
                const base64Data = msg.image.split(',')[1];
                const mimeType = msg.image.split(';')[0].split(':')[1];
                if (base64Data && mimeType) {
                    parts.push({
                        inlineData: {
                            data: base64Data,
                            mimeType: mimeType
                        }
                    });
                }
            }
            return {
                role: msg.role,
                parts: parts
            };
        });

        const currentParts: any[] = [];
        if (messageText.trim()) {
            currentParts.push({ text: messageText.trim() });
        }
        if (imageAttachment) {
            currentParts.push({
                inlineData: {
                    mimeType: imageAttachment.mimeType,
                    data: imageAttachment.data
                }
            });
        }

        const contents = [...historyForAPI, { role: Role.USER, parts: currentParts }];

        // Select Agent
        const selectedAgent = await selectAgent(messageText);
        let agentName = "Zephyr";
        let finalSystemInstruction = "You are Zephyr, a helpful AI assistant created by Quantum Coders. You can provide the current date and time. Your responses should be formatted in Markdown.";
        
        if (selectedAgent) {
            agentName = selectedAgent.name;
            setProcessingAgent(agentName); // Update UI to show who is processing
            finalSystemInstruction = `${selectedAgent.instructions}\n\nCURRENT AGENT MODE: ${agentName}\nROLE: ${selectedAgent.role}\nDESCRIPTION: ${selectedAgent.description}`;
        } else {
             setProcessingAgent("Zephyr");
        }

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: contents,
            config: {
                systemInstruction: finalSystemInstruction,
                tools: [{ googleSearch: {} }],
            },
        });
        
        const responseText = response.text;
        const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
        const sources = groundingChunks
            .map(chunk => chunk.web)
            .filter((web): web is { uri: string; title: string; } => !!(web?.uri && web.title));
        
        const modelMessage: Message = { 
            role: Role.MODEL, 
            text: responseText, 
            sources: sources.length > 0 ? sources : undefined,
            agentName: agentName // Store who answered
        };
        setMessages([...newMessages, modelMessage]);

    } catch (error) {
        console.error("Error calling Gemini API:", error);
        const errorMessage: Message = { role: Role.MODEL, text: "Sorry, I'm having trouble connecting to the AI service. Please try again later." };
        setMessages([...newMessages, errorMessage]);
    } finally {
        setLoading(false);
        setProcessingAgent(null);
    }
  };

  const handleSuggestionClick = (text: string) => {
    sendMessage(text);
  };

  const handleMicClick = () => {
    if (loading || !recognitionRef.current) return;

    if (isRecording) {
      recognitionRef.current.stop();
    } else {
      setInput('');
      try {
        recognitionRef.current.start();
      } catch (e) {
        console.error("Speech recognition failed to start", e);
        setIsRecording(false);
      }
    }
  };
  
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
        try {
            const processedImage = await processImage(file);
            setAttachment(processedImage);
        } catch (error) {
            console.error("Error processing image:", error);
            alert("Failed to process image. Please try a standard image format (PNG, JPEG).");
        }
    }
    if (fileInputRef.current) {
        fileInputRef.current.value = '';
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input, attachment || undefined);
  };
  
  const renderText = (text: string) => {
    try {
        if (typeof marked !== 'undefined' && marked.parse) {
            const rawHtml = marked.parse(text);
            return { __html: rawHtml };
        }
    } catch (e) {
        console.warn("Markdown parsing failed", e);
    }
    // Fallback if marked is missing or fails
    return { __html: text.replace(/\n/g, '<br/>') };
  };
  
  const toggleTheme = () => {
    setTheme(prevTheme => prevTheme === 'light' ? 'dark' : 'light');
  };

  if (showLoadingScreen) {
    return <LoadingScreen />;
  }

  return (
    <div className="bg-white dark:bg-gray-900 text-black dark:text-white h-screen flex flex-col font-sans">
      <HistorySidebar
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        history={chatHistory}
        onLoadChat={loadChat}
        onDeleteChat={deleteChat}
        onNewChat={startNewChat}
      />
      <header className="p-4 border-b border-gray-200 dark:border-gray-800 shrink-0">
        <div className="max-w-4xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-3">
             <div>
                <h1 className="text-3xl font-bold">Zephyr</h1>
                <p className="text-sm text-gray-600 dark:text-gray-400">by Quantum coders</p>
             </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={toggleTheme} className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors">
                {theme === 'light' ? 
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg> : 
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>
                }
            </button>
            <button onClick={() => setIsHistoryOpen(true)} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4 scroll-smooth">
        <div className="max-w-3xl mx-auto space-y-6 h-full flex flex-col">
          {messages.length === 0 ? (
             <div className="flex-1 flex flex-col items-center justify-center min-h-[50vh]">
                <h1 className="text-4xl font-bold mb-10 text-black dark:text-white text-center">How can I help you today?</h1>
                <div className="flex flex-wrap items-center justify-center gap-3 w-full max-w-2xl">
                    <button onClick={() => handleSuggestionClick("What's the latest news?")} className="px-5 py-2.5 rounded-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-sm font-medium">
                        What's the latest news?
                    </button>
                    <button onClick={() => handleSuggestionClick("Code a Simple UI")} className="px-5 py-2.5 rounded-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-sm font-medium">
                        Code a Simple UI
                    </button>
                    <button onClick={() => handleSuggestionClick("Suggest me a recipe for dinner")} className="px-5 py-2.5 rounded-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-sm font-medium">
                        Suggest me a recipe for dinner
                    </button>
                    <button onClick={() => handleSuggestionClick("Who are Quantum coders?")} className="px-5 py-2.5 rounded-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-sm font-medium">
                        Who are Quantum coders?
                    </button>
                    <button onClick={() => handleSuggestionClick("/image A futuristic city with flying cars")} className="px-5 py-2.5 rounded-full bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 hover:bg-purple-100 dark:hover:bg-purple-900/30 transition-colors text-sm font-medium text-purple-700 dark:text-purple-300">
                        Generate Image
                    </button>
                </div>
             </div>
          ) : (
              <>
                {messages.map((msg, index) => (
                    <div key={index} className={`flex ${msg.role === Role.USER ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] rounded-2xl p-4 shadow-sm ${
                        msg.role === Role.USER 
                        ? 'bg-blue-600 text-white rounded-br-none' 
                        : 'bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-bl-none'
                    }`}>
                        {/* Agent Badge - Only show if it's a model message and has a specific agent name */}
                        {msg.role === Role.MODEL && msg.agentName && msg.agentName !== 'Zephyr' && (
                            <div className="mb-2">
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200">
                                {msg.agentName}
                                </span>
                            </div>
                        )}

                        {msg.image && (
                        <img src={msg.image} alt="Uploaded" className="max-w-full h-auto rounded-lg mb-2 border border-gray-200 dark:border-gray-700" />
                        )}
                        
                        {msg.type === 'image' ? (
                            <img
                                src={msg.text}
                                alt="AI generated"
                                className="rounded-xl mt-2 max-w-full border border-slate-300 dark:border-slate-700"
                            />
                        ) : (
                            <div 
                                className={`prose ${msg.role === Role.USER ? 'prose-invert' : 'dark:prose-invert'} max-w-none text-sm leading-relaxed`}
                                dangerouslySetInnerHTML={renderText(msg.text)}
                            />
                        )}
                        
                        {msg.sources && msg.sources.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                            <p className="text-xs font-semibold mb-1 opacity-70">Sources:</p>
                            <ul className="list-disc list-inside text-xs space-y-1">
                            {msg.sources.map((source, i) => (
                                <li key={i}>
                                <a href={source.uri} target="_blank" rel="noopener noreferrer" className="hover:underline opacity-80 hover:opacity-100 truncate block">
                                    {source.title}
                                </a>
                                </li>
                            ))}
                            </ul>
                        </div>
                        )}
                    </div>
                    </div>
                ))}
                
                {loading && (
                    <div className="flex justify-start animate-pulse">
                    <div className="bg-white dark:bg-gray-800 rounded-2xl rounded-bl-none p-4 border border-gray-100 dark:border-gray-700">
                        <div className="flex items-center space-x-2">
                            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                        </div>
                        <p className="text-xs text-gray-400 mt-2 font-medium">
                            {processingAgent ? `${processingAgent} is processing...` : 'Zephyr is thinking...'}
                        </p>
                    </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
              </>
          )}
        </div>
      </main>

      <div className="p-4 border-t border-gray-200 dark:border-gray-800 shrink-0 bg-white dark:bg-gray-900">
        <div className="max-w-3xl mx-auto">
          {attachment && (
            <div className="mb-2 inline-flex items-center gap-2 bg-gray-100 dark:bg-gray-800 px-3 py-1 rounded-full text-sm">
                <span className="truncate max-w-xs">Image attached</span>
                <button onClick={() => setAttachment(null)} className="text-gray-500 hover:text-red-500">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
            </div>
          )}
          <form onSubmit={handleSend} className="relative flex items-center gap-2">
             <input 
               type="file" 
               accept="image/*" 
               onChange={handleFileSelect} 
               ref={fileInputRef}
               className="hidden" 
             />
             <button 
                type="button" 
                onClick={() => fileInputRef.current?.click()}
                className="p-3 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors"
                title="Attach Image"
             >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
             </button>

            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask Zephyr anything..."
              className="w-full bg-gray-100 dark:bg-gray-800 text-black dark:text-white rounded-full py-3 px-5 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
            />
            
            {input.trim() || attachment ? (
                <button 
                  type="submit" 
                  disabled={loading}
                  className="p-3 bg-blue-600 text-white rounded-full hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                </button>
            ) : (
                <button 
                  type="button" 
                  onClick={handleMicClick}
                  className={`p-3 rounded-full transition-colors ${isRecording ? 'bg-red-500 text-white animate-pulse' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                >
                  {isRecording ? (
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17.657 16.657L13.414 20.9a1.998 1.998 0 0 1-2.827 0l-4.244-4.243a8 8 0 1 1 11.314 0z"></path></svg>
                  ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
                  )}
                </button>
            )}
          </form>
          
          <div className="mt-2 text-center text-xs text-gray-400">
             Zephyr may produce inaccurate information. Type /image to generate images.
          </div>
        </div>
      </div>
    </div>
  );
};

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);