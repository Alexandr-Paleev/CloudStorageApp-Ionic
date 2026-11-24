import { Fragment, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonPage,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
} from '@ionic/react';
import { send, stopCircleOutline } from 'ionicons/icons';
import aiService, { type AnswerSource } from '../services/ai.service';
import { HttpError } from '../utils/http.utils';
import { citedNumbers } from '../utils/citations';
import './Ask.css';

/** The longest question the route takes (`MAX_QUESTION_CHARS` on the server). */
const MAX_QUESTION = 500;

interface Turn {
  question: string;
  sources: AnswerSource[];
  text: string;
  state: 'asking' | 'answering' | 'done' | 'empty' | 'stopped' | 'failed';
  error?: string;
}

/** What a failure before the answer began says to the person. */
function sayFailure(error: unknown): string {
  if (error instanceof HttpError) {
    if (error.status === 501) return 'Questions are not available on this site.';
    // A spent limit says when to come back, in local time (`httpErrorFrom`).
    return error.message;
  }
  return 'The question could not be asked. Check the connection and try again.';
}

/**
 * The answer, with each [n] a link to the file it cites.
 *
 * Text, always: the answer is a model's writing about the person's own files,
 * and a file can ask a model to write anything. React escapes every string
 * here; nothing is ever set as HTML.
 */
const AnswerText: React.FC<{ text: string; sources: AnswerSource[] }> = ({ text, sources }) => {
  const navigate = useNavigate();
  const parts = text.split(/(\[\d+\])/);
  return (
    <p className="ask-answer-text">
      {parts.map((part, i) => {
        const source = /^\[(\d+)\]$/.test(part)
          ? sources.find((s) => `[${s.n}]` === part)
          : undefined;
        if (!source) return <Fragment key={i}>{part}</Fragment>;
        return (
          /* The file's name as text, never as aria-label or title: Sentry
             describes a tapped element by those, and the name is the owner's. */
          <button
            key={i}
            type="button"
            className="ask-cite"
            onClick={() => navigate(`/file/${source.fileId}`)}
          >
            <span className="sr-only">Source </span>
            {source.n}
            <span className="sr-only">: {source.fileName}</span>
          </button>
        );
      })}
    </p>
  );
};

/** The pieces the answer cites, each with its file, for the reader to check it against. */
const Sources: React.FC<{ text: string; sources: AnswerSource[] }> = ({ text, sources }) => {
  const navigate = useNavigate();
  const cited = citedNumbers(text)
    .map((n) => sources.find((s) => s.n === n))
    .filter((s): s is AnswerSource => !!s);
  if (cited.length === 0) return null;
  return (
    <ol className="ask-sources" aria-label="Sources">
      {cited.map((source) => (
        <li key={source.n}>
          <button
            type="button"
            className="ask-source"
            onClick={() => navigate(`/file/${source.fileId}`)}
          >
            <span className="ask-source-name">
              [{source.n}] {source.fileName}
            </span>
            <span className="ask-source-excerpt">{source.content}</span>
          </button>
        </li>
      ))}
    </ol>
  );
};

/**
 * Questions asked of one's own files (ADR 0019, step 4).
 *
 * The answer is read from the pieces of the files nearest to the question,
 * and streams in: the sources arrive first, then the words. Every account
 * may ask, a demo's included, within the day's limit; production answers on
 * Workers AI for free. Stop ends the request, and the server stops the model.
 *
 * What is asked and answered is the owner's, so Hotjar records none of it.
 */
const Ask: React.FC = () => {
  const navigate = useNavigate();
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const running = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);

  const busy = turns.some((t) => t.state === 'asking' || t.state === 'answering');

  // Leaving the page is a stop as well: nobody is reading the rest.
  useEffect(() => () => running.current?.abort(), []);

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' });
  }, [turns]);

  /** Changes the last turn, the one being answered. */
  const update = (change: (turn: Turn) => Turn) =>
    setTurns((all) => [...all.slice(0, -1), change(all[all.length - 1]!)]);

  const ask = async () => {
    const text = question.trim();
    if (!text || busy) return;
    setQuestion('');
    setTurns((all) => [...all, { question: text, sources: [], text: '', state: 'asking' }]);

    const controller = new AbortController();
    running.current = controller;
    try {
      await aiService.ask(
        text,
        (event) => {
          if (event.type === 'sources') {
            update((t) => ({ ...t, sources: event.sources, state: 'answering' }));
          } else if (event.type === 'text') {
            update((t) => ({ ...t, text: t.text + event.text }));
          } else if (event.type === 'done') {
            update((t) => ({ ...t, state: event.empty ? 'empty' : 'done' }));
          } else {
            update((t) => ({ ...t, state: 'failed', error: event.message }));
          }
        },
        controller.signal
      );
      // A body that ended without its last line: the connection went.
      update((t) =>
        t.state === 'asking' || t.state === 'answering'
          ? { ...t, state: 'failed', error: 'The answer was cut off. Try asking again.' }
          : t
      );
    } catch (error) {
      if (controller.signal.aborted) {
        update((t) => ({ ...t, state: 'stopped' }));
      } else {
        update((t) => ({ ...t, state: 'failed', error: sayFailure(error) }));
      }
    } finally {
      if (running.current === controller) running.current = null;
    }
  };

  const stop = () => running.current?.abort();

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/dashboard" />
          </IonButtons>
          <IonTitle>Ask your files</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="ion-padding">
        <div className="ask-thread" data-hj-suppress="">
          {turns.length === 0 && (
            <div className="ask-intro">
              <p>
                Ask what your files say: when a lease ends, what a bill came to, what a contract
                says about notice.
              </p>
              <IonText color="medium">
                <p>
                  The answer is read only from your indexed files, and cites the pieces it comes
                  from. Free, within a daily limit.
                </p>
              </IonText>
            </div>
          )}

          {turns.map((turn, i) => (
            <section
              key={i}
              className="ask-turn"
              aria-live={i === turns.length - 1 ? 'polite' : undefined}
            >
              <p className="ask-question">{turn.question}</p>

              {turn.state === 'asking' && (
                <div className="ask-waiting">
                  <IonSpinner name="dots" aria-label="Finding the pieces" />
                </div>
              )}

              {turn.text && <AnswerText text={turn.text} sources={turn.sources} />}

              {turn.state === 'answering' && !turn.text && (
                <div className="ask-waiting">
                  <IonSpinner name="dots" aria-label="Writing the answer" />
                </div>
              )}

              {turn.state === 'empty' && (
                <div className="ask-note">
                  <p>None of your files are indexed yet, so there is nothing to answer from.</p>
                  <IonButton size="small" fill="outline" onClick={() => navigate('/dashboard')}>
                    Index them on the dashboard
                  </IonButton>
                </div>
              )}

              {turn.state === 'stopped' && (
                <IonText color="medium">
                  <p className="ask-note">Stopped.</p>
                </IonText>
              )}

              {turn.state === 'failed' && (
                <IonText color="danger">
                  <p className="ask-note" role="alert">
                    {turn.error}
                  </p>
                </IonText>
              )}

              {(turn.state === 'done' || turn.state === 'stopped') && (
                <Sources text={turn.text} sources={turn.sources} />
              )}
            </section>
          ))}
          <div ref={end} />
        </div>
      </IonContent>

      {/* Plain elements rather than IonFooter and IonTextarea: Ionic's
          components share one chunk that every page loads first, and these
          two, used nowhere else, put it over its budget (`npm run size`). */}
      <footer className="ask-compose">
        <textarea
          className="ask-input"
          // A question being typed is the owner's as much as one sent.
          data-hj-suppress=""
          data-testid="ask-question"
          aria-label="Your question"
          placeholder="When does my lease end?"
          value={question}
          maxLength={MAX_QUESTION}
          rows={1}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            // Enter asks; Shift+Enter is a new line.
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void ask();
            }
          }}
        />
        {busy ? (
          <IonButton
            fill="clear"
            onClick={stop}
            aria-label="Stop"
            title="Stop"
            data-testid="ask-stop"
          >
            <IonIcon icon={stopCircleOutline} slot="icon-only" aria-hidden="true" />
          </IonButton>
        ) : (
          <IonButton
            fill="clear"
            onClick={() => void ask()}
            disabled={!question.trim()}
            aria-label="Ask"
            title="Ask"
            data-testid="ask-send"
          >
            <IonIcon icon={send} slot="icon-only" aria-hidden="true" />
          </IonButton>
        )}
      </footer>
    </IonPage>
  );
};

export default Ask;
