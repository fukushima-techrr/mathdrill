
import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, Type } from "@google/genai";
import { MathProblem, AppStatus, GameState } from './types';
import { soundService } from './services/sound';
import ScratchPad from './components/ScratchPad';

const App: React.FC = () => {
  const [hasCheckedKey, setHasCheckedKey] = useState(false);
  const [needsKeySelection, setNeedsKeySelection] = useState(false);

  const [gameState, setGameState] = useState<GameState>(() => {
    const saved = sessionStorage.getItem('sansu_quest_state');
    if (saved) {
      const parsed = JSON.parse(saved);
      return { ...parsed, status: AppStatus.IDLE };
    }
    return {
      problems: [],
      currentIndex: 0,
      wrongProblemIds: [],
      status: AppStatus.IDLE,
      isCorrect: null
    };
  });

  const [loadingMsg, setLoadingMsg] = useState('クエストをじゅんびちゅう...');
  const clearCanvasRef = useRef<() => void>(() => {});

  useEffect(() => {
    const checkKey = async () => {
      const aistudio = (window as any).aistudio;
      if (aistudio && typeof aistudio.hasSelectedApiKey === 'function') {
        const hasKey = await aistudio.hasSelectedApiKey();
        setNeedsKeySelection(!hasKey);
      } else {
        // aistudioオブジェクトがない場合は、process.env.API_KEYの有無で判断
        setNeedsKeySelection(!process.env.API_KEY);
      }
      setHasCheckedKey(true);
    };
    checkKey();
  }, []);

  const handleOpenSelectKey = async () => {
    const aistudio = (window as any).aistudio;
    if (aistudio && typeof aistudio.openSelectKey === 'function') {
      try {
        await aistudio.openSelectKey();
      } catch (e) {
        console.error("Failed to open key selection dialog:", e);
      }
    }
    // レースコンディション回避のため、aistudioの有無に関わらず即座に状態を更新してアプリへ進む
    setNeedsKeySelection(false);
  };

  useEffect(() => {
    sessionStorage.setItem('sansu_quest_state', JSON.stringify(gameState));
  }, [gameState]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setGameState(prev => ({ ...prev, status: AppStatus.LOADING }));
    setLoadingMsg('AIがもんだいをよんでいるよ...');

    try {
      // API呼び出しの直前に新しいインスタンスを作成する（最新のAPIキーを使用するため）
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || "" });
      
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve) => {
        reader.onload = () => {
          const base64 = (reader.result as string).split(',')[1];
          resolve(base64);
        };
      });
      reader.readAsDataURL(file);
      const base64Data = await base64Promise;

      const prompt = `
        この算数ドリルの画像から、算数の問題を抽出し、それに基づいた「類題（数値や設定が異なるが、解き方のロジックは同じ問題）」を5問作成してください。
        必ず3択クイズ形式、JSON形式で出力すること。
      `;

      const response = await ai.models.generateContent({
        model: "gemini-3-pro-preview",
        contents: [
          {
            parts: [
              { text: prompt },
              { inlineData: { mimeType: file.type, data: base64Data } }
            ]
          }
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                question: { type: Type.STRING },
                options: { type: Type.ARRAY, items: { type: Type.STRING } },
                answerIndex: { type: Type.NUMBER }
              },
              required: ["question", "options", "answerIndex"]
            }
          }
        }
      });

      const textResponse = response.text;
      if (!textResponse) throw new Error("Empty response");

      const parsedData = JSON.parse(textResponse);
      const generatedProblems: MathProblem[] = (Array.isArray(parsedData) ? parsedData : []).map((p: any, i: number) => ({
        question: p.question || "もんだいを取得できませんでした",
        options: Array.isArray(p.options) ? p.options : ["?", "?", "?"],
        answerIndex: typeof p.answerIndex === 'number' ? p.answerIndex : 0,
        id: `prob-${Date.now()}-${i}`
      }));

      setGameState({
        problems: generatedProblems,
        currentIndex: 0,
        wrongProblemIds: [],
        status: AppStatus.PLAYING,
        isCorrect: null
      });
    } catch (error: any) {
      console.error("AI Quest Error:", error);
      const errorMessage = error?.message || "";
      
      // キーが無効な場合のエラーハンドリング
      if (errorMessage.includes("Requested entity was not found")) {
        setNeedsKeySelection(true);
        alert("APIキーが うまくみつからなかったよ。もういちど キーをえらんでね！");
      } else {
        alert("AIが もんだいを つくれなかったみたい。しゃしんを かえて もういちど ためしてね！");
      }
      setGameState(prev => ({ ...prev, status: AppStatus.IDLE }));
    }
  };

  const handleAnswer = (choiceIndex: number) => {
    const currentProblem = gameState.problems[gameState.currentIndex];
    const correct = choiceIndex === currentProblem.answerIndex;

    if (correct) soundService.playSuccess();
    else soundService.playFailure();

    setGameState(prev => ({
      ...prev,
      status: AppStatus.FEEDBACK,
      isCorrect: correct,
      wrongProblemIds: correct ? prev.wrongProblemIds : [...prev.wrongProblemIds, currentProblem.id]
    }));

    setTimeout(() => {
      setGameState(prev => {
        const nextIndex = prev.currentIndex + 1;
        const isEndOfRound = nextIndex >= prev.problems.length;
        return {
          ...prev,
          status: isEndOfRound ? AppStatus.RETRY_SUMMARY : AppStatus.PLAYING,
          currentIndex: nextIndex,
          isCorrect: null
        };
      });
      if (clearCanvasRef.current) clearCanvasRef.current();
    }, 1200);
  };

  const startRetryRound = () => {
    const nextProblems = gameState.problems.filter(p => gameState.wrongProblemIds.includes(p.id));
    if (nextProblems.length === 0) {
      setGameState(prev => ({ ...prev, status: AppStatus.FINISHED }));
    } else {
      setGameState({
        problems: nextProblems,
        currentIndex: 0,
        wrongProblemIds: [],
        status: AppStatus.PLAYING,
        isCorrect: null
      });
      if (clearCanvasRef.current) clearCanvasRef.current();
    }
  };

  const resetGame = () => {
    setGameState({
      problems: [],
      currentIndex: 0,
      wrongProblemIds: [],
      status: AppStatus.IDLE,
      isCorrect: null
    });
  };

  if (!hasCheckedKey) return null;

  return (
    <div className="h-screen w-screen flex flex-col p-4 md:p-8 gap-4 overflow-hidden select-none bg-sky-50">
      {/* Header */}
      <div className="flex justify-between items-center px-6 py-3 bg-white rounded-3xl shadow-md border-b-4 border-sky-200">
        <h1 className="text-2xl md:text-4xl font-black text-sky-500 tracking-tighter">
          AI さんすうクエスト
        </h1>
        <div className="flex gap-3 items-center">
          {gameState.problems.length > 0 && (
            <span className="text-lg font-black text-sky-600 bg-sky-50 px-4 py-1 rounded-full border-2 border-sky-100">
              {gameState.status === AppStatus.RETRY_SUMMARY ? 'リザルト' : `${Math.min(gameState.currentIndex + 1, gameState.problems.length)} / ${gameState.problems.length}`}
            </span>
          )}
          {!needsKeySelection && (
            <button onClick={resetGame} className="bg-slate-100 hover:bg-slate-200 text-slate-500 px-4 py-2 rounded-full font-bold transition-all text-sm">
              さいしょから
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col gap-4 min-h-0">
        {needsKeySelection ? (
          <div className="flex-1 flex flex-col items-center justify-center bg-white rounded-[3rem] shadow-2xl border-4 border-sky-200 p-12 text-center relative overflow-hidden">
            <div className="text-9xl mb-8 animate-bounce">🎒</div>
            <h2 className="text-4xl md:text-6xl font-black text-slate-800 mb-6 tracking-tight">
              さんすうの ぼうけんへ！
            </h2>
            <div className="flex flex-col items-center gap-6">
              <p className="text-xl text-slate-500 font-bold mb-4">
                Googleアカウントで ログインして はじめよう！
              </p>
              <button 
                onClick={handleOpenSelectKey}
                className="group flex items-center gap-4 bg-sky-500 hover:bg-sky-600 text-white px-12 py-6 rounded-full text-3xl font-black shadow-[0_10px_0_rgb(3,105,161)] active:shadow-none active:translate-y-[10px] transition-all"
              >
                <img src="https://www.google.com/favicon.ico" alt="" className="w-8 h-8 bg-white rounded-full p-1" />
                <span>ぼうけんを はじめる</span>
              </button>
            </div>
          </div>
        ) : gameState.status === AppStatus.IDLE ? (
          <div className="flex-1 flex flex-col items-center justify-center bg-white rounded-[3rem] shadow-2xl border-4 border-dashed border-sky-300 p-12 text-center relative overflow-hidden animate-in fade-in duration-500">
            <div className="text-9xl mb-8 animate-pulse">📸</div>
            <h2 className="text-3xl md:text-5xl font-black text-slate-800 mb-6 tracking-tight">
              ドリルの しゃしんを アップしよう！
            </h2>
            <div className="flex flex-col items-center gap-6">
              <p className="text-xl text-slate-500 font-bold mb-4">
                AIが もんだいをつくって くれるよ
              </p>
              <label className="group cursor-pointer bg-sky-500 hover:bg-sky-600 text-white px-12 py-6 rounded-full text-3xl font-black shadow-[0_10px_0_rgb(3,105,161)] active:shadow-none active:translate-y-[10px] transition-all inline-block">
                <span>📸 しゃしんを とる</span>
                <input type="file" accept="image/*" onChange={handleFileUpload} className="hidden" />
              </label>
            </div>
          </div>
        ) : gameState.status === AppStatus.LOADING ? (
          <div className="flex-1 flex flex-col items-center justify-center bg-white rounded-[3rem] p-8 text-center border-4 border-sky-100">
            <div className="w-24 h-24 border-8 border-sky-100 border-t-sky-500 rounded-full animate-spin mb-8"></div>
            <p className="text-3xl font-black text-sky-500 animate-pulse">{loadingMsg}</p>
          </div>
        ) : (gameState.status === AppStatus.PLAYING || gameState.status === AppStatus.FEEDBACK) ? (
          <>
            <div className="h-1/2 flex flex-col gap-4 relative">
              <div className="flex-1 bg-white rounded-[2rem] shadow-xl border-4 border-sky-100 p-8 overflow-y-auto">
                <div className="text-2xl md:text-4xl font-black leading-tight text-slate-700">
                  {gameState.problems[gameState.currentIndex]?.question}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4 md:gap-8 shrink-0">
                {gameState.problems[gameState.currentIndex]?.options.map((option, idx) => (
                  <button
                    key={idx}
                    disabled={gameState.status === AppStatus.FEEDBACK}
                    onClick={() => handleAnswer(idx)}
                    className="aspect-square md:aspect-auto md:py-10 bg-white hover:bg-sky-50 active:scale-95 text-sky-600 rounded-[2rem] text-2xl md:text-5xl font-black shadow-lg border-4 border-sky-200 transition-all disabled:opacity-50"
                  >
                    {option}
                  </button>
                ))}
              </div>
              {gameState.status === AppStatus.FEEDBACK && (
                <div className="absolute inset-0 z-50 flex items-center justify-center pointer-events-none">
                  <div className={`text-[15rem] md:text-[25rem] font-black animate-stamp drop-shadow-2xl ${gameState.isCorrect ? 'text-rose-500' : 'text-blue-500'}`}>
                    {gameState.isCorrect ? '◯' : '×'}
                  </div>
                </div>
              )}
            </div>
            <div className="h-1/2 flex flex-col gap-2 min-h-0">
              <div className="flex justify-between items-center px-4">
                <span className="text-lg font-black text-slate-400">けいさんメモ 📝</span>
                <button onClick={() => clearCanvasRef.current()} className="bg-slate-200 hover:bg-slate-300 text-slate-600 px-6 py-2 rounded-full font-black transition-all shadow-sm">
                  ぜんぶ けす 🧹
                </button>
              </div>
              <div className="flex-1 min-h-0">
                <ScratchPad onClearRef={(fn) => clearCanvasRef.current = fn} />
              </div>
            </div>
          </>
        ) : gameState.status === AppStatus.RETRY_SUMMARY ? (
          <div className="flex-1 flex flex-col items-center justify-center bg-white rounded-[3rem] shadow-2xl p-12 text-center animate-in zoom-in duration-300 border-4 border-sky-400">
            {gameState.wrongProblemIds.length === 0 ? (
              <>
                <div className="text-9xl mb-8">✨</div>
                <h2 className="text-5xl md:text-7xl font-black text-rose-500 mb-6">パーフェクト！</h2>
                <button onClick={resetGame} className="bg-sky-500 hover:bg-sky-600 text-white px-16 py-8 rounded-full text-3xl font-black shadow-[0_10px_0_rgb(3,105,161)] active:translate-y-[10px] active:shadow-none transition-all">もういちど あそぶ</button>
              </>
            ) : (
              <>
                <div className="text-9xl mb-8">🔥</div>
                <h2 className="text-5xl md:text-7xl font-black text-sky-600 mb-6">まだまだ！</h2>
                <p className="text-2xl text-slate-500 font-bold mb-10">あと <span className="text-rose-500 text-4xl">{gameState.wrongProblemIds.length}もん</span> で クリアだ！</p>
                <button onClick={startRetryRound} className="bg-sky-500 hover:bg-sky-600 text-white px-16 py-8 rounded-full text-3xl font-black shadow-[0_10px_0_rgb(3,105,161)] active:translate-y-[10px] active:shadow-none transition-all">まちがえた もんだいに ちょうせん</button>
              </>
            )}
          </div>
        ) : gameState.status === AppStatus.FINISHED && (
          <div className="flex-1 flex flex-col items-center justify-center bg-white rounded-[3rem] shadow-2xl p-12 text-center border-4 border-rose-400">
             <div className="text-[12rem] mb-8 animate-bounce">👑</div>
             <h2 className="text-6xl md:text-8xl font-black text-rose-500 mb-10 italic underline decoration-sky-300 decoration-8">QUEST CLEAR!</h2>
             <button onClick={resetGame} className="bg-sky-500 hover:bg-sky-600 text-white px-16 py-8 rounded-full text-3xl font-black shadow-[0_10px_0_rgb(3,105,161)] active:translate-y-[10px] active:shadow-none transition-all">あたらしい クエストへ</button>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
