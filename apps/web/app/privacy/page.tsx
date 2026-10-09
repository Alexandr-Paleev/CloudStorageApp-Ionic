import { LegalPage, legalMetadata } from '../_components/legal-page';

export const metadata = legalMetadata('privacy');

export default function PrivacyPage() {
  return <LegalPage document="privacy" />;
}
