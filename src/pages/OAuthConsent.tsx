import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  IonButton,
  IonContent,
  IonHeader,
  IonPage,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
} from '@ionic/react';
import { isDemoEmail } from '@cloud-storage/core/demo-address';
import { useAuth } from '../contexts/AuthContext';
import assistantsService, { leaveFor, whereBack } from '../services/assistants.service';
import {
  clearPendingConsent,
  isAuthorizationId,
  leavePendingConsent,
  pendingConsent,
} from '../utils/pending-consent';
import './Account.css';
import './OAuthConsent.css';

/**
 * Where Supabase Auth's OAuth server sends a person whose assistant is
 * signing in to `/mcp` (ADR 0020): which assistant asks, what it will be able
 * to do, and the answer.
 *
 * Anyone can register an assistant, under any name; what stands between it
 * and the files is this page. So it says the name as the assistant gave it,
 * and, as the one thing a registration cannot dress up, the address the
 * person goes back to.
 *
 * A demo account is told it cannot connect one, and may only refuse: `/mcp`
 * refuses a demo whatever is answered here, since approving is a call to
 * Supabase this page cannot stand in front of.
 */
const OAuthConsent: React.FC = () => {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const fromAddress = params.get('authorization_id');
  /* The address's own first: a new request replaces one left from before.
     A malformed one in the address is no request at all. */
  const [id] = useState(() =>
    fromAddress !== null ? (isAuthorizationId(fromAddress) ? fromAddress : null) : pendingConsent()
  );

  /* Signed out: sign in first, and come back here (utils/pending-consent.ts). */
  useEffect(() => {
    if (loading || user || !id) return;
    leavePendingConsent(id);
    navigate('/login', { replace: true });
  }, [loading, user, id, navigate]);

  const pending = useQuery({
    queryKey: ['oauth-request', id, user?.id],
    queryFn: () => assistantsService.pending(id!),
    enabled: !!user && !!id,
    retry: false,
    staleTime: Infinity,
  });

  /* Answered before, for the same assistant and the same access: Supabase
     says to go straight back. */
  const goTo = pending.data?.kind === 'answered' ? pending.data.goTo : null;
  useEffect(() => {
    if (!goTo) return;
    clearPendingConsent();
    leaveFor(goTo);
  }, [goTo]);

  const answer = useMutation({
    mutationFn: (allow: boolean) => assistantsService.answer(id!, allow),
    onSuccess: (url) => {
      clearPendingConsent();
      leaveFor(url);
    },
  });

  const body = (() => {
    if (!id) {
      return (
        <section className="account-card">
          <h2 className="account-heading">Connect an assistant</h2>
          <p className="consent-text">
            This page opens when an assistant asks to read your files, after you add Cloud Storage
            to it. Start from the assistant: this link is not complete.
          </p>
          <IonButton expand="block" fill="outline" onClick={() => navigate('/dashboard')}>
            Go to your files
          </IonButton>
        </section>
      );
    }

    if (loading || !user || pending.isLoading || goTo) {
      return (
        <div className="consent-loading">
          <IonSpinner aria-label="Loading" />
        </div>
      );
    }

    if (pending.isError || !pending.data || pending.data.kind !== 'ask') {
      return (
        <section className="account-card">
          <h2 className="account-heading">Connect an assistant</h2>
          <IonText color="danger">
            <p className="consent-text" role="alert">
              {pending.error instanceof Error
                ? pending.error.message
                : 'Could not read what the assistant asks for.'}{' '}
              The request may have expired: start again from the assistant.
            </p>
          </IonText>
        </section>
      );
    }

    const { request } = pending.data;
    const demo = isDemoEmail(user.email);
    return (
      <section className="account-card">
        <h2 className="account-heading">An assistant asks to read your files</h2>
        {/* As the assistant registered it: anyone can, under any name. */}
        <p className="consent-client" data-hj-suppress="">
          {request.client.name || 'An unnamed assistant'}
        </p>
        <p className="consent-text">
          You go back to <strong className="consent-place">{whereBack(request.redirectUri)}</strong>{' '}
          after you answer.
        </p>
        {/* A link to this page can be sent by anyone with an assistant of
            their own: approving it would hand them these files. */}
        <p className="consent-text consent-warning">
          Allow only if you have just added Cloud Storage to this assistant yourself. A link someone
          sent you can ask for your files on behalf of their assistant.
        </p>

        <h3 className="consent-subheading">It will be able to</h3>
        <ul className="consent-list">
          <li>list your files and folders, with their names, types, sizes and dates;</li>
          <li>search them by meaning, and read what they say;</li>
          <li>ask questions of them, from this account’s daily allowance.</li>
        </ul>
        <h3 className="consent-subheading">It will not be able to</h3>
        <ul className="consent-list">
          <li>upload, rename, move, delete or share a file;</li>
          <li>see your plan, your billing, or your share links.</li>
        </ul>
        <p className="consent-text">
          What it reads goes to the assistant and to whoever runs it. You can take access back at
          any time, from your account page.
        </p>

        <p className="consent-text consent-who" data-hj-suppress="">
          Signed in as <strong>{request.email || user.email}</strong>.{' '}
          <button
            type="button"
            className="consent-link"
            disabled={answer.isPending}
            onClick={async () => {
              /* The request waits for the other account (pending-consent.ts). */
              leavePendingConsent(id);
              await logout();
            }}
          >
            Use another account
          </button>
        </p>

        {demo && (
          <IonText color="warning">
            <p className="consent-text" role="note">
              A demo account cannot connect an assistant: it is erased within a day. Sign up to
              connect one.
            </p>
          </IonText>
        )}

        <div className="consent-actions">
          <IonButton
            expand="block"
            fill="outline"
            disabled={answer.isPending}
            onClick={() => answer.mutate(false)}
          >
            Deny
          </IonButton>
          {!demo && (
            <IonButton
              expand="block"
              disabled={answer.isPending}
              onClick={() => answer.mutate(true)}
            >
              {answer.isPending ? <IonSpinner name="crescent" aria-label="Working" /> : 'Allow'}
            </IonButton>
          )}
        </div>

        {answer.isError && (
          <IonText color="danger">
            <p className="consent-text" role="alert">
              {answer.error instanceof Error ? answer.error.message : 'Could not send the answer.'}
            </p>
          </IonText>
        )}
      </section>
    );
  })();

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Connect an assistant</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <div className="account-page">{body}</div>
      </IonContent>
    </IonPage>
  );
};

export default OAuthConsent;
