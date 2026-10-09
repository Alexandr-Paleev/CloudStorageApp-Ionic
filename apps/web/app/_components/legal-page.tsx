import type { Metadata } from 'next';
import Link from 'next/link';
import { LEGAL, readLegalDocument, type LegalDocument } from '../../lib/legal';
import type { Block, Inline } from '../../lib/markdown';
import styles from './legal-page.module.css';

export function legalMetadata(document: LegalDocument): Metadata {
  const { title, description, path } = LEGAL[document];
  return { title, description, alternates: { canonical: path } };
}

function renderInline(inline: Inline, key: number) {
  switch (inline.kind) {
    case 'strong':
      return <strong key={key}>{inline.text}</strong>;
    case 'emphasis':
      return <em key={key}>{inline.text}</em>;
    case 'code':
      return <code key={key}>{inline.text}</code>;
    case 'link':
      /* A page of this site, or somewhere else. */
      return inline.href.startsWith('/') ? (
        <Link key={key} href={inline.href}>
          {inline.text}
        </Link>
      ) : (
        <a key={key} href={inline.href} rel="noreferrer">
          {inline.text}
        </a>
      );
    default:
      return inline.text;
  }
}

function renderBlock(block: Block, key: number) {
  switch (block.kind) {
    case 'heading': {
      const Tag = `h${block.level}` as const;
      return <Tag key={key}>{block.content.map(renderInline)}</Tag>;
    }
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul';
      return (
        <Tag key={key}>
          {block.items.map((item, index) => (
            <li key={index}>{item.map(renderInline)}</li>
          ))}
        </Tag>
      );
    }
    case 'rule':
      return <hr key={key} />;
    default:
      return <p key={key}>{block.content.map(renderInline)}</p>;
  }
}

export function LegalPage({ document }: { document: LegalDocument }) {
  return (
    <article className={styles.document}>{readLegalDocument(document).map(renderBlock)}</article>
  );
}
