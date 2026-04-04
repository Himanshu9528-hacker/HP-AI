import React, { useState, useRef, useEffect } from 'react';
import { Send, Terminal, User, Sparkles, ShieldAlert, Cpu, MessageSquare, Paperclip, X, Image as ImageIcon, Music, FileText, Plus, Trash2, Menu, ChevronLeft, Info, MessageCircle, Github, Linkedin, Twitter, Mic, MicOff } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Markdown from 'react-markdown';
import { ai, SYSTEM_PROMPTS, generateImage, generateVideo, generateMusic, textToSpeech } from '../lib/gemini';
import { ThinkingLevel } from '@google/genai';
import { cn } from '../lib/utils';
import { db, auth, signOut, collection, doc, setDoc, getDoc, getDocs, query, where, orderBy, onSnapshot, addDoc, deleteDoc, updateDoc, serverTimestamp, Timestamp, User as FirebaseUser, handleFirestoreError, OperationType } from '../lib/firebase';
import { LogOut, Search, MapPin, Video, Music as MusicIcon, Volume2, Brain, VideoOff, VolumeX } from 'lucide-react';

interface Attachment {
  data: string;
  mimeType: string;
  name: string;
  previewUrl?: string;
}

interface Message {
  id?: string;
  role: 'user' | 'model';
  content: string;
  attachments?: Attachment[];
  timestamp?: number;
  type?: 'text' | 'image' | 'video' | 'audio';
  mediaUrl?: string;
  isHackerMode?: boolean;
}

interface ChatSession {
  id: string;
  uid: string;
  title: string;
  isHackerMode: boolean;
  timestamp: number;
}

export default function ChatInterface({ user }: { user: FirebaseUser }) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(window.innerWidth > 768);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>('');
  const [isHackerMode, setIsHackerMode] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [showAbout, setShowAbout] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isThinkingMode, setIsThinkingMode] = useState(false);
  const [useSearch, setUseSearch] = useState(false);
  const [useMaps, setUseMaps] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const recognitionRef = useRef<any>(null);
  const currentSessionIdRef = useRef(currentSessionId);
  const isHackerModeRef = useRef(isHackerMode);

  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  useEffect(() => {
    isHackerModeRef.current = isHackerMode;
  }, [isHackerMode]);

  // Initialize Speech Recognition
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false; // Stop after one phrase for better control
      recognitionRef.current.interimResults = false;
      
      // Try to match the language if possible, otherwise default
      recognitionRef.current.lang = 'en-US';

      recognitionRef.current.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        if (transcript) {
          setInput(prev => prev + (prev ? ' ' : '') + transcript);
        }
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current.onerror = (event: any) => {
        console.error('Speech recognition error', event.error);
        if (event.error === 'not-allowed') {
          alert("Microphone access is blocked. Please allow microphone permission in your browser settings to use voice typing.");
        }
        setIsListening(false);
      };
    }
  }, []);

  const toggleSpeechRecognition = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
    } else {
      if (!recognitionRef.current) {
        alert("Speech recognition is not supported in your browser.");
        return;
      }
      try {
        recognitionRef.current.start();
        setIsListening(true);
      } catch (err) {
        console.error('Failed to start speech recognition', err);
        setIsListening(false);
      }
    }
  };

  // Handle window resize for responsiveness
  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth <= 768;
      setIsMobile(mobile);
      if (!mobile) setIsSidebarOpen(true);
      else setIsSidebarOpen(false);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  // Load sessions from Firestore
  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'sessions'),
      where('uid', '==', user.uid),
      orderBy('timestamp', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const sessionList = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as ChatSession[];
      setSessions(sessionList);
      
      // If no session is selected, pick the most recent one for the current mode
      if (!currentSessionIdRef.current && sessionList.length > 0) {
        const modeSessions = sessionList.filter(s => !!s.isHackerMode === isHackerModeRef.current);
        if (modeSessions.length > 0) {
          setCurrentSessionId(modeSessions[0].id);
        } else {
          // If no sessions for current mode, create one instead of switching modes
          createNewSession();
        }
      } else if (sessionList.length === 0) {
        createNewSession();
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'sessions');
    });

    return () => unsubscribe();
  }, [user]);

  // Load messages for current session
  useEffect(() => {
    if (!currentSessionId || !user) return;
    const q = query(
      collection(db, `sessions/${currentSessionId}/messages`),
      orderBy('timestamp', 'asc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgList = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Message[];
      setMessages(msgList);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `sessions/${currentSessionId}/messages`);
    });

    return () => unsubscribe();
  }, [currentSessionId]);

  const createNewSession = async () => {
    const newSessionRef = doc(collection(db, 'sessions'));
    const newSession = {
      id: newSessionRef.id,
      uid: user.uid,
      title: "New Chat",
      isHackerMode: isHackerMode,
      timestamp: Date.now()
    };
    await setDoc(newSessionRef, newSession);
    setCurrentSessionId(newSessionRef.id);

    // Add welcome message
    await addDoc(collection(db, `sessions/${newSessionRef.id}/messages`), {
      uid: user.uid,
      role: 'model',
      content: isHackerMode 
        ? "System initialized. HP (Hacker Edition) is online. Ready for deep technical analysis. What's our target today? 💻⚡"
        : "Hello there! I'm HP, your friendly AI companion. How can I help you today? 😊",
      timestamp: Date.now(),
      type: 'text',
      isHackerMode: isHackerMode
    });
  };

  const switchSession = (id: string) => {
    const session = sessions.find(s => s.id === id);
    if (session) {
      setCurrentSessionId(id);
      setIsHackerMode(session.isHackerMode);
      if (isMobile) setIsSidebarOpen(false);
    }
  };

  const deleteSession = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await deleteDoc(doc(db, 'sessions', id));
    if (currentSessionId === id) {
      setCurrentSessionId('');
    }
  };

  const handleLogout = () => {
    signOut(auth);
  };

  const playTTS = async (text: string) => {
    const url = await textToSpeech(text);
    if (url) {
      const audio = new Audio(url);
      audio.play();
    }
  };
  const toggleHackerMode = async () => {
    const nextMode = !isHackerMode;
    setIsHackerMode(nextMode);
    
    // Find most recent session for the new mode
    const modeSessions = sessions.filter(s => s.isHackerMode === nextMode);
    if (modeSessions.length > 0) {
      setCurrentSessionId(modeSessions[0].id);
    } else {
      // Create a new session for this mode if none exists
      const newSessionRef = doc(collection(db, 'sessions'));
      const newSession = {
        id: newSessionRef.id,
        uid: user.uid,
        title: "New Chat",
        isHackerMode: nextMode,
        timestamp: Date.now()
      };
      await setDoc(newSessionRef, newSession);
      setCurrentSessionId(newSessionRef.id);

      // Add welcome message
      await addDoc(collection(db, `sessions/${newSessionRef.id}/messages`), {
        uid: user.uid,
        role: 'model',
        content: nextMode 
          ? "System initialized. HP (Hacker Edition) is online. Ready for deep technical analysis. What's our target today? 💻⚡"
          : "Hello there! I'm HP, your friendly AI companion. How can I help you today? 😊",
        timestamp: Date.now(),
        type: 'text',
        isHackerMode: nextMode
      });
    }
  };

  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<Attachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newAttachments: Attachment[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const reader = new FileReader();
      
      const promise = new Promise<Attachment>((resolve) => {
        reader.onload = (e) => {
          const base64 = (e.target?.result as string).split(',')[1];
          const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined;
          resolve({
            data: base64,
            mimeType: file.type,
            name: file.name,
            previewUrl
          });
        };
      });
      
      reader.readAsDataURL(file);
      newAttachments.push(await promise);
    }

    setAttachedFiles(prev => [...prev, ...newAttachments]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachment = (index: number) => {
    setAttachedFiles(prev => {
      const newFiles = [...prev];
      if (newFiles[index].previewUrl) URL.revokeObjectURL(newFiles[index].previewUrl!);
      newFiles.splice(index, 1);
      return newFiles;
    });
  };

  const handleSend = async () => {
    if ((!input.trim() && attachedFiles.length === 0) || isLoading || !currentSessionId) return;

    const userMessage = input.trim();
    const currentAttachments = [...attachedFiles];
    
    setInput('');
    setAttachedFiles([]);
    
    // Add user message to Firestore
    await addDoc(collection(db, `sessions/${currentSessionId}/messages`), {
      uid: user.uid,
      role: 'user',
      content: userMessage || (currentAttachments.length > 0 ? "Sent attachments" : ""),
      attachments: currentAttachments,
      timestamp: Date.now(),
      type: 'text',
      isHackerMode: isHackerMode
    });

    // Update session title if it's new
    const currentSession = sessions.find(s => s.id === currentSessionId);
    if (currentSession && currentSession.title === "New Chat" && userMessage) {
      await updateDoc(doc(db, 'sessions', currentSessionId), {
        title: userMessage.slice(0, 30) + (userMessage.length > 30 ? '...' : '')
      });
    }

    setIsLoading(true);

    try {
      // Check for media generation intent
      const lowerMsg = userMessage.toLowerCase();
      let responseContent = "";
      let mediaUrl = "";
      let type: 'text' | 'image' | 'video' | 'audio' = 'text';

      const isImageIntent = lowerMsg.includes("generate image") || 
                            lowerMsg.includes("photo banao") || 
                            lowerMsg.includes("image banao") || 
                            lowerMsg.includes("create image") ||
                            lowerMsg.includes("tasveer banao") ||
                            (currentAttachments.some(a => a.mimeType.startsWith('image/')) && (lowerMsg.includes("edit") || lowerMsg.includes("change") || lowerMsg.includes("modify") || lowerMsg.includes("banao")));

      if (isImageIntent) {
        const prompt = userMessage.replace(/generate image|photo banao|image banao|create image|tasveer banao/gi, "").trim();
        const attachedImage = currentAttachments.find(a => a.mimeType.startsWith('image/'));
        
        mediaUrl = await generateImage(
          prompt || (attachedImage ? "Enhance this image" : "A beautiful landscape"),
          attachedImage ? { data: attachedImage.data, mimeType: attachedImage.mimeType } : undefined
        ) || "";
        
        responseContent = attachedImage 
          ? "Dost, maine tumhari image ko modify kar diya hai! ✨" 
          : "Dost, tumhari image taiyar hai! ✨";
        type = 'image';
      } else if (lowerMsg.includes("generate video") || lowerMsg.includes("video banao") || lowerMsg.includes("animation banao") || lowerMsg.includes("cartoon banao")) {
        const prompt = userMessage.replace(/generate video|video banao|animation banao|cartoon banao/gi, "").trim();
        mediaUrl = await generateVideo(prompt || "A cinematic animation") || "";
        responseContent = "Bhai, tumhari animation video ready hai! 🎬";
        type = 'video';
      } else if (lowerMsg.includes("generate music") || lowerMsg.includes("gaana banao") || lowerMsg.includes("music banao")) {
        const prompt = userMessage.replace(/generate music|gaana banao/gi, "").trim();
        mediaUrl = await generateMusic(prompt || "A happy upbeat track") || "";
        responseContent = "Music taiyar hai, suno! 🎵";
        type = 'audio';
      } else {
        // Normal chat with tools
        const tools: any[] = [];
        if (useSearch) tools.push({ googleSearch: {} });
        if (useMaps) tools.push({ googleMaps: {} });

        const chat = ai.chats.create({
          model: "gemini-3-flash-preview",
          config: {
            systemInstruction: isHackerMode ? SYSTEM_PROMPTS.hacker : SYSTEM_PROMPTS.normal,
            thinkingConfig: isThinkingMode ? { thinkingLevel: ThinkingLevel.HIGH } : undefined,
            tools: tools.length > 0 ? tools : undefined,
          },
          history: messages.map(m => ({
            role: m.role,
            parts: [
              { text: m.content },
              ...(m.attachments?.map(a => ({
                inlineData: { data: a.data, mimeType: a.mimeType }
              })) || [])
            ]
          }))
        });

        const messageParts: any[] = [];
        if (userMessage) messageParts.push({ text: userMessage });
        currentAttachments.forEach(file => {
          messageParts.push({
            inlineData: {
              data: file.data,
              mimeType: file.mimeType
            }
          });
        });

        const result = await chat.sendMessage({ message: messageParts });
        responseContent = result.text || "Dost, kuch gadbad ho gayi.";
      }

      // Save model response to Firestore
      await addDoc(collection(db, `sessions/${currentSessionId}/messages`), {
        uid: user.uid,
        role: 'model',
        content: responseContent,
        mediaUrl: mediaUrl || null,
        type: type,
        timestamp: Date.now(),
        isHackerMode: isHackerMode
      });

    } catch (error) {
      console.error("Chat error:", error);
      // Save error message to Firestore
      await addDoc(collection(db, `sessions/${currentSessionId}/messages`), {
        uid: user.uid,
        role: 'model',
        content: "Bhai, server down lag raha hai ya API key ka chakkar hai. Check kar lo!",
        timestamp: Date.now(),
        type: 'text',
        isHackerMode: isHackerMode
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={cn(
      "flex h-screen transition-all duration-500 overflow-hidden",
      isHackerMode ? "hacker-mode" : "bg-white text-zinc-800"
    )}>
      {/* Modals */}
      <AnimatePresence>
        {showAbout && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowAbout(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className={cn(
                "max-w-lg w-full p-6 rounded-3xl shadow-2xl relative overflow-hidden",
                isHackerMode ? "bg-zinc-900 border border-hacker-green/30 text-hacker-green" : "bg-white text-zinc-800"
              )}
              onClick={(e) => e.stopPropagation()}
            >
              <button 
                onClick={() => setShowAbout(false)}
                className="absolute top-4 right-4 p-2 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all"
              >
                <X size={20} />
              </button>

              <div className="flex flex-col items-center text-center">
                <div className="relative mb-6">
                  <div className={cn(
                    "w-32 h-32 rounded-full overflow-hidden border-4",
                    isHackerMode ? "border-hacker-green shadow-[0_0_20px_rgba(0,255,65,0.3)]" : "border-indigo-100"
                  )}>
                    <img 
                      src="https://picsum.photos/seed/himanshu/400/400" 
                      alt="Mr. Himanshu Yadav" 
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                  <div className={cn(
                    "absolute -bottom-2 -right-2 p-2 rounded-full",
                    isHackerMode ? "bg-hacker-green text-black" : "bg-indigo-600 text-white"
                  )}>
                    <Sparkles size={16} />
                  </div>
                </div>

                <h2 className={cn(
                  "text-2xl font-bold mb-1",
                  isHackerMode && "hacker-glow"
                )}>Mr. Himanshu Yadav</h2>
                <p className="text-sm opacity-60 mb-4 font-medium uppercase tracking-widest">Founder & Lead Developer</p>
                
                <div className={cn(
                  "p-4 rounded-2xl mb-6 text-sm leading-relaxed",
                  isHackerMode ? "bg-black/40 border border-hacker-green/10" : "bg-zinc-50"
                )}>
                  Mr. Himanshu Yadav is a visionary developer and cybersecurity enthusiast. He created HP to bridge the gap between complex security concepts and everyday users. His mission is to make the digital world safer and more accessible for everyone through friendly AI companionship.
                </div>

                <div className="flex gap-4">
                  <a href="#" className="p-2 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all"><Github size={20} /></a>
                  <a href="#" className="p-2 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all"><Linkedin size={20} /></a>
                  <a href="#" className="p-2 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all"><Twitter size={20} /></a>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}

        {showFeedback && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowFeedback(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className={cn(
                "max-w-md w-full p-6 rounded-3xl shadow-2xl relative",
                isHackerMode ? "bg-zinc-900 border border-hacker-green/30 text-hacker-green" : "bg-white text-zinc-800"
              )}
              onClick={(e) => e.stopPropagation()}
            >
              <button 
                onClick={() => setShowFeedback(false)}
                className="absolute top-4 right-4 p-2 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all"
              >
                <X size={20} />
              </button>

              <h2 className="text-xl font-bold mb-2 flex items-center gap-2">
                <MessageCircle size={20} />
                Share Your Feedback
              </h2>
              <p className="text-sm opacity-60 mb-6">Arre dost, batao kaisa lag raha hai HP? Tumhari feedback se hum ise aur behtar banayenge! 😊</p>

              {feedbackSubmitted ? (
                <div className="text-center py-8">
                  <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Sparkles size={32} />
                  </div>
                  <h3 className="font-bold text-lg mb-1">Shukriya Dost!</h3>
                  <p className="text-sm opacity-60">Tumhari feedback hum tak pahunch gayi hai. ✨</p>
                  <button 
                    onClick={() => {
                      setShowFeedback(false);
                      setFeedbackSubmitted(false);
                      setFeedbackText('');
                    }}
                    className={cn(
                      "mt-6 px-6 py-2 rounded-full font-medium transition-all",
                      isHackerMode ? "bg-hacker-green text-black" : "bg-indigo-600 text-white"
                    )}
                  >
                    Close
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <textarea
                    value={feedbackText}
                    onChange={(e) => setFeedbackText(e.target.value)}
                    placeholder="Write your message here..."
                    className={cn(
                      "w-full h-32 p-4 rounded-2xl outline-none transition-all resize-none",
                      isHackerMode 
                        ? "bg-black border border-hacker-green/30 text-hacker-green focus:border-hacker-green" 
                        : "bg-zinc-100 border border-transparent focus:bg-white focus:border-indigo-300"
                    )}
                  />
                  <button
                    onClick={() => setFeedbackSubmitted(true)}
                    disabled={!feedbackText.trim()}
                    className={cn(
                      "w-full py-3 rounded-2xl font-bold transition-all active:scale-95 disabled:opacity-50",
                      isHackerMode ? "bg-hacker-green text-black" : "bg-indigo-600 text-white"
                    )}
                  >
                    Submit Feedback
                  </button>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sidebar Overlay for Mobile */}
      <AnimatePresence>
        {isMobile && isSidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <AnimatePresence mode="wait">
        {isSidebarOpen && (
          <motion.aside
            initial={isMobile ? { x: -280 } : { width: 0, opacity: 0 }}
            animate={isMobile ? { x: 0 } : { width: 280, opacity: 1 }}
            exit={isMobile ? { x: -280 } : { width: 0, opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className={cn(
              "h-full border-r flex flex-col shrink-0 overflow-hidden z-50",
              isMobile ? "fixed left-0 top-0 bottom-0 w-[280px]" : "relative",
              isHackerMode ? "border-hacker-green/30 bg-black/95" : "border-zinc-200 bg-zinc-50"
            )}
          >
            <div className="p-4 flex flex-col h-full">
              <button
                onClick={createNewSession}
                className={cn(
                  "flex items-center gap-2 w-full p-3 rounded-xl font-medium transition-all active:scale-95 mb-6",
                  isHackerMode 
                    ? "border border-hacker-green/50 text-hacker-green hover:bg-hacker-green/10" 
                    : "bg-white border border-zinc-200 text-zinc-800 hover:bg-zinc-100 shadow-sm"
                )}
              >
                <Plus size={18} />
                New Chat
              </button>

              <div className="flex-1 overflow-y-auto space-y-2 scrollbar-hide">
                <p className="text-[10px] uppercase tracking-wider opacity-50 px-2 mb-2">
                  {isHackerMode ? "Hacker Intel Logs" : "Recent Chats"}
                </p>
                {sessions
                  .filter(session => !!session.isHackerMode === isHackerMode)
                  .map(session => (
                    <div
                      key={session.id}
                      onClick={() => switchSession(session.id)}
                      className={cn(
                        "group flex items-center justify-between p-3 rounded-xl cursor-pointer transition-all",
                        currentSessionId === session.id
                          ? (isHackerMode ? "bg-hacker-green/20 text-hacker-green border border-hacker-green/30" : "bg-indigo-50 text-indigo-700 border border-indigo-100")
                          : (isHackerMode ? "hover:bg-hacker-green/5 text-hacker-green/70" : "hover:bg-zinc-100 text-zinc-600")
                      )}
                    >
                    <div className="flex items-center gap-3 overflow-hidden">
                      <MessageSquare size={16} className="shrink-0" />
                      <span className="text-sm truncate">{session.title}</span>
                    </div>
                    <button
                      onClick={(e) => deleteSession(session.id, e)}
                      className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-500 transition-all"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>

              <div className="mt-auto space-y-2 pt-4 border-t border-zinc-200/20">
                <button
                  onClick={() => setShowFeedback(true)}
                  className={cn(
                    "flex items-center gap-3 w-full p-3 rounded-xl text-sm font-medium transition-all hover:bg-zinc-100",
                    isHackerMode ? "hover:bg-hacker-green/10 text-hacker-green" : "text-zinc-600"
                  )}
                >
                  <MessageCircle size={18} />
                  Feedback
                </button>
                <button
                  onClick={() => setShowAbout(true)}
                  className={cn(
                    "flex items-center gap-3 w-full p-3 rounded-xl text-sm font-medium transition-all hover:bg-zinc-100",
                    isHackerMode ? "hover:bg-hacker-green/10 text-hacker-green" : "text-zinc-600"
                  )}
                >
                  <Info size={18} />
                  About AI
                </button>

                <button
                  onClick={handleLogout}
                  className={cn(
                    "flex items-center gap-3 w-full p-3 rounded-xl text-sm font-medium transition-all hover:bg-red-50 text-red-600",
                    isHackerMode && "hover:bg-red-900/20"
                  )}
                >
                  <LogOut size={18} />
                  Logout
                </button>

                <div className="flex items-center gap-3 p-2 pt-4">
                  <img src={user.photoURL || ""} alt={user.displayName || ""} className="w-8 h-8 rounded-full border border-zinc-200" referrerPolicy="no-referrer" />
                  <div className="text-xs overflow-hidden">
                    <p className="font-bold truncate">{user.displayName}</p>
                    <p className="opacity-50 truncate">{user.email}</p>
                  </div>
                </div>
              </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <div className="flex-1 flex flex-col h-full relative overflow-hidden">
        {/* Header */}
        <header className={cn(
          "flex items-center justify-between p-4 border-b shrink-0",
          isHackerMode ? "border-hacker-green/30 bg-black/50" : "border-zinc-200 bg-white/80 backdrop-blur-md"
        )}>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className={cn(
                "p-2 rounded-lg transition-all hover:bg-zinc-100",
                isHackerMode && "hover:bg-hacker-green/10 text-hacker-green"
              )}
            >
              {isSidebarOpen ? <ChevronLeft size={20} /> : <Menu size={20} />}
            </button>
            <div className={cn(
              "p-2 rounded-xl hidden sm:block",
              isHackerMode ? "bg-hacker-green/10 text-hacker-green" : "bg-indigo-100 text-indigo-600"
            )}>
              {isHackerMode ? <Terminal size={24} /> : <Sparkles size={24} />}
            </div>
            <div>
              <h1 className={cn(
                "font-bold text-lg sm:text-xl tracking-tight",
                isHackerMode && "hacker-glow"
              )}>
                HP <span className="text-xs sm:text-sm font-normal opacity-70">{isHackerMode ? "[Hacker Edition]" : "AI"}</span>
              </h1>
              <p className="text-[10px] sm:text-xs opacity-60">
                {isHackerMode ? "Status: Root Access Granted 🔓" : "Online & Ready to Help 😊"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-4">
            <div className="hidden md:flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800 p-1 rounded-xl">
              <button
                onClick={() => setUseSearch(!useSearch)}
                className={cn(
                  "p-2 rounded-lg transition-all",
                  useSearch ? "bg-white shadow-sm text-blue-600" : "text-zinc-400 hover:text-zinc-600"
                )}
                title="Google Search Grounding"
              >
                <Search size={18} />
              </button>
              <button
                onClick={() => setUseMaps(!useMaps)}
                className={cn(
                  "p-2 rounded-lg transition-all",
                  useMaps ? "bg-white shadow-sm text-green-600" : "text-zinc-400 hover:text-zinc-600"
                )}
                title="Google Maps Grounding"
              >
                <MapPin size={18} />
              </button>
              <button
                onClick={() => setIsThinkingMode(!isThinkingMode)}
                className={cn(
                  "p-2 rounded-lg transition-all",
                  isThinkingMode ? "bg-white shadow-sm text-purple-600" : "text-zinc-400 hover:text-zinc-600"
                )}
                title="Thinking Mode (Deep Reasoning)"
              >
                <Brain size={18} />
              </button>
            </div>
            <button
              onClick={toggleHackerMode}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 sm:px-4 sm:py-2 rounded-full text-xs sm:text-sm font-medium transition-all active:scale-95",
                isHackerMode 
                  ? "bg-hacker-green text-black hover:bg-hacker-green/90" 
                  : "bg-zinc-900 text-white hover:bg-zinc-800"
              )}
            >
              {isHackerMode ? <Cpu size={16} /> : <ShieldAlert size={16} />}
              <span className="hidden xs:inline">{isHackerMode ? "Normal Mode" : "Hacker Mode"}</span>
            </button>
          </div>
        </header>

      {/* Chat Area */}
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 space-y-6 scrollbar-hide"
      >
        <AnimatePresence initial={false}>
          {messages.map((msg, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn(
                "flex gap-3 max-w-[85%]",
                msg.role === 'user' ? "ml-auto flex-row-reverse" : "mr-auto"
              )}
            >
              <div className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-1",
                msg.role === 'user' 
                  ? (isHackerMode ? "bg-hacker-green/20 text-hacker-green" : "bg-zinc-200 text-zinc-600")
                  : (isHackerMode ? "bg-hacker-green text-black" : "bg-indigo-600 text-white")
              )}>
                {msg.role === 'user' ? <User size={16} /> : <MessageSquare size={16} />}
              </div>
              
              <div className={cn(
                "p-4 rounded-2xl shadow-sm markdown-body relative",
                msg.role === 'user' 
                  ? (isHackerMode ? "bg-hacker-green/10 border border-hacker-green/30" : "bg-zinc-100")
                  : (isHackerMode ? "bg-black/40 border border-hacker-green/20" : "bg-white border border-zinc-100")
              )}>
                {msg.isHackerMode && (
                  <div className="absolute -top-2 -right-2 bg-hacker-green text-black text-[8px] font-bold px-1.5 py-0.5 rounded-full shadow-sm uppercase tracking-tighter z-10">
                    Hacker
                  </div>
                )}
                {msg.mediaUrl && (
                  <div className="mb-4">
                    {msg.type === 'image' && (
                      <img src={msg.mediaUrl} alt="Generated" className="rounded-xl max-w-full shadow-lg" referrerPolicy="no-referrer" />
                    )}
                    {msg.type === 'video' && (
                      <div className="relative">
                        <video 
                          src={msg.mediaUrl} 
                          controls 
                          className="rounded-xl max-w-full shadow-lg"
                          onError={(e) => {
                            const target = e.target as HTMLVideoElement;
                            if (target.src.startsWith('blob:')) {
                              target.parentElement!.innerHTML = '<div className="p-4 bg-zinc-800 text-white rounded-xl text-xs flex items-center gap-2"><VideoOff size={16} /> Video expired (refresh session to re-generate)</div>';
                            }
                          }}
                        />
                      </div>
                    )}
                    {msg.type === 'audio' && (
                      <audio 
                        src={msg.mediaUrl} 
                        controls 
                        className="w-full"
                        onError={(e) => {
                          const target = e.target as HTMLAudioElement;
                          if (target.src.startsWith('blob:')) {
                            target.parentElement!.innerHTML = '<div className="p-4 bg-zinc-800 text-white rounded-xl text-xs flex items-center gap-2"><VolumeX size={16} /> Audio expired</div>';
                          }
                        }}
                      />
                    )}
                  </div>
                )}
                {msg.attachments && msg.attachments.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-3">
                    {msg.attachments.map((att, idx) => (
                      <div key={idx} className="relative group">
                        {att.mimeType.startsWith('image/') ? (
                          <img 
                            src={`data:${att.mimeType};base64,${att.data}`} 
                            alt={att.name} 
                            className="max-w-[200px] max-h-[200px] rounded-lg object-cover border border-zinc-200"
                            referrerPolicy="no-referrer"
                          />
                        ) : att.mimeType.startsWith('audio/') ? (
                          <div className="flex items-center gap-2 p-2 bg-zinc-800 text-white rounded-lg text-xs">
                            <Music size={14} />
                            <span className="truncate max-w-[100px]">{att.name}</span>
                            <audio controls className="h-8 w-40">
                              <source src={`data:${att.mimeType};base64,${att.data}`} type={att.mimeType} />
                            </audio>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 p-2 bg-zinc-200 rounded-lg text-xs text-zinc-700">
                            <FileText size={14} />
                            <span>{att.name}</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <Markdown>{msg.content}</Markdown>
                {msg.role === 'model' && (
                  <button
                    onClick={() => playTTS(msg.content)}
                    className="mt-2 p-1.5 rounded-lg hover:bg-zinc-100 transition-all text-zinc-400 hover:text-indigo-600"
                    title="Listen to response"
                  >
                    <Volume2 size={16} />
                  </button>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        
        {isLoading && (
          <div className="flex gap-3 mr-auto max-w-[85%] animate-pulse">
            <div className={cn(
              "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
              isHackerMode ? "bg-hacker-green text-black" : "bg-indigo-600 text-white"
            )}>
              <MessageSquare size={16} />
            </div>
            <div className={cn(
              "p-4 rounded-2xl border",
              isHackerMode ? "bg-black/40 border-hacker-green/20 text-hacker-green" : "bg-white border-zinc-100"
            )}>
              {isHackerMode ? "Decrypting response..." : "AI is replying..."}
            </div>
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className={cn(
        "p-4 border-t",
        isHackerMode ? "border-hacker-green/30 bg-black/50" : "border-zinc-200 bg-white"
      )}>
        <div className="max-w-4xl mx-auto">
          {/* Attachment Previews */}
          <AnimatePresence>
            {attachedFiles.length > 0 && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="flex flex-wrap gap-2 mb-3 p-2 rounded-xl bg-zinc-100 dark:bg-zinc-900/50"
              >
                {attachedFiles.map((file, idx) => (
                  <div key={idx} className="relative group">
                    {file.previewUrl ? (
                      <img src={file.previewUrl} className="w-16 h-16 rounded-lg object-cover border border-zinc-300" />
                    ) : (
                      <div className="w-16 h-16 rounded-lg bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center text-zinc-500">
                        {file.mimeType.startsWith('audio/') ? <Music size={24} /> : <FileText size={24} />}
                      </div>
                    )}
                    <button 
                      onClick={() => removeAttachment(idx)}
                      className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5 shadow-md opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          <div className="relative flex items-center gap-2">
            <input 
              type="file" 
              ref={fileInputRef}
              onChange={handleFileChange}
              multiple
              accept="image/*,audio/*"
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "p-3 rounded-xl transition-all active:scale-90",
                isHackerMode 
                  ? "bg-zinc-800 text-hacker-green hover:bg-zinc-700" 
                  : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
              )}
              title="Attach File"
            >
              <Paperclip size={20} />
            </button>

            <button
              onClick={toggleSpeechRecognition}
              className={cn(
                "p-3 rounded-xl transition-all active:scale-90 relative",
                isListening 
                  ? (isHackerMode ? "bg-hacker-green text-black" : "bg-red-500 text-white animate-pulse")
                  : (isHackerMode ? "bg-zinc-800 text-hacker-green hover:bg-zinc-700" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200")
              )}
              title={isListening ? "Stop Listening" : "Speak Message"}
            >
              {isListening ? <MicOff size={20} /> : <Mic size={20} />}
              {isListening && (
                <span className="absolute -top-1 -right-1 flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                </span>
              )}
            </button>

            <div className="relative flex-1">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                placeholder={isHackerMode ? "Enter command or query..." : "Apne dost se kuch bhi pucho..."}
                className={cn(
                  "w-full p-4 pr-14 rounded-2xl outline-none transition-all",
                  isHackerMode 
                    ? "bg-black border border-hacker-green/50 text-hacker-green placeholder:text-hacker-green/30 focus:border-hacker-green" 
                    : "bg-zinc-100 border border-transparent focus:bg-white focus:border-indigo-300"
                )}
              />
              <button
                onClick={handleSend}
                disabled={isLoading || (!input.trim() && attachedFiles.length === 0)}
                className={cn(
                  "absolute right-2 top-2 p-3 rounded-xl transition-all active:scale-90 disabled:opacity-50",
                  isHackerMode 
                    ? "bg-hacker-green text-black hover:shadow-[0_0_15px_rgba(0,255,65,0.5)]" 
                    : "bg-indigo-600 text-white hover:bg-indigo-700"
                )}
              >
                <Send size={20} />
              </button>
            </div>
          </div>
        </div>
        <p className="text-[10px] text-center mt-2 opacity-40">
          HP can make mistakes. Always verify technical commands.
        </p>
      </div>
    </div>
  </div>
  );
}
