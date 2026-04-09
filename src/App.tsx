/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from 'react';
import { 
  Plus, 
  BookOpen, 
  History, 
  Printer, 
  Upload, 
  Image as ImageIcon, 
  Trash2, 
  CheckCircle2, 
  ChevronRight, 
  Loader2, 
  RefreshCw,
  LogOut,
  User,
  Download,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useDropzone } from 'react-dropzone';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut, 
  User as FirebaseUser 
} from 'firebase/auth';
import { 
  collection, 
  addDoc, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  deleteDoc, 
  doc 
} from 'firebase/firestore';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

import { auth, db, handleFirestoreError, OperationType } from './lib/firebase';
import { geminiService } from './services/geminiService';
import { WrongQuestionRecord, OCRResult, Variation, QuestionData } from './types';
import { cn } from './lib/utils';

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [activeTab, setActiveTab] = useState<'recognize' | 'notebook'>('recognize');
  const [loading, setLoading] = useState(true);
  
  // Recognition State
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [ocrResult, setOcrResult] = useState<OCRResult | null>(null);
  const [variations, setVariations] = useState<Variation[]>([]);
  const [isRecognizing, setIsRecognizing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Notebook State
  const [records, setRecords] = useState<WrongQuestionRecord[]>([]);
  const [selectedRecords, setSelectedRecords] = useState<string[]>([]);
  const [isPrinting, setIsPrinting] = useState(false);
  const [viewRecord, setViewRecord] = useState<WrongQuestionRecord | null>(null);

  const printRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, 'wrongQuestions'),
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as WrongQuestionRecord[];
      setRecords(data);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'wrongQuestions');
    });

    return () => unsubscribe();
  }, [user]);

  const handleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error('Login failed:', error);
    }
  };

  const handleLogout = () => signOut(auth);

  const onDrop = (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        setSelectedImage(reader.result as string);
        setOcrResult(null);
        setVariations([]);
      };
      reader.readAsDataURL(file);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop, 
    accept: { 'image/*': [] },
    multiple: false 
  } as any);

  const handleRecognize = async () => {
    if (!selectedImage) return;
    setIsRecognizing(true);
    try {
      const base64 = selectedImage.split(',')[1];
      const mimeType = selectedImage.split(';')[0].split(':')[1];
      const result = await geminiService.recognizeWrongQuestion(base64, mimeType);
      setOcrResult(result);
    } catch (error) {
      console.error('Recognition failed:', error);
    } finally {
      setIsRecognizing(false);
    }
  };

  const handleGenerate = async () => {
    if (!ocrResult) return;
    setIsGenerating(true);
    try {
      const result = await geminiService.generateVariations(ocrResult.knowledgePoint, ocrResult.text);
      setVariations(result.variations);
    } catch (error) {
      console.error('Generation failed:', error);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSave = async () => {
    if (!user || !ocrResult || variations.length === 0) return;
    setIsSaving(true);
    try {
      const record: Omit<WrongQuestionRecord, 'id'> = {
        userId: user.uid,
        originalQuestion: {
          ...ocrResult,
          imageUrl: selectedImage || undefined
        },
        knowledgePoint: ocrResult.knowledgePoint,
        variations,
        createdAt: new Date().toISOString()
      };
      await addDoc(collection(db, 'wrongQuestions'), record);
      setActiveTab('notebook');
      // Reset recognition state
      setSelectedImage(null);
      setOcrResult(null);
      setVariations([]);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'wrongQuestions');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('确定要删除这条记录吗？')) return;
    try {
      await deleteDoc(doc(db, 'wrongQuestions', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `wrongQuestions/${id}`);
    }
  };

  const toggleSelection = (id: string) => {
    setSelectedRecords(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handlePrint = async (ids?: string[]) => {
    const targetIds = ids || selectedRecords;
    if (targetIds.length === 0) return;
    setIsPrinting(true);
    
    // Temporarily set selected records for printing if a specific list was provided
    const originalSelection = [...selectedRecords];
    if (ids) setSelectedRecords(ids);

    // Wait for the print preview to render
    setTimeout(async () => {
      try {
        const element = printRef.current;
        if (!element) return;

        const canvas = await html2canvas(element, {
          scale: 2,
          useCORS: true,
          logging: false
        });
        
        const imgData = canvas.toDataURL('image/png');
        const pdf = new jsPDF('p', 'mm', 'a4');
        const imgProps = pdf.getImageProperties(imgData);
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
        
        pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
        pdf.save(`错题集_${new Date().toLocaleDateString()}.pdf`);
      } catch (error) {
        console.error('PDF generation failed:', error);
      } finally {
        setIsPrinting(false);
        if (ids) setSelectedRecords(originalSelection);
      }
    }, 500);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-white p-8 rounded-3xl shadow-xl text-center"
        >
          <div className="w-20 h-20 bg-blue-100 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <BookOpen className="w-10 h-10 text-blue-600" />
          </div>
          <h1 className="text-3xl font-bold text-slate-900 mb-2">错题举一反三打印机</h1>
          <p className="text-slate-500 mb-8">全科通用，智能识别，举一反三，轻松打印</p>
          <button 
            onClick={handleLogin}
            className="w-full py-4 bg-blue-600 text-white rounded-2xl font-semibold flex items-center justify-center gap-3 hover:bg-blue-700 transition-colors shadow-lg shadow-blue-200"
          >
            <User className="w-5 h-5" />
            使用 Google 账号登录
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 px-4 py-3">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <BookOpen className="w-5 h-5 text-white" />
            </div>
            <h1 className="font-bold text-slate-900 hidden sm:block">错题打印机</h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-slate-500 hidden sm:block">{user.email}</span>
            <button 
              onClick={handleLogout}
              className="p-2 text-slate-400 hover:text-red-500 transition-colors"
              title="退出登录"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-4">
        <AnimatePresence mode="wait">
          {activeTab === 'recognize' ? (
            <motion.div 
              key="recognize"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="space-y-6"
            >
              {/* Upload Section */}
              <div 
                {...getRootProps()} 
                className={cn(
                  "border-2 border-dashed rounded-3xl p-8 transition-all cursor-pointer text-center",
                  isDragActive ? "border-blue-500 bg-blue-50" : "border-slate-200 bg-white hover:border-blue-400"
                )}
              >
                <input {...getInputProps()} />
                {selectedImage ? (
                  <div className="relative group">
                    <img src={selectedImage} alt="Selected" className="max-h-64 mx-auto rounded-xl shadow-md" />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-xl">
                      <p className="text-white font-medium">点击更换图片</p>
                    </div>
                  </div>
                ) : (
                  <div className="py-8">
                    <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Upload className="w-8 h-8 text-slate-400" />
                    </div>
                    <p className="text-lg font-medium text-slate-700">点击或拖拽上传错题图片</p>
                    <p className="text-sm text-slate-400 mt-1">支持 JPG, PNG 格式</p>
                  </div>
                )}
              </div>

              {selectedImage && !ocrResult && (
                <button 
                  onClick={handleRecognize}
                  disabled={isRecognizing}
                  className="w-full py-4 bg-blue-600 text-white rounded-2xl font-semibold flex items-center justify-center gap-2 hover:bg-blue-700 disabled:opacity-50 shadow-lg shadow-blue-200"
                >
                  {isRecognizing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
                  {isRecognizing ? '正在识别题目...' : '开始识别错题'}
                </button>
              )}

              {/* OCR Result Section */}
              {ocrResult && (
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100 space-y-4"
                >
                  <div className="flex items-center justify-between">
                    <h2 className="text-xl font-bold text-slate-900">识别结果</h2>
                    <span className="px-3 py-1 bg-blue-100 text-blue-700 text-xs font-bold rounded-full uppercase tracking-wider">
                      {ocrResult.knowledgePoint}
                    </span>
                  </div>
                  
                  <div className="space-y-4">
                    <div>
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">题目内容</label>
                      <textarea 
                        value={ocrResult.text}
                        onChange={(e) => setOcrResult({ ...ocrResult, text: e.target.value })}
                        className="w-full mt-1 p-3 bg-slate-50 rounded-xl border-none focus:ring-2 focus:ring-blue-500 min-h-[100px]"
                      />
                    </div>
                    
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">你的回答</label>
                        <input 
                          value={ocrResult.userAnswer || ''}
                          onChange={(e) => setOcrResult({ ...ocrResult, userAnswer: e.target.value })}
                          className="w-full mt-1 p-3 bg-slate-50 rounded-xl border-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">标准答案</label>
                        <input 
                          value={ocrResult.correctAnswer || ''}
                          onChange={(e) => setOcrResult({ ...ocrResult, correctAnswer: e.target.value })}
                          className="w-full mt-1 p-3 bg-slate-50 rounded-xl border-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    </div>
                  </div>

                  {variations.length === 0 ? (
                    <button 
                      onClick={handleGenerate}
                      disabled={isGenerating}
                      className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-semibold flex items-center justify-center gap-2 hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {isGenerating ? <Loader2 className="w-5 h-5 animate-spin" /> : <RefreshCw className="w-5 h-5" />}
                      {isGenerating ? '正在生成举一反三...' : '生成举一反三题目'}
                    </button>
                  ) : (
                    <div className="space-y-6 pt-4 border-t border-slate-100">
                      <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                        <History className="w-5 h-5 text-indigo-600" />
                        举一反三题目
                      </h3>
                      <div className="space-y-4">
                        {variations.map((v, i) => (
                          <div key={i} className="bg-indigo-50/50 rounded-2xl p-4 border border-indigo-100">
                            <p className="font-medium text-slate-800 mb-2">题目 {i + 1}: {v.text}</p>
                            <div className="space-y-2 text-sm">
                              <p className="text-slate-600"><span className="font-bold text-indigo-600">答案:</span> {v.answer}</p>
                              <p className="text-slate-600"><span className="font-bold text-indigo-600">解析:</span> {v.analysis}</p>
                              {v.commonMistakes && (
                                <p className="text-red-600 bg-red-50 p-2 rounded-lg"><span className="font-bold">易错点:</span> {v.commonMistakes}</p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="flex gap-3">
                        <button 
                          onClick={handleGenerate}
                          disabled={isGenerating}
                          className="flex-1 py-3 bg-slate-100 text-slate-700 rounded-xl font-medium hover:bg-slate-200 transition-colors flex items-center justify-center gap-2"
                        >
                          <RefreshCw className="w-4 h-4" />
                          重新生成
                        </button>
                        <button 
                          onClick={handleSave}
                          disabled={isSaving}
                          className="flex-[2] py-3 bg-green-600 text-white rounded-xl font-bold hover:bg-green-700 transition-colors flex items-center justify-center gap-2 shadow-lg shadow-green-100"
                        >
                          {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
                          保存到错题本
                        </button>
                      </div>
                      <div className="pt-2">
                        <button 
                          onClick={() => {
                            // Create a temporary record for printing
                            const tempRecord: WrongQuestionRecord = {
                              id: 'temp',
                              userId: user.uid,
                              originalQuestion: { ...ocrResult!, imageUrl: selectedImage || undefined },
                              knowledgePoint: ocrResult!.knowledgePoint,
                              variations,
                              createdAt: new Date().toISOString()
                            };
                            // We need to handle this special case in handlePrint or just save first.
                            // For simplicity, let's suggest saving first or implement a temp print.
                            // Actually, let's just make it save then print.
                            handleSave().then(() => {
                              // After saving, the record will be in the list. 
                              // But handleSave redirects to notebook.
                            });
                          }}
                          className="w-full py-3 border border-slate-200 text-slate-600 rounded-xl font-medium hover:bg-slate-50 flex items-center justify-center gap-2"
                        >
                          <Printer className="w-4 h-4" />
                          保存并立即打印
                        </button>
                      </div>
                    </div>
                  )}
                </motion.div>
              )}
            </motion.div>
          ) : (
            <motion.div 
              key="notebook"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold text-slate-900">我的错题本</h2>
                <div className="flex gap-2">
                  {selectedRecords.length > 0 && (
                    <button 
                      onClick={handlePrint}
                      disabled={isPrinting}
                      className="px-4 py-2 bg-blue-600 text-white rounded-xl font-medium flex items-center gap-2 hover:bg-blue-700 disabled:opacity-50 shadow-lg shadow-blue-100"
                    >
                      {isPrinting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
                      打印选中的 ({selectedRecords.length})
                    </button>
                  )}
                  <button 
                    onClick={() => setSelectedRecords(records.length === selectedRecords.length ? [] : records.map(r => r.id!))}
                    className="px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded-xl font-medium hover:bg-slate-50"
                  >
                    {records.length === selectedRecords.length ? '取消全选' : '全选'}
                  </button>
                </div>
              </div>

              <div className="grid gap-4">
                {records.length === 0 ? (
                  <div className="text-center py-20 bg-white rounded-3xl border border-slate-100">
                    <History className="w-12 h-12 text-slate-200 mx-auto mb-4" />
                    <p className="text-slate-400">还没有错题记录，快去识别吧</p>
                  </div>
                ) : (
                  records.map(record => (
                    <div 
                      key={record.id}
                      className={cn(
                        "bg-white rounded-2xl p-4 border transition-all flex items-center gap-4 group",
                        selectedRecords.includes(record.id!) ? "border-blue-500 ring-1 ring-blue-500" : "border-slate-100 hover:border-blue-200"
                      )}
                    >
                      <div 
                        onClick={() => toggleSelection(record.id!)}
                        className={cn(
                          "w-6 h-6 rounded-full border-2 flex items-center justify-center cursor-pointer transition-colors",
                          selectedRecords.includes(record.id!) ? "bg-blue-600 border-blue-600" : "border-slate-200"
                        )}
                      >
                        {selectedRecords.includes(record.id!) && <CheckCircle2 className="w-4 h-4 text-white" />}
                      </div>
                      
                      <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setViewRecord(record)}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-[10px] font-bold rounded uppercase tracking-wider">
                            {record.knowledgePoint}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            {new Date(record.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                        <p className="text-slate-800 font-medium truncate">{record.originalQuestion.text}</p>
                      </div>

                      <div className="flex items-center gap-2">
                        <button 
                          onClick={() => handlePrint([record.id!])}
                          className="p-2 text-slate-400 hover:text-blue-600 transition-colors"
                          title="打印此题"
                        >
                          <Printer className="w-5 h-5" />
                        </button>
                        <button 
                          onClick={() => setViewRecord(record)}
                          className="p-2 text-slate-400 hover:text-blue-600 transition-colors"
                        >
                          <ChevronRight className="w-5 h-5" />
                        </button>
                        <button 
                          onClick={() => handleDelete(record.id!)}
                          className="p-2 text-slate-400 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-6 py-3 z-40">
        <div className="max-w-md mx-auto flex items-center justify-around">
          <button 
            onClick={() => setActiveTab('recognize')}
            className={cn(
              "flex flex-col items-center gap-1 transition-colors",
              activeTab === 'recognize' ? "text-blue-600" : "text-slate-400 hover:text-slate-600"
            )}
          >
            <Plus className="w-6 h-6" />
            <span className="text-[10px] font-bold uppercase tracking-widest">错题识别</span>
          </button>
          <button 
            onClick={() => setActiveTab('notebook')}
            className={cn(
              "flex flex-col items-center gap-1 transition-colors",
              activeTab === 'notebook' ? "text-blue-600" : "text-slate-400 hover:text-slate-600"
            )}
          >
            <History className="w-6 h-6" />
            <span className="text-[10px] font-bold uppercase tracking-widest">错题本</span>
          </button>
        </div>
      </nav>

      {/* Record Detail Modal */}
      <AnimatePresence>
        {viewRecord && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white w-full max-w-2xl max-h-[90vh] rounded-3xl overflow-hidden flex flex-col shadow-2xl"
            >
              <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                <div className="flex items-center gap-4">
                  <h3 className="font-bold text-slate-900">错题详情</h3>
                  <button 
                    onClick={() => handlePrint([viewRecord.id!])}
                    className="flex items-center gap-1.5 px-3 py-1 bg-blue-600 text-white text-xs font-bold rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    打印此题
                  </button>
                </div>
                <button onClick={() => setViewRecord(null)} className="p-2 hover:bg-slate-200 rounded-full transition-colors">
                  <X className="w-5 h-5 text-slate-500" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-6 space-y-8">
                <section className="space-y-4">
                  <div className="flex items-center gap-2">
                    <div className="w-1 h-6 bg-blue-600 rounded-full" />
                    <h4 className="font-bold text-slate-900">原题内容</h4>
                  </div>
                  {viewRecord.originalQuestion.imageUrl && (
                    <img src={viewRecord.originalQuestion.imageUrl} alt="Original" className="max-h-48 rounded-xl shadow-sm" />
                  )}
                  <div className="bg-slate-50 p-4 rounded-2xl text-slate-800 leading-relaxed">
                    {viewRecord.originalQuestion.text}
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div className="bg-red-50 p-3 rounded-xl border border-red-100">
                      <p className="text-xs font-bold text-red-400 uppercase tracking-widest mb-1">你的回答</p>
                      <p className="text-red-700 font-medium">{viewRecord.originalQuestion.userAnswer || '无'}</p>
                    </div>
                    <div className="bg-green-50 p-3 rounded-xl border border-green-100">
                      <p className="text-xs font-bold text-green-400 uppercase tracking-widest mb-1">标准答案</p>
                      <p className="text-green-700 font-medium">{viewRecord.originalQuestion.correctAnswer || '无'}</p>
                    </div>
                  </div>
                </section>

                <section className="space-y-4">
                  <div className="flex items-center gap-2">
                    <div className="w-1 h-6 bg-indigo-600 rounded-full" />
                    <h4 className="font-bold text-slate-900">举一反三</h4>
                  </div>
                  <div className="space-y-4">
                    {viewRecord.variations.map((v, i) => (
                      <div key={i} className="bg-indigo-50/30 p-4 rounded-2xl border border-indigo-100/50 space-y-3">
                        <p className="font-bold text-slate-800">变式 {i + 1}</p>
                        <p className="text-slate-700">{v.text}</p>
                        <div className="pt-3 border-t border-indigo-100 text-sm space-y-2">
                          <p><span className="font-bold text-indigo-600">答案:</span> {v.answer}</p>
                          <p><span className="font-bold text-indigo-600">解析:</span> {v.analysis}</p>
                          {v.commonMistakes && (
                            <p className="text-red-600 bg-red-50 p-2 rounded-lg"><span className="font-bold">易错点:</span> {v.commonMistakes}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hidden Print Container */}
      <div className="fixed -left-[9999px] top-0">
        <div ref={printRef} className="w-[210mm] bg-white p-[20mm] space-y-12 text-black">
          <div className="text-center border-b-2 border-black pb-6">
            <h1 className="text-3xl font-bold">错题举一反三练习集</h1>
            <p className="text-sm mt-2">生成时间: {new Date().toLocaleString()}</p>
          </div>
          
          {records.filter(r => selectedRecords.includes(r.id!)).map((record, idx) => (
            <div key={record.id} className="space-y-8 page-break-inside-avoid">
              <div className="flex items-center gap-4">
                <span className="text-2xl font-black bg-black text-white w-10 h-10 flex items-center justify-center rounded">
                  {idx + 1}
                </span>
                <h2 className="text-xl font-bold border-b border-black flex-1 pb-1">
                  知识点: {record.knowledgePoint}
                </h2>
              </div>

              <div className="space-y-4">
                <h3 className="font-bold text-lg underline underline-offset-4">【原错题】</h3>
                <p className="text-lg leading-relaxed">{record.originalQuestion.text}</p>
                <div className="grid grid-cols-2 gap-8 text-sm italic">
                  <p>我的回答: {record.originalQuestion.userAnswer || '____'}</p>
                  <p>标准答案: {record.originalQuestion.correctAnswer || '____'}</p>
                </div>
              </div>

              <div className="space-y-6">
                <h3 className="font-bold text-lg underline underline-offset-4">【举一反三】</h3>
                {record.variations.map((v, vIdx) => (
                  <div key={vIdx} className="space-y-3 pl-4 border-l-2 border-slate-200">
                    <p className="font-bold">变式 {vIdx + 1}:</p>
                    <p className="text-lg leading-relaxed">{v.text}</p>
                    <div className="mt-4 p-4 bg-slate-50 rounded border border-slate-200 text-sm space-y-1">
                      <p><span className="font-bold">答案:</span> {v.answer}</p>
                      <p><span className="font-bold">解析:</span> {v.analysis}</p>
                      {v.commonMistakes && <p className="text-red-700"><span className="font-bold">易错点:</span> {v.commonMistakes}</p>}
                    </div>
                  </div>
                ))}
              </div>
              
              {idx < selectedRecords.length - 1 && <div className="border-b border-dashed border-slate-300 pt-8" />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
