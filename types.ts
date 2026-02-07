
export interface MathProblem {
  id: string;
  question: string;
  options: string[];
  answerIndex: number;
}

export enum AppStatus {
  IDLE = 'IDLE',
  LOADING = 'LOADING',
  PLAYING = 'PLAYING',
  FEEDBACK = 'FEEDBACK',
  RETRY_SUMMARY = 'RETRY_SUMMARY',
  FINISHED = 'FINISHED'
}

export interface GameState {
  problems: MathProblem[];
  currentIndex: number;
  wrongProblemIds: string[];
  status: AppStatus;
  isCorrect: boolean | null;
}
