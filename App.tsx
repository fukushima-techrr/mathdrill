
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { GoogleGenAI, Type } from "@google/genai";
import { MathProblem, AppStatus, GameState } from './types';
import { soundService } from './services/sound';
import ScratchPad from './components/ScratchPad';

const API_KEY = process.env.API_KEY || ""; // Handled by environment

const App: React.FC = () => {
  // State initialization with sessionStorage fallback
  const [gameState, setGameState] = useState<GameState>(() => {
    const saved = sessionStorage.getItem('sansu_quest_state');
    if (saved) {
      const parsed = JSON.parse(saved);
      return { ...parsed, status: AppStatus.IDLE }; // Start from idle to avoid stale visual state
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

  // Save state to sessionStorage
  useEffect(() => {
    sessionStorage.setItem('sansu_quest_state', JSON.stringify(gameState));
  }, [gameState]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !API_KEY) {
      if (!API_KEY) alert("APIキーが設定されていません。");
      return;
    }

    setGameState(prev => ({ ...prev, status: AppStatus.LOADING }));
    setLoadingMsg('AIがもんだいをよんでいるよ...');

    try {
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve) => {
        reader.onload = () => {
          const base64 = (reader.result as string).split(',')[1];
          resolve(base64);
        };
      });
      reader.readAsDataURL(file);
      const base64Data = await base64Promise;

      const ai = new GoogleGenAI({ apiKey: API_KEY });
      const prompt = `
        この算数ドリルの画像から、算数の問題を抽出し、それに基づいた「類題（似た形式だが数値や設定が異なる問題）」を5問作成してください。
        
        制約:
        - 3択クイズ形式にすること。
        - 答えは必ず選択肢の中に1つだけ含めること。
        - 小学生が理解できる日本語を使うこと。
        - 構造化されたJSON形式で出力すること。
      `;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
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
                question: { type: Type.STRING, description: "問題文" },
                options: { type: Type.ARRAY, items: { type: Type.STRING }, description: "3つの選択肢" },
                answerIndex: { type: Type.NUMBER, description: "正解のインデックス(0-2)" }
              },
              required: ["question", "options", "answerIndex"]
            }
          }
        }
      });

      const generatedProblems: MathProblem[] = JSON.parse(response.text).map((p: any, i: number) => ({
        ...p,
        id: `prob-${Date.now()}-${i}`
      }));

      setGameState({
        problems: generatedProblems,
        currentIndex: 0,
        wrongProblemIds: [],
        status: AppStatus.PLAYING,
        isCorrect: null
      });
    } catch (error) {
      console.error(error);
      alert("エラーがおきたよ。もういちどためしてね！");
      setGameState(prev => ({ ...prev, status: AppStatus.IDLE }));
    }
  };

  const handleAnswer = (choiceIndex: number) => {
    const currentProblem = gameState.problems[gameState.currentIndex];
    const correct = choiceIndex === currentProblem.answerIndex;

    if (correct) {
      soundService.playSuccess();
    } else {
      soundService.playFailure();
    }

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

        if (isEndOfRound) {
          return {
            ...prev,
            status: AppStatus.RETRY_SUMMARY,
            currentIndex: nextIndex,
            isCorrect: null
          };
        }

        return {
          ...prev,
          status: AppStatus.PLAYING,
          currentIndex: nextIndex,
          isCorrect: null
        };
      });
      // Clear memo for each new problem
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

  return (
    <div className="h-screen w-screen flex flex-col p-4 md:p-8 gap-4 overflow-hidden select-none">
      {/* Header */}
      <div className="flex justify-between items-center px-4 py-2 bg-white rounded-2xl shadow-sm border-b-4 border-sky-200">
        <h1 className="text-xl md:text-3xl font-black text-sky-600 tracking-wider">
          AI さんすうクエスト ⚔️
        </h1>
        <div className="flex gap-2 items-center">
          {gameState.problems.length > 0 && (
            <span className="text-sm md:text-lg font-bold text-slate-500 bg-sky-100 px-3 py-1 rounded-full">
              {gameState.status === AppStatus.RETRY_SUMMARY ? 'リザルト' : `${Math.min(gameState.currentIndex + 1, gameState.problems.length)} / ${gameState.problems.length}`}
            </span>
          )}
          <button 
            onClick={resetGame}
            className="text-xs md:text-sm bg-slate-200 hover:bg-slate-300 text-slate-600 px-3 py-1 rounded-full font-bold transition-all"
          >
            さいしょから
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col gap-4 min-h-0">
        
        {gameState.status === AppStatus.IDLE && (
          <div className="flex-1 flex flex-col items-center justify-center bg-white rounded-3xl shadow-xl border-4 border-dashed border-sky-300 p-8 text-center animate-in fade-in duration-500">
            <div className="text-6xl mb-6">📸</div>
            <h2 className="text-2xl md:text-4xl font-black text-slate-700 mb-4">
              ドリルのしゃしんをアップしよう！
            </h2>
            <p className="text-slate-500 mb-8 max-w-md">
              AIがしゃしんをみて、きみにぴったりの「とくべつもんだい」をつくってくれるよ。
            </p>
            <label className="group relative overflow-hidden bg-sky-500 hover:bg-sky-600 text-white px-10 py-6 rounded-3xl text-2xl font-black shadow-lg hover:shadow-2xl hover:-translate-y-1 transition-all cursor-pointer">
              <span>カメラでとる / ファイルをえらぶ</span>
              <input 
                type="file" 
                accept="image/*" 
                onChange={handleFileUpload} 
                className="hidden"
              />
            </label>
          </div>
        )}

        {gameState.status === AppStatus.LOADING && (
          <div className="flex-1 flex flex-col items-center justify-center bg-white rounded-3xl p-8 text-center">
            <div className="w-20 h-20 border-8 border-sky-200 border-t-sky-500 rounded-full animate-spin mb-6"></div>
            <p className="text-2xl font-bold text-sky-600 animate-pulse">{loadingMsg}</p>
          </div>
        )}

        {(gameState.status === AppStatus.PLAYING || gameState.status === AppStatus.FEEDBACK) && (
          <>
            {/* Top Half: Question & Answer */}
            <div className="h-1/2 flex flex-col gap-4 relative">
              <div className="flex-1 bg-white rounded-3xl shadow-lg border-4 border-sky-100 p-6 overflow-y-auto">
                <div className="text-xl md:text-3xl font-bold leading-relaxed text-slate-700">
                  {gameState.problems[gameState.currentIndex]?.question}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 md:gap-6 shrink-0">
                {gameState.problems[gameState.currentIndex]?.options.map((option, idx) => (
                  <button
                    key={idx}
                    disabled={gameState.status === AppStatus.FEEDBACK}
                    onClick={() => handleAnswer(idx)}
                    className="aspect-square md:aspect-auto md:py-8 bg-sky-400 hover:bg-sky-500 active:scale-95 text-white rounded-3xl text-xl md:text-4xl font-black shadow-lg transition-all border-b-8 border-sky-600 disabled:opacity-50"
                  >
                    {option}
                  </button>
                ))}
              </div>

              {/* Feedback Overlay */}
              {gameState.status === AppStatus.FEEDBACK && (
                <div className="absolute inset-0 z-50 flex items-center justify-center pointer-events-none">
                  <div className={`text-[12rem] md:text-[20rem] font-black animate-ping drop-shadow-2xl ${gameState.isCorrect ? 'text-rose-500' : 'text-blue-500'}`}>
                    {gameState.isCorrect ? '◯' : '×'}
                  </div>
                </div>
              )}
            </div>

            {/* Bottom Half: ScratchPad */}
            <div className="h-1/2 flex flex-col gap-2 min-h-0">
              <div className="flex justify-between items-center px-2">
                <span className="text-sm font-bold text-slate-400">けいさんメモ</span>
                <button 
                  onClick={() => clearCanvasRef.current()}
                  className="bg-slate-200 hover:bg-slate-300 text-slate-600 px-4 py-1 rounded-full text-xs font-bold transition-all shadow-sm"
                >
                  メモをけす 🧹
                </button>
              </div>
              <div className="flex-1 min-h-0">
                <ScratchPad onClearRef={(fn) => clearCanvasRef.current = fn} />
              </div>
            </div>
          </>
        )}

        {gameState.status === AppStatus.RETRY_SUMMARY && (
          <div className="flex-1 flex flex-col items-center justify-center bg-white rounded-3xl shadow-xl p-8 text-center animate-in zoom-in duration-300 border-4 border-sky-400">
            {gameState.wrongProblemIds.length === 0 ? (
              <>
                <div className="text-8xl mb-6">🎉</div>
                <h2 className="text-4xl md:text-6xl font-black text-rose-500 mb-4">
                  オールクリア！
                </h2>
                <p className="text-xl md:text-2xl text-slate-600 mb-8">
                  ぜんぶ せいかいできたね！すごいぞ！
                </p>
                <button 
                  onClick={resetGame}
                  className="bg-sky-500 hover:bg-sky-600 text-white px-12 py-6 rounded-3xl text-2xl font-black shadow-xl transition-all"
                >
                  もういちどあそぶ
                </button>
              </>
            ) : (
              <>
                <div className="text-8xl mb-6">💪</div>
                <h2 className="text-4xl md:text-6xl font-black text-sky-600 mb-4">
                  リトライ！
                </h2>
                <p className="text-xl md:text-2xl text-slate-600 mb-8">
                  まちがえたもんだいが <span className="text-rose-500 font-black">{gameState.wrongProblemIds.length}もん</span> あるよ。<br/>
                  ぜんぶ せいかいするまで おわれないぞ！
                </p>
                <button 
                  onClick={startRetryRound}
                  className="bg-sky-500 hover:bg-sky-600 text-white px-12 py-6 rounded-3xl text-2xl font-black shadow-xl transition-all"
                >
                  まちがえた もんだいに ちょうせん
                </button>
              </>
            )}
          </div>
        )}

        {gameState.status === AppStatus.FINISHED && (
          <div className="flex-1 flex flex-col items-center justify-center bg-white rounded-3xl shadow-xl p-8 text-center border-4 border-rose-400">
             <div className="text-9xl mb-6 animate-bounce">👑</div>
             <h2 className="text-5xl md:text-7xl font-black text-rose-500 mb-6 italic underline decoration-sky-300">
               QUEST CLEAR!
             </h2>
             <p className="text-2xl text-slate-600 mb-10">
               きみは 算数マスターだ！<br/>
               つぎの ドリルも AIに まかせてね。
             </p>
             <button 
                onClick={resetGame}
                className="bg-sky-500 hover:bg-sky-600 text-white px-12 py-6 rounded-3xl text-2xl font-black shadow-xl transition-all"
              >
                あたらしい クエストへ
              </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
