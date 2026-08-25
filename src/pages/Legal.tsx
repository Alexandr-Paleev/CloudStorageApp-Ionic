import {
  IonBackButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonPage,
  IonTitle,
  IonToolbar,
} from '@ionic/react';
import termsMarkdown from '../../TERMS_OF_SERVICE.md?raw';
import privacyMarkdown from '../../PRIVACY_POLICY.md?raw';
import './Legal.css';

/**
 * Renders the legal documents that live as markdown at the repository root, so
 * there is one copy rather than a second one drifting inside the app.
 *
 * These routes are deliberately public: Stripe reviews them before enabling
 * live payments, and app stores need a reachable privacy policy — neither has
 * an account to log in with.
 */
const DOCUMENTS = {
  terms: { title: 'Terms of Service', markdown: termsMarkdown },
  privacy: { title: 'Privacy Policy', markdown: privacyMarkdown },
} as const;

export type LegalDocument = keyof typeof DOCUMENTS;

/** Inline formatting: **bold**, `code` and [text](href) */
function renderInline(text: string, keyPrefix: string) {
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  return text.split(pattern).map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={key}>{part.slice(1, -1)}</code>;
    }
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      return (
        <a key={key} href={link[2]} target="_blank" rel="noreferrer">
          {link[1]}
        </a>
      );
    }
    return <span key={key}>{part}</span>;
  });
}

/**
 * Small on purpose: these documents only use headings, bullets, bold, links,
 * code spans and rules. A markdown library would be a dependency for four
 * hundred lines of static text.
 */
function renderMarkdown(markdown: string) {
  const blocks: React.ReactNode[] = [];
  let listItems: string[] = [];

  const flushList = (key: string) => {
    if (!listItems.length) return;
    blocks.push(
      <ul key={key}>
        {listItems.map((item, index) => (
          <li key={`${key}-${index}`}>{renderInline(item, `${key}-${index}`)}</li>
        ))}
      </ul>
    );
    listItems = [];
  };

  markdown.split('\n').forEach((rawLine, index) => {
    const line = rawLine.trimEnd();
    const key = `l${index}`;

    if (/^\s*[-*]\s+/.test(line)) {
      listItems.push(line.replace(/^\s*[-*]\s+/, ''));
      return;
    }
    flushList(`ul${index}`);

    if (!line.trim()) return;
    if (/^---+$/.test(line.trim())) {
      blocks.push(<hr key={key} />);
      return;
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      const Tag = `h${heading[1].length}` as 'h1' | 'h2' | 'h3' | 'h4';
      blocks.push(<Tag key={key}>{renderInline(heading[2], key)}</Tag>);
      return;
    }

    blocks.push(<p key={key}>{renderInline(line, key)}</p>);
  });

  flushList('ul-last');
  return blocks;
}

const Legal: React.FC<{ document: LegalDocument }> = ({ document }) => {
  const { title, markdown } = DOCUMENTS[document];

  return (
    <IonPage>
      <IonHeader className="ion-no-border">
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/login" />
          </IonButtons>
          <IonTitle>{title}</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <article className="legal-document" data-testid={`legal-${document}`}>
          {renderMarkdown(markdown)}
        </article>
      </IonContent>
    </IonPage>
  );
};

export default Legal;
