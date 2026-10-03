import type { Language } from "../../../shared/records";
import type { QuizFormat } from "../../../shared/stage2";

export type { Language };

export type QuizFormatSample = Record<QuizFormat, { text?: string; context?: string; choices?: string[]; tiles?: string[] }>;
