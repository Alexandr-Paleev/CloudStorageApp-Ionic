# Privacy Policy for Cloud Storage App

**Last Updated:** October 20, 2026

## Introduction

Cloud Storage App ("we", "our", or "us") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, and safeguard your information when you use our application.

## Information We Collect

### 1. Account Information
- **Email address** (when you sign up)
- **Google account information** (if you sign in with Google)
- **Profile information** (name, profile picture if provided by Google)

### 2. Files and Content
- Files you upload to our service
- Folder names and file metadata (size, type, upload date)
- File storage locations (determined by our routing logic)

### 3. Technical Information
- Browser type and version
- Device information (for PWA functionality)
- IP address and location data (for security)
- Usage statistics, in the app (Google Analytics 4 and Hotjar)
- Error reports (Sentry)

## How We Use Your Information

We use your information to:
- Provide and maintain the Service
- Authenticate your account
- Store and manage your files
- Send you service-related notifications
- Improve our Service and user experience
- Detect and prevent fraud and abuse
- Comply with legal obligations

## Data Storage

Your data is stored securely using:
- **Supabase** (authentication, metadata and file storage)
- **Cloudinary** (image storage)
- **Google Drive** (optional, with your explicit consent)
- **Cloudflare R2** and **Dropbox** (coming soon)

### Semantic search, and what it sends where

If this deployment has semantic search switched on, asking to index a file
sends **that file's name and contents** — the image itself, or the first few
kilobytes of a text file — to the model provider the deployment is configured
for: Anthropic, or Cloudflare Workers AI. The provider returns one sentence
describing the file and a few tags. The name, the sentence and the tags are
then turned into a numeric representation, by Voyage AI when the model is
Anthropic's and by Cloudflare Workers AI otherwise. The sentence, the tags and
the representation are stored next to your file's row and are readable only
by you. A search by meaning sends the words you search for to the same
service, to be turned into the same kind of representation.

Indexing never happens on its own. It runs when you press the button that
offers it, on the files you own, and files kept in your own Google Drive or
Dropbox are never sent anywhere. Nothing is sent when the feature is switched
off, which is the default.

## Data Sharing

We **DO NOT** sell your personal information. We may share data with:
- **Service providers** (Vercel, Supabase, Cloudinary, Stripe, Sentry) - only as necessary to provide the Service
- **Analytics** (Google Analytics, Hotjar) - only once you have accepted them in the app
- **Model providers** (Anthropic with Voyage AI, or Cloudflare Workers AI) - only the name and contents of a file you have asked to index and the words of a search by meaning, and only while semantic search is enabled on this deployment
- **Law enforcement** - if required by law
- **Business transfers** - in case of merger or acquisition

## Your Rights

You have the right to:
- Access your personal data
- Correct inaccurate data
- Delete your account and data
- Export your data
- Opt-out of non-essential data collection

### How to Exercise Your Rights

Contact us at: [paleev045@gmail.com](mailto:paleev045@gmail.com) (or via GitHub Issues)

## Data Retention

- **Account data**: Retained while your account is active
- **Files**: Retained until you delete them or close your account
- **Demo accounts**: Kept for 24 hours, then deleted with their files when the next demo account is opened
- **Logs**: Kept by the hosting (Vercel) and the error reporting (Sentry) for as long as their plans keep them

## Security

We implement industry-standard security measures:
- Encrypted data transmission (HTTPS)
- Secure authentication (Supabase Auth)
- Row Level Security (RLS) policies
- Regular security audits

## Cookies and Tracking

We use:
- **Essential storage**: the app keeps your sign-in session, and your answer about analytics cookies, in your browser's local storage
- **Analytics cookies**: Google Analytics 4 sets its own cookies in the app, and so does Hotjar, which the app also loads. Neither runs until you accept them in the banner the app shows. Your answer is kept in this browser for 24 months, and asked for again sooner if the tools or what they are used for change; you can change it at any time, from the foot of the sign-in page or on the Account page. Turning them off removes their cookies, and so does the app whenever it starts without a yes from you. They also wait until the page's address carries no sign-in tokens or codes, and blocking them in your browser does not break the app
- **Error reports**: Sentry receives a report when the app fails. Every field in it that holds an address is cut at the address's query string and fragment, and the names of your files are cut out of the addresses and paths in it
- **No third-party advertising cookies**

The public site sets no analytics cookies.

## Children's Privacy

Our Service is not intended for users under 13 years old. We do not knowingly collect data from children.

## Changes to This Policy

We may update this Privacy Policy. Every change is dated at the top of this policy, and its whole history is public in [the repository](https://github.com/Alexandr-Paleev/CloudStorageApp-Ionic/commits/main/apps/web/content).

## Third-Party Services

We use the following third-party services:
- **Supabase** - [Privacy Policy](https://supabase.com/privacy)
- **Cloudinary** - [Privacy Policy](https://cloudinary.com/privacy)
- **Google Drive** - [Privacy Policy](https://policies.google.com/privacy)
- **Sentry** - [Privacy Policy](https://sentry.io/privacy/)
- **Vercel** - [Privacy Policy](https://vercel.com/legal/privacy-policy)
- **Stripe** - [Privacy Policy](https://stripe.com/privacy)
- **Google Analytics** - [Privacy Policy](https://policies.google.com/privacy)
- **Hotjar** - [Privacy Policy](https://www.hotjar.com/legal/policies/privacy/)
- **Anthropic** (semantic search, when it is switched on) - [Privacy Policy](https://www.anthropic.com/legal/privacy)
- **Voyage AI** (semantic search, when it is switched on) - [Privacy Policy](https://www.voyageai.com/privacy)
- **Cloudflare Workers AI** (semantic search, when it is switched on) - [Privacy Policy](https://www.cloudflare.com/privacypolicy/)

## Contact Us

If you have questions about this Privacy Policy:
- **Email**: [paleev045@gmail.com](mailto:paleev045@gmail.com)
- **GitHub**: [Open an Issue](https://github.com/Alexandr-Paleev/CloudStorageApp-Ionic/issues)

## Compliance

This Privacy Policy is written to meet:
- **GDPR** (General Data Protection Regulation)
- **CCPA** (California Consumer Privacy Act)
- **Google OAuth 2.0 Policy**

---

**Community Edition** is open-source (MIT License).  
**Pro Edition** may have additional terms for enterprise customers.
