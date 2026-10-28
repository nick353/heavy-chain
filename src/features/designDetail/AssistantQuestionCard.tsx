import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { AssistantQuestion } from './assistantQuestions';

/** Light's confirmation form: one question at a time with n/N, 前へ／次へ, and 確認 on the last one. */
export function AssistantQuestionCard({ questions, disabled, onConfirm }: {
  questions: AssistantQuestion[]; disabled: boolean; onConfirm: (answers: string[][]) => void;
}) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<string[][]>(() => questions.map(() => []));
  const question = questions[step];
  const answer = answers[step] ?? [];
  const last = step === questions.length - 1;
  const canMove = !disabled && (question.kind !== 'single' || answer.length === 1);
  const set = (value: string[]) => setAnswers((current) => current.map((item, index) => index === step ? value : item));
  return <section data-testid="design-assistant-questions" className="mt-3">
    <p className="flex items-start gap-2 text-sm leading-5 text-neutral-200"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/5"><Sparkles className="h-4 w-4 text-[#0bcabc]" /></span>最適な結果を得るため、いくつか確認させてください。</p>
    <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <span data-testid="design-question-step" className="inline-block rounded-full bg-[#0bcabc] px-3 py-0.5 text-xs font-medium text-neutral-950">{step + 1} / {questions.length}</span>
      <p className="mt-3 text-sm text-neutral-100">{question.kind === 'single' && <span className="mr-1 text-red-400">*</span>}{question.title}</p>
      {question.kind === 'text' ? <>
        <textarea data-testid="design-question-text" disabled={disabled} maxLength={500} value={answer[0] ?? ''} onChange={(event) => set([event.target.value])}
          placeholder={question.options[0] ?? ''} className="mt-3 h-16 w-full resize-none rounded-lg border border-white/10 bg-transparent p-3 text-xs text-neutral-100 placeholder:text-neutral-500 focus:outline-none" />
        <p className="text-right text-[10px] text-neutral-500">{(answer[0] ?? '').length}/500</p>
      </> : <div className="mt-3 flex flex-col gap-2" role={question.kind === 'single' ? 'radiogroup' : 'group'} aria-label={question.title}>
        {question.options.map((option) => {
          const checked = answer.includes(option);
          return <button key={option} type="button" role={question.kind === 'single' ? 'radio' : 'checkbox'} aria-checked={checked} disabled={disabled}
            data-testid="design-question-option"
            onClick={() => set(question.kind === 'single' ? [option] : checked ? answer.filter((item) => item !== option) : [...answer, option])}
            className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-left text-xs leading-[18px] ${checked ? 'border-[#0bcabc] text-white' : 'border-white/10 text-neutral-200'} hover:border-[#0bcabc]/60`}>
            <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center border ${question.kind === 'single' ? 'rounded-full' : 'rounded'} ${checked ? 'border-[#0bcabc] bg-[#0bcabc]' : 'border-white/30'}`} />
            <span>{option}</span>
          </button>;
        })}
      </div>}
      <div className="mt-3 flex justify-end gap-2">
        {step > 0 && <button type="button" disabled={disabled} onClick={() => setStep(step - 1)} className="h-8 w-20 rounded-lg border border-white/15 text-xs text-neutral-200">前へ</button>}
        <button type="button" data-testid={last ? 'design-question-confirm' : 'design-question-next'} disabled={!canMove}
          onClick={() => last ? onConfirm(answers) : setStep(step + 1)}
          className="h-8 w-20 rounded-lg bg-[#0bcabc] text-xs text-neutral-950 disabled:bg-white/10 disabled:text-neutral-500">{last ? '確認' : '次へ'}</button>
      </div>
    </div>
  </section>;
}
